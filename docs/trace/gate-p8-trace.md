# Gate P8 FR-036 カレンダー取込 トレーサビリティ表

- 対象: FR-036「外部更新の取込は差分確認後に適用する」(DOC-02)、SC-27
- Gate: P8(API・UI・E2Eの縦切り)
- 前提: Gate P7適用後
- 関連ADR: `docs/adr/ADR-calendar-import.md`
- migration: なし

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p8_calendar_import.py`(B)、`frontend/src/...`(F)、`frontend/e2e/calendar-import.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | ICSの解析(UTC・TZID・日付のみ・浮動時刻・折り返し・エスケープ・上限) | RFC 5545 | IMPLEMENTED | B `test_parse_ics_variants` |
| 2 | 差分確認(追加・変更前後・取り込まない理由)、確認では本案を変えない | FR-036、SC-27 | IMPLEMENTED | B `test_preview_candidates_and_no_db_change`; F `CalendarImportPage.test.tsx`, `calendarImportModel.test.ts`; E |
| 3 | 選んだ案だけを適用、1つの変更セットでUndo可能 | FR-036、共通不変条件4 | IMPLEMENTED | B `test_apply_and_undo`; F; E |
| 4 | 書き出したICSを戻すと同じ予定として扱う(変更なしは取り込まない) | FR-036 | IMPLEMENTED | B `test_export_then_import_roundtrip`; E |
| 5 | 確定済み・繰り返し・取消・重複・日程なしは取り込まない | FR-036、FR-020 | IMPLEMENTED | B `test_preview_candidates_and_no_db_change`, `test_apply_validation_and_permissions` |
| 6 | 権限(editor以上)・楽観ロック・監査に内容なし | DOC-06、DOC-11 | IMPLEMENTED | B `test_apply_validation_and_permissions`, `test_preview_candidates_and_no_db_change` |
| 7 | 契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 3種; F `contract.test.ts`, `c2b3.test.ts`, `p8calendarImport.test.ts` |
| 8 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 選択前・確認) |
| 9 | 外部カレンダーとの常時同期・削除の取込 | FR-036 | NOT STARTED | ADR §3 |
