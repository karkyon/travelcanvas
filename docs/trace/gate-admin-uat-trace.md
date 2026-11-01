# Gate AdminUAT — 管理画面の鍵の表示の食い違いの解消と、旅行相談の UAT(実 AI・音声)を成立させる準備

基点: main `78aefe5`(omega-dev2 に反映済み・DB `c3e5a7b9d1f4`)。正本: 「Claude修正指示：管理画面の誤表示修正と旅行相談UATの成立確認」(2026-11-01)。
外への通信の試験は httpx.MockTransport と CI の模擬の提供元(`PROVIDER_HTTP_STUB`)。模擬の成功は実 AI の成功ではない。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | [2.1] DB 登録済みの鍵に「本物の鍵を登録してください」を出さない。旧 .env の情報は「旧設定の詳細」に畳み、文言は「旧.envにサンプル値が残っていますが、使用していません。現在のDB登録キーの利用には影響しません。」。DB 未登録で必要な時だけ CMS からの登録を案内(.env へは戻らない) | IMPLEMENTED | `opsSecretDisplay.legacyDisplay`・vitest `opsSecretDisplay.test.ts`・`AdminOpsPage.test.tsx`(DB 登録済み + 旧 .env サンプル + 確認済み) |
| 2 | [2.2] 登録の状態と接続確認の状態から表示を1つに決める(確認済み・未確認・拒否・未判定・期限切れ・設定変更後)。確認済みは「登録済み・接続確認済み」と「CMSで登録したキーをDBから取得します。確認期限：○年○月○日 ○時○分」。表示を成功に固定しない(backend の判定のまま)。確認が通ると再読み込みで更新 | IMPLEMENTED | `opsSecretDisplay.secretDisplay`・`providerSecretDisplay`・vitest(6 状態) |
| 3 | [2.2] 鍵の確認と、提供元の停止・会員クラス・枠による利用の制限を別に表示 | IMPLEMENTED | `/admin/ops/secrets` の `suspended_providers`・`restrictionNote`・`test_suspension_is_reported_apart_from_verification` |
| 4 | [2.3] 今の構成で使わない鍵(Google のブラウザ用。地図は OpenStreetMap)は「現在の構成では使用しません。設定不要」。未設定の警告にしない | IMPLEMENTED | `required`・`secret_required`・`test_unused_browser_key_is_not_required_and_used_keys_are`・E2E `ops-console.spec.ts` |
| 5 | [2.4] 「テスト実行(Fake)」のクラスは Fake 試験専用で、ログイン中の会員クラスは変わらないと明示。Fake の成功を実 AI の接続の成功として扱わない | IMPLEMENTED | `ops-run-fake-note`・E2E `ops-console.spec.ts` |
| 6 | [3] ログイン中のアカウントの UAT の準備(会員クラス・AI の利用の同意・AI/場所/経路の鍵と停止・模擬かどうか)を、今の値と変える場所つきで表示(送らない) | IMPLEMENTED | `GET /admin/ops/uat-readiness`・`test_gate_admin_uat.py`・E2E `ops-console.spec.ts` |
| 7 | [3 U05] 食い違う希望は AI が片方に決めず「確かめてほしいこと」に出す(schema `contradictions`) | IMPLEMENTED | `test_contradictions_are_returned_not_resolved`・E2E `zz-consult-ai.spec.ts` |
| 8 | [4] 音声の UAT 用の https の入口(compose の profile `uat-https`・caddy 2.8.4 の内部 CA・/api・/health・/ready だけを backend へ)。https の画面は同じ入口の API を使い(混在を起こさない)、CSP・CORS も同じ入口。`scripts/ops/uat_https.sh up|check|stop` は .env の TC_UAT_* と TC_PUBLIC_HOSTS の行だけを変え、証明書・health・ready・画面・CSP・CORS を確かめる | IMPLEMENTED | `test_ops_uat_https.py`・`test_uat_https_port_adds_https_origins_only_when_set`・vitest `publicHost.h1.test.ts`・`staticServer.test.ts`。手元で実の caddy 2.8.4 を通した E2E(相談の AI・入力の確認)4 件合格・安全な接続で「録音を始める」が出る |
| 9 | 実環境・実 AI での U01〜U12(PC・スマートフォン)、音声の実機の確認、実 API の呼び出しと利用台帳の照合 | NOT_RUN(omega-dev2 で行う。runbook `consult-uat-omega-dev2.md`) | — |
