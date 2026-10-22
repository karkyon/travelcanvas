# Gate G2 トレース(DB の権限の分離・依存のメジャー更新・外部サービスの要らない「(部分)」の解消)

対象: 監査の実行台帳(2026-10-20、`main@af7de3d`)のうち利用者だけで進められるもの — SEC-F4、DEP-1、FR-020・FR-040・
FR-042・FR-045 の「(部分)」。migration 3つ(`f1a7c3e9b2d4` → `f2b8d4a1c6e3` → `f3c9e5b7a2d1`、Alembic head `f3c9e5b7a2d1`)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: R = `backend/tests/test_gate_g2_db_roles.py`、
O = `test_gate_g2_org_api.py`、S = `test_gate_g2_support_access.py`、M = `test_gate_g2_member_policy.py`、
T = `test_gate_g2_realtime.py`、F = `frontend/src/pages/G2.features.test.tsx`。

## SEC-F4 DB の権限の分離(`docs/adr/ADR-db-roles.md`)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | アプリのロールは表の読み書きだけ(DDL・migration の版の書き換え・権限の付け替えは拒否) | IMPLEMENTED | `app/ops/db_roles.py`。R(実 PostgreSQL で拒否・許可を確かめる) |
| 2 | 所有者の資格情報は migration の一回きりの処理だけ(backend へ渡さない) | IMPLEMENTED | `docker-compose.yml` の `migrate`・backend の `DATABASE_URL: ${APP_DATABASE_URL}`。R `test_compose_runs_app_with_least_privilege_role` |
| 3 | 今後の表にも権限が付く(migration で表を足しても動く) | IMPLEMENTED | `ALTER DEFAULT PRIVILEGES`。R |
| 4 | 起動後に権限を点検(CI・パッチで止める) | IMPLEMENTED | `db_roles check --expect-app`、CI の e2e ジョブ |
| 5 | バックアップは読むだけのロール・監視は pg_monitor | IMPLEMENTED | `tcops.py backup`(tc_backup)、tc_readonly_monitor |
| 6 | 運用の道具の資格情報をコマンドの引数に出さない | IMPLEMENTED | `app/ops/cli.py`(`-e OPS_DATABASE_URL` は名前だけ)。R `test_tcops_passes_owner_url_to_backend_only_and_hides_it` |

## DEP-1 依存のメジャー更新

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 7 | vite の脆弱性の例外を無くす(Vite 6.4・Vitest 4) | IMPLEMENTED | `frontend/package.json`、`scripts/security/dependency-allowlist.json` の node の例外 0 件、`npm audit` 0 件 |
| 8 | React Router 7・Tailwind CSS 4・typescript-eslint 8 | IMPLEMENTED | 見た目の互換(枠線の色・ボタンのカーソル)は `src/index.css`。tsc・lint・Vitest・E2E 全件 |
| 9 | 最初に読む JS の上限(450kB)を守る | IMPLEMENTED | 管理者の確認・コマンドパレット・オフラインの鍵・G2 の decoder を遅延読込。`scripts/ci/check_bundle_budget.py` |

## FR-020 共同編集(即時)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| G2-20 | 他の人の保存・開いている人の変化を即時に知らせる | IMPLEMENTED | `GET /plans/{id}/events/stream`(SSE)、`hooks/usePlanPresence.ts`。T、E2E `realtime-collab.spec.ts` |
| 21 | 見られなくなったら切る・同時の接続の上限・つなぎ直し(Last-Event-ID) | IMPLEMENTED | T `test_stream_access_rules_and_limit`・`test_stream_ready_revision_presence_and_reconnect` |
| 22 | 文字単位の同時編集(CRDT) | NOT STARTED | 対象外(版の競合を検出する方式。ADR-collaboration 追記) |

## FR-040 管理・監査

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| G2-40 | サポート閲覧は本人の同意・目的・時間制限・監査 | IMPLEMENTED | `support_grants`、`/privacy/support-grants`・`/admin/support-grants`。S、F、E2E `support-access.spec.ts` |
| 41 | 読み取り専用の投影(秘密・個人の値を出さない)・本人への知らせ・自分の許可は見られない | IMPLEMENTED | S `test_admin_views_masked_projection_with_audit_and_notice`・`test_admin_cannot_view_own_grant` |
| 42 | 共有の失効・外部連携の障害・容量・削除待ちの管理画面 | IMPLEMENTED | `/admin/operations`・`/admin/support`。S `test_operations_summary_and_share_link_revoke` |
| 43 | 濫用の自動検知の画面(FC-097) | NOT STARTED | 検知は S6 の運用の道具。画面は次の Gate |

## FR-042 API・埋込(`#G2-42`)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 44 | 書き込みの API(配布の変更・改訂・停止)。Idempotency-Key・If-Match・スコープ | IMPLEMENTED | `PATCH /ext/distributions/{id}` 等。O |
| 45 | 秘密・署名の鍵の猶予つきの切り替え・前の値の即時の失効 | IMPLEMENTED | `rotate-secret`・`retire-previous`、画面。O、E2E `org-api-rotation.spec.ts` |
| 46 | 自動の再送(間隔を伸ばす)・dead-letter・410 で停止・手の送り直し | IMPLEMENTED | `org_api.retry_due`、`tcops.py jobs webhook-retry`(5分ごと)。O |
| 47 | 埋め込み(iframe・部品)、旅行・予定・予約の書き込み | NOT STARTED | 個人データを外へ出さない方針で配布だけ。FR-042 は INTEGRATED(部分)のまま |

## FR-045 安全な共有ポリシー(`#G2-45`)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 48 | 同行者(編集者・閲覧者)向けの項目の規則(役割の既定・1人ずつ) | IMPLEMENTED | `app/services/member_policy.py`、`/plans/{id}/member-policy`、共有の画面。M、F、E2E `member-policy.spec.ts` |
| 49 | 隠した項目は全ての経路で出さない(画面・検索・出力・しおり・当日・同期・検証・コメント・場所) | IMPLEMENTED | M `test_viewer_sees_nothing_hidden_on_any_route`・`test_validation_hides_budget_and_reservation_issues` |
| 50 | 見えない値を上書きさせない | IMPLEMENTED | M `test_editor_cannot_write_or_read_hidden_fields` |

→ FR-020・FR-040・FR-045 は VERIFIED。FR-042 は INTEGRATED(部分)。DOC-10 v5.1-r14。

## 適用の修正(v2)

omega-dev2 での v1 の適用は frontend の像の build(`npx vite build`)で失敗し、自動で元に戻った。原因は
`frontend/Dockerfile` の `COPY . .`: `.dockerignore` は `.gitignore` の対象でリポジトリに無く、手元の
`node_modules`(G1 の依存。Vite 4・Tailwind CSS 3)がコンテナの `npm ci` の結果に上書きされ、Tailwind CSS 4 の
`@import 'tailwindcss'` が Tailwind CSS 3 の JS を CSS として読んだ(`CssSyntaxError: Unknown word "use strict"`)。

- build の段は build に要る物だけを写す(`index.html`・設定・`public`・`src`・`.env*`)。単体試験 `securityHeaders.test.ts`
- パッチは像を先に作り(migration の前)、失敗の原因の行を表示する。戻す時は手元の `node_modules` も実行前の lock へ戻す
- 予行は alpine(musl)の node 24 で Dockerfile の段どおりに build し、omega と同じく手元の古い `node_modules` を文脈に置いて確かめる
