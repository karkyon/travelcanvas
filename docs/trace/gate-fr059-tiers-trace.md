# Gate FR059-Tiers トレース(会員の機能クラス Free / Trip / Journey / Explorer)

対象: 利用者の指示「TravelCanvas 最新ソース監査・4クラス実装・本日テスト一括指示」(2026-10-31)の §3・§5 B。
FR-059 正本 §3.2〜§3.5・§13 D15。migration `a1d3f5b7c9e2`(価格の版 `2026-10-31.1` の行を足す。表・列は変えない)。
実の有料の API へは送らない(Fake の提供元だけ)。価格・販売・決済(FR-058)は持たない。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 4つのクラスを旅行の中の権限・ゲスト・Family/Group・Pro・Trip Pass と別の Entitlement にする(`trip_planning.class.<tier>`) | IMPLEMENTED | `backend/app/services/membership_tiers.py`・`cost_guard.CLASS_PRIORITY`、BE `test_gate_fr059_tiers.py::test_resolution_order_and_legacy_classes_unchanged` |
| 2 | クラスに含まない有料の操作を provider の前で 403 `tier_feature_not_included`(口座・予約を作らない)。Free は AI・有料の検索なし、Trip は AI なし、Journey は Web 検索なし | IMPLEMENTED | `cost_guard._tier_denial`・`reserve`、BE `test_class_matrix_allows_and_denies_before_provider[free/trip/journey/explorer]`・`test_run_never_calls_provider_for_excluded_operation` |
| 3 | クラス別の回数の上限を価格の版から逆算し、全ての上限を同時に使っても 1旅行 50円以下(Trip 28.23・Journey 29.60・Explorer 49.55)。月の上限 ≥ 月の旅行の数 × 最大額 | IMPLEMENTED | FR-059 正本 §3.3、BE `test_policy_profiles_match_machine_readable_policy` |
| 4 | 40円の警告・45円の運用の知らせ・ちょうど 50円の許可・越える見込みの拒否は全てのクラスで同じ | IMPLEMENTED | BE `test_thresholds_40_45_50_same_for_every_class[trip/journey/explorer]`・`test_explorer_full_use_stays_under_cap_and_alerts_at_45` |
| 5 | 同時の予約(別の接続 6本)でも回数を越えない | IMPLEMENTED | BE `test_concurrent_journey_reservations_never_exceed_quota` |
| 6 | Family/Group の人数で枠を増やさない(共同編集の人も所有者のクラス・台帳) | IMPLEMENTED | BE `test_family_members_do_not_multiply_explorer_cap` |
| 7 | 旧 Free(AI 5回)は retired、旧 Plus・Trip Pass・Family・Pro は一律に変えない。downgrade で戻せる | IMPLEMENTED | migration `a1d3f5b7c9e2`、CI の Alembic upgrade → downgrade → upgrade、BE `test_trip_pass_plan_keeps_legacy_quota_for_free_member` |
| 8 | `GET /entitlements`・`GET /plans/{id}/planning-usage` にクラスの説明(`tier`)、Free の旅行は `manual_only`、操作ごとの `included` | IMPLEMENTED | `cost_guard.plan_summary`・`user_summary`、BE `test_api_entitlements_show_tier` |
| 9 | 画面: 旅程の利用枠・旅行相談の入口にクラスの副題、Free は「外部の AI・有料の検索を使いません(0円)」、含まない操作は「このクラスに含まない」 | IMPLEMENTED | FE `PlanningUsageMeter.tsx`・`planningUsageModel.ts`、FE `PlanningUsage.test.tsx`、E2E `fr059-planning-usage.spec.ts`・`gate-g11-usage-layout.spec.ts`(Free の状態でも一覧が動かない) |
| 10 | 管理の付与(二者の承認)に Trip・Journey・Explorer | IMPLEMENTED | `planning_usage.admin_request_entitlement`(`USER_CLASSES`)、FE `AdminEntitlementsPanel.tsx`、BE `test_admin_two_person_approval_for_tiers` |
| 11 | 運用コンソール「会員クラス」: 比較・機能の表・移行の表・閾値(`GET /admin/ops/tiers`) | IMPLEMENTED | `admin_ops.ops_tiers`、BE `test_ops_tiers_matrix`、FE `AdminOpsPage.test.tsx`、E2E `ops-console.spec.ts` |
| 12 | 開発環境の試験の切り替え(多要素認証・理由・24時間・監査・本番は 403・正式な付与は消さない) | IMPLEMENTED | `POST /admin/ops/test-tier`、BE `test_ops_test_tier_switch`、E2E `ops-console.spec.ts` |
| 13 | Fake の家族旅行の試験でクラスを選ぶ(Free は全て断り 0円、外部への送信 0回) | IMPLEMENTED | `POST /admin/ops/test-runs/family-fake`(`tier`)、BE `test_family_fake_run_per_tier[...]` |
| 14 | 保存の数・オフライン・書き出しのクラス別の制限 | NOT STARTED | 表では △ とし、強制は「既存の上限のまま」と表示(数値は未決定。推測で入れない) |
| 15 | 価格・販売・決済(Trip・Journey・Explorer の購入) | NOT STARTED | FR-058(製品の判断待ち) |
| 16 | 実の有料の API でのクラス別の確認・請求の明細との照合 | NOT STARTED | 利用者の承認(契約・鍵・金額)と adapter の Gate の後 |
