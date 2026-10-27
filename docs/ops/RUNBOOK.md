# TravelCanvas 運用 Runbook(障害対応・バックアップ・復元・rollback 手順書)

> 対象: omega-dev2(`/home/karkyon/projects/travelcanvas`、docker compose 4サービス: postgres / redis / backend / frontend)  
> 道具: `python3 scripts/ops/tcops.py`(標準ライブラリだけで動く。本体は `backend/app/ops/cli.py`)  
> 設計の判断: `docs/adr/ADR-operations.md`。トレース: `docs/trace/gate-o1-trace.md`。初回の演習記録: `docs/ops/drills/gate-o1-drill.md`。

---

## 0. 早見表

| 起きたこと | まず見る | 最初の一手 |
|---|---|---|
| 画面が開かない・APIが応答しない | `tcops.py monitor` | §3.1 |
| `/ready` が 503(`migration_current` が false) | `docker compose exec -T backend alembic current` | §3.2 |
| 5xx が増えた(`http_5xx`) | `docker compose logs --since 30m backend` | §3.3 |
| ログに個人情報らしき値(`log_leak`) | `tcops.py log-scan --since 25h` | §3.6 |
| ダウンロードが 403・アップロードが 413/422/503 | `/metrics` の `security_events` | §3.8 |
| 応答が遅い(`slow_responses`) | `/metrics` のルート別の時間 | §3.4 |
| ディスクが少ない(`disk_low`) | `df -h`、`tcops.py list` | §3.5 |
| バックアップが古い・無い(`backup_stale` / `backup_missing`) | `ops-state/logs/backup.log` | §4.1 |
| データを壊した・消した | **何もせず §5 を読む** | §5 |
| 更新後に不具合(コードを戻したい) | `tcops.py rollback-plan --to <commit>` | §6 |
| 管理者が多要素認証の端末と回復コードをなくした | `tcops.py security mfa-status --email …` | §8.3 |
| パッチが「CI が不合格」で止まった・main へ push できない | `python3 scripts/ops/ci_gate.py status` | §9 |
| 暗号化の鍵を替えたい・鍵の漏洩が疑われる | `tcops.py keys check`・`tcops.py keys status` | §8.2、`docs/ops/KEY-INVENTORY.md` |

終了コード: `monitor` は 0=異常なし、1=注意、2=異常。その他のコマンドは 0=成功、3=失敗。

---

## 1. 守ること(全手順に共通)

1. **`docker compose down -v` とボリュームの削除は禁止。** DB(`travelcanvas_pgdata`)と保存ファイル(`travelcanvas_uploads`)が消える。
2. **運用中の DB を上書きしない。** 復元は必ず別名の DB(名前に `restore` を含む)へ行い、確認してから切り替える(§5)。`tcops.py` は運用中の DB 名・`test` を含む名前・`restore` を含まない名前への復元を拒否する。
3. **秘密を画面・チャット・記録に貼らない。** `.env` の値、接続文字列、`docker compose config` の出力は共有しない。`tcops.py` の出力は接続文字列を伏せてある。
4. **`.env`(暗号鍵)はバックアップに含まれない。** `ENCRYPTION_KEY`・`LOOKUP_INDEX_KEY`・`DOCUMENT_DOWNLOAD_SIGNING_KEY`・`JWT_SECRET_KEY` を失うと、バックアップを復元しても予約番号・チケット・秘匿制約・位置などが読めない。**`.env` はオフラインの媒体(暗号化USB等)に別途保管する。** 鍵を変えたら保管し直す。
5. バックアップは個人データを含む。置き場所は 0700、ファイルは 0600(`tcops.py` が設定する)。他の機械へ移す時も暗号化した媒体を使う。

---

## 2. 日常の運用

### 2.1 定期実行の登録(初回だけ)

```bash
cd ~/projects/travelcanvas
python3 scripts/ops/tcops.py schedule print     # 登録内容の確認
python3 scripts/ops/tcops.py schedule install   # crontab に登録(何度実行しても1区画だけ)
python3 scripts/ops/tcops.py schedule remove    # 解除
```

| 時刻(ホストの時刻) | 内容 |
|---|---|
| 毎日 03:10 | バックアップ(DB+保存ファイル)→ 目録とハッシュの検証 → 古い世代の整理 |
| 毎日 03:40 | 猶予期間を過ぎた削除済みデータの完全削除(旅行30日・文書・QuickDraft) |
| 毎週日曜 04:20 | 最新バックアップの復元演習(別DBへ復元 → 件数・保存ファイル・復号・migration 往復) |
| 毎日 03:50 | 直近25時間の backend のログに個人情報・秘密が出ていないかの検査(`log-scan`) |
| 5分ごと | 監視(状態が変わった時だけ記録・通知) |
| 5分ごと | [Gate G2] Webhook の自動の再送(`tcops.py jobs webhook-retry`。1・5・30分・2・6時間の間隔、6回で dead) |
| 15分ごと | [Gate G4] 投票の締切(`tcops.py jobs poll-deadlines`。締切の24時間前に未回答の人へ知らせ、締切で締めて結果を知らせる。決定は人が行う) |
| 5分ごと | [Gate G4] 通知のまとめのメールと送信待ちのメール(`tcops.py jobs email-outbox`。送信の設定が無ければ何もしない。失敗は5分から6時間まで間を空けて6回で dead) |
| 毎時 25分 | [Gate G4] 濫用の自動の検知(`tcops.py jobs abuse-scan`。1時間に50以上の接続元から開かれた共有・合言葉の失敗20回・1日に50個の共有・感染した文書を管理者の一覧へ) |
| 毎日 04:05 | [Gate G6] 削除してから7日を過ぎた旅の記録を消す(`tcops.py jobs memory-trash`。写真・音声のファイルを含む。§8.12) |
| 毎日 04:20 | [Gate G7] 予定日を過ぎた「猶予つきのアカウントの削除」を実行する(`tcops.py jobs account-deletions`。管理者は対象外。§8.13) |

ログは `ops-state/logs/*.log`、演習の記録は `ops-state/drills/`(どちらも git の対象外)。

### 2.2 通知(任意)

`.env` に `OPS_ALERT_WEBHOOK_URL=<Slack 互換の incoming webhook>` を書くと、監視の状態が変わった時(発生・回復)だけ送る。同じ異常を5分ごとに送り続けることはない。

### 2.3 設定(`.env` または環境変数、すべて任意)

