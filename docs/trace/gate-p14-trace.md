# Gate P14 FR-054・FR-053 トレーサビリティ表

- 対象: FR-054 Plan-to-Memory、FR-053 旅の達成指標(DOC-02)、SC-42、CA-011/012
- Gate: P14(DB・API・UI・E2Eの縦切り)
- 前提: Gate P13適用後
- 関連ADR: `docs/adr/ADR-journey-review.md`
- migration: `d3f9b1c5e7a4`(revises `c1e7a9b3d5f2`、1テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p14_journey.py`(B)、`frontend/src/...`(F)、`frontend/e2e/journey.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 予定を実績で上書きせず別に保持 | CA-012 | IMPLEMENTED | B `test_record_actuals_without_touching_plan`; E |
| 2 | 行った/行かなかった・到着と出発の記録(If-Match) | CA-012、SC-42 | IMPLEMENTED | B `test_record_actuals_without_touching_plan`; F `JourneyPage.test.tsx`; E |
| 3 | 予定時刻と実績時刻の比較 | CA-012 | IMPLEMENTED | B; F `journeyModel.test.ts`; E |
| 4 | 実績の提案(軌跡・記録の日時)と確定根拠の保持 | DOC-14 §4.4 | IMPLEMENTED | B `test_suggestions_use_only_own_track_and_visible_memories`, `test_pure_functions`; F; E |
| 5 | 写真・メモを同じ予定へ関連付け | CA-012 | IMPLEMENTED | B(記録の件数); F; E |
| 6 | 行かなかった候補を次回旅行へ戻す(Undo可能) | CA-012 | IMPLEMENTED | B `test_carry_over_and_permissions`; F; E |
| 7 | 達成指標(計画達成率・訪問達成率・写真付き訪問率・記録完成率・移動距離・滞在時間) | CA-011 | IMPLEMENTED | B `test_pure_functions`; F `journeyModel.test.ts`; E |
| 8 | 数値を非表示にできる・ランキングを作らない | CA-011 | IMPLEMENTED | F `JourneyPage.test.tsx`; E |
| 9 | 予定経路とGPS軌跡の比較 | CA-012 | NOT STARTED | ADR §3 |
| 10 | 他人の軌跡・非公開の記録を使わない | DOC-11 | IMPLEMENTED | B `test_suggestions_use_only_own_track_and_visible_memories` |
| 11 | 権限(viewerは閲覧のみ・戻し先はeditor) | DOC-04 §9 | IMPLEMENTED | B `test_carry_over_and_permissions`; F |
| 12 | 書き出し | FR-039 | IMPLEMENTED | B `test_carry_over_and_permissions` |
| 13 | API契約(実backend応答のdecoder検証) | DOC-06 | IMPLEMENTED | F `contract.test.ts`(7種), `p14journey.test.ts` |
| 14 | アクセシビリティ(axe) | DOC-04 §7 | IMPLEMENTED | E |
