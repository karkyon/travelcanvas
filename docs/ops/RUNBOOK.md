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
| 応答が遅い(`slow_responses`) | `/metrics` のルート別の時間 | §3.4 |
| ディスクが少ない(`disk_low`) | `df -h`、`tcops.py list` | §3.5 |
| バックアップが古い・無い(`backup_stale` / `backup_missing`) | `ops-state/logs/backup.log` | §4.1 |
| データを壊した・消した | **何もせず §5 を読む** | §5 |
| 更新後に不具合(コードを戻したい) | `tcops.py rollback-plan --to <commit>` | §6 |

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
| 5分ごと | 監視(状態が変わった時だけ記録・通知) |

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

---

## 4. バックアップ

### 4.1 中身

1回のバックアップは3つのファイル(ID は `tc-YYYYMMDDTHHMMSSZ`、UTC):

| ファイル | 中身 |
|---|---|
| `<id>.db.dump` | 運用中の DB の `pg_dump -Fc`(postgres コンテナの中で実行。パスワードを使わない) |
| `<id>.uploads.tar.gz` | 保存ファイル(文書・写真・音声。backend の `/app/uploads`) |
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

`/metrics` は Prometheus のテキスト形式なので、将来 Prometheus・Grafana を入れる時もそのまま取り込める。

---

## 8. 改訂履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-10-16 | 1 | Gate O1 で新設(B-010) |
