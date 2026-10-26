# Gate L4 FR-018 トレーサビリティ表

- 対象: FR-018 説明可能な最適化(DOC-02)、SC-16、B-007
- Gate: L4(API・UI・E2Eの縦切り。DB変更なし)
- 前提: Gate P10適用後
- 関連ADR: `docs/adr/ADR-explainable-optimization.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_l4_optimization.py`(B)、`frontend/src/...`(F)、`frontend/e2e/optimization.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 元案と候補A/Bを比較(移動時間・違反数) | SC-16 | IMPLEMENTED | B `test_constraint_aware_candidate_and_apply_undo`; F `OptimizationPanel.test.tsx`; E |
| 2 | 制約(L2)・実行可能性検証(L3)を最適化の入力にする | FR-018、B-007 | IMPLEMENTED | B `test_constraint_aware_candidate_and_apply_undo`; E |
| 3 | 変更理由を自然言語と数値で提示 | SC-16 | IMPLEMENTED | B `test_candidates_reorder_with_time_slots_and_do_not_touch_plan`; F `optimizationModel.test.ts` |
| 4 | 移動したカード(順番・時刻の前後)を示す | SC-16 | IMPLEMENTED | B; F; E |
| 5 | 適用・却下(適用まで旅程を変えない) | SC-16、共通不変条件4 | IMPLEMENTED | B `test_candidates_reorder_with_time_slots_and_do_not_touch_plan`; E |
| 6 | 確定・予約付きの予定を動かさない | FR-018、共通不変条件4 | IMPLEMENTED | B `test_classify_and_time_slots`, `test_fixed_events_stay_and_stale_fingerprint` |
| 7 | 並び順と時刻の一貫性(時刻の枠の割り当て直し) | FR-005 | IMPLEMENTED | B `test_classify_and_time_slots`, `test_candidates_reorder_with_time_slots_and_do_not_touch_plan` |
| 8 | 再現性(方式・入力の版・決定的な候補ID) | FC-058 | IMPLEMENTED | B `test_route_totals_and_hash_are_deterministic`, `test_fixed_events_stay_and_stale_fingerprint` |
| 9 | 1つの変更セットで適用、Undo | 共通不変条件4 | IMPLEMENTED | B `test_constraint_aware_candidate_and_apply_undo`; E |
| 10 | 権限・楽観ロック・監査に内容なし | DOC-06、DOC-11 | IMPLEMENTED | B `test_permissions`, `test_constraint_aware_candidate_and_apply_undo` |
| 11 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 候補の表示) |
| 12 | 公平性・疲労の指標、条件変更、部分採用 | SC-16 | NOT STARTED | ADR §3 ※ **SUPERSEDED BY Gate G7(目的の内訳・重み・選んだ予定だけ。gate-g7-trace.md #14〜17)** |
| 13 | 外部経路サービスによる実移動時間 | FR-014/015 | NOT STARTED | ADR §3 |
