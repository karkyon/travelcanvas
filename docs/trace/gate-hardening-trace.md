# Gate Hardening-A トレース(製品固めゲート監査 2026-11-17 の是正: 要求の追跡・正本の所在・G-07/G-09/G-10/G-14)

基準: main `a2c419d`。migration なし。B = backend `tests/test_gate_hardening_trace.py`・`tests/test_gate_hardening_ssrf.py`・
`tests/test_ops_tc_transfer.py`、U = vitest(`pages/today/live/mapFilters.test.ts`・`pages/MemoryReplanPage.test.tsx`・
`pages/MemoriesPage.test.tsx`)。再判定とゲートの判定は `docs/audit/2026-11-17_product-hardening-gate_addendum.md`。

| # | 要件(監査の指摘) | 状態 | 証拠 |
|---|---|---|---|
| 1 | G-01 共通正本の所在を辿れる(資料室の v5.1・版・状態・優先の順) | IMPLEMENTED | `docs/spec/canonical-sources.json`・`CANONICAL-SOURCES.md`。B |
| 2 | G-01 全59 FR の要求の出典・受入・承認済みの変更と、画面・API・表・試験の対応 | IMPLEMENTED | `docs/trace/fr-requirements.json`・`FR-TRACE.md`。B(参照の実在・状態との一致) |
| 3 | G-01 FC-001〜180 単位の照合 | NOT STARTED | FR 単位まで。FC 単位は次の Gate |
| 4 | G-03 残件を 未実装/設定待ち/実通信待ち/実機待ち/運用待ち/利用者判断待ち に分類し、実機・実 API・本番を証拠なしに「済」にしない | IMPLEMENTED | FR-TRACE §1。B |
| 5 | G-07 地図の線を直線の目安と明示し、位置の記録の無い時に「足跡」と呼ばない | IMPLEMENTED | `mapFilters.ts`(`trailInUse`・`mapLineLegend`)・`TodayMap.tsx`・`TodayDash.tsx`・`ScreensBook.tsx`・`ScreensMove.tsx`。U。PR #120 |
| 6 | G-09 DOC-11 と実装・試験・本番の証跡の対応 | IMPLEMENTED | `docs/security/SECURITY-TRACE.md`。B(参照の実在・SEC-001〜020 の行) |
| 7 | G-09 SEC-009 の判定を差し替えずに確かめる | IMPLEMENTED | `tests/test_gate_hardening_ssrf.py`(内部・metadata・CGNAT・混ざった DNS・内部への転送) |
| 8 | G-09 SEC-010・SEC-012・SEC-014 の専用の試験 | PARTIAL | 既存の試験は一部だけ(SECURITY-TRACE §5) |
| 9 | G-10 同じ鍵を写す移し方を開発の環境の間だけに限る | IMPLEMENTED | `scripts/ops/tc_transfer.py` の `refuse_strict_environment`。B 4 件。`docs/runbooks/gcp-data-transfer.md` §4 |
| 10 | G-14 規則の提案・下書きの作り方(AI は使わない)を表示 | IMPLEMENTED | `MemoryReplanPage.tsx`・`MemoriesPage.tsx`。U。PR #120 |
| 11 | Phase C 縦断シナリオ 6 本の受入ケースと FR の対応 | IMPLEMENTED | `docs/test/integrated-acceptance-scenarios.md`。B(全59 FR の対応) |
| 12 | 縦断シナリオの実施(stub/mock・実機・実サービス) | NOT STARTED | 利用者・開発メンバーが環境 B・実機で実施 |

FR の状態の遷移なし(DOC-10 r55)。