| 名前 | 既定 | 意味 |
|---|---|---|
| `OPS_BACKUP_DIR` | `<repo>/backups` | バックアップの置き場所。**別ディスクを推奨** |
| `OPS_KEEP_DAILY` / `OPS_KEEP_WEEKLY` / `OPS_KEEP_MIN` | 7 / 4 / 3 | 世代管理(直近7日は各日1つ、直近4週は各週1つ、最低3つ) |
| `OPS_BACKEND_URL` | `http://127.0.0.1:8001` | 監視する backend |
| `METRICS_TOKEN` | なし | 設定すると `/metrics` に `Authorization: Bearer` が必要。未設定時は私設アドレス(LAN・同じ機械)からだけ見える |
| `OPS_ALERT_WEBHOOK_URL` | なし | §2.2 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USE_TLS` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `EMAIL_FROM` | なし / 587 / true / なし / なし / なし | [Gate G4] 通知のまとめのメール(§8.10)。`SMTP_HOST` と `EMAIL_FROM` が無ければメールは送らない(画面に「使えません」と出る) |
| `SHARE_VIEW_SIGNING_KEY` / `SHARE_VIEW_TTL_SECONDS` | `JWT_SECRET_KEY` から導出 / 7200 | [Gate G4] 共有の閲覧の一時トークン(§8.10、KEY-INVENTORY) |
| `USAGE_LIMITS` | なし(既定の上限) | [Gate G5] 使用量の上限の上書き(JSON。例 `{"user": {"imports": 500}}`。§8.11) |

### 2.4 手で行うこと

```bash
python3 scripts/ops/tcops.py backup --prune   # 今すぐバックアップ
python3 scripts/ops/tcops.py list             # 一覧(OK/NG は目録とハッシュの照合結果)
python3 scripts/ops/tcops.py verify --latest  # 最新のバックアップの照合
python3 scripts/ops/tcops.py drill            # 今すぐ復元演習(新しくバックアップを取ってから)
python3 scripts/ops/tcops.py monitor          # 監視を1回
```

**更新(パッチ適用)の前には必ず `backup` を取る。** パッチ自体は DB の新規テーブル追加しか行わないが、取り返しのつかない誤操作に備える。

---

## 3. 障害対応

### 3.1 backend が応答しない(`backend_down` / `container_unhealthy`)

```bash
docker compose ps
docker compose logs --since 30m backend | tail -100
docker compose restart backend      # 再起動(データは消えない)
python3 scripts/ops/tcops.py monitor
```

- postgres が unhealthy の時は先に `docker compose logs --since 30m postgres`。ディスク満杯(§3.5)が多い。
- `docker compose up -d --build backend` は、コードを更新した後だけ。

### 3.2 `/ready` が 503

`/ready` の `checks` を見る(`curl -s http://127.0.0.1:8001/ready`)。

| 項目 | 意味 | 対処 |
|---|---|---|
| `database` が false | DB に繋がらない | §3.1 の postgres の確認 |
| `migration` が false | alembic の版が記録されていない | 新しい DB。`docker compose exec -T backend alembic upgrade head` |
| `migration_current` が false | DB の版とコードの migration が一致しない | コードの更新後に `alembic upgrade head` を忘れた、またはコードだけ戻して downgrade を忘れた。`alembic current` と `alembic heads` を比べ、§6 の手順で合わせる |
| `required_routers` が false | 認証などの必須APIが登録されていない | 起動時のエラー。`docker compose logs backend` |

### 3.3 5xx が増えた(`http_5xx`)

```bash
docker compose logs --since 30m backend | grep -E "Unhandled exception|ERROR" | tail -50
curl -s http://127.0.0.1:8001/metrics | grep 'status="5xx"'
```

- `/metrics` はルートの型(例 `/api/v1/plans/{plan_id}/replans`)ごとに数えているので、どの機能かが分かる。
- エラー応答の `request_id` とログの `[request_id]` が対応する。利用者には request_id だけを聞く。
- 直前の更新が原因なら §6(コードを戻す)。

### 3.4 応答が遅い(`slow_responses`)

`/metrics` の `travelcanvas_http_request_duration_seconds_bucket` をルートごとに見る。DB の負荷は
`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pid, state, now()-query_start as t, left(query,80) from pg_stat_activity where state<>'"'"'idle'"'"' order by t desc limit 10"'`。

### 3.5 ディスクが少ない(`disk_low`)

```bash
df -h
python3 scripts/ops/tcops.py prune --dry-run   # 消える世代の確認
python3 scripts/ops/tcops.py prune
docker system df                               # 古いイメージは docker image prune(ボリュームは消さない)
```

### 3.6 ログに個人情報らしき値が出た(`log_leak`)

backend はログを書く時点でメールアドレス・トークン・暗号文・パスワードのハッシュ・SQL の値などを伏せている
(`backend/app/core/log_safety.py`、設計は `docs/adr/ADR-log-safety.md`)。それでも検査で見つかった時:

```bash
python3 scripts/ops/tcops.py log-scan --since 25h     # 種類・行番号・伏せた抜粋(値そのものは出ない)
cat ops-state/log_scan.json
```

1. **抜粋をチャット・Issue に貼る時も値は含まれていない**が、元のログ(`docker compose logs`)は貼らない。
2. 出どころ(どの処理のログか)を抜粋から特定し、伏せる規則(`log_safety._RULES`)か、出どころのログ文を直す。
   直したら `tests/test_gate_o2_log_safety.py` に同じ形の試験を足す。
3. 漏れたログを消す: backend のログは docker のコンテナごとの記録なので、`docker compose up -d --force-recreate backend`
   で作り直すと古いログは消える(DB・保存ファイルは消えない)。
4. トークン(共有リンク・ダウンロード)が漏れていた場合は、該当の共有リンクを画面から失効させる。
5. SQL の値を調査で見たい時も `SQL_ECHO=true` は短時間だけにする(値は常に伏せられるが、SQL 文そのものは出る)。

出てよいメールアドレス(運営の送信元など)がある場合は、`.env` の `OPS_LOG_ALLOWED_EMAILS` にカンマ区切りで書く。

### 3.7 回数制限(429 が増えた・攻撃が疑われる)

回数制限は Redis(`REDIS_URL`)で数え、全ての worker・コンテナが同じ数を見る(`backend/app/utils/rate_limiter.py`、
設計は `docs/adr/ADR-shared-rate-limit.md`)。キーはハッシュで、メール・IP は Redis に残らない。

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:8001/metrics | grep -E "rate_limit"
```

- `travelcanvas_rate_limited_total{kind="login_email"}` 等が急に増えた: 総当たり・パスワードリスト攻撃の疑い。
  `kind`(login_email / login_ip / register / refresh / guest …)で、狙われている入口が分かる。
- `travelcanvas_rate_limiter_fallback_total` が増えた: Redis に届かず、その間はコンテナごとの制限に下がっている
  (制限は続くが緩む)。Redis の状態(`docker compose ps redis`)を確認する。
- 正規の利用者が締め出された・E2E を続けて流したら 429 になった時は、制限だけを消せる(データは消えない):

```bash
docker compose exec -T backend python -c "from app.utils import rate_limiter as r; print(r.reset_all())"
```

### 3.8 文書のダウンロードが 403・アップロードが 413/422/503(防御が働いた)

設計は `docs/adr/ADR-document-delivery-hardening.md`。防御が働いた数は `/metrics` で見られる(値・利用者は出ない)。

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:8001/metrics | grep security_events
```

