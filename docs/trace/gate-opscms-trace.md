# Gate OpsCMS トレース(運用コンソール: 外部 API の接続・原価の台帳・Cloud 環境・Fake の家族旅行の試験)

対象: 利用者の指示「TravelCanvas API運用CMS・テスト基盤: Claude実装指示」(2026-10-30)の Phase 0(有料の API を使わない)と CMS のモック。
migration なし(既存の FR-059 の表 usage_budget_accounts・provider_usage_reservations・provider_usage_events を読む)。FR の状態の遷移なし。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = pytest、FE = vitest、E2E = Playwright。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 管理者(多要素認証)だけが使える。管理者でなければ 403 | IMPLEMENTED | `backend/app/api/v1/admin_ops.py`(require_admin)、BE `test_gate_opscms.py`、E2E `ops-console.spec.ts` |
| 2 | 概要: Fake の試験の額と実の提供元の見込みを別の欄に。閾値 40/45/50円。Cloud Billing は「取得していない」 | IMPLEMENTED | `GET /admin/ops/overview`、FE `AdminOpsPage.test.tsx` |
| 3 | API・契約と接続: 提供元ごとの用途・登録・停止・価格の版・鍵の設定の有無・送信の可否。鍵の値は返さない | IMPLEMENTED | `GET /admin/ops/providers`、BE(鍵の値が応答に出ない) |
| 4 | 提供元を止める・戻す(理由・監査) | IMPLEMENTED | `POST /admin/ops/providers/{name}/suspend・resume` |
| 5 | 原価・利用台帳: 旅行ごとの確定・予約中・残り・状態・提供元別。旅行の題・相談の文章を返さない | IMPLEMENTED | `GET /admin/ops/ledger` |
| 6 | Cloud 環境: 実行環境から読める値だけ。請求・予算・有効な API・Secret Manager は未取得と表示 | IMPLEMENTED | `GET /admin/ops/cloud` |
| 7 | 家族旅行の Fake の試験: 50円を越えない・40円/45円の段・送る前に断る・Idempotency-Key で二重に数えない・本番では断る | IMPLEMENTED | `POST /admin/ops/test-runs/family-fake`、BE・E2E(49.55円で止まる) |
| 8 | 接続の手順・停止・鍵の入れ替えの Runbook | IMPLEMENTED | `docs/runbooks/ops-console-api-connection.md` |
| 9 | 実の提供元(OpenAI・Maps JavaScript・Places (New)・Routes)の adapter・live の1回の確認・請求の照合の画面 | NOT STARTED | 契約・鍵・Secret Manager は利用者の操作が先(Runbook §2) |
| 10 | GCP の Cloud Billing・Service Usage・Secret Manager をアプリから読む | NOT STARTED | 実行のアカウントの権限を足す判断が要る(最小の権限) |
| 11 | 価格の版の変更の画面(差分・理由・試算) | NOT STARTED | 版は今 migration で入れる。画面からの変更は別の Gate |

## Gate OpsSecrets(鍵の登録。利用者の承認 2026-10-30: 表 provider_secrets を足す)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 12 | 運用コンソールから API キーを登録する(管理者 + 多要素認証・理由が必須・監査)。ENCRYPTION_KEY で暗号化して保存し、平文を返す API は無い | IMPLEMENTED | `backend/app/services/provider_secrets.py`・`POST /admin/ops/secrets/{slot}`、migration `e8b4c2a7f1d3`、BE `test_gate_opscms.py` |
| 13 | 画面・応答・監査には末尾4文字・版・出典(cms/env)だけ。入力は password の欄で、保存の後は空にする | IMPLEMENTED | FE `AdminOpsPage.test.tsx`、E2E `ops-console.spec.ts`(ページの HTML に値が無い) |
| 14 | 新しい版で前の版は入れ替え済み(有効は slot ごとに1つ)・無効にすると .env の値へ戻る | IMPLEMENTED | BE |
| 15 | 鍵の列は `*_ciphertext`(鍵の点検・掛け直し `tcops.py keys` の対象) | IMPLEMENTED | `provider_secrets.secret_ciphertext` |
| 16 | 登録した鍵で外部の API へ送る(提供元の adapter) | NOT STARTED | 提供元の Gate(契約・価格の確認の後) |
