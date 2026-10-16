# Gate P12 FR-037 トレーサビリティ表

- 対象: FR-037 写真・メモ・旅行記(DOC-02)、SC-28。あわせて FR-039 データの書き出しの漏れ修正
- Gate: P12(DB・API・UI・E2Eの縦切り)
- 前提: Gate P11適用後
- 関連ADR: `docs/adr/ADR-memories.md`
- migration: `b9d5f3a7c1e4`(revises `a8c4e2f6d9b3`、1テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p12_memories.py`(B)、`frontend/src/...`(F)、`frontend/e2e/memories.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 予定・日・日時・場所へ文章のメモを紐付ける | FR-037 | IMPLEMENTED | B `test_create_list_and_link`; F `MemoriesPage.test.tsx`; E |
| 2 | 写真を紐付ける(検証・暗号化保存・表示) | FR-037 | IMPLEMENTED | B `test_upload_media_encrypted_and_streamed`, `test_validate_media_and_url`; F; E |
| 3 | 音声メモを紐付ける | FR-037 | IMPLEMENTED | B `test_upload_media_encrypted_and_streamed`; F `p12memories.test.ts` |
| 4 | 動画の参照(URL)を紐付ける | FR-037 | IMPLEMENTED | B `test_create_list_and_link`, `test_validate_media_and_url`; F |
| 5 | 公開範囲(既定は本人だけ)、他人の非公開記録の存在を知らせない | DOC-11 §23、DOC-04 §9 | IMPLEMENTED | B `test_visibility_and_permissions`; E |
| 6 | 変更は本人だけ(If-Match)、削除は本人と所有者 | DOC-04 §9 | IMPLEMENTED | B `test_update_requires_if_match`, `test_visibility_and_permissions`; F |
| 7 | 計画と実績から旅行記の下書きを生成 | FR-037、CA-012 | IMPLEMENTED | B `test_journal_draft_pure`, `test_journal_draft_api`; F; E |
| 8 | 公開前の検査(同行者名・予約番号・電話番号・位置・写真) | SC-28 | PARTIAL | B `test_journal_draft_pure`; E。顔の自動判定・EXIF検査は未(確認を促す表示のみ) |
| 9 | 公開範囲の確認・項目別の選択 | FR-037、SC-28 | PARTIAL | 下書きの選択肢(位置・写真等・他の人の記録)。旅行記の公開(URL)は未 |
| 10 | 旅行の完全削除・アカウント削除で記録とファイルを消す | FR-039、B-012 | IMPLEMENTED | B `test_purge_export_and_account_deletion` |
| 11 | データの書き出しに含める(他人の非公開分は除く) | FR-039 | IMPLEMENTED | B `test_purge_export_and_account_deletion` |
| 12 | 書き出しの漏れ(P7/P10/P11の表)の修正と再発防止 | FR-039 | IMPLEMENTED | B `test_export_covers_every_plan_table` |
| 13 | 監査に本文・場所を残さない | DOC-11 | IMPLEMENTED | B `test_create_list_and_link` |
| 14 | API契約(実backend応答のdecoder検証) | DOC-06 | IMPLEMENTED | F `contract.test.ts`(memory_* 9種・journal_draft 3種), `p12memories.test.ts` |
| 15 | アクセシビリティ(axe) | DOC-04 §7 | IMPLEMENTED | E(一覧・下書き) |
| 16 | MEMORY MAP(地図表示)・軌跡との自動紐付け | DOC-14 §4.5 | NOT STARTED | ADR §4 |
| 17 | 記録の変更・削除のUndo | FC-013 | NOT STARTED | ADR §4 |