| `kind` | 意味 | 対応 |
|---|---|---|
| `download_denied` | 期限切れ・共有の取消・文書の変更・ログアウト後の URL | 正規の利用者なら画面からもう一度開けば取れる。急増は URL の使い回し・漏洩の疑い(監査 `document_download_denied` の reason を見る) |
| `body_too_large` / `upload_too_large` | 上限を超える要求 | 急増は資源を使い切らせる攻撃の疑い。正規なら `API_MAX_BODY_BYTES`・`DOCUMENT_MAX_UPLOAD_SIZE_BYTES` を見直す |
| `malware_rejected` | ウイルスとして拒否(保存していない) | 監査 `upload_rejected_malware` で利用者・プランを確認する |
| `malware_scan_unavailable` | ClamAV に届かない | `docker compose --profile malware-scan ps clamav`。必須設定なら届くまでアップロードは 503 |
| `audit_write_failed` | 監査ログを書けなかった | DB の状態(§3.2)。続くなら証跡が欠けているので最優先で直す |

ウイルス検査(ClamAV)を使う時:

```bash
docker compose --profile malware-scan up -d clamav     # 初回は定義の取得に数分
docker compose --profile malware-scan ps clamav        # healthy になるまで待つ
# .env に MALWARE_SCAN_BACKEND=clamav(必要なら DOCUMENT_REQUIRE_CLEAN_SCAN=true)を書いてから
docker compose up -d --force-recreate backend
```

`DOCUMENT_REQUIRE_CLEAN_SCAN=true` にすると、それ以前に受け取った未検査(not_scanned)の文書はダウンロードできなくなる(409)。
必要な文書は取り直してもらうか、検査してから使う。

### 3.9 不審な接続元の自動遮断(`guard_blocked` / `security_events_spike` / `audit_write_failed`)

設計は `docs/adr/ADR-threat-guard.md`。接続元(IP)ごとに、失敗した要求を「怪しさの点数」にして15分の窓で合計する。
1つ1つは普通の失敗(ログインの失敗・無効なトークン・他人のデータへの 403/404・期限切れ URL・別サイトからの操作・
大きすぎる本文・ウイルス)でも、入口を変えながら続くと止まる。

| 点数(15分) | 段階 | 起きること |
|---|---|---|
| 60 以上 | 注意 | 監査 `guard_warn`、`security_events_total{kind="guard_warn"}` |
| 150 以上 | 遮断 | その接続元の `/api/*` を15分 429(`Retry-After` 付き)。監査 `ip_blocked`、監視 `guard_blocked` |
| 24時間以内に再び | 再犯 | 前回の4倍(上限24時間) |

`/health`・`/ready`・`/metrics` は止めない。成功した要求、ログインしていない画面の 401 は数えない。数は Redis(全プロセス共有、IP は sha256)。

正規の利用者・社内の機械を止めてしまった時:

```bash
# 監査の ip_blocked で時刻を確かめ、問い合わせの IP を外す
docker compose exec -T backend python -c "from app.services import threat_guard as g; g.reset('203.0.113.5')"
# 全部外す(誤検知が広がった時)
docker compose exec -T backend python -c "from app.services import threat_guard as g; print(g.reset_all())"
```

監視・運用の機械は `.env` の `GUARD_TRUSTED_IPS`(カンマ区切り、CIDR 可)に書くと数えない。止める時は `GUARD_ENABLED=false`
(どちらも backend の作り直しが必要)。同じ NAT の後ろに多くの利用者がいる環境(社内・学校)で誤検知が続く時は、
`GUARD_BLOCK_SCORE` を上げる。

`security_events_spike`(前回から50件以上)は、遮断に至らない広く薄い攻撃・設定の誤りのどちらか。§3.7・§3.8 の `kind` を見て判断する。
`audit_write_failed` は証跡が欠けているので最優先で DB を直す(§3.2)。

### 3.10 ログイン・登録で計算の確認(428)が出る

設計は `docs/adr/ADR-challenge.md`。§3.9 の点数が30以上の接続元からのログイン・登録・ゲスト開始・昇格には、
画面が自動で解く計算を求める(利用者の操作は増えない。点数が高いほど時間がかかる)。

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:8001/metrics | grep challenge
```

| `kind` | 意味 |
|---|---|
| `challenge_issued` | 確認を求めた |
| `challenge_passed` | 正しく解いて通った(普通の利用者・解ける攻撃) |
| `challenge_failed` | 偽造・誤り・使い回し(点数にも入る) |

正規の利用者が「時間がかかる」と言う時は、その接続元の点数が高い(同じ NAT の後ろで失敗が続いている等)。
§3.9 の `reset(ip)` で点数を消す。攻撃が続く時は `.env` の `CHALLENGE_ALWAYS=register,guest` 等で常に求める
(backend の作り直しが必要)。止める時は `CHALLENGE_ENABLED=false`。

### 3.11 画面の CSP 違反の報告(`csp_violations`)

設計は `docs/adr/ADR-csp-reporting.md`。画面の CSP(Gate S2)がブラウザで読み込み・実行を止めると、ブラウザが
`/api/v1/security/csp-report` へ報告し、backend は数だけを記録する(止めた先のオリジンと指示はログに WARNING で出る。
URL のパス・画面の URL・スクリプトの断片は残さない)。

```bash
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:8001/metrics | grep 'kind="csp'
docker compose logs --since 1h backend | grep "CSP violation"
```

| 様子 | 考えられること | 対応 |
|---|---|---|
| 多くの利用者で同じ指示・同じ読み込み先 | 画面の更新で CSP に無い読み込み先を使った(画面の不具合) | `frontend/src/config/securityHeaders.ts` に足すか、読み込みをやめる |
| `script-src` で見知らぬ外部のオリジン | スクリプトの差し込み(XSS)の試み、改ざんされたネットワーク | 該当の画面・入力を調べる。§8 の手順 |
| `chrome-extension:` 等 | 利用者のブラウザの拡張機能 | 対応不要 |

報告はだれでも送れるため、数だけが急に増える時は偽の報告の可能性もある(自動遮断の点数には入れていない)。

---

## 4. バックアップ

### 4.1 中身

1回のバックアップは3つのファイル(ID は `tc-YYYYMMDDTHHMMSSZ`、UTC):

| ファイル | 中身 |
|---|---|
| `<id>.db.dump` | 運用中の DB の `pg_dump -Fc`(postgres コンテナの中で実行。パスワードを使わない) |
| `<id>.uploads.tar.gz` | 保存ファイル(文書・写真・音声。backend の `/app/uploads`) |
| `<id>.keys.jsonl` | [Gate G3] データ鍵の写し(`data_keys` の行。ENCRYPTION_KEY で包んだまま)。DB のダンプには入れない。破棄した鍵は中身を消した記録だけ(`keys purge-escrow`、KEY-INVENTORY §3) |
| `<id>.manifest.json` | 目録: 各ファイルのサイズと SHA-256、表ごとの件数(取得の直前・直後)、保存ファイルの一覧とハッシュ、alembic の版、commit、鍵の指紋(鍵の値は含まない) |

目録は最後に書く。目録の無いバックアップ(途中で止まったもの)は一覧に出ず、使われない。作成直後に目録とファイルを照合し、合わなければ失敗として消す。

### 4.2 失敗した時

`ops-state/logs/backup.log` を見る。よくある原因: ディスク不足(§3.5)、postgres の停止(§3.1)、取得中に保存ファイルが変わった(もう一度実行)。

---

## 5. 復元(データを失った・壊した時)

**運用中の DB は上書きしない。** 別名の DB に復元し、確認してから backend の接続先を切り替える。元の DB は残るので、いつでも戻せる。

### 5.1 まず止める

```bash
docker compose stop frontend        # 利用者の操作を止める(backend は確認のため動かしておく)
python3 scripts/ops/tcops.py backup # 壊れた状態も保存しておく(調査用)
```

### 5.2 別名の DB へ復元して確認

```bash
python3 scripts/ops/tcops.py list
python3 scripts/ops/tcops.py restore --backup <id> --target-db travelcanvas_restore_YYYYMMDD --files-to ~/tc-restore-files
```

出力の `ok` が true であること(件数・保存ファイル・復号・alembic の版・鍵の指紋がすべて一致)。
`fingerprint_mismatches` に名前が出たら、**今の `.env` の鍵がバックアップ時と違う**。保管している `.env` に戻してから再実行する(§1-4)。

### 5.3 切り替え

1. `.env` の `DATABASE_URL` の DB 名だけを `travelcanvas_restore_YYYYMMDD` に変える(`DB_NAME_DEV` は postgres の初期化用なので変えない)。
2. 保存ファイルも戻す場合:
   ```bash
   docker compose cp ~/tc-restore-files/. backend:/app/uploads/
   ```
   (既存のファイルは上書きされるが消えない。完全に入れ替える場合は先に `docker compose exec -T backend mv /app/uploads/documents /app/uploads/documents.bak-YYYYMMDD`)
3. `docker compose up -d backend` → `python3 scripts/ops/tcops.py monitor` → `docker compose start frontend`。
4. 元の DB は調査が終わるまで残す。不要になったら `docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" <旧DB名>'`(**名前を2回確認する**)。

