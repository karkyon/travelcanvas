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
