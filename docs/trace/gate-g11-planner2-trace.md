# Gate G11-Planner2 トレース(G11 の段階6: 旅程の画面の残り)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §1.0・§3.2・§4、UIX-M03・M04・M11(ハンドオフ 2026-10-29g §3 の残り 1・2)。
migration `c4e8a1f3b7d2`(down `b8d4f6a0c3e5`。区間・経路候補の区間の mode の CHECK に express_bus を足す)。FR の状態の遷移なし
(FR-005・FR-014・FR-017 の gates は G11 のまま。FR-005 の実機のタッチ・FR-014 の外部の時刻表・運賃は残る)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_g11_planner2.py`、
FE = `frontend/src/components/planner/PlannerG11.test.tsx`・`frontend/src/store/planStore.test.ts`、E2E = `frontend/e2e/gate-g11-planner.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 路線バス(bus)と高速バス(express_bus)を区別して保存・表示する。自家用車(driving)の名前。凡例に路線バス・高速バス・自転車 | IMPLEMENTED | migration `c4e8a1f3b7d2`、`segments.py`・`branch_resources.py` の MODES、`route_estimator.py`、`utils/transportModes.ts`、`SegmentsPage.tsx`・`branches/resourcesModel.ts`、decoder、BE `test_segments_accept_express_bus`・`test_express_bus_vocabulary_and_estimate`、FE、E2E |
| 2 | 避けたい移動手段の語を複数の mode に当てる(「高速バス」→ express_bus と区別する前の bus、「バス」→ 両方、「新幹線」→ shinkansen と train、「ヘリ」→ helicopter)。表示の名前(実行可能性・思い出・予定表の書き出し) | IMPLEMENTED | `services/feasibility.py` `TRANSPORT_KEYWORDS`、BE `test_avoid_transport_maps_bus_kinds`・`test_labels_for_new_modes`、既存 `test_gate_l3_validation` |
| 3 | 移動の区間をタイムラインの独立した行(着く予定の前)に出す。手段・所要時間・推定・確定・出発の予定の名前・時差。直前の予定と出発の予定が違えば「前の予定と合っていません(自動では直しません)」 | IMPLEMENTED | `plannerModel.ts` `segmentRow`、`DayView.tsx`、FE、E2E |
| 4 | 並べ替えの影響: 順の変化・営業時間の判定の変化(確認中・比べられない・変化なし を区別)・合わなくなった区間の数と行き先・時刻と確定の予定を変えていないこと。「元に戻す」(最初の並びへ)・「このままにする」 | IMPLEMENTED | `plannerModel.ts` `reorderImpact`、`components/planner/ReorderImpact.tsx`、`DayView.tsx`、FE、E2E(サーバーの順が戻る) |
| 5 | 確定(🔒)の予定は動かさない: 確定の予定・それと入れ替わる移動のボタンは押せず、矢印キーでは理由を読み上げる | IMPLEMENTED | `plannerModel.ts` `moveBlockedReason`、`DayView.tsx`、FE |
| 6 | 見つけて直したこと: 確定の予定がある日の並べ替えは、位置の変わらない確定の予定にも移動の API を送り 409 で全て失敗していた。位置の変わらない予定は送らない | IMPLEMENTED | `store/planStore.ts` `reorderScheduleItems`・`mapEvent`(sort_order)、FE `planStore.test.ts` |
| 7 | 先に影響を見せてから適用する方式(プレビュー) | NOT STARTED | 今は保存してから影響を出し、元に戻せる方式(仕様 §3.2 に記録)。1回の変更として記録する並べ替えの API は無い(元に戻すは並べ直し) |
| 8 | 移動手段のアイコンを OS の絵文字に頼らない(統合ハンドオフの記述) | NOT STARTED | 名前と組にしているので色・絵文字だけには頼っていない。共通のアイコンへの置き換えは別の段階 |
| 9 | CI の E2E の 429 連鎖(ハンドオフ §3 の 5)の調査: 何の応答が接続元の点数になったかを CI の要約・注記に残す | PARTIAL | `scripts/ci/e2e_guard_report.py`、`.github/workflows/ci.yml` の「E2E の接続元の点数の報告」、BE `test_gate_g11_guard_report.py`。原因は未特定(下の記録) |

## CI の 429 連鎖の記録

- PR #15 の1回目: push の run は e2e 合格、pull_request の run(job 123214120657)は `gate-g4.spec.ts` の COL-05 から 50 件が 429
  (「短時間に不審な操作が続いた」)で失敗した。PR #13 と同じ形(この時は member-policy から)。再試行(retries 1)も遮断の中で落ちた
- サンドボックスで全件を Redis の MONITOR で数えた(挙動は変えない): 点数の加算は 41 回・合計 117、うち 60 は最後の
  `zz-security-challenge.spec.ts`(最初に点数を消してから、わざと点数を上げる試験)。それ以外の合計は 57、900 秒の窓の最大は 95。
  多いのは `member-policy` 9・`auth-flows` 8・`account-deletion` 5。応答の内訳は 登録の 428 が 29 件・`/auth/me` の 401 が 22 件・登録の 429 が 9 件
- CI では gate-g4(全 89 件の 36 番目ごろ)までに 150 に届いており、サンドボックスの同じ所(約 27)の5倍以上。CI だけの点数の出どころが
  あるはずだが、job の log は手元から読めない。次の CI の run で、上の報告が点数の内訳(応答の種類・経路・時刻)を出す
- 遮断の閾値・点数の付け方・E2E の再試行は変えていない(連鎖を隠さない)

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| backend pytest | 1,277 合格・2 飛ばし(新規 4 件)。flake8 0、mypy 0(基準 0)。Alembic の往復(`c4e8a1f3b7d2` ⇄ `b8d4f6a0c3e5`)で構造が一致 |
| frontend | vitest 900 合格(175 ファイル)・標準エラー 0 行、tsc 0、lint 0、最初に読む JS 427.83 kB(上限 430 kB) |
| E2E(全件) | **89 合格・失敗 0・再試行 0**(1回目。`gate-g11-planner.spec.ts` に並べ替えの影響・元に戻す・区間の行・高速バスを足した。`gate-g8.spec.ts` は名前の変更(車 → 自家用車・バス → 路線バス)に合わせた) |
| 文書 | DOC-10 r26・trace の目次・エラーの一覧の生成の一致 |
