# Gate G11-Icons トレース(G11 の段階9: 移動手段のアイコン)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §4、統合ハンドオフ「アイコンは OS/絵文字依存を避け、既存のアイコン系を調査し整合させる」。
migration なし・FR の状態の遷移なし。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = `frontend/src/components/common/TransportIcon.test.tsx`・
`frontend/src/components/planner/PlannerG11.test.tsx`、E2E = `frontend/e2e/gate-g11-planner.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 既存のアイコンの系統を調べて合わせる → lucide(移動区間の画面 `SegmentsPage.tsx` が既に使う)。ヘリは lucide に無いため同じ線の太さで描く | IMPLEMENTED | `components/common/TransportIcon.tsx` |
| 2 | 移動の区間の行・予定のカードの移動・全日程のチャート・旅程の下書きの区間で、絵文字ではなく SVG のアイコン + 名前 | IMPLEMENTED | `DayView.tsx`・`ScheduleItem.tsx`・`AllDaysChart.tsx`・`TripDraftPage.tsx`、FE、E2E(区間の行に絵文字が無い・`data-mode`) |
| 3 | アイコンは読み上げから外し、名前を必ず文字で出す。値が無い・知らない値はアイコンを出さない | IMPLEMENTED | FE |
| 4 | 文字の表示(`transportText`)に絵文字を使わない | IMPLEMENTED | `utils/transportModes.ts`、FE |
| 5 | 移動手段以外の画面の飾りの絵文字(移動区間の入口の見出しなど) | NOT STARTED | 範囲外(UX-6 の共通の部品の置き換えで扱う) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

検証の結果は PR に記録する。
