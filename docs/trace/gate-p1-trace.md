# Gate P1 FR-025・FR-026 トレーサビリティ表

- 対象: FR-025 持ち物、FR-026 準備タスク・レディネス(DOC-02)、FC-068・FC-069・FC-070
- Gate: P1(DB・API・UI・E2Eの縦切り)
- 前提HEAD: `2e062498a1a91756598093c43d04bc018e27962c`
- 関連ADR: `docs/adr/ADR-preparation.md`
- migration: `a4d7e2c9b1f6`(revises `e5b9c2d8f341`、`packing_items`・`preparation_tasks`新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p1_preparation.py`(B)、`frontend/src/...`(F)、`frontend/e2e/preparation.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 共有/個人の持ち物、数量、担当、必須 | FR-025 | IMPLEMENTED | B `test_create_shared_item_with_assignee_and_audit_without_name`, `test_assignee_must_be_member`; E |
| 2 | 購入・梱包・使用後の状態 | FR-025 | IMPLEMENTED | status to_prepare/to_buy/packed/after_use; B `test_update_requires_if_match_and_detects_conflict`; E(梱包済み) |
| 3 | 個人の持ち物(薬等)は本人限定・暗号化 | FC-070、DOC-05 §8.5 | IMPLEMENTED | B `test_personal_item_is_encrypted_and_invisible_to_others`, `test_personal_item_check_constraint`; F `p1preparation.test.ts` |
| 4 | 日数・活動・海外・洗濯・子ども・薬から候補生成(理由付き) | FR-025、FC-069 | IMPLEMENTED | B `test_suggestions_reflect_itinerary_and_conditions`; E(海外・山歩き) |
| 5 | 天候は判定していないことを明示 | FR-030の方針、FR-017「検証不能を問題なしにしない」 | IMPLEMENTED | `unverified`; F `PreparationPage.test.tsx`; E |
| 6 | 旅程変更時の追加・不要・数量変更の候補 | FR-025 | IMPLEMENTED | B `test_adopted_suggestions_are_excluded_and_changes_are_proposed`; F(数量変更) |
| 7 | 未予約・未支払・未確認・未割当・期限切れ・持ち物不足の一覧 | FR-026 | IMPLEMENTED | B `test_readiness_detects_each_category`; E |
| 8 | 完了条件・責任者・期限 | FR-026、FC-068 | IMPLEMENTED | B `test_task_lifecycle_with_criteria_assignee_due`; E |
| 9 | 準備状況の項目をタスクで対応済みにする | FR-026 | IMPLEMENTED | B `test_readiness_item_converted_to_task_and_resolved`; E |
| 10 | 担当者(閲覧者)は状態/完了だけ変更できる | DOC-06 §21 | IMPLEMENTED | B `test_assigned_viewer_can_only_change_status`, `test_task_lifecycle_with_criteria_assignee_due`; F |
| 11 | メンバーから外れた担当者は未割当 | EX-018 | IMPLEMENTED | B `test_removed_member_assignee_becomes_unassigned` |
| 12 | 楽観ロック・論理削除・監査に本文なし | DOC-06 §23、DOC-05 §10.1 | IMPLEMENTED | B `test_update_requires_if_match_and_detects_conflict`, `test_delete_is_logical` |
| 13 | プラン削除で一緒に消える(外部キー方針) | Gate B-012 | IMPLEMENTED | B `test_plan_purge_removes_packing_and_tasks`; 既存 `test_every_foreign_key_into_plan_owned_tables_has_a_deletion_policy` |
| 14 | 「未取得」「準備完了」「残りあり」を区別 | SC-22 | IMPLEMENTED | F `preparationModel.test.ts`, `PreparationPage.test.tsx` |
| 15 | 実backend応答との契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 17種; F `contract.test.ts`, `c2b3.test.ts` |
| 16 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 準備状況・持ち物・タスク) |
| 17 | 薬の時刻通知・天候連動・予算連動 | FC-070・FR-030・FR-027 | NOT STARTED | ADR §3 |
