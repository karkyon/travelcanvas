# Gate G11-Planner トレース(G11 の段階2: 旅程の画面)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §1.0・§2.3・§3.2・§4、UIX-M02〜M07・M11。migration `b8d4f6a0c3e5`
(down `a7c3e5f9b2d4`。区間・経路候補の区間の mode の CHECK に shinkansen・helicopter を足す)。FR の状態の遷移なし
(FR-005・FR-008・FR-014・FR-017 の gates に G11 を足しただけ。FR-005 の実機のタッチ・FR-014 の外部の時刻表・運賃は残る)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_g11_planner.py`、
FE = `frontend/src/components/planner/PlannerG11.test.tsx`、E2E = `frontend/e2e/gate-g11-planner.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 予定ごとの営業時間の照合: 時間内・閉店/最終入場まで30分未満・最終入場の後・ラストオーダーの後(飲食だけ)・滞在の途中で閉まる(既定の滞在の見積もりを含む)・休業(曜日・例外の日)・開く前・閉まった後・場所/時刻/登録が無い。深夜営業を使う。出典が90日より古い時は「時間内」を出さない | IMPLEMENTED | `backend/app/services/hours_check.py`・`api/v1/hours_check.py`、BE |
| 2 | API: 見える人だけ、他の旅行の日は 404、予定を変えない、日の現地の日付と zone | IMPLEMENTED | BE `test_api_permissions_and_payload` |
| 3 | 予定のカードの営業時間の帯(記号と文字・出典と確認日。色だけにしない)。順・時刻・場所が変わったら読み直し、それまでは「確認中」 | IMPLEMENTED | `components/planner/ScheduleItem.tsx`・`plannerModel.ts` `hoursBadge`、`components/DayView.tsx`、FE、E2E |
| 4 | 予定へ着く移動の名前(アイコン+名前+所要時間・推定・確定)。鉄道を新幹線と言わない、ヘリは要手配で所要時間を推定しない、不明は「移動手段未設定」(既定の電車のアイコンを出さない)、所要時間が無い時は「未計算」(0分と区別) | IMPLEMENTED | `utils/transportModes.ts`、`plannerModel.ts` `arrivalLeg`、`route_estimator.py`、FE、BE、E2E |
| 5 | 区間に新幹線・ヘリを保存できる(DB の CHECK・API・画面の選択肢・decoder) | IMPLEMENTED | migration `b8d4f6a0c3e5`、`segments.py`・`branch_resources.py` の MODES、`SegmentsPage.tsx`・`branches/resourcesModel.ts`、BE `test_segments_accept_new_modes` |
| 6 | 日の見出しに現地の時刻帯(IANA)を常に出す。時差をまたぐ区間は同じ瞬間から出発地・到着地の現地の日時・UTC との差・日付の変わりを出す。夏時間・日付変更線・無効な時刻帯 | IMPLEMENTED | `utils/zonedTime.ts`、`DayView.tsx`、FE、E2E |
| 7 | 並べ替え: ドラッグ・上下矢印キーに加え、触って使う「上へ」「下へ」(44px、端は押せない)。動かした後に読み上げで知らせ、再確認が終わると「確かめました」 | IMPLEMENTED | `hooks/useDragDrop.tsx` `moveItemBy`、`DayView.tsx`、FE、E2E。実機のタッチの確認は omega-dev2 で別に記録する(FR-005 の gaps) |
| 8 | 日別 / 全日程の切り替え。全日程は日ごとの列・同じ時刻の物差し・要約(予定の数・最初と最後・移動・空き・固定)、重なりを二重に数えない、4日を超えると横に流せる、押すと日別へ戻る。既存の「概要を表示」は残す | IMPLEMENTED | `components/planner/AllDaysChart.tsx`・`plannerModel.ts` `buildChart`、`pages/PlannerPage.tsx`、FE、E2E |
| 9 | 見つけて直したこと: 旅程の store が予定の場所・固定・日の時刻帯を写していなかった(移動の行が API のデータでは出なかった) | IMPLEMENTED | `store/planStore.ts` `mapEvent`・`mapDay` |
| 10 | 360px・暗い見た目で横にはみ出さない・axe 違反 0 | IMPLEMENTED | E2E |
| 11 | 外部の時刻表・運賃・実際の経路の provider | NOT STARTED | 仕様に無い(FR-014 の gaps のまま) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-28) |
|---|---|
| backend pytest | 1,251 合格・1 飛ばし(新規 6 件)。flake8 0、mypy 0(基準 0)。Alembic の往復(`b8d4f6a0c3e5` ⇄ `a7c3e5f9b2d4`)で構造が一致 |
| frontend | vitest 872 合格(171 ファイル)・標準エラー 0 行、tsc 0、lint 0、最初に読む JS 426.31 kB(上限 430 kB) |
| E2E(全件) | 1回目: 83 合格・1 失敗(`gate-g7.spec.ts` のドラッグの並べ替えで「並び替えました」が出なかった)。同じ試験を単独で2回・CPU に負荷をかけて6回、計8回は全て合格し、原因は特定できなかった。2回目の全件: **84 合格・失敗 0・再試行 0**(新規 `gate-g11-planner.spec.ts` を含む)。VERIFIED の E2E の証拠 40 件が合格 |
| 文書 | DOC-10 r24・trace の目次・エラーの一覧の生成の一致 |

1回目の失敗は再試行・sleep で隠していない。CI で再び出た時は `e2e_flaky_report.py` の issue で追う(HTML のドラッグの試験が負荷の高い時に落ちる可能性)。
