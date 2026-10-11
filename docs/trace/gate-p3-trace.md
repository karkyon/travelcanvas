# Gate P3 FR-022・FR-024 トレーサビリティ表

- 対象: FR-022 合意形成、FR-024 コメント(DOC-02)、FC-065〜067、EX-011
- Gate: P3(DB・API・UI・E2Eの縦切り)
- 前提: Gate P2適用後
- 関連ADR: `docs/adr/ADR-discussion.md`
- migration: `c9f4a2b7d1e3`(revises `b8e3f1a6c2d9`、4テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p3_discussion.py`(B)、`frontend/src/...`(F)、`frontend/e2e/discussion.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 候補の投票(Love/OK/懸念/不可/棄権)と未回答者 | FR-022 | IMPLEMENTED | B `test_poll_lifecycle_consensus_and_notifications`; F `DiscussionPage.test.tsx`; E |
| 2 | 懸念・不可の理由必須、代替案 | FR-022、FC-065 | IMPLEMENTED | B `test_veto_policies`, `test_poll_validation_and_permissions`; F `discussionModel.test.ts`; E |
| 3 | 懸念の解決記録(本人・編集者) | FC-066 | IMPLEMENTED | B `test_resolution_permissions_and_reset_on_change`; E |
| 4 | 合意状態の判定・最有力・決定 | FR-022 | IMPLEMENTED | B `test_option_state_rules`, `test_poll_lifecycle_consensus_and_notifications`; F; E |
| 5 | 締切後は回答不可 | FR-022 | IMPLEMENTED | B `test_deadline_closes_voting` |
| 6 | 匿名(秘匿回答・少人数で件数を伏せる) | FC-067 | IMPLEMENTED | B `test_anonymous_poll_hides_individuals_until_threshold`; F `p3discussion.test.ts` |
| 7 | コメントのスレッド・返信・解決済み | FR-024 | IMPLEMENTED | B `test_comment_thread_mentions_and_warning`, `test_comment_targets_and_resolution`; F; E |
| 8 | メンション通知(本文を含めない) | FR-024 | IMPLEMENTED | B `test_comment_thread_mentions_and_warning` |
| 9 | 機密らしき文字列の注意 | EX-011 | IMPLEMENTED | B 同上; F `discussionModel.test.ts`, `DiscussionPage.test.tsx`; E |
| 10 | 予定・予約・費用へのコメント | FR-024 | PARTIAL | APIは対象を受け付ける(B `test_comment_targets_and_resolution`)。画面はプラン全体のみ |
| 11 | 権限・部外者・プラン削除時の消去 | DOC-06 | IMPLEMENTED | B `test_poll_validation_and_permissions`, `test_outsider_and_purge` |
| 12 | 楽観ロック・論理削除・監査に本文なし | DOC-06 §23 | IMPLEMENTED | B `test_poll_lifecycle_consensus_and_notifications`, `test_comment_thread_mentions_and_warning` |
| 13 | 実backend応答との契約・URL実在 | Gate C2b方式 | IMPLEMENTED | fixture 14種; F `contract.test.ts`, `c2b3.test.ts`, `p3discussion.test.ts` |
| 14 | a11y(WCAG 2.1 AA) | DOC-04 §7 | IMPLEMENTED | E(axe: 投票空・投票あり・コメント) |
| 15 | 決定した候補の予定への反映 | FR-022 | NOT STARTED | ADR §3 |
| 16 | 締切リマインド・リアルタイム更新 | FR-024 | NOT STARTED | ADR §3 |
