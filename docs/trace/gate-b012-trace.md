# Gate B-012 トレーサビリティ表(プラン削除)

- 対象: B-012「関連データを持つプランを削除できない」、FR-004のプラン削除、DOC-02 §5のデータ保持
- 前提HEAD: `d8a217ce5781a5dccadb8762e6f56a103505923d`
- 関連ADR: `docs/adr/ADR-plan-deletion.md`
- migration: `e5b9c2d8f341`(revises `c3e8a1f47d20`。travel_plansへ列追加、外部キー35件の削除方針を明示)

試験名は `backend/tests/test_gate_b012_plan_deletion.py`(B)、`frontend/src/...`(F)、`frontend/e2e/plan-deletion.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 子データの種類によらずプランを削除できる(500にならない) | B-012 | IMPLEMENTED | B `test_plan_with_any_child_data_can_be_deleted_and_purged`(7種)、`test_plan_promoted_from_quickdraft_can_be_purged`; E |
| 2 | 登録旅行は猶予後に削除(論理削除→30日→完全削除) | DOC-02 §5 | IMPLEMENTED | B `test_purge_expired_skips_plans_within_grace_period`; `scripts/run_plan_purge.py` |
| 3 | 削除時に共有を即時失効 | DOC-02 §5 | IMPLEMENTED | B `test_soft_deleted_plan_is_hidden_everywhere` |
| 4 | 削除済みプランへ更新を適用しない | EX-015 | IMPLEMENTED | B `test_soft_deleted_plan_is_hidden_everywhere`(所有者・共同編集者・招待者・公開共有) |
| 5 | 猶予期間内の復元(所有者のみ、期限切れは410) | DOC-05 §23 restore | IMPLEMENTED | B `test_deleted_list_and_restore_keep_data_and_share_links_stay_revoked`、`test_restore_after_grace_period_is_gone`; F `DeletedPlansSection.test.tsx`; E |
| 6 | 完全削除で正本・Objectを追跡削除 | FC-099 | IMPLEMENTED | B `test_purge_removes_every_owned_row_and_file_but_keeps_outside_records`(24表0件・実ファイル削除) |
| 7 | ファイル削除に失敗したら完全削除を保留 | FC-099 | IMPLEMENTED | B `test_purge_is_postponed_when_document_file_cannot_be_deleted` |
| 8 | 監査は内容最小化し独立保持 | DOC-02 §5 | IMPLEMENTED | B `test_purge_removes_every_owned_row_and_file_but_keeps_outside_records`(題名を記録しない) |
| 9 | FKの削除方針を明示・漏れ検査 | DOC-05 v5.1物理スキーマ | IMPLEMENTED | B `test_every_foreign_key_into_plan_owned_tables_has_a_deletion_policy` |
| 10 | 通常操作の参照整合性は従来どおり即時検査 | — | IMPLEMENTED | B `test_cross_references_are_still_checked_immediately_in_normal_operations` |
| 11 | 管理統計から削除済みを除外 | — | IMPLEMENTED | B `test_admin_statistics_exclude_soft_deleted_plans` |
| 12 | 削除は所有者のみ | Gate #30 | IMPLEMENTED | B `test_only_owner_can_delete` |
| 13 | 画面: 削除・復元・完全削除、削除失敗を成功と表示しない | FR-004 | IMPLEMENTED | F `DeletedPlansSection.test.tsx`、`planStore.test.ts`; E |
| 14 | 実backend応答との契約 | Gate C2b方式 | IMPLEMENTED | fixture `plan_soft_deleted`・`deleted_plan_list(_empty)`・`plan_restored`・`plan_purged`; F `contract.test.ts`、`b012planTrash.test.ts`、`c2b3.test.ts` |
| 15 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 最近削除したプランを開いた一覧) |
| 16 | 暗号鍵破棄を含む削除 | DOC-02 §5 | NOT STARTED | KMS未導入(行は物理削除される) |
| 17 | 個別削除の同種500(予定・日程・共同編集者) | B-013 | NOT STARTED | 別Gate(ADR §4) |