### 5.4 戻す

`.env` の `DATABASE_URL` を元の DB 名に戻して `docker compose up -d backend`。

---

## 6. コードの rollback(更新後に不具合が出た時)

```bash
git log --oneline -5
python3 scripts/ops/tcops.py rollback-plan --to <戻し先の commit>
```

`downgrade_to` が null なら migration の変更は無く、コードを戻すだけでよい。値があれば、**コードを戻す前に**その版まで downgrade する(新しい表が消えるので、先に `backup`):

```bash
python3 scripts/ops/tcops.py backup
docker compose exec -T backend alembic downgrade <downgrade_to>   # 必要な時だけ
git switch --detach <戻し先の commit>                               # main の履歴は書き換えない
docker compose up -d --build backend frontend
python3 scripts/ops/tcops.py monitor                               # migration_current が true になること
```

直したら `git switch main` で戻り、修正を新しい commit として積む(force push・履歴の書き換えは禁止)。
`ok` が false(枝分かれ)の時は自動では戻せない。`alembic history` を見て判断する。

migration の downgrade が実データの上で通ることは、毎週の復元演習(§2.1)で「最新の migration を1つ戻して再適用」して確認している。

---

## 7. 監視の中身

`tcops.py monitor` が見るもの(`backend/app/ops/opslib.py` の `evaluate_monitor`):

| 検出 | 段階 | 条件(既定) |
|---|---|---|
| `backend_down` | 異常 | `/health` が200でない |
| `backend_not_ready` | 異常 | `/ready` のどれかが false、または取得できない |
| `container_unhealthy` | 異常 | `docker compose ps` で running/healthy でないサービス |
| `backup_missing` | 異常 | 検証が通るバックアップが無い |
| `http_5xx` | 注意 | 前回から5xxが5件以上、またはリクエスト20件以上で5%以上 |
| `slow_responses` | 注意 | 前回からの応答時間の95%点が2秒超(20件以上) |
| `disk_low` | 注意 | バックアップ先の空きが2GB未満または10%未満 |
| `backup_stale` | 注意 | 最新のバックアップが26時間より古い |
| `restore_drill_missing` / `restore_drill_stale` | 注意 | 復元演習の記録が無い / 8日より古い |
| `metrics_unavailable` | 注意 | `/metrics` を取得できない |
| `log_leak` | 注意 | 直近の `log-scan` で個人情報・秘密らしき値が見つかった(§3.6) |
| `guard_blocked` | 注意 | 前回から、不審な接続元を自動で遮断した(§3.9) |
| `security_events_spike` | 注意 | 前回から、セキュリティの拒否・検出が50件以上(§3.9) |
| `audit_write_failed` | 異常 | 監査ログの書き込みに失敗した(§3.9) |
| `csp_violations` | 注意 | 前回から、画面の CSP 違反の報告が20件以上(§3.11) |

`/metrics` は Prometheus のテキスト形式なので、将来 Prometheus・Grafana を入れる時もそのまま取り込める。

---

## 8. 侵害が疑われる時(インシデント対応)

設計は `docs/adr/ADR-incident-response.md`。操作は全て監査ログに残る。結果は1行の JSON。

```bash
python3 scripts/ops/tcops.py security status
python3 scripts/ops/tcops.py security lockdown on --minutes 120 --reason "パスワードリスト攻撃"
python3 scripts/ops/tcops.py security lockdown on --minutes 60 --close-signup     # 新規登録・ゲスト開始も止める
python3 scripts/ops/tcops.py security lockdown off
python3 scripts/ops/tcops.py security unblock --ip 203.0.113.5
python3 scripts/ops/tcops.py security unblock-all
python3 scripts/ops/tcops.py security revoke-sessions --email user@example.com --reason "端末の紛失"
python3 scripts/ops/tcops.py security revoke-sessions --all --yes --reason "鍵の漏洩の疑い"
```

終了コード: 0=成功、2=使い方の誤り、3=失敗(利用者が見つからない等)、4=効果が無い(Redis に届かず、backend の全プロセスに伝えられない。§3.7)。

### 8.1 手順

| 段階 | すること |
|---|---|
| 1. 気付く | 監視の `guard_blocked`・`security_events_spike`・`audit_write_failed`(§7)、利用者からの連絡、`log-scan`(§3.6) |
| 2. 記録を守る | `python3 scripts/ops/tcops.py backup`(調査用。§4)。監査ログ(`audit_logs`)を消さない |
| 3. 封じ込める | 攻撃が続いている → `lockdown on`(全員に計算の確認、遮断の閾値を半分)。登録の悪用 → `--close-signup`。特定の利用者の乗っ取り → `revoke-sessions --email` の後、本人にパスワードの変更を依頼 |
| 4. 鍵を替える | 鍵の漏洩が疑われる時だけ(下の表) |
| 5. 戻す | `lockdown off`、誤って止めた接続元は `unblock`。監視が落ち着いたことを確かめる |
| 6. 振り返る | 時刻・影響・原因・対応・再発防止を記録する(`docs/ops/incidents/YYYY-MM-DD.md`) |

