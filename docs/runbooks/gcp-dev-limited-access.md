# GCP 開発環境(新しい project)— 読み取りの棚卸しと限定公開の設計

対象: 利用者の監査「TravelCanvas 最新ソース監査と Claude 作業継続指示」(2026-10-30)の Gate D。
新しい project: `project-c883e9da-6ebc-4d0d-a23`(番号 1072503803591)。旧 project `travelcanvas-development` は削除の操作の記録があるため、
**作り直し・undelete・削除をしない**(`gcp-dev-runtime.md` の手順の project 名は旧 project のまま。新しい project では下の値に読み替える)。

> この文書は 2026-10-31 時点の**設計と確認の手順**です。Claude の作業環境には GCP の認証が無いため、project の中身は**未確認**です。
> 下の §1 の読み取り専用の確認を利用者が Cloud Shell で実行し、結果(秘密の値は出ない)を貼った時点で「確認済み」にします。

## 0. いま分かっていること(コードから)

| 項目 | 状態 | 根拠 |
|---|---|---|
| GitHub の workflow | `.github/workflows/deploy-gcp-dev.yml`(手動の実行だけ・main だけ) | backend の image を Artifact Registry `asia-northeast1/travelcanvas-dev/backend:<SHA>` へ push。`deploy_service=true` の時だけ migration の job と **非公開の** Cloud Run `travelcanvas-dev-backend` を配備 |
| Cloud Run の設定 | `--no-allow-unauthenticated`・min 0・max 1・CPU 1・512Mi・timeout 300 秒・`allUsers` があれば失敗 | 同上 |
| 使う secret(Secret Manager) | `tc-dev-db-owner-url`・`tc-dev-db-app-url`・`tc-dev-redis-url`・`tc-dev-jwt-secret`・`tc-dev-encryption-key`・`tc-dev-lookup-index-key`・`tc-dev-document-signing-key`・`tc-dev-mfa-key`・`tc-dev-offline-pack-key`・`tc-dev-metrics-token` | 同上。利用者の Cloud Shell のログ(2026-10-30)では DB・Redis の3つの値の版が空だった(報告のみ) |
| 認証 | Workload Identity Federation(pool `github-actions`・provider `github`)、SA `tc-dev-deployer`・`tc-dev-runtime`・`tc-dev-migrator` | 同上 |
| frontend の配備 | **無い** | workflow は backend だけ。携帯のブラウザから使える Web の画面はまだ GCP に無い |
| 外部 API の鍵 | 運用コンソールの登録はアプリの DB(`provider_secrets`)。Secret Manager の上の一覧に外部 API の鍵は無い | `docs/runbooks/ops-console-api-connection.md` |

**言い換えの禁止**: Artifact Registry に image がある ≠ アプリが公開済み。Cloud Run の backend の URL ≠ TravelCanvas の Web サイト。
予算の通知 ≠ 自動の停止。アプリの 50円の上限 ≠ Cloud の請求の上限。

## 1. 読み取り専用の棚卸し(利用者が Cloud Shell で実行。何も作らない・変えない)

秘密の**値**は表示しません(`secrets versions access` は使わない)。出力を貼る前に、メールアドレス以外の個人情報が無いか確かめてください。

