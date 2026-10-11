# Gate P9 FR-039 アカウント削除・同意撤回 トレーサビリティ表

- 対象: FR-039 データポータビリティ・削除(DOC-02)のうちアカウント単位の削除と同意の撤回、DOC-11 §15、SC-29
- Gate: P9(API・UI・E2Eの縦切り)
- 前提: Gate P8適用後
- 関連ADR: `docs/adr/ADR-account-deletion.md`
- migration: なし

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p9_account_deletion.py`(B)、`frontend/src/...`(F)、`frontend/e2e/account-deletion.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 削除前に影響(所有旅行・参加者数・消えるもの/残るもの・保持期間)を説明 | DOC-11 §15、SC-29 | IMPLEMENTED | B `test_preview_does_not_change_anything`; F `privacyModel.test.ts`, `PrivacyCards.test.tsx`; E |
| 2 | 本人確認(確認の文字・パスワード、試行回数制限、管理者の除外) | DOC-11 §15 | IMPLEMENTED | B `test_reauth_and_confirmation`; F; E |
| 3 | 所有旅行の削除と共有の即時失効、猶予後の完全削除 | DOC-11 §15、FC-099 | IMPLEMENTED | B `test_delete_account` |
| 4 | 参加旅行からの離脱と本人だけの情報の削除、同行者の記録は仮名で保持 | DOC-11 §15、EX-018 | IMPLEMENTED | B `test_delete_account` |
| 5 | セッション失効・トークン拒否(ゲスト含む)・同じメールで再登録可能 | DOC-11 §15 | IMPLEMENTED | B `test_real_tokens_rejected_after_delete`; E |
| 6 | 端末のオフラインパックとログイン状態の消去 | DOC-11 §8 | IMPLEMENTED | F `AccountDeletedPage.test.tsx`, `authStore.test.ts`; E |
| 7 | 目的別の同意と撤回(既定は同意しない、更新日時) | DOC-11 §15・§23 | IMPLEMENTED | B `test_consents`; F `PrivacyCards.test.tsx`; E |
| 8 | 監査に内容(題名・メール)を残さない | DOC-11 §11 | IMPLEMENTED | B `test_delete_account`, `test_consents` |
| 9 | 契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 4種; F `contract.test.ts`, `c2b3.test.ts`, `p9privacy.test.ts` |
| 10 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 設定画面・削除確認・完了画面) |
| 11 | 同意を確認する処理(AI・位置・分析・メール) | DOC-11 §9・§14 | NOT STARTED | 該当機能が未実装(ADR §3) |
| 12 | 猶予つき削除・所有者移譲・出典付き訂正 | FR-039、SC-18 | NOT STARTED | ADR §4 |