### 8.2 鍵を替える時

| 鍵(.env) | 替えた時に起きること | 手順 |
|---|---|---|
| `JWT_SECRET_KEY` | 全員のアクセストークンとゲストのトークンが無効(ゲストは作り直し) | 新しい値を書き、`docker compose up -d --force-recreate backend`。続けて `revoke-sessions --all --yes` |
| `DOCUMENT_DOWNLOAD_SIGNING_KEY` | 発行済みの文書 URL が無効(画面から開き直せば取れる) | 新しい値を書いて backend を作り直す |
| `METRICS_TOKEN` | 監視の取得に新しい値が要る | `.env` を替えて backend を作り直す(tcops は `.env` を読む) |
| `ENCRYPTION_KEY` | [Gate G1] 版の切り替え(前の鍵を `ENCRYPTION_KEYS_PREVIOUS` に残して掛け直す)ので読めなくならない | **`docs/ops/KEY-INVENTORY.md` §2 の手順だけで行う**。`tcops.py keys status` → `keys rekey` → `previous_keys_removable: true` を確かめてから前の鍵を外す。漏洩が疑われる時は、切り替えの後に前の鍵を外すまでを急ぐ(外すまでは漏れた鍵で読める) |
| `LOOKUP_INDEX_KEY` | 索引を作り直すまで予約番号・同行者名の検索で見つからない | 新しい値を書いて backend を作り直し、`docker compose exec -T backend python -m app.ops.backfill_lookup_index --all` |

鍵の一覧・用途・使い回しの点検は `docs/ops/KEY-INVENTORY.md` と `python3 scripts/ops/tcops.py keys check`(値は出さない)。

### 8.3 多要素認証(Gate S11、`docs/adr/ADR-admin-mfa.md`)

- 管理者の画面・API は、多要素認証(認証アプリ)を設定し、そのセッションで12時間以内に確認コードを通した時だけ使える。
  設定は 設定 → セキュリティ「多要素認証(認証アプリ)」(画面の案内: `/settings?tab=security`)。
- 管理者を新しく作った時は、本人に最初のログインの後で設定してもらう(設定するまで管理者の画面には入れない)。
- 端末と回復コードを両方なくした人は、**本人確認を別の手段で済ませてから**外す。外すとその人の全端末もログアウトする。

```bash
python3 scripts/ops/tcops.py security mfa-status --email admin@example.com
# [Gate G3] 申請(管理者 A)と承認(別の管理者 B)。対象の本人は申請も承認もできない(KEY-INVENTORY §3.1)
python3 scripts/ops/tcops.py security mfa-reset-request --email admin@example.com --requested-by a@example.com --reason "端末の紛失(本人確認済み)"
python3 scripts/ops/tcops.py security mfa-reset --request <申請のID> --approved-by b@example.com --yes
```

- 監視・監査: 監査ログの `mfa_failed`(確認コードの誤り)・`mfa_recovery_code_used`・`mfa_disabled`・`mfa_reset_by_operator`・
  `admin_mfa_required`。誤りは自動遮断の点数(5点)になる(§3.9)。
- 設定(`.env`): `ADMIN_MFA_REQUIRED`(既定 true。本番で false だと起動しない)、`ADMIN_MFA_MAX_AGE_HOURS`(既定 12)、
  `RATE_LIMIT_MFA`(既定 10。利用者ごと15分)。

---

## 8.4 共同編集の「開いている人」(Gate C1)

- 旅行を開いている端末の知らせは Redis(`<名前空間>:presence:<旅行の ID>`、40秒で無効、キーは120秒で消える)に置く。
  Redis が止まっても各プロセスの中で続く(他のプロセスの端末は見えなくなるだけで、編集・保存は止まらない)。
- 持つのは利用者の ID・端末の印・編集中の予定の ID・時刻だけ(予定の内容・座標なし)。消してよい(次の知らせで戻る)。

## 8.5 管理者の権限(Gate A2)

- 管理者の権限は画面・API からは付けられない。運用者がサーバーの中で付ける・外す:
  `docker compose exec -T backend python scripts/security_incident.py grant-admin --email a@example.com --yes --reason "…"`
  / `revoke-admin`。どちらもその人の全端末をログアウトさせ、監査ログ(`admin_role_granted` / `admin_role_revoked`、
  対象の ID と理由だけ)に残す。ゲスト・停止中の人には付けられない。
- 付けられた人は、次に管理者の画面を開く時に多要素認証の設定を求められる(§8.3)。
- 管理者の画面から、自分自身・ほかの管理者は停止できない(管理者を止める時は先に revoke-admin)。停止した人の端末は
  すぐログアウトされる。管理者が一覧・詳細・監査ログを見たことも監査に残る。
- E2E(`frontend/e2e/admin.spec.ts`)は試験用の会員に grant-admin し、終わったら revoke-admin する。

## 8.6 DB の権限の分離(Gate G2 SEC-F4、`docs/adr/ADR-db-roles.md`)

- backend は **`tc_app`(表の読み書きだけ)**で接続する。表を作る・変える・消す、migration の版の書き換えはできない。
  migration とロールの設定は compose の `migrate` サービス(所有者 = `.env` の `DATABASE_URL`)が backend の起動前に1回だけ行う
  (`alembic upgrade head && python -m app.ops.db_roles apply`)。backend は `migrate` が成功してから起動する。
- `.env` に必要な値(初回はパッチが作る。値は出さない):
  - `DB_APP_PASSWORD`: `tc_app` のパスワード(24文字以上。ほかの鍵・DB のパスワードと同じ値にしない)
  - `APP_DATABASE_URL`: `postgresql://tc_app:<DB_APP_PASSWORD>@postgres:5432/<DB 名>`(backend へはこれだけを渡す。
    `DATABASE_URL`・`DB_PASSWORD`・`DB_APP_PASSWORD` は backend のコンテナでは空にする)
- 他のロール: `tc_backup`(読むだけ。`tcops.py backup` の pg_dump が使う)、`tc_readonly_monitor`(pg_monitor と migration の版を読むだけ)。
  どちらもパスワードを持たない(postgres のコンテナの中からだけ使う)。
- 確認: `docker compose exec -T backend python -m app.ops.db_roles check --expect-app`(`least_privilege: true`・`app_ready: true`)。
  運用の道具(`tcops.py`)は所有者の URL を引数ではなく環境変数で渡す(`ps` に資格情報を出さない)。
- `tc_app` のパスワードを替える: `.env` の `DB_APP_PASSWORD` と `APP_DATABASE_URL` を同じ値に直し、
  `docker compose up -d --force-recreate migrate backend`(migrate が `ALTER ROLE` し直す)。
- 元に戻す(緊急): `.env` の `APP_DATABASE_URL` を所有者の URL にすると、権限の分離の前と同じ動きになる(推奨しない)。

## 8.7 サポート閲覧と運用の要約(Gate G2 FR-040、`docs/adr/ADR-support-access.md`)

