# Gate B-013 トレーサビリティ表(個別削除: 紐付け解除して削除)

- 対象: B-013「個別削除でも同種の500」、B-014「移動区間・経路候補画面のIf-Matchが項目のrevision」
- 前提HEAD: `5b8cd6bf2bc9ecfe8f857e147a1baed15fcfe84e`
- 関連ADR: `docs/adr/ADR-plan-item-deletion.md`
- migration: なし

試験名は `backend/tests/test_gate_b013_item_deletion.py`(B)、`frontend/src/...`(F)、`frontend/e2e/item-deletion.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 予約・区間・経路候補の付いた予定を削除できる(500にならない) | B-013、FR-005 | IMPLEMENTED | B `test_event_with_related_data_can_be_deleted_and_undone`(5種); E |
| 2 | それらの予定を含む日程を削除できる | B-013、FR-005 | IMPLEMENTED | B `test_day_with_related_data_can_be_deleted_and_undone`(5種) |
| 3 | 採用済みの経路候補を削除でき、採用した区間は残る | B-013、FR-015 | IMPLEMENTED | B `test_adopted_route_option_can_be_deleted_keeping_segment_and_undone`; F `RouteOptionsPage.test.tsx`; E |
| 4 | チケット担当者・参加者の共同編集者を削除(アクセス取消し)でき、割当だけ外れる | B-013、EX-018、FR-021 | IMPLEMENTED | B `test_collaborator_removal_always_succeeds_and_only_detaches`(4種); F `SharePage.test.tsx` |
| 5 | 予約・文書・チケット・参加者の本体は残る | FC-042 | IMPLEMENTED | B 1〜4の各試験、`test_document_link_and_event_note_are_detached_and_restored` |
| 6 | 削除と関連解除を1回のUndoで原子的に戻す(予定は元のID) | FR-018方式、FR-005 | IMPLEMENTED | B 1〜3、`test_day_undo_keeps_event_ids_times_and_place`、`test_event_with_adopted_route_is_deleted_and_undone_in_fk_safe_order`; E |
| 7 | 旧形式(予定IDを持たない)日程削除記録もUndoできる | 後方互換 | IMPLEMENTED | B `test_legacy_day_change_without_event_ids_is_still_undoable` |
| 8 | 確定ロックされた紐付けがあれば何も変えずに構造化409 | DOC-13 ロック | IMPLEMENTED | B `test_locked_reservation_link_blocks_deletion_without_any_change`(予定・日程); F `planStore.test.ts`; E |
| 9 | Undo時の競合は上書きせず409(再紐付け・論理削除・同日付) | FR-020、EX-010 | IMPLEMENTED | B `test_undo_refuses_when_reservation_was_relinked` / `_deleted_afterwards` / `test_undo_refuses_when_document_was_deleted_afterwards` / `test_undo_refuses_when_same_date_day_was_recreated` |
| 10 | Undo途中の予期しない失敗は全体を巻き戻す | 原子性 | IMPLEMENTED | B `test_unexpected_failure_during_undo_rolls_back_everything` |
| 11 | 権限: viewerは削除不可、editorは共同編集者を削除不可 | Gate #30 | IMPLEMENTED | B `test_viewer_cannot_delete_and_editor_cannot_remove_collaborators` |
| 12 | 他プランへ干渉しない | 他tenant非干渉 | IMPLEMENTED | B `test_other_plans_are_not_affected` |
| 13 | 外部キーの扱いが漏れなく定義されている | 再発防止 | IMPLEMENTED | B `test_every_foreign_key_into_individually_deletable_tables_has_a_policy`(4表) |
| 14 | 監査は件数のみ(個人情報なし) | DOC-11 | IMPLEMENTED | B 4(メールアドレス非含有を検査) |
| 15 | 画面: 外した紐付け・削除した従属データと「元に戻す」を案内、失敗を成功と表示しない | FR-005 | IMPLEMENTED | F `itemDeletionMessages.test.ts`、`planStore.test.ts`; E |
| 16 | 実backend応答との契約 | Gate C2b方式 | IMPLEMENTED | fixture `event_deleted_detached`・`day_deleted`・`route_option_deleted_adopted`・`collaborator_removed`・`event_delete_locked_409`・`undo_conflict_409`; F `contract.test.ts`、`b013itemDeletion.test.ts` |
| 17 | 移動区間・経路候補の画面操作がプランの版番号で送られる | B-014 | IMPLEMENTED | F `RouteOptionsPage.test.tsx`、`SegmentsPage.test.tsx`(修正前は失敗を確認); E |
| 18 | a11y(WCAG 2.1 AA): 予定のあるプランナー・経路候補・移動区間画面 | DOC-04 §7 | IMPLEMENTED | E(axe×3)。予定一覧のlist役割、補足文字・NEXTバッジのコントラストを修正 |
| 19 | 削除された参加者の個人データ返却・削除 | EX-018 | NOT STARTED | ADR §6 |
