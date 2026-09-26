# Gate L3 FR-017 トレーサビリティ表

- 対象: FR-017 実行可能性検証(DOC-02)、FR-023の「満たす/満たさない」表示の一部
- Gate: L3(DB・API・UI・E2Eの縦切り)
- 前提HEAD: `18665181c062bebaa924c0c4def1bb42e1a8c55a`
- 関連ADR: `docs/adr/ADR-feasibility-validation.md`
- migration: `c3e8a1f47d20`(revises `b7d41e9c2a53`、`validation_runs`・`validation_issues`テーブル新設のみ)

凡例: `IMPLEMENTED`(実装・検証済み) / `PARTIAL`(一部) / `NOT STARTED`(未着手)。
試験名は `backend/tests/test_gate_l3_validation.py`(B)、`frontend/src/...`(F)、`frontend/e2e/feasibility.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 時間重複 | FR-017 | IMPLEMENTED | B `test_time_overlap_is_error_and_same_start_is_warning`; E |
| 2 | 移動不足(所要・準備・バッファ) | FR-017 | IMPLEMENTED | B `test_travel_shortfall_uses_duration_preparation_and_buffer`, `test_travel_with_unknown_end_is_error_only_when_certain_otherwise_unverified`; E |
| 3 | 営業時間外・休業日 | FR-017 | IMPLEMENTED | B `test_opening_hours_closed_day_outside_hours_overnight_and_unknown`, `test_opening_hours_from_database` |
| 4 | 予約不一致・取消済み予約 | FR-017 | IMPLEMENTED | B `test_reservation_mismatch_and_cancelled_reservation`, `test_reservation_link_checks_end_to_end` |
| 5 | 滞在不足 | FR-017 | PARTIAL | 終了未定で移動に間に合うか分からない予定を検証不能として示す(STAY_LENGTH_UNKNOWN)。標準滞在時間との比較は未実装 |
| 6 | 予算超過 | FR-017 | IMPLEMENTED | B `test_budget_constraint_sums_same_currency_and_reports_rest_as_unverified`, `test_budget_constraint_for_one_day_counts_only_that_day` |
| 7 | 休憩不足 | FR-017 | PARTIAL | 疲労(移動量)・食事間隔の制約で判定。B `test_fatigue_and_meal_interval_constraints`。休憩の自動判定は未実装 |
| 8 | 最終交通逸失 | FR-017 | PARTIAL | 時刻制約(before)で判定。B `test_time_constraint_before_after_between`; E前提。時刻表照合は未実装 |
| 9 | 未確認情報(検証不能を問題なしにしない) | FR-017 | IMPLEMENTED | kind=unverified; B `test_unknown_start_time_is_reported_as_unverified_not_ok`, `test_text_constraints_are_possible_violation_or_unverified_never_satisfied`, `test_engine_failure_is_recorded_as_failed_not_as_ok`; F `validationModel.test.ts`; E |
| 10 | ERROR/WARNING/INFO分類 | FR-017 | IMPLEMENTED | B `test_findings_are_ordered_errors_first_then_warnings_then_unverified` |
| 11 | 根拠・影響・修正候補 | FR-017 | IMPLEMENTED | evidence/suggestion; B `test_travel_shortfall_uses_duration_preparation_and_buffer` |
| 12 | ハード/ソフト制約の判定(soft=重み付き警告) | FR-016/017 | IMPLEMENTED | B `test_time_constraint_before_after_between`, `test_avoid_transport_maps_japanese_words_to_modes`; E |
| 13 | 秘匿制約は詳細非表示のまま判定に使う | FR-016/FR-023 | IMPLEMENTED | B `test_private_constraint_findings_never_contain_the_constraint_value`, `test_private_constraint_is_masked_for_others_and_never_stored_in_plain`; F `l3validation.test.ts` |
| 14 | 制約ごとの満たす/満たさない表示 | FR-023 | IMPLEMENTED | constraint_results; B `test_constraint_results_and_titles_in_response`; F `ConstraintsPage.test.tsx`; E |
| 15 | 結果の保存・履歴・古い結果の明示 | DOC-06 §9 | IMPLEMENTED | B `test_list_and_get_and_staleness`, `test_history_is_pruned_to_max_runs`; E(再読込・無効化後の古い表示) |
| 16 | 権限 | DOC-06 §21 | IMPLEMENTED | B `test_permissions_viewer_can_run_stranger_cannot`, `test_get_unknown_or_other_plans_run_is_404` |
| 17 | 画面: 未検証/問題なし/検証不能/失敗の区別 | SC-15 | IMPLEMENTED | F `ConstraintsPage.test.tsx`(実行可能性チェック); E |
| 18 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 未検証・結果表示) |
| 19 | 実backend応答との契約 | Gate C2b方式 | IMPLEMENTED | fixture `validation_run_*`(5種); F `contract.test.ts`, `c2b3.test.ts`(URL実在) |
| 20 | 最適化への制約反映 | FR-018 | NOT STARTED | Gate L4 |
