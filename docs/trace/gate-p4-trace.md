# Gate P4 FR-034・FR-035・FR-046 トレーサビリティ表

- 対象: FR-034 しおり生成、FR-035 安全な印刷・公開、FR-046 画像/PDF出力(DOC-02)、FC-087〜089、EX-019
- Gate: P4(DB・API・UI・E2Eの縦切り)
- 前提: Gate P3適用後
- 関連ADR: `docs/adr/ADR-booklet.md`
- migration: `d2a7c5e9f4b1`(revises `c9f4a2b7d1e3`、1テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p4_booklet.py`(B)、`frontend/src/...`(F)、`frontend/e2e/booklet.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | テーマ7種(かわいい・簡潔・家族・学校・出張・アクセシブル・白黒) | FR-034 | IMPLEMENTED | B `test_options_validation`; F `BookletPage.test.tsx`; E |
| 2 | 同じ構造化データからWeb・印刷・PDF | FR-034、FR-046 | IMPLEMENTED(PDFはブラウザ) | F `BookletPage.test.tsx`; E(`page.pdf()`でPDF生成) |
| 3 | 章の選択(表紙・目次・日程・地図・持ち物・連絡先・費用・注意事項・予約) | FR-034 | IMPLEMENTED(地図は場所の一覧) | B `test_preview_default_is_whitelisted_and_masked`; F; E |
| 4 | 予約番号・QR・住所・電話・参加者を版ごとに選択 | FR-035 | IMPLEMENTED(QRは常に除外) | B `test_preview_default_is_whitelisted_and_masked`, `test_sensitive_includes_owner_only`; F; E |
| 5 | 機密を含む版へ警告・透かし・有効日 | FR-035、FC-088 | IMPLEMENTED | B `test_sensitive_export_guard_watermark_and_creator_only`; F; E |
| 6 | 版・生成時刻・情報基準時刻の印字、更新後の差の警告 | SC-26、EX-019 | IMPLEMENTED | B `test_export_versions_snapshot_and_stale`; F; E |
| 7 | 失効・有効期限 | FC-087 | IMPLEMENTED | B `test_revoke_and_expiry`; F; E |
| 8 | 白黒でも区別できる | FC-089 | IMPLEMENTED | F `bookletModel.test.ts`(種類を文字で表示); E(白黒テーマ) |
| 9 | 公開ページの検索除外 | FR-035 | IMPLEMENTED | B `test_public_share_is_noindex` |
| 10 | 権限(Owner全操作・Editor許可時・Viewer不可) | DOC-04 §9 | IMPLEMENTED | B `test_sensitive_includes_owner_only`, `test_outsider_cannot_access`; F |
| 11 | 監査に内容を残さない | DOC-11 | IMPLEMENTED | B `test_sensitive_includes_owner_only`, `test_export_versions_snapshot_and_stale` |
| 12 | 実backend応答との契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 9種; F `contract.test.ts`, `c2b3.test.ts`, `p4booklet.test.ts` |
| 13 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 設定・プレビュー、印刷画面) |
| 14 | サーバー側PDF・画像出力・ダウンロードURL | FR-046、DOC-06 | NOT STARTED | ADR §3 |
| 15 | 冊子面付(A4両面・中綴じ) | FC-090 | NOT STARTED | ADR §3 |