- サポートの担当者は、利用者本人が「設定 → サポート」で作った許可(目的・1〜72時間・旅行1つかアカウントの概要)がある時だけ、
  管理者の画面「運用とサポート」(`/admin/support`)から読み取り専用で見られる。住所・メモの本文・位置・予約番号・文書の中身は
  出ない。閲覧のたびに監査(`support_grant_accessed`)と本人への知らせ。管理者が自分の許可を見ることはできない。
- 問い合わせの対応: 利用者に許可を作ってもらい、問い合わせ番号を許可に書いてもらうと、一覧で見分けられる。終わったら
  利用者に取り消してもらう(期限が来れば自動で終わる)。
- 運用の要約: 有効な共有リンク(編集できる・期限の無いもの)・Webhook の失敗と dead・DB と文書の容量・削除待ち。
  不正な利用が疑われる共有リンクは、理由を書いて止める(所有者に知らせ、監査に残る)。

## 8.8 共同編集の即時の通知と同行者向けの項目の規則(Gate G2 FR-020・FR-045)

- 即時の通知 `GET /plans/{id}/events/stream`(Server-Sent Events)は、各端末が45秒ごとにつなぎ直す。1人あたり4本まで(超えると 429)。
  backend の DB への問い合わせは接続ごとに1秒に1回(版の確認だけ)。途中の機器(リバースプロキシ)を置く時は、
  この経路の応答の溜め込み(buffering)を止める(backend は `X-Accel-Buffering: no` を返す)。つながらない時は従来の問い合わせ
  (5〜20秒ごと)で動き続ける。
- 同行者向けの項目の規則は旅行の所有者が共有の画面で決める(運用者の操作は無い)。問い合わせ「予約が見えない」の時は、
  所有者の設定(役割の既定・1人ずつの設定)を確かめてもらう。

## 8.9 画面の配信・データ鍵・エラーの問い合わせ番号・性能(Gate G3)

- **画面の配信**: frontend のコンテナは `node server/static-server.mjs`(Node の標準の部品だけの配信。`vite preview` ではない)。
  応答ヘッダー(CSP 等)・受け付ける名前(`TC_PUBLIC_HOSTS`)・API の向き先は以前と同じ。`/assets/` は1年のキャッシュ、
  `index.html` は no-cache、文字のファイルは gzip。許していない名前で開くと 403(`Blocked request`)。
- **データ鍵**(KEY-INVENTORY §3): 旅行・利用者ごとの鍵。旅行の完全削除・アカウントの削除で破棄し、毎日 03:45 の
  `tcops.py keys purge-escrow` が全ての世代のバックアップの鍵の写しから消す。復元の演習で `erased`(消した値)が数えられるのは正常。
  コードを前の版へ戻す時は、先に `python3 scripts/ops/tcops.py keys convert --to legacy`(戻す前のコードで)。
- **多要素認証の解除**は申請と承認の二者(KEY-INVENTORY §3.1、§8.3)。
- **エラーの問い合わせ番号**: 画面の「問い合わせ番号: xxxxxxxx」は応答の `request_id`(`X-Request-ID`)の先頭8文字。
  `docker compose logs backend | grep <番号>` でサーバーのログを探す。エラーの一覧は `docs/spec/error-catalog.md`。
- **性能**: GitHub の `perf` の workflow が毎晩、予定 10,000 件・通知 100,000 件で主な API の p95・SQL の数(N+1)・索引の使用を
  確かめる(`backend/tests/test_gate_g3_perf.py`、結果は Actions の成果物 `perf-*`)。

## 8.10 検索のコマンド・合意の採用・通知・ゲストの閲覧・濫用への対応(Gate G4)

- **検索のコマンド**(`>予定を追加 11/3 10:00 清水寺` 等): Enter は確認の表示だけ。「実行する」で1回だけ実行し(Idempotency-Key)、
  実行の記録は `command_runs`。「元に戻す」は本人だけ、その後に別の変更が無い時だけ(あれば 409 `undo_not_latest`)。
- **投票の決定の採用**: 決定した選択肢を旅程に反映する前に内容を確かめる(何も変えない)。反映は1つの変更セット(source=decision)。
  定足数に届かない投票は決定できない(409 `quorum_not_met`)。採用した後は決定の変更・再開・削除をしない(先に「反映を元に戻す」)。
  締切は 15分ごとの `poll-deadlines` が締める。手で動かす: `python3 scripts/ops/tcops.py jobs poll-deadlines`。
- **通知の設定**: 利用者ごと(全体・旅行ごと)に「すべて・自分あてだけ・受け取らない」。メールのまとめ(1日1回)は SMTP の設定がある時だけ。
  送信待ちの件数: `docker compose exec -T postgres psql -U <所有者> -d <DB> -c "SELECT status, count(*) FROM email_outbox GROUP BY 1"`。
  `dead` が増えた時は SMTP の設定・提供元の障害を確かめ、直したら `UPDATE email_outbox SET status='failed', attempts=0, next_attempt_at=now() WHERE status='dead'`
  で送り直す(本文に予約番号・コメントの本文・位置は入っていない)。
- **ゲストの閲覧**: リンクを開く前の確認(`/info`)と、開いた後の見直し(一時トークン、既定2時間)は使用回数を使わない。
  共有の失効・期限切れ・合言葉の変更で一時トークンはすぐ使えない。複製は所有者が「複製できる」にした共有だけ・許した項目だけ。
- **濫用への対応**(FC-097): 管理者の画面「濫用への対応」(`/admin/abuse`)。通報が24時間に別々の3人から(詐欺・有害)来た共有は
  自動で止まり(`revoked_reason=abuse_auto`)、所有者に知らせる。管理者は内容を確かめて「却下」「共有を止める」「共有を戻す」。
  対応は監査(`admin_abuse_*`)に残る。旅行の中身を確かめる時は、本人の同意のサポート閲覧(§8.7)を使う。

## 8.11 費用の記録・使用量の上限・組織のロゴとドメイン(Gate G5)

- **為替の記録**: 旅行ごとに「1 外貨 = いくら(基準通貨)」を出典・基準日つきで手で記録する(外部の為替の提供元にはつながない)。
  支出は記録を選んで換算し、後で記録を足しても過去の支出の換算は変わらない。予約額は最新の記録で換算し、記録の無い通貨は別に示す。
- **予算の版**: 当初(1つだけ)・更新・確定(確定した予約)・実績を、その時点の写しとして `budget_versions` に残す(変えない)。
- **取消と締め**: 支出の取消は理由つきで、行を消さずに集計・精算から外す。精算を締める(`plan_finance_settings.locked_at`)と、
  支出・精算・基準通貨・端数の規則が 409 `finance_locked` になる。締めの解除は旅行の所有者だけ・理由つき(監査 `finance_unlocked`)。
