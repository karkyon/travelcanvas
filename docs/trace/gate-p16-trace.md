# Gate P16 FR-046 トレーサビリティ表

- 対象: FR-046 画像/PDF出力(DOC-02)のうち画像出力、CA-004、SC-36
- Gate: P16(UI・E2E。backend・DBの変更なし。PDFは P4)
- 前提: Gate P15適用後
- 関連ADR: `docs/adr/ADR-image-export.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `frontend/src/...`(F)、`frontend/e2e/booklet-image.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 1日単位・旅行全体の画像化 | CA-004 | IMPLEMENTED | F `imageCards.test.ts`, `ImageExportPanel.test.tsx`; E |
| 2 | スマートフォン縦長・LINE向け画像 | CA-004 | IMPLEMENTED | F `cardImage.test.ts`; E(1080×1920・1080×1080) |
| 3 | A4/PDF | CA-004 | IMPLEMENTED | P4(しおりの版の印刷・PDF) |
| 4 | 出力前の含有項目の確認・機密の初期除外 | CA-004、CA-003 | IMPLEMENTED | F; E(しおりで予約番号を含めても画像の投影は含めない) |
| 5 | 生成日時・最新状態・共有範囲の表示 | CA-004 | IMPLEMENTED | F `cardImage.test.ts`(各ページのフッター), `imageCards.test.ts` |
| 6 | STALE への警告 | CA-004 | IMPLEMENTED | F `imageCards.test.ts`, `ImageExportPanel.test.tsx` |
| 7 | 入りきらない時のページ分け | — | IMPLEMENTED | F `cardImage.test.ts` |
| 8 | NOW/NEXT カードの画像化 | CA-004 | NOT STARTED | ADR §3 |
| 9 | 画像作成の監査 | CA-003 | NOT STARTED | ADR §3 |
| 10 | アクセシビリティ(axe・代替テキスト) | DOC-04 §7 | IMPLEMENTED | F; E |
