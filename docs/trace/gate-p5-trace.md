# Gate P5 FR-036 トレーサビリティ表

- 対象: FR-036 カレンダー・地図入出力(DOC-02)のうち書き出し、FC-091、FC-092
- Gate: P5(API・UI・E2Eの縦切り、DB変更なし)
- 前提: Gate P4適用後
- 関連ADR: `docs/adr/ADR-itinerary-export.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p5_itinerary_export.py`(B)、`frontend/src/...`(F)、`frontend/e2e/exports.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | ICS出力(timezone、UID、更新sequence、取消) | FR-036、FC-091 | IMPLEMENTED | B `test_ics_calendar`, `test_ics_sequence_advances`, `test_ics_escape_and_fold`; E |
| 2 | KML/GPX出力、非公開場所・実位置の選択除外、精度表示 | FR-036、FC-092 | IMPLEMENTED | B `test_gpx_and_kml`, `test_waypoints_precision_and_lodging`; F `ExportsPage.test.tsx`; E |
| 3 | CSV出力 | FR-036 | IMPLEMENTED | B `test_csv`, `test_csv_safe`; E |
| 4 | 予約番号・チケット・メモを含めない、住所は選択時のみ | DOC-11 | IMPLEMENTED | B `test_ics_calendar`, `test_csv`; E |
| 5 | 書き出さなかった件数の明示 | FR-036 | IMPLEMENTED | B `test_ics_calendar`, `test_gpx_and_kml`; F `ExportsPage.test.tsx`; E |
| 6 | 権限(viewer以上)・部外者403・監査に内容なし | DOC-06 | IMPLEMENTED | B `test_permissions`, `test_ics_calendar`, `test_gpx_and_kml` |
| 7 | URL実在・クライアント | Gate C2b方式 | IMPLEMENTED | F `c2b3.test.ts`, `p5itineraryExport.test.ts` |
| 8 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe) |
| 9 | ICS/GPX/KML/CSVの取込(差分確認後に適用) | FR-036 | NOT STARTED | ADR §3 |
| 10 | Google/Apple Calendarとの直接連携 | FR-036 | NOT STARTED | ADR §3 |
