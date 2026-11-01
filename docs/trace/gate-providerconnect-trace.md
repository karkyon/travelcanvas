# Gate ProviderConnect — 鍵の有効性の確認・候補の有効化・OpenAI / Places / Routes の実接続

基点: `gate/secretpolicy` `1db0815`。正本: 「APIキー安全管理・有効性検証・実API接続 完全改修指示」(2026-10-31)の工程 2・4・5・6。
外への通信の試験は httpx.MockTransport(実の API は CI で呼ばない。模擬の成功は「提供元が鍵を認めた」証明ではない)。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 保存 → 候補 → 確認 → 有効化。有効な版があれば新しい鍵は候補(pending)で、有効な版は壊さない。確認(この設定・期限内に accepted)の無い候補は有効にできない。有効化は今の有効な版を条件に(違えば 409) | IMPLEMENTED | `test_candidate_never_breaks_the_working_key_and_needs_verification`、`test_discard_candidate_keeps_active` |
| 2 | 状態の分離: 保管・形・取得・提供元の認証(unverified / accepted / rejected / inconclusive)・操作ごとの結果・確認の時刻・期限・設定の hash・adapter・送信可能 | IMPLEMENTED | `provider_secrets.verification_view`、`test_provider_list_is_ready_only_after_verification` |
| 3 | 確認は管理者の明示の操作だけ(MFA の step-up は require_admin・理由・監査)。保存・一覧・画面・起動では送らない | IMPLEMENTED | `test_nothing_is_sent_on_save_list_or_pages`、vitest `確認は明示の操作…` |
| 4 | OpenAI は実際に使う Responses API とモデル(`OPENAI_MODEL`)で確認。Models 一覧は使わない | IMPLEMENTED | `test_verify_openai_uses_the_real_endpoint_model_and_records_without_the_key` |
| 5 | Google のサーバー用の鍵は Places (Text Search・field mask `places.id`) と Routes (2地点・`routes.duration,routes.distanceMeters`) を別々に確認。1つの成功で全部を確認済みにしない | IMPLEMENTED | `test_google_server_key_checks_places_and_routes_separately` |
| 6 | ブラウザ用の鍵はサーバーから確認しない(今の地図は OpenStreetMap。未使用と表示) | IMPLEMENTED | `test_browser_key_and_unknown_versions_are_not_verified` |
| 7 | 401/403/404/429/5xx/時間切れ/到達不可を固定のコードへ(キー無効・権限・API 未有効・送信元の制限・課金・残高・モデル・混雑・障害)。提供元の本文・URL・header・鍵を残さない | IMPLEMENTED | `test_classification_is_fixed_codes` |
| 8 | 送り先は許可の一覧の固定の URL だけ。TLS 検証あり・redirect を追わない・環境の proxy / SDK の環境変数を読まない | IMPLEMENTED | `test_only_allowlisted_endpoints_and_no_env_or_redirects`、`test_no_code_sends_to_paid_hosts_without_an_adapter` |
| 9 | 確認の期限(既定 72時間)・設定(モデル・送り先・field mask・adapter の版)の変更で以前の確認を使わない | IMPLEMENTED | `test_send_requires_fresh_verification_for_this_configuration` |
| 10 | 確認の費用: 単価の版から見込みを出し、送る前に管理者の確認の日の枠(全ての提供元の合計・既定 50円/日・日本時間)へ予約。越える時・30秒以内の連打は送らない。時間切れも見込みのまま数える。単価が分からない確認はしない | IMPLEMENTED | `test_daily_ops_budget_and_rate_limit_stop_before_sending`、`test_timeout_is_inconclusive_and_still_counted` |
| 11 | 業務の導線: 旅行の中の「AI に聞く」「Google で場所を探す」「Google で経路を調べる」(押した時だけ・編集者以上・Idempotency-Key)。順序: 権限 → クラス → 停止 → 上限・価格 → 予約 → 確認済みの鍵 → 送信 → 確定 | IMPLEMENTED | `test_ai_suggest_goes_through_tier_budget_and_records_usage`、`test_places_and_route_results_are_not_saved_and_attributed`、vitest `PaidActionsPanel` |
| 12 | 管理者でもクラス・50円を迂回しない。Free・Trip の AI、Free の検索は送る前に拒否 | IMPLEMENTED | `test_class_denial_sends_nothing` |
| 13 | 二重押し・同じ Idempotency-Key で二度送らない | IMPLEMENTED | `test_idempotent_replay_does_not_send_twice`、vitest(送っている間は押せない) |
| 14 | 送信の時の鍵の拒否は鍵の状態へ記録し、次の送信を止める(予約は解放) | IMPLEMENTED | `test_rejected_key_at_send_stops_the_next_send` |
| 15 | 時間切れ(届いたか分からない)は予約を解放せず見込みの額で確定 | IMPLEMENTED | `test_timeout_at_send_is_counted_not_released` |
| 16 | 結果は旅行に保存しない。AI は「要確認」、Google は帰属「Google」を表示 | IMPLEMENTED | 同上・vitest |
| 17 | adapter の一覧は実装の正本(`provider_calls.ADAPTERS`)から作る。「接続済み」は鍵の確認が通った時だけ | IMPLEMENTED | `test_key_present_is_not_connected_without_adapter`、`cost_guard.connected_operations` |
| 18 | GCP Secret Manager(SECRET_BACKEND=gcp_secret_manager)の本体の接続 | NOT_IMPLEMENTED(GCP の実行 ID・最小 IAM・LAN からの短期認証の準備が前提。暫定の db_encrypted のまま) | — |
| 19 | 実の鍵での確認・業務の少数の実送信・無効化の後の送信 0・請求の照合 | NOT_RUN(omega-dev2 で利用者が行う。runbook `secretpolicy-acceptance-omega-dev2.md` §5) | — |
| 20 | 写真(places.photo)・場所の詳細(places.details)・Web 検索(ai.web_search)・地図の読み込み(map.load) | NOT_IMPLEMENTED(クラスの表には残るが adapter は無く、送らない) | `ADAPTERS` に無い |

## 価格と枠
- 確認の見込みは `usage_policy_profiles` の版(explorer・2026-10-31.1)の単価から計算する(Places は enterprise の単価で多めに見積もる)。
- 業務の操作は既存の FR-059 の cost_guard(1旅行 50円・40円の警告・45円の運用の通知・クラス別の回数)をそのまま通る。
- 管理者の確認の日の枠(50円/日)は本 Gate で新しく置いた初期の方針(設定 `OPS_VERIFY_DAILY_CAP_JPY`)。
