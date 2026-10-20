# Gate P6 FR-039 トレーサビリティ表

- 対象: FR-039 データポータビリティ・削除(DOC-02)のうちエクスポートと保持期間の説明、FC-098
- Gate: P6(API・UI・E2Eの縦切り、DB変更なし)
- 前提: Gate P5適用後
- 関連ADR: `docs/adr/ADR-data-export.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p6_data_export.py`(B)、`frontend/src/...`(F)、`frontend/e2e/data-export.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 旅行単位のエクスポート(構造化JSON) | FR-039、FC-098 | IMPLEMENTED | B `test_plan_export_contents_and_privacy`, `test_plan_export_owner_only`; F; E |
| 2 | アカウント単位のエクスポート | FR-039 | IMPLEMENTED | B `test_account_export`; F `DataPrivacyPage.test.tsx`; E |
| 3 | 原本文書manifest | FC-098 | IMPLEMENTED | B `test_document_manifest` |
| 4 | 暗号化配布 | FC-098 | NOT STARTED | ADR §3(機密値は出さない方式で代替) |
| 5 | 機密値・他人の本人限定情報を含めない、除外列の明示 | DOC-11 | IMPLEMENTED | B `test_plan_export_contents_and_privacy`, `test_account_export`; E |
| 6 | 内容のハッシュ(確認用) | — | IMPLEMENTED | B(全エクスポート試験); F `p6dataExport.test.ts`; E |
| 7 | バックアップ・監査の残存期間の説明 | FR-039、DOC-02 §5 | IMPLEMENTED | B `test_retention_info`; F; E |
| 8 | 旅行の削除 | FR-039 | IMPLEMENTED(B-012) | 既存 |
| 9 | アカウント単位の削除・同意撤回・訂正 | FR-039 | NOT STARTED | ADR §3 ※ **SUPERSEDED BY Gate P9(アカウント削除・同意の撤回は実装。訂正は残り)** |
| 10 | URL実在・契約 | Gate C2b方式 | IMPLEMENTED | F `c2b3.test.ts`, `contract.test.ts`(retention_info) |
| 11 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe) |
