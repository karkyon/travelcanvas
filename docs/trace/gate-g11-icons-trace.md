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
| 5 | 移動手段以外の画面の飾りの絵文字(移動区間の入口の見出しなど) | NOT STARTED | 範囲外(UX-6 の共通の部品の置き換えで扱う) ※ **SUPERSEDED BY Gate UX6-Icons**(旅程の中の移動・基本情報。ほかの画面は `gate-ux6-icons-trace.md` の 6) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| 全検証 | vitest 914 合格・標準エラー 0 行・tsc・lint・build・bundle 428.02 kB・backend 合格 |
| E2E(全件・1回目) | **88 合格・2 失敗**・1 条件付きの飛ばし。① `candidates.spec.ts:22` ゲストの開始が 429(1時間 100 回の発行の上限)。サンドボックスの Redis に前の実行の回数が残っていた(CI は毎回新しい Redis)。② `gate-g8.spec.ts:182` 二端末の競合の表示が「ほかの人が変えた項目はこの画面の項目にはありません」になり「開始時刻: ほかの人の値「09:30」」が出なかった。この実行の backend の log は次の起動で上書きされ、原因(競合の後の読み直しの失敗か)は確かめられていない |
| 2 件だけの再実行 | 3 回とも合格(5 件ずつ) |
| E2E(全件・2回目) | サンドボックスの起動の手順で DB を作り直す時に Redis も空にして実行 → **90 合格・失敗 0**・1 条件付きの飛ばし(`gate-g10-ux` の 0 時の前後)。閾値・試験の再試行は変えていない |

② は再現した時に、競合の後に最新を読み直せなかった場合の表示(今は「この画面の項目にはありません」と出る)を見直す。 ※ **SUPERSEDED BY Gate G11-Layout**(読み直せなかった時は言い切らず、読み直してから違いを示す。`gate-g11-layout-trace.md`)
