# Gate P2 FR-027・FR-028 トレーサビリティ表

- 対象: FR-027 予算・費用、FR-028 立替・精算(DOC-02)、FC-055・FC-071〜074、EX-013
- Gate: P2(DB・API・UI・E2Eの縦切り)
- 前提: Gate P1適用後
- 関連ADR: `docs/adr/ADR-finance.md`
- migration: `b8e3f1a6c2d9`(revises `a4d7e2c9b1f6`、5テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p2_finance.py`(B)、`frontend/src/...`(F)、`frontend/e2e/expenses.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 計画額(予算)・実費・税・手数料・返金 | FR-027 | IMPLEMENTED | B `test_summary_budget_vs_actual`, `test_refund_reduces_balances_and_is_bounded`; E |
| 2 | 予約額 | FR-027 | PARTIAL | 基準通貨の予約のみ合計、他通貨は件数。B `test_summary_budget_vs_actual` |
| 3 | 複数通貨・換算レート(出典・基準日) | FR-027、FC-072 | IMPLEMENTED(手入力) | B `test_foreign_currency_conversion_and_unconverted`; E |
| 4 | レート不明時は現地額を正本に、集計から除外と明示 | EX-013 | IMPLEMENTED | B 同上; F `financeModel.test.ts`, `ExpensesPage.test.tsx`; E |
| 5 | 人別・カテゴリ別・日別の予算と差異 | FR-027 | IMPLEMENTED | B `test_summary_budget_vs_actual`, `test_budgets_and_private_member_budget`; E |
| 6 | 個人の予算上限は本人のみ・暗号化 | FC-055、DOC-05 §19 | IMPLEMENTED | B `test_budgets_and_private_member_budget`; F `p2finance.test.ts` |
| 7 | 支払者・負担者、均等・比率・金額・対象外 | FR-028、FC-073 | IMPLEMENTED | B `test_expense_default_equal_split_among_members`, `test_expense_ratio_amount_none_and_payer`; F |
| 8 | 丸め差を明示的な調整で処理、合計一致 | DOC-05 §8.6・§17 | IMPLEMENTED | B `test_split_equal_puts_remainder_on_first_participants`, `test_split_ratio_amount_none_and_errors` |
| 9 | 債務簡約・精算済み | FR-028 | IMPLEMENTED | B `test_suggest_transfers_minimises_and_balances`, `test_balances_transfers_and_settlement`; F; E(1人旅の完了) |
| 10 | 返金・取消料を別明細で | FC-074 | IMPLEMENTED | B `test_refund_reduces_balances_and_is_bounded`; E |
| 11 | 領収書原本との紐付け | FR-028 | PARTIAL | receipt_document_id(存在検証あり)。画面からの紐付けUIは未 |
| 12 | 外れたメンバーの差額を消さない | EX-018 | IMPLEMENTED | B `test_removed_member_keeps_balance` |
| 13 | 楽観ロック・論理削除・監査に金額なし | DOC-06 §23 | IMPLEMENTED | B `test_update_recomputes_shares_with_if_match`, `test_expense_default_equal_split_among_members` |
| 14 | 実backend応答との契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 21種; F `contract.test.ts`, `c2b3.test.ts`, `p2finance.test.ts` |
| 15 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 概要・支出・精算) |
| 16 | 予算の版(当初・更新・確定・実績) | FC-071 | NOT STARTED | ADR §3 |
| 17 | 為替レートの自動取得 | FC-072 | NOT STARTED | ADR §3 |