- **使用量の上限**(BILL-02): 利用者・組織ごと、月(UTC)ごとに `usage_counters` で数える(アップロードの量・取込・移動の候補の作成・
  共有リンク・組織の配布)。上限を越える要求は 429 `quota_exceeded` で断り、何も変えない。8割を越えると画面に注意が出る。
  既定は `app/services/usage.py` の `DEFAULT_LIMITS`、全体の変更は `USAGE_LIMITS`(§2.3)、1人・1組織だけの今月の変更は
  管理者の画面(管理 → 使用量と上限。理由が必須、監査 `admin_usage_override`)。今の数を見る:
  `docker compose exec -T postgres psql -U <所有者> -d <DB> -c "SELECT subject_type, metric, period, used, override_limit FROM usage_counters ORDER BY updated_at DESC LIMIT 20"`。
- **組織のロゴ**: 受け取った画像はウイルス検査の後、512 ピクセル以内の PNG に作り直して DB(`organizations.logo_png`)に置く
  (撮影情報は残らない。保存ファイルではないので鍵の点検の対象外)。
- **独自のドメイン**: 登録すると TXT `_travelcanvas.<ドメイン>` に置く値(`travelcanvas-verify=…`)を示す。「確認する」で backend が
  DNS を引く(backend から外の DNS に届く必要がある。届かない時は `last_error=dns_error:…`)。確認済みのドメインは1つの組織だけ。
  組織を閉じると取り消す。
- **席の上限**: owner が設定する(空欄は上限なし)。上限に達するとメンバーを足せない(409 `seat_limit_reached`)。参加・脱退・上限の変更は
  `organization_seat_events` に残る。

## 8.12 オフラインの端末・守る範囲・旅行記の公開・記録の削除の取り消し(Gate G6)

- **オフラインの端末の鍵**(OFF-01): 鍵は利用者・版・端末の ID から導出し(保存しない)、30日の期限つきで配る。端末は
  `offline_devices` に名前(ブラウザと OS の種類だけ)と最後に鍵を受け取った時刻だけを残す。利用者は「データとプライバシー」で
  1台だけ失効でき、失効した端末は次の通信で 410 を受け取り保存データを消す。全ての端末を一度に止める時は、以前と同じ
  「全ての端末のオフラインデータを無効にする」(鍵の版を上げる)。端末は1人10台まで(失効した端末は数えない)。
  失くした端末の問い合わせ: 本人に失効してもらう。通信しない端末は鍵の期限(30日)の後は開けない。
- **オフラインの編集**(OFF-02): 予定に加えて、日程の作成・変更・削除と、日程の中の予定の並びを端末に溜める。
  予約(予約番号・チケット)はオフラインでは変えない(`online_required`)。競合は利用者が「同期で競合した変更」で解く。
- **守る範囲**(LOC-02): 利用者が自宅・職場などを登録する(中心は本人のデータ鍵で暗号化。`privacy_zones`)。GPX・KML の書き出しと
  旅行記の公開から、その範囲の中の地点を外す(旅行の所有者の範囲と書き出す本人の範囲の両方)。データ鍵を破棄した利用者の範囲は
  読めないため、その利用者に関わる書き出しは位置を全て外す(安全側)。
- **旅行記の公開**(MEM-01): 本人の記録だけの写し(`memory_publications.snapshot`。座標・音声・他のメンバーの記録は含めない)を
  `/journal/<推測できない値>` で見せる。サーバーには値のハッシュだけを残す(URL は作った時だけ画面に出る)。閲覧は回数の制限つき・
  `X-Robots-Tag: noindex`・`Cache-Control: no-store`。不適切な公開の申し出があれば、所有者に失効してもらうか、管理者が
  `docker compose exec -T postgres psql -U <所有者> -d <DB> -c "UPDATE memory_publications SET revoked_at = now() WHERE token_prefix = '<先頭8文字>'"`
  で止める(監査に理由を残す)。
- **記録の削除の取り消し**: 削除した記録は7日間 `memory_trash` に本文を暗号化して保管し(写真・音声のファイルも残す)、
  削除した人か書いた人が「元に戻す」で戻せる。期限の後は毎日 04:05 の `tcops.py jobs memory-trash` がファイルごと消す
  (出力 `{"purged": 件数, "files": 消したファイル, "failed": 失敗}`。`failed` が続く時は保存先の権限を確かめる)。
  定期実行を登録済みなら `python3 scripts/ops/tcops.py schedule install` をもう一度実行すると足される。

## 8.13 移動・滞在の既定・案の比較・猶予つきのアカウントの削除(Gate G7)

- **移動・滞在の既定**(MOVE-03): 旅行ごとの既定(`plan_movement_settings`。歩く速さ・同行者・種類ごとの滞在・休憩・1日の上限・
  最終の便の前の余裕)で、終了時刻の無い予定の滞在を見積もって検証する(`feasibility-v2`。見積もりの指摘は「見積もり」と示す)。
  変更は版(If-Match)つき。監査には変えた項目の名前だけを残す(同行者の属性の値は残さない)。見積もりを使わない設定にすると、
  以前の検証(終了時刻のある予定だけ)に戻る。問い合わせ「休憩の無い連続と出る」: 既定の「休憩とみなす空き」と滞在の見込みを確かめる。
- **最終の便**: 移動の区間の `last_departure_at`(任意)より出発が後なら、検証が「最終の便に間に合わない」と示す。
- **日をまたぐ予定**(FR-005): 予定の終了は「時刻」と「開始の日から何日後か(0〜2)」で持つ(1件の長さは72時間まで)。
- **案の比較**(FR-019): 本案と案(最大3つ)を、検証の件数・直線距離による移動の概算・疲れ・費用(通貨ごと)・外す予定に紐付く予約で比べる。
  予約は自動では取り消さない。見せない設定(FR-045)の費用・予約は比較にも出さない。
- **猶予つきのアカウントの削除**(FR-039): 会員は「14日後に削除する(取り消せる)」で申し込める(`ACCOUNT_DELETE_GRACE_DAYS`、既定14日)。
  申し込みの間はいつも通り使え、本人が取り消せる。予定日を過ぎた申し込みは毎日 04:20 の `tcops.py jobs account-deletions` が
  すぐの削除と同じ手順で消す(出力 `{"deleted": 件数, "skipped_admin": 飛ばした管理者の件数, "failed": 失敗}`)。管理者は飛ばす
  (管理者の権限を外してから本人が削除する。§8.5)。本人からの「取り消したい」: 予定日の前なら画面で取り消せる。
  定期実行を登録済みなら `python3 scripts/ops/tcops.py schedule install` をもう一度実行すると足される。

## 8.14 案の中の区間・予約・所有者の移譲・訂正・定期の処理の記録(Gate G8)

- **定期の処理の記録**(FR-004・O02): 9つの定期の処理は実行ごとに `ops_job_runs` へ時刻・成否・件数だけを残す(30日で消す)。
  確かめる: `docker compose exec -T backend python -m app.ops.job_runs status`(1行の JSON)、または管理者の画面の「定期の処理」。
  判定は ok(最後の成功が 間隔×2+10分 以内)・overdue(それより古い)・failing(最後の実行が失敗)・never(記録なし)。
  `tcops.py monitor` は overdue・failing を `job_overdue:<名前>`・`job_failing:<名前>` として知らせる(never は知らせない)。
  - `never` しか無い: 定期実行が未登録(§2.1 の `schedule install`)。
  - `overdue`: crontab が消えた・コンテナが止まっていた。`crontab -l` と §3.1 を確かめ、処理を手で1回動かす
    (例: `python3 scripts/ops/tcops.py jobs account-deletions`)。
  - `failing`: `last_error`(例外の種類だけ)とコンテナのログを確かめる。DB・Redis の障害なら §3.1・§3.2。
