# Gate FR059-B トレース(外部 API の原価の守りのサーバー実装)

対象: `docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md`(正本 v5.1-p2)§2〜§11、FC-181〜185。migration `d5f9b2c8e1a3`
(down `c4e8a1f3b7d2`)。FR-059: SPECIFIED → **INTEGRATED(部分)**(外部の有料 provider は未接続のため VERIFIED にしない)。DOC-10 r28。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_fr059_cost_guard.py`(fake provider)、
FE = `frontend/src/components/planning/PlanningUsage.test.tsx`、E2E = `frontend/e2e/fr059-planning-usage.spec.ts`。

| # | 受入条件(正本 §11) | 状態 | 証拠 |
|---|---|---|---|
| 1 | クラスの表(Guest・Free・Trip Pass・Plus・Family/Group・Pro/B2B) | IMPLEMENTED | `app/services/cost_guard.py` `resolve`・`user_class`、BE `test_guest_is_zero_and_free_is_one_plan_per_month`・`test_plus_five_plans_then_sixth_denied_and_user_type_does_not_raise`・`test_trip_pass_only_for_assigned_plan`・`test_family_four_members_share_one_fifty_yen_cap`・`test_pro_contract_exception_only_after_approval` |
| 2 | `user_type`・要求の本文・`GET /entitlements` の書き換えで quota が増えない | IMPLEMENTED | `user_class`(付与だけを見る)、`planning-actions/estimate` は上限・クラスを受け付けない(422 `client_policy_ignored`)、BE・E2E |
| 3 | 同じ旅行への同時の呼び出しで 50円を越えない(原子的な予約) | IMPLEMENTED | 月 → 旅行の口座の `SELECT … FOR UPDATE`、BE `test_concurrent_reservations_never_exceed_cap`(別の接続 8本 → 3件だけ) |
| 4 | 残り 12円に 15円は provider の前で 429(例の usage・fallbacks)、ちょうど 50円は許可 | IMPLEMENTED | BE `test_boundary_429_payload`・`test_exactly_fifty_is_allowed` |
| 5 | token・Web 検索・Places の検索/詳細/写真・route・地図の上限 | IMPLEMENTED | BE `test_feature_quotas_checked_before_provider` |
| 6 | 時間切れ・再試行(1回)・同じ Idempotency-Key・単価の不明・失敗の後の解放で残りが負にならない | IMPLEMENTED | BE `test_idempotency_settle_release_and_expiry`・`test_run_retry_once_release_on_failure_and_suspend`・`test_price_profile_fits_cap_and_unknown_price_fails_closed`、口座の CHECK(0 以上) |
| 7 | Plus の6つ目の旅行を断り月が変わると再開・Free の2つ目・Trip Pass の割り当てていない旅行 | IMPLEMENTED | BE(1 と同じ)。割り当てていない旅行は利用者のクラスで判定(正本 §13 D8) |
| 8 | Family/Group は4人でも 50円、月の枠は支払う人に集まる | IMPLEMENTED | BE `test_family_four_members_share_one_fifty_yen_cap` |
| 9 | 画面: 0円 / 50円・80% の警告・上限の停止・未接続・手で続ける方法 | PARTIAL | `components/planning/PlanningUsageMeter.tsx`・`PlanningClassSummary.tsx`、FE(警告・停止・月の上限・読めない時)、E2E(0円 / 50円・未接続・ゲスト 0円・360px・暗い見た目・axe)。80% と停止の実際の画面の E2E は有料 provider の接続の後(fake では画面から使えない) |
| 10 | 使用の記録に入力の文章・鍵・旅程が無い | IMPLEMENTED | `provider_usage_events` に文章の列が無い。量は整数だけ(文字列は 422)。BE `test_feature_quotas_checked_before_provider`・`test_idempotency_settle_release_and_expiry` |
| 11 | 無料枠に依らない価格の検算(49.55円 ≤ 50円) | IMPLEMENTED | `worst_case_plan_cost`、BE `test_price_profile_fits_cap_and_unknown_price_fails_closed` |
| 12 | 実際の請求が見込みを上回った時の alert と provider の停止 | IMPLEMENTED(process の中) | `cost_guard.reconcile`・`_finish`(見込みの超過)、BE `test_reconcile_delta_suspends_provider`。worker 間の共有は D14 |
| 13 | 管理: クラスの付与・Trip Pass の割り当て・Pro の契約の例外は二者の承認(MFA の確認済みの管理者)・理由・監査 | IMPLEMENTED | `app/api/v1/planning_usage.py`、`pages/Admin/AdminEntitlementsPanel.tsx`、BE `test_admin_two_person_approval`、DB の CHECK `ck_entitlements_two_person`、FE |
| 14 | 利用者の削除: 付与・月の口座を消し、予約・使用の記録から本人を外す(金額は残す) | IMPLEMENTED | `account_deletion.scrub_provider_usage`、BE `test_account_deletion_clears_grants_and_accounts` |
| 15 | 指標(見込み・実際・予約・拒否・再試行・照合の差) | IMPLEMENTED | `app/ops/metrics.py` `add_provider_usage`(`travelcanvas_provider_usage_*`) |
| 16 | 外部の有料 provider の接続・staging での実際の請求の照合 | NOT STARTED | 正本 §11 の順(有料 provider の Gate)。`cost_guard.register_provider` を通さない provider は呼ばない |
| 17 | 無料の provider の使用の記録(§2.3) | NOT STARTED | 正本 §13 D11 |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| backend pytest | 1,296 合格・2 飛ばし(新規 16 件。同時の予約は別の接続 8本)。1回目は旅行の書き出しの表の漏れ(`test_export_covers_every_plan_table`)で失敗 → 本人の予約・使用の記録を旅行の書き出しに足して合格。flake8 0、mypy 0(基準 0)、Alembic の往復(`d5f9b2c8e1a3` ⇄ `c4e8a1f3b7d2`)で構造が一致 |
| frontend | vitest 906 合格・標準エラー 0 行(1回目は管理の画面の直書きの色のクラスが基準 1,632 を 7 件越えて失敗 → デザインの決まりの色へ直して合格)、tsc 0、lint 0、最初に読む JS 427.93 kB(上限 430 kB) |
| E2E(全件) | **90 合格・失敗 0・再試行 0**(1回目。新規 `fr059-planning-usage.spec.ts`) |
| 文書 | DOC-10 r28・V3 再監査 違反 0・trace の目次・エラーの一覧(216 件) |
