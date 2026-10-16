# Gate P11 FR-033 トレーサビリティ表

- 対象: FR-033 オフライン編集・同期(DOC-02)、SC-06/07
- Gate: P11(DB・API・UI・E2Eの縦切り)
- 前提: Gate L4適用後
- 関連ADR: `docs/adr/ADR-offline-sync.md`
- migration: `a8c4e2f6d9b3`(revises `f7a3d1c8e2b5`、1テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p11_sync.py`(B)、`frontend/src/...`(F)、`frontend/e2e/offline-sync.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 一時ID(端末で作った予定の仮のID) | FR-033 | IMPLEMENTED | B `test_offline_create_update_delete_with_temp_id_and_replay`; F `syncQueue.test.ts`, `planStore.offline.test.ts` |
| 2 | 操作キュー | FR-033、DOC-03 §11.1 | IMPLEMENTED | F `syncQueue.test.ts`, `planStore.offline.test.ts`; E |
| 3 | 再送・冪等性(operation_id) | FR-033、DOC-06 §30 | IMPLEMENTED | B `test_offline_create_update_delete_with_temp_id_and_replay`; F |
| 4 | 操作ごとの結果(applied/conflicted/rejected/already_applied) | DOC-06 §13・§30 | IMPLEMENTED | B `test_deleted_locked_related_and_rejections`; F `p11sync.test.ts` |
| 5 | 競合の検出(項目単位) | DOC-13 Conflict | IMPLEMENTED | B `test_field_level_conflicts_and_resolution`, `test_clean_fields_and_conflicts` |
| 6 | 競合解決UI | FR-033、DOC-04 §6 | IMPLEMENTED | B `test_field_level_conflicts_and_resolution`; F `SyncConflictsPage.test.tsx`; E |
| 7 | 未同期・競合の状態表示 | SC-06、DOC-04 §8 | IMPLEMENTED | F `SyncConflictsPage.test.tsx`(SyncStatusBar); E |
| 8 | client_atを順序の根拠にしない | DOC-06 §30 | IMPLEMENTED | 実装(送られた順に処理)・ADR §2.2 |
| 9 | 確定・紐付きのある予定はオフラインで変更・削除しない | 共通不変条件4、B-013 | IMPLEMENTED | B `test_deleted_locked_related_and_rejections` |
| 10 | 権限・利用者ごとの分離・監査に内容なし | DOC-06、DOC-11 | IMPLEMENTED | B `test_permissions_and_isolation`, `test_offline_create_update_delete_with_temp_id_and_replay` |
| 11 | 契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 7種; F `contract.test.ts`, `c2b3.test.ts`, `p11sync.test.ts` |
| 12 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 競合の画面) |
| 13 | 機密値の変更にオンライン再認証 | FR-033 | NOT STARTED | ADR §3(機密値はオフライン編集の対象外) |
| 14 | 予定以外のオフライン編集・日程の操作・並べ替え | FR-033 | NOT STARTED | ADR §3 |