- **案の中の区間・予約**(FR-019): 案で「取り消す予定」にした予約は、採用しても予約先では取り消されない。準備の一覧に
  「予約の取消の手続き: <予約>」が入る。問い合わせ「採用したのに予約が残っている」: 手続きの後に予約の状態を「取消」にする。
  採用は本案の「元に戻す」で戻せる(採用の後に予約の紐付けを手で変えていれば 409。紐付けを戻してからやり直す)。
- **所有者の移譲**(FR-021): 手続き中(期限7日、`OWNERSHIP_TRANSFER_DAYS`)は旅行の削除・受け取る人を外すことが 409
  (`ownership_transfer_pending`)。問い合わせ「旅行を消せない」: 共有の画面の「所有者の移譲」で申し出を取り下げる。
  運用者が所有者を直接書き換えることはしない(本人どうしの申し出と受け入れで行う)。
- **訂正**(FR-039): 本人の情報の訂正の前後と出典は本人だけが見られる(運用者・監査ログには値を残さない)。旅行の中の情報の
  訂正の申し出は旅行の所有者が対応する。`ENCRYPTION_KEY` が無い環境では 503(`encryption_not_configured`)で何も変えない。

## 9. CI と main の保護(Gate S11)

- main は保護する: 必須の CI(secret-scan / dependency-audit / frontend / backend / e2e)、管理者にも適用、強制 push・削除の禁止。
  設定: `GITHUB_TOKEN=<管理者のトークン> python3 scripts/ops/ci_gate.py protect`(トークンが無いと画面での手順を表示する)。
  確認: `python3 scripts/ops/ci_gate.py status`。
- パッチの流れ: omega-dev2 で全試験に合格 → commit → `gate/<名前>` へ push → `ci_gate.py wait --sha <commit>` で CI の全ジョブの
  合格を待つ(20分前後)→ 同じ commit を main へ push → `gate/<名前>` を消す。**CI が不合格なら main は変わらず、手元は元に戻る**
  (`gate/<名前>` は調べるために残す)。GitHub の Actions の画面で落ちたジョブを確かめる。
- [Gate L5-r2] CI が不合格の時、`ci_gate.py wait` は落ちたジョブの注記(Playwright の失敗は `github` の reporter で注記になる)と
  ログの要点を表示し、ログの全体を一時ファイル(`/tmp/travelcanvas-ci-<commit>-<ジョブ>.log`)に残す。後から見るには
  `python3 scripts/ops/ci_gate.py failures --sha <commit>`。落ちたのが **e2e だけ**なら、内容を表示したうえで **1回だけ**再実行し、
  再実行で合格したら「不安定」と表示して合格にする(表示した1回目の失敗は次の Gate で直す)。ほかのジョブの不合格は再実行しない。
- CI の実行環境は `ubuntu-24.04` に固定する(`ubuntu-latest` は 2026-10-19 から Ubuntu 26 へ順次移る。移行中に E2E が揺れた)。
- GitHub に届かない時(`ci_gate.py wait` の終了コード 2)は main へ送らない。保護を設定する前に限り、`TC_SKIP_CI_WAIT=1` を付けて
  パッチを実行すると従来どおり直接 main へ送る(保護の後は GitHub が拒否する)。

---

## 10. 改訂履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-10-16 | 1 | Gate O1 で新設(B-010) |
| 2026-10-17 | 2 | Gate O2: ログの個人情報の検査(`log-scan`、毎日 03:50、監視の `log_leak`、§3.6)。定期実行を登録済みの場合は `schedule install` をもう一度実行すると追加される |
| 2026-10-18 | 3 | Gate S3: 回数制限の共有(Redis)と監視(§3.7) |
| 2026-10-18 | 4 | Gate S4: 文書の配信条件・アップロードの上限・ウイルス検査(§3.8)と防御の計数 |
| 2026-10-18 | 5 | Gate S6: 不審な接続元の自動遮断と、攻撃の兆候の監視(§3.9、§7) |
| 2026-10-18 | 6 | Gate S7: 怪しい接続元の入口に計算の確認(§3.10) |
| 2026-10-18 | 7 | Gate S8: 侵害が疑われる時の手順と封じ込めの操作(§8)。改訂履歴は §9 へ |
| 2026-10-18 | 8 | Gate S10: 画面の CSP 違反の報告と監視(§3.11、§7) |
| 2026-10-19 | 9 | Gate S11: 多要素認証(§8.3)、CI と main の保護・パッチの流れ(§9)。改訂履歴は §10 へ |
| 2026-10-21 | 11 | Gate G2: DB の権限の分離(§8.6)、Webhook の自動の再送の定期実行(§2.1)、サポート閲覧と運用の要約(§8.7)、即時の通知と同行者向けの項目の規則(§8.8) |
| 2026-10-22 | 13 | Gate G4: 検索のコマンド・合意の採用・通知の設定とメールのまとめ・ゲストの閲覧・濫用への対応(§8.10)、定期実行 poll-deadlines・email-outbox・abuse-scan(§2.1) |
| 2026-10-23 | 14 | Gate G5: 為替の記録・予算の版・支出の取消・精算の締め・使用量の上限・組織のロゴ・独自のドメイン・席の上限(§8.11、`USAGE_LIMITS` §2.3) |
| 2026-10-23 | 15 | Gate G6: オフラインの端末ごとの鍵と失効・日程と並びのオフラインの編集・守る範囲・旅行記の公開・記録の削除の取り消し(§8.12)、定期実行 memory-trash(§2.1) |
| 2026-10-27 | 17 | Gate G8: 定期の処理の記録と遅れ・失敗の監視、案の中の区間・予約、所有者の移譲、出典つきの訂正(§8.14) |
| 2026-10-26 | 16 | Gate G7: 移動・滞在の既定・最終の便・日をまたぐ予定・案の比較・猶予つきのアカウントの削除(§8.13)、定期実行 account-deletions(§2.1) |
| 2026-10-22 | 12 | Gate G3: 画面の本番用の配信・データ鍵と鍵の破棄による削除・バックアップの鍵の写し(§4.1・§8.9)、TOTP の鍵と解除の二者の確認(§8.3)、エラーの問い合わせ番号・性能の検査(§8.9)。定期実行を登録済みなら `schedule install` をもう一度実行すると `keys purge-escrow` が足される |
| 2026-10-20 | 10 | Gate G1: 暗号化の鍵の版の切り替え(`tcops.py keys`、§8.2、`docs/ops/KEY-INVENTORY.md`)、main の保護の設定の記録(`ci_gate.py export`、§9)、CI の試験結果の保存と台帳の照合(§9) |
