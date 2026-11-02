# Gate SearchUAT-S3 — 無料の検索の復旧・診断の修正・原価の表示と料金版・AI 10回(UAT の開始の準備)

基点: `main` `6632d65`(PR #45 の squash)。正本: 「Claude への作業継続指示: SearchUAT・原価是正・会話10回・実UAT」(2026-11-02)と
「最新現状監査・課題一覧・方針・工程表」(2026-11-02)。外への通信の試験は httpx.MockTransport と CI の E2E の模擬の提供元だけ。
**模擬・CI の成功は、実の Overpass・実 AI・実 Google の成功ではない。** 実環境の合否は omega-dev2 の UAT(下の「未実施」)で付ける。

## 1. 監査の指摘と対応

| ID | 指摘 | 状態 | 変更(ファイル) | 試験 |
|---|---|---|---|---|
| S3-02 | `search_diag.usage_breakdown` が無い列 `created_at` を参照(必ず AttributeError) | FIXED | `backend/app/ops/search_diag.py`(`occurred_at`) | `test_usage_breakdown_reads_occurred_at`(実の PostgreSQL の行で数える) |
| S3-03 | 比較の「UA なし」は httpx の既定の User-Agent(`python-httpx/…`)が付いていた | FIXED | 比較の条件を3つに分けた: アプリの UA / HTTP クライアントの既定の UA / header なし(要求から header を消す)。送った header(名前・User-Agent の値)を記録 | `test_user_agent_comparison_sends_the_same_body_and_only_changes_the_header`(wire の header を確かめる) |
| S3-03 / N04・N05 | 配備のたびに外へ 6 回・毎回 406 | FIXED | 標準の診断は外へ 1 回(`/api/status`、検索ではない)。`--probe`(最大 3 回)・`--compare`(最大 3 回)は明示した時だけ。429 の後は残りを送らない。待機中は送らない | `test_default_diag_sends_one_status_request_only`・`test_probe_stops_during_cooldown`・`test_compare_stops_after_429` |
| S3-04 / N03 | 配備の後はログが空(コンテナを作り直す) | FIXED | `search_diag.sh` は (a) 反映の前に退避したログ(出どころの名前つき)と (b) 今のコンテナのログ(作成の時刻つき)を分けて出す。空は「失敗なし」と書かない | `test_ops_scripts_run_the_diagnosis_without_reading_secrets`(順序)・`bash -n` |
| S3-01 / N06 | Overpass の問い合わせが重い(10km の around で nwr を一括・historic の全て・timeout 15 秒・maxsize 既定) | FIXED(実環境の合否は未実施) | `search_provider.build_overpass_query`: 囲む四角(bbox・索引)、カテゴリごとの種類(食べ物・市場は nw)、観光の値を絞る(historic の道標・記念の札などを外す)、`[timeout:10][maxsize:64MB]`、`out tags center 60`。円の外は除く(半径の内を保証)。待つ時間は 15 秒(server の上限より少し長いだけ。延ばしていない) | `test_query_is_light_bbox_and_bounded`・`test_results_outside_the_circle_are_removed` |
| N01 | 429 の Retry-After を守る・406 を繰り返さない・502/503/504 の扱い | FIXED | `search_guard`: 429 は Retry-After(無ければ 60 秒・最大 900 秒)、403/406 は 10 分、アプリから送らない(Redis で worker 間で共有、届かなければプロセス内)。502/503/504/時間切れは待機しない。次の送り先へ移るのは `OVERPASS_FALLBACK_URLS`(**既定は空**。利用者が承認した mirror だけ)で、429・406 では移らない | `test_429_waits_for_retry_after_and_does_not_send_again`・`test_406_is_not_repeated`・`test_timeout_and_5xx_do_not_start_a_cooldown`・`test_no_unapproved_fallback_and_failover_only_on_server_errors`・`test_rate_limit_is_not_bypassed_through_a_fallback` |
| N08 | 同じ条件の結果を保存していない | FIXED | 成功した結果だけを 45 分(`OVERPASS_CACHE_SECONDS`)。提供元の失敗の時は 6 時間(`OVERPASS_STALE_SECONDS`)までの古い結果を「前の結果(○時間前に取得)」として失敗と一緒に示す。キーは条件の SHA-256(入力の原文・利用者 ID なし。基点は小数 3 桁)。一部だけの結果は保存しない。保存を使った時は外へ送っていない(無料の送信の回数に数えない) | `test_cache_reuses_success_without_sending_and_keys_have_no_raw_input`・`test_partial_results_are_not_cached`・`test_failure_returns_the_previous_result_as_stale`・`test_api_reports_retry_after_cached_and_partial` |
| F06 補足 | 一部だけの結果の印が画面へ届いていなかった(結果の数で切った後の list から読んでいた) | FIXED | `search.py` は切る前の結果から `partial_providers` を読む | `test_api_partial_flag_survives_the_result_limit` |
| UI | 「該当なし」「一部」「提供元の障害」「429 の後の待機」「保存した結果」「前の結果(古い)」を分ける | FIXED | `PlaceSearchPanel.tsx`・`consultModel.searchErrorMessage`・`cachedLabel` | vitest `PlaceSearchPanel.test.tsx` [S3] |
| C-01 / M02 | ¥8.05 が請求額に読める(「今月の実の提供元の見込み」) | FIXED | 概要を「今月の利用枠の計上(見込み)· 提供元の請求額ではありません」「今月の管理者の鍵の確認(見込み)· 旅行の枠とは別」「提供元の請求額: 未照合」の 3 つに分け、計上の根拠の表(料金版・SKU・単価 USD・1単位の円・換算・出典)を出す | `test_overview_separates_allowance_verification_and_invoice`・vitest `AdminOpsPage.test.tsx` |
| C-02 | Places の field mask は Text Search **Pro** なのに Enterprise $0.035 で計上 | FIXED | 新しい料金版 `2026-11-02.1`(migration `e9c1a5d3f7b2`。既存の migration は変えない)。Pro $0.032。field mask → SKU の表を試験にし、Enterprise の field を足すと失敗する | `test_places_field_mask_maps_to_the_right_sku`・`test_price_migration_constants_match_the_app` |
| C-03 | AI の単価が公式と違う | FIXED(単価だけ。実 usage との照合は未実施) | gpt-5-nano 入力 $0.05・出力 $0.40 / 100万 token(以前の版は $0.10・$0.50)。推論の token は出力に含めて数える。モデル・field mask・adapter の版は変えていない(**鍵の確認はやり直し不要**) | `test_policy_profiles_match_machine_readable_policy` |
| F07-4 | Journey AI 3回・Explorer 5回 | FIXED | 2026-11-02.1: Journey・Explorer の AI 10回、Journey の場所の検索 3回。AI の回数 = 送った要求の数(送った後の失敗・時間切れ・読めない応答も 1回、送る前に断った・送らなかった予約の解放は戻る) | `test_journey_and_trip_per_plan_quotas`・`test_concurrent_journey_reservations_never_exceed_quota`(12 並行 → 10 成功)・`test_ai_call_quota_and_cap_are_enforced_per_consult`・E2E `zz-consult-ai.spec.ts` |
| F07-4 | AI の保護の枠 | FIXED | AI 以外の操作は、残りの AI の回数 × 1回の最大の額(0.2961円)を 1旅行 50円の中に残して予約する(`ai_protection_reserved`)。AI 自身・旧クラスには掛けない。利用枠の応答に `ai_calls_left`・`ai_protection_jpy` | `test_ai_protection_keeps_room_for_remaining_ai_calls` |
| F07-4 | 受入の場面 AI 10 + Places 3 + Routes 4 | FIXED(見込みの検算) | 無料枠・割引に頼らない見込みで 29.37円(≤ 45円)。AI を先・Google を先の両方の順で全て予約でき、11回目の AI は断る | `test_uat_scenario_ai10_places3_routes4_fits_both_orders` |
| F07-4 | 月の枠で「5旅行 × 50円を保証」と誤表示しない | FIXED | Journey の全ての上限 37.12円 × 5 = 185.6円 > 月 150円。月の枠・旅行の数は変えず、会員クラスの表に「各旅行の上限まで使うと月の枠で 4旅行まで」を出す(`plans_at_full_use`) | `test_tier_matrix_shows_plans_at_full_use_without_overpromising` |
| F07-3 | 追加の相談を `.slice(0, 4000)` で後ろから切り、最新の訂正を黙って失う | FIXED | 上限(AI 3000 文字・規則 4000 文字)を越える時は送らず、理由を出し、入力を消さない | vitest `ConsultInputs.test.tsx` [F07-3] |
| OPS-02 | 管理ダッシュボードの総数にゲスト・試験が混ざって見える・super_admin を登録の利用者に数える | FIXED | 総数(ゲスト・試験を含む)の内訳: 登録(試験を除く)・ゲスト・管理者(super_admin を含む)・運用の試験(`@ops.invalid`)。旅行は下書き・進行中・完了・ゲスト・試験 | `test_dashboard_separates_guests_tests_and_super_admins` |
| OPS-01 / T01 | Fake の試験の意味が誤解しやすい・データが残る | PARTIAL | 画面に「外への送信 0 回の原価の上限の試験。実 AI の受入ではない。実行のたびに試験の利用者 1名・旅行 1件が残る。繰り返し実行しない」と明記し、ダッシュボードで分けて数える。保管・削除の操作は未実装(既存の行は消さない) | vitest `AdminOpsPage.test.tsx` |

## 2. 計算の表(料金版 2026-11-02.1。円 = USD × 180 × 1.10 × 1.15 = 227.7)

| 操作 | field mask / モデル | SKU | 単価(USD) | 1単位の計上(円) | 出典(2026-11-02 に確認) |
|---|---|---|---:|---:|---|
| 場所の検索 | `places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri` | Text Search Pro | 0.032 / 要求 | 7.2864 | Google Text Search の field と SKU、Maps Platform pricing(Pro $32/1,000・月 5,000 は無料の使用の上限) |
| 鍵の確認(場所) | `places.id` | Text Search Essentials (IDs Only)(公式は無料・上限なし) | 見込みは場所の検索の単価で数える(高めの見込み) | 7.2864 | 同上 |
| AI の読み取り | gpt-5-nano | 入力 / 出力 | 0.00000005 / 0.0000004 per token | 1回の最大(10,000 / 2,000 token)0.2961 | OpenAI gpt-5-nano |
| 経路 | `routes.duration,routes.distanceMeters` | Compute Routes Essentials | 0.005 / 区間 | 1.1385 | Maps Platform pricing |
| 場所の詳細・写真・地図 | (adapter は未接続) | Place Details Enterprise / Photos / Dynamic Maps | 0.020 / 0.007 / 0.007 | 4.5540 / 1.5939 / 1.5939 | Maps Platform pricing |

全ての回数の上限を同時に使った額: Free 0円・Trip 26.87円・Journey 37.12円・Explorer 48.00円(全て ≤ 50円)。

**¥8.05 と ¥9.1144 の区分:** ¥8.05 は旅行の口座(相談を旅行へ移したもの)に計上した Places ¥7.97 + OpenAI ¥0.08(以前の料金版
`2026-10-31.1` の単価。確定した記録は版のまま残す)。¥9.1144 は管理者の Google サーバー用の鍵の確認の日の枠の見込みで、旅行・相談の
50円の枠とは別。どちらも提供元の請求額ではない。**提供元の請求との照合は未実施**(Google Cloud Billing の請求先・プロジェクト・
SKU・月の使用量、OpenAI の usage の画面を読んでいない)。月 5,000 要求の無料の使用の上限があるため実際の請求が 0 円の可能性は
あるが、請求の画面を見るまで 0 円と断定しない。

**価格の訂正は原価の削減ではない:** Places の計上は 7.9695 → 7.2864 円(-8.6%)、AI 1回の最大は 0.4554 → 0.2961 円は、
料金版の単価の訂正による見込みの下落で、実際の API の原価は変わっていない。同じ課題での原価の半減(F07-5)は未評価。

## 3. 未実施(UAT・利用者の確認が要る)

| 項目 | 状態 |
|---|---|
| omega-dev2 で伊勢 10km の 観光・食べ物・市場 を、時刻を変えて 2 回以上、画面から OpenStreetMap で探す | NOT_RUN |
| 実 AI の 10 ターンの相談(会話の状態は F07-1/2 の次の PR) | NOT_RUN |
| 端末(PC・スマホ)の音声入力(https の入口・証明書の指紋の照合の後) | NOT_RUN |
| アプリの計上と Google Cloud Billing・OpenAI usage の照合 | NOT_RUN |
| F07-1/F07-2 会話の状態(要件 ID・訂正・削除・矛盾・複数の予算・差分の送信)・F07-5 原価と品質の比較 | NOT_IMPLEMENTED(次の PR) |
| Overpass の mirror(`OVERPASS_FALLBACK_URLS`)の採用 | 利用者の判断待ち(既定は空。承認の無い送り先へは送らない) |
| gpt-5-nano の後継のモデル(公式の表示は非推奨) | 利用者の判断待ち(変えると鍵の確認のやり直しが要る) |

## 4. 反映(omega-dev2)

migration `e9c1a5d3f7b2` は表・列を変えない(価格の版の行を足し、以前の 4 クラスの版を retired にする)。downgrade は 2026-11-02.1 で
予約・確定・口座の記録がある時は断る(その版で精算できなくなるため)。反映の手順は runbook `docs/runbooks/consult-uat-omega-dev2.md`。
