# Gate P7 FR-019 トレーサビリティ表

- 対象: FR-019 What-if・旅程ブランチ(DOC-02)、SC-17
- Gate: P7(DB・API・UI・E2Eの縦切り)
- 前提: Gate P6適用後
- 関連ADR: `docs/adr/ADR-branches.md`
- migration: `e6c1a9d3b7f2`(revises `d2a7c5e9f4b1`、1テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p7_branches.py`(B)、`frontend/src/...`(F)、`frontend/e2e/branches.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 雨天・遅延・欠席・予算・体調の分岐案を保存 | FR-019、SC-17 | IMPLEMENTED | B `test_create_delay_branch_does_not_touch_plan`, `test_rain_and_fatigue_and_locked`; F; E |
| 2 | 本案を壊さずに分岐を生成 | SC-17 | IMPLEMENTED | B `test_create_delay_branch_does_not_touch_plan`; E |
| 3 | 本案との差分 | FR-019 | IMPLEMENTED | B `test_edit_adopt_and_undo`; F `branchModel.test.ts`, `BranchesPage.test.tsx`; E |
| 4 | 採用履歴(採用者・日時・状態) | FR-019 | IMPLEMENTED | B `test_edit_adopt_and_undo`, `test_discard_delete_and_permissions` |
| 5 | 採用は承認後に1つの変更セット、Undo可能 | 共通不変条件4 | IMPLEMENTED | B `test_edit_adopt_and_undo`; E |
| 6 | 本案と食い違う変更は採用しない | 共通不変条件4、FR-020 | IMPLEMENTED | B `test_conflicts_block_adoption`, `test_locked_and_validation`; F; E |
| 7 | 権限・楽観ロック・監査に内容なし | DOC-06 | IMPLEMENTED | B `test_discard_delete_and_permissions`, `test_create_delay_branch_does_not_touch_plan` |
| 8 | 契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 8種; F `contract.test.ts`, `c2b3.test.ts`, `p7branches.test.ts` |
| 9 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 一覧・詳細) |
| 10 | 予約・移動・費用の分岐と、移動時間・制約・費用差の比較 | SC-17 | NOT STARTED | ADR §3 ※ **SUPERSEDED BY Gate G7(比較は解消。案の中で予約・区間を変える分岐は gate-g7-trace.md #22 に残す)** |
