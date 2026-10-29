# Gate G11-Preview トレース(G11 の段階7: 並べ替えを保存する前の案)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §3.2、UIX-M03(統合ハンドオフの「計算中・差分・適用/取消・Undo」の「先に見せる」方式)。
段階6 の「保存してから影響・元に戻す」に、保存の前の案を足した。migration なし・FR の状態の遷移なし。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = `frontend/src/components/planner/PlannerG11.test.tsx`、
E2E = `frontend/e2e/gate-g11-planner.spec.ts`・`frontend/e2e/gate-g7.spec.ts`(実際のマウスのドラッグ)。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 触る(上へ・下へ)・矢印キー・ドラッグは保存せずに案を作り、案の並びで一覧・区間の行を見せる | IMPLEMENTED | `components/DayView.tsx`(`pending`・`view`)、FE、E2E |
| 2 | 案の影響: 順の変化・前後が合わなくなる区間(行き先)・営業時間(時刻は変えないので判定は変わらない)・確定の予定は動かさない | IMPLEMENTED | `components/planner/ReorderPreview.tsx`(`reorderImpact` を案の並びで使う)、FE、E2E(区間 2件) |
| 3 | 「この並びにする」で1回に保存(位置の変わらない予定は送らない)→ 実際の影響と「元に戻す」(段階6) | IMPLEMENTED | `applyPending` → `reorderSchedule`、FE、E2E(サーバーの順・元に戻す) |
| 4 | 「やめる」で何も変えない(サーバーの順も変わらない) | IMPLEMENTED | FE、E2E(`serverOrder` が元のまま) |
| 5 | 予定が変わった(他の人の変更・削除)時は案を取り消して知らせる | IMPLEMENTED | FE |
| 6 | 確定(🔒)の予定の位置が変わる案を作らない(ボタン・矢印キー・ドラッグ) | IMPLEMENTED | `moveBlockedReason`・`handleItemDrop`、FE |
| 7 | 実機のタッチの確認 | NOT STARTED | omega-dev2 で別に記録する(FR-005 の gaps) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| 全検証 | vitest 907 合格・標準エラー 0 行(1回目は案の一覧の確かめ方・非同期の act の警告で 2件失敗 → 試験を直して合格)・tsc・lint・build・bundle・backend 合格 |
| E2E(全件) | **90 合格・失敗 0・再試行 0**(`gate-g11-planner.spec.ts` は案 → やめる → 案 → この並びにする → 元に戻す、`gate-g7.spec.ts` は実際のマウスのドラッグ → 案 → この並びにする) |