```bash
P=project-c883e9da-6ebc-4d0d-a23
R=asia-northeast1
gcloud config set project "$P"

# 請求・予算(予算は通知。自動では止まらない)
gcloud billing projects describe "$P" --format='value(billingEnabled,billingAccountName)'
BA=$(gcloud billing projects describe "$P" --format='value(billingAccountName)' | sed 's#billingAccounts/##')
gcloud billing budgets list --billing-account="$BA" \
  --format='table(displayName,amount.specifiedAmount.units,thresholdRules[].thresholdPercent.list(),notificationsRule.pubsubTopic)'

# 有効な API
gcloud services list --enabled --format='value(config.name)' | sort

# IAM・WIF(誰が何をできるか。allUsers・allAuthenticatedUsers が無いこと)
gcloud projects get-iam-policy "$P" --format=json | grep -E '"(role|members)"|allUsers|allAuthenticatedUsers' | head -80
gcloud iam service-accounts list --format='table(email,disabled)'
gcloud iam workload-identity-pools list --location=global --format='table(name,state)'
gcloud iam workload-identity-pools providers list --workload-identity-pool=github-actions --location=global \
  --format='table(name,state,attributeCondition)' 2>&1 | head

# 置き場所・実行
gcloud artifacts repositories list --location="$R" --format='table(name,format)'
gcloud artifacts docker images list "$R-docker.pkg.dev/$P/travelcanvas-dev/backend" --include-tags \
  --format='table(tags,createTime)' 2>&1 | head
gcloud run services list --region="$R" --format='table(metadata.name,status.url,status.conditions[0].status)'
gcloud run jobs list --region="$R" --format='table(metadata.name)'
for s in $(gcloud run services list --region="$R" --format='value(metadata.name)'); do
  echo "== $s"; gcloud run services get-iam-policy "$s" --region="$R" --format='value(bindings.members)'; done

# DB・Redis
gcloud sql instances list --format='table(name,databaseVersion,settings.tier,state)' 2>&1 | head
gcloud redis instances list --region="$R" --format='table(name,tier,memorySizeGb,state)' 2>&1 | head

# Secret Manager: 名前と版の状態だけ(値は読まない)
for s in tc-dev-db-owner-url tc-dev-db-app-url tc-dev-redis-url tc-dev-jwt-secret tc-dev-encryption-key \
         tc-dev-lookup-index-key tc-dev-document-signing-key tc-dev-mfa-key tc-dev-offline-pack-key tc-dev-metrics-token; do
  printf '%-30s ' "$s"; gcloud secrets versions list "$s" --filter='state=ENABLED' --format='value(name)' 2>/dev/null \
    | wc -l | awk '{print ($1>0) ? "ENABLED の版あり("$1")" : "有効な版なし"}'
done

# 予算の通知の配信先(Pub/Sub)
gcloud pubsub topics list --format='value(name)'
gcloud pubsub subscriptions list --format='table(name,topic,pushConfig.pushEndpoint)'
```

## 2. 限定公開の設計(案。作る前に利用者の判断が要る)

目的: 家族(決まった Google アカウント)だけが、携帯のブラウザから HTTPS で使える。一般には公開しない。

| 方式 | 構成 | よい点 | 注意 |
|---|---|---|---|
| **A(推奨)** 1つの入口 + IAP | frontend の Cloud Run(`static-server.mjs`)に IAP(Identity-Aware Proxy)を付け、許可した Google アカウントだけ。`/api/*` は frontend の server が backend へ ID token 付きで中継(backend は `--no-allow-unauthenticated` のまま、frontend の実行の SA にだけ `run.invoker`) | 同じ origin で CORS・cookie の問題が無い。backend は外から直接呼べない。負荷分散(LB)の月額が要らない | `static-server.mjs` に中継のコードを足す Gate が要る。IAP の OAuth 同意画面の設定 |
| B | 外部 HTTPS 負荷分散 + 独自ドメイン + IAP(`/` → frontend、`/api` → backend) | 独自ドメイン・Cloud Armor を付けられる | 転送ルールの月額(数千円規模)。ドメインと証明書の用意 |
| C | 両方の Cloud Run に IAP、別の origin | 中継のコードが要らない | CORS + IAP の cookie が別 origin で扱いにくい。携帯での動作の検証が重い |

共通の決まり:
- `allUsers`・`allAuthenticatedUsers` を付けない(workflow の検査を frontend にも入れる)
- Cloud Run は min 0・max 1(開発)。timeout・同時実行は今の backend と同じ
- `CORS_ORIGINS` は A なら frontend の URL だけ。CSRF の対策は今のアプリのまま(同じ origin)
- 予算: 月の予算と 50%・90%・100% の通知(**通知であり停止ではない**)。自動の停止は別の Gate(Pub/Sub → 検証済みの関数)
- 本番相当のデータを入れない。DB・Redis の URL の secret に有効な版が揃うまで migration・deploy をしない

## 3. 利用者の判断が要ること(Claude は実行しない)

1. DB・Redis をどこに置くか(Cloud SQL / Memorystore は月額がかかる。外部の無料枠のサービスは契約が要る)と、その URL の secret の登録
2. 限定公開の方式(上の A・B・C)と、許可する Google アカウント
3. 月の予算の額と通知の先
4. workflow の実行(`deploy_service=true`)。Claude は GCP の resource を作らない・消さない

## 4. 完了の条件(全て揃った時だけ「GCP で使える」と書く)

- frontend と backend の実際の URL があり、許可したアカウントの携帯でログインできる
- 許可していないアカウント・未ログインでは画面も API も開けない
- `allUsers` が無い・予算の通知がある・min 0 / max 1
- `/ready` が ready・Alembic が head・旅行相談と旅程の画面が動く
