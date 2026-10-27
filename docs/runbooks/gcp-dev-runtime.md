# GCP開発実行環境 — 低額・鍵不要・段階配備

対象: `travelcanvas-development` / `asia-northeast1`

## 到達状態

| 層 | 構成 | セキュリティ | 費用制御 |
|---|---|---|---|
| CI/CD | GitHub Actions → WIF → deployer SA | SA鍵なし、repository ID/owner ID/main/専用workflowに限定 | 手動起動 |
| Image | Artifact Registry `travelcanvas-dev` | commit SHA固定、リポジトリ単位Writer | 7日削除 + 最新5版保持 |
| API | Cloud Run `travelcanvas-dev-backend` | 初回は非公開、runtime SA、秘密はSecret Manager参照 | min=0、max=1、1 CPU、512 MiB |
| Migration | Cloud Run Job `travelcanvas-dev-migrate` | migrator SAだけがDB owner URLを読める | 配備時だけ実行 |
| DB | 外部serverless PostgreSQL | TLS必須、owner/app資格情報分離 | free/低額枠を使用 |
| Redis | 外部serverless Redis | TLS `rediss://` 必須 | free/低額枠を使用 |
| Secrets | Secret Manager | secret単位IAM、値をGitHubへ保存しない | 少数アクセスのみ |

Cloud SQLとMemorystoreを常時起動すると月額3,000円上限を守れないため、開発段階では採用しない。本番移行時は可用性・リージョン・バックアップ要件を再評価する。

## 重要な境界

- `tc-dev-runtime` はDB app URLとRedis URL、用途別アプリ鍵だけを読める。
- `tc-dev-migrator` はDB owner URLだけを読める。
- `tc-dev-deployer` はCloud Runへ配備できるが、Secret Managerの値を読む権限は持たない。
- Cloud Runサービスは最初から `allUsers` を付けず、認証必須で作る。
- 外部公開は、フロントエンド・CSRF/CORS・独自ドメイン・WAF方針の確認後に別Gateで行う。
- 開発中の文書保存はコンテナの一時領域であり永続保証がない。文書機能を検証する前にGCS backend実装が必要。

## 1. main更新

Cloud Shellで、対話シェル自体には `set -e` を設定しない。

```bash
cd ~/travelcanvas
git fetch origin main
git switch main
git pull --ff-only origin main
```

## 2. runtime基盤

スクリプトは子プロセスとして実行する。途中失敗してもCloud Shell本体は終了せず、ログをホームへ残す。

```bash
bash scripts/ops/bootstrap_gcp_dev_runtime.sh
```

期待値:

- `tc-dev-migrator` SAが作成される。
- Secret Managerにアプリ用secret containerと、ランダム生成された用途別鍵の初版が作られる。
- runtime/migratorのsecret単位IAMが設定される。
- DB/Redis URLが未投入なら `FOUNDATION PASS` と表示される。これは異常ではない。

## 3. DB/Redisを用意

契約先で以下を作る。

| 値 | 条件 |
|---|---|
| DB owner URL | migration専用。DDL可能。通常APIでは使わない |
| DB app URL | 別ユーザー。通常の表DMLだけを許す |
| Redis URL | TLSの `rediss://`。開発環境専用namespace |

DB URLには `sslmode=require` を含める。ownerとappで同一資格情報を使わない。

## 4. URLをSecret Managerへ投入

値は端末へ表示されず、ログにも残らない。

```bash
bash scripts/ops/configure_gcp_dev_data_services.sh
```

入力後、secretの値ではなく版の存在だけを確認する。

```bash
for s in tc-dev-db-owner-url tc-dev-db-app-url tc-dev-redis-url; do
  gcloud secrets versions list "$s" --project=travelcanvas-development --filter='state=ENABLED' --format='table(name,state,createTime)'
done
```

## 5. GitHub Actionsから配備

Actions → **GCP dev image publish** → **Run workflow**:

- branch: `main`
- `deploy_service`: true
- `cors_origin`: 実在するHTTPSフロントエンドorigin。パスや末尾スラッシュなし

workflowは次の順で停止条件を持って実行する。

1. production imageをcommit SHAでbuild/push
2. migration Jobを更新
3. migrationを実行し、失敗ならAPI配備を中止
4. private Cloud Run APIを更新
5. `allUsers` がないことを検査
6. OIDC identity tokenで `/health` を検査

## 6. 読み取り専用監査

```bash
gcloud run services describe travelcanvas-dev-backend \
  --project=travelcanvas-development --region=asia-northeast1 \
  --format='yaml(metadata.name,status.url,spec.template.spec.serviceAccountName,spec.template.metadata.annotations)'

gcloud run services get-iam-policy travelcanvas-dev-backend \
  --project=travelcanvas-development --region=asia-northeast1

gcloud run jobs describe travelcanvas-dev-migrate \
  --project=travelcanvas-development --region=asia-northeast1 \
  --format='yaml(metadata.name,spec.template.template.spec.serviceAccountName,status)'
```

## 7. 緊急停止

課金または不審挙動があれば、サービスを削除せずトラフィックを止め、証拠を保存する。まずrevisionと監査ログを取得する。即時停止が必要な場合のみ:

```bash
gcloud run services update travelcanvas-dev-backend \
  --project=travelcanvas-development --region=asia-northeast1 \
  --max=1 --no-cpu-boost
```

Cloud Runは `min=0` のため、無通信時は0台へ縮退する。予算通知は強制停止ではないため、異常課金の自動停止は別Gateで実装する。

## 未完了Gate

| Gate | 状態 | 完了条件 |
|---|---|---|
| 外部DB/Redis契約 | BLOCKED | TLS URL 3本をSecret Managerへ登録 |
| private API初回配備 | READY | 上記URL登録後、workflowをdeploy=trueで実行 |
| frontend配備 | TODO | API URLをビルド時注入し、同じWIF/IAM原則で配備 |
| GCS文書backend | TODO | bucket単位IAM、保存時暗号化、期限付きURL、削除/保持試験 |
| 公開入口 | TODO | 独自domain、Cloud Armor/WAFまたは代替、CORS/CSRF/E2E合格後 |
| 自動費用停止 | TODO | budget Pub/Subを検証済みCloud Run functionへ接続 |
