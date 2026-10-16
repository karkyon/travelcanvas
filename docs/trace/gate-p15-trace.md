# Gate P15 FR-052 トレーサビリティ表

- 対象: FR-052 Personal Travel Atlas(DOC-02)、SC-41、CA-010
- Gate: P15(API・UI・E2Eの縦切り。migrationなし)
- 前提: Gate P14適用後
- 関連ADR: `docs/adr/ADR-atlas.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p15_atlas.py`(B)、`frontend/src/...`(F)、`frontend/e2e/atlas.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 複数旅行を横断した訪問地域の可視化 | CA-010 | IMPLEMENTED | B `test_atlas_across_trips_with_privacy`; F `AtlasPage.test.tsx`; E |
| 2 | 予定・通過・訪問・滞在の区別 | CA-007 | IMPLEMENTED | B `test_cells_and_aggregate`; F `atlasModel.test.ts`; E |
| 3 | 地図代替一覧・色以外の状態表現 | DOC-04 SC-41・§7 | IMPLEMENTED | F; E(axe) |
| 4 | 年で絞り込み・区画の大きさ | SC-41 | IMPLEMENTED | B; F; E |
| 5 | 旅行単位の公開範囲(Atlasから除く) | CA-010 | IMPLEMENTED | B; F; E |
| 6 | 他の人の記録・軌跡を使わない・他の人のAtlasは見えない | DOC-11 | IMPLEMENTED | B `test_atlas_across_trips_with_privacy` |
| 7 | 再訪率 | CA-011 | IMPLEMENTED | B `test_cells_and_aggregate`; E |
| 8 | 過去のMemory・未訪問候補・次回のPLANへ遷移 | CA-010 | PARTIAL | 一覧から旅行(プラン画面)へ移動。未訪問候補は P14 の「次の旅行に戻す」 |
| 9 | 国・都道府県・市区町村・テーマ別 | CA-010 | NOT STARTED | ADR §3(逆ジオコーディング未接続) |
| 10 | 地点単位の公開範囲・共有 | CA-010 | NOT STARTED | ADR §3 |
| 11 | API契約 | DOC-06 | IMPLEMENTED | F `contract.test.ts`(4種), `p15atlas.test.ts` |
