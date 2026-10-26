# Gate P17 FR-057 トレーサビリティ表

- 対象: FR-057 Memory Replan(DOC-02)、CA-015
- Gate: P17(API・UI・E2E。migrationなし)
- 前提: Gate P16適用後
- 関連ADR: `docs/adr/ADR-memory-replan.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p17_memory_replan.py`(B)、`frontend/src/...`(F)、`frontend/e2e/memory-replan.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 過去の予定と実績から次回計画への提案を生成 | CA-015 | IMPLEMENTED | B `test_insights_and_apply_with_undo`; F; E |
| 2 | 説明可能(根拠の件数・旅行・例) | CA-015 | IMPLEMENTED | B `test_pure_functions`; F `memoryReplanModel.test.ts`; E |
| 3 | 採用するまで旅程を変えない | CA-015 | IMPLEMENTED | B; E |
| 4 | 可逆(1つの変更セット・元に戻す) | CA-015、FC-013 | IMPLEMENTED | B `test_insights_and_apply_with_undo`; E |
| 5 | 確定・予約付きの予定を動かさない | FR-018の方針 | IMPLEMENTED | B `test_pure_functions`, `test_locked_and_permissions` |
| 6 | 入力が変わったら適用しない(409) | — | IMPLEMENTED | B `test_insights_and_apply_with_undo` |
| 7 | 権限・材料の範囲(参加している旅行だけ) | DOC-11 | IMPLEMENTED | B `test_locked_and_permissions` |
| 8 | 機微情報をAIへ送らない | CA-015 | IMPLEMENTED | AIを使わない(集計の規則だけ) |
| 9 | 同行者属性・移動手段の傾向 | CA-015 | NOT STARTED | ADR §3 ※ **SUPERSEDED BY Gate G7(gate-g7-trace.md #23・#24)** |
| 10 | API契約 | DOC-06 | IMPLEMENTED | F `contract.test.ts`(4種), `p17memoryReplan.test.ts` |
