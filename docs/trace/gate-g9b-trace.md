# Gate G9 後半 トレース(UX-2 旅行の表紙・UX-3 見出しと移動・UX-4 文脈型ダッシュボード)

対象: G9 の画面の改修のうち UX-2・UX-3・UX-4(実行指示 2026-10-28、HEAD `99744c3`)。migration なし(Alembic head は
`f4d8a2c6e9b1` のまま)。DOC-10 の FR の状態は変えない(UX の改修で閉じる FR の残件は無い。r20 のまま)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: DB = `backend/tests/test_gate_g9_dashboard.py`、
DM = `frontend/src/pages/dashboard/dashboardModel.test.ts`、DP = `frontend/src/pages/DashboardPage.test.tsx`、
HD = `frontend/src/components/Header.test.tsx`、CV = `frontend/src/styles/cover.test.ts`・`tokens.test.ts`、
E2E = `frontend/e2e/gate-g9.spec.ts`、UXB = `frontend/e2e/ux-baseline.spec.ts`。

## UX-4 文脈型ダッシュボード

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 見られる旅行を旅行中・旅行前・旅行後・日付未定に分け、焦点の旅行を1つ選ぶ(旅行先のタイムゾーンの今日) | IMPLEMENTED | `app/api/v1/dashboard.py`(`phase_of`・`choose_focus`)、DB `test_phase_and_focus_rules`・`test_empty_and_phases_with_focus_details` |
| 2 | 焦点の中身(NOW/NEXT・準備・遅延と休業)は各画面と同じ値。旅行後は出さない | IMPLEMENTED | DB `test_empty_and_phases_with_focus_details`・`test_past_focus_has_no_details_and_undated` |
| 3 | 参加者の役割(閲覧のみは編集できない)・見せない設定の予約は準備の要約にも出ない・他人の旅行と削除した旅行は出ない | IMPLEMENTED | DB `test_member_roles_policy_and_idor`、`test_requires_login` |
| 4 | Hero・NOW/NEXT・Readiness・Alerts・操作(最大4つ・権限の無い操作は出さない)・段階ごとの一覧 | IMPLEMENTED | `DashboardPage.tsx`・`dashboard/DashboardParts.tsx`・`dashboardModel.ts`、DM、DP、E2E |
| 5 | 旅行なし・旅行前・旅行中・旅行後・閲覧のみ・読み込み中・失敗(再試行)・オフライン(つながると読み直す) | IMPLEMENTED | DP、E2E(API の失敗は route で 500、オフラインは `context.setOffline`) |
| 6 | 360・390・768・1024・1440px・暗い見た目で横にはみ出さず axe 違反が無い | IMPLEMENTED | E2E、UXB |
| 7 | GlassyDashboard2 に頼らず、tokens と Surface だけを使う | IMPLEMENTED | `DashboardParts.tsx`(import は `Surface`・`TripCover` だけ) |
| 8 | 応答の形の検査(実 backend の応答)・URL の実在 | IMPLEMENTED | `__fixtures__/g9Responses.json`、`services/api/g9.test.ts`、`backendRoutes.json` |

## UX-2 旅行の表紙

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 9 | 画像が無い旅行に生成のグラデーション(決まった入力に同じ色・季節)。白い文字が 4.5:1 以上 | IMPLEMENTED | `tokens.ts`(`COVER_PALETTES`・`coverFor`)、`tokens.css`(`.tc-cover`)、`components/trip/TripCover.tsx`、CV |
| 10 | ダッシュボードの最上段・旅行のカード・旅行の画面の見出しで同じ表紙 | IMPLEMENTED | `DashboardParts.tsx`、`PlanHeader.tsx`(`trip-header-cover`)、E2E |
| 11 | 表紙の写真の読み込み(EXIF の除去・形式・大きさの確認) | NOT STARTED | ADR-design-tokens §2.1(別の Gate。本 Gate は生成の表紙だけ) |

## UX-3 見出し・旅行の中の移動

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 12 | 全体の見出しは高さが一定(64px)・項目名を1文字ずつ折り返さない・「AI検索」は1か所・点滅する印を外す | IMPLEMENTED | `Header.tsx`、HD、E2E(5つの幅で高さと項目の高さを測る) |
| 13 | 旅行の画面で今開いている旅行を見出しに示す(最初に読む JS を増やさない) | IMPLEMENTED | `store/currentTripStore.ts`、HD、E2E |
| 14 | 通知の未読数を名前で伝える・メニューの開閉を aria-expanded で伝える | IMPLEMENTED | HD |
| 15 | 旅行の画面は表紙の見出し(状態は色だけでなく文字・オフラインの印)を最初に置き、23個の入口を目的ごとの5つのまとまりに分ける | IMPLEMENTED | `PlanHeader.tsx`、`PlannerPage.tsx`(`planner-actions`)、UXB(全ての入口が画面の中) |
| 16 | 暗い見た目を全体に当てる | NOT STARTED | UX-8(ADR-design-tokens §2.2。本 Gate はダッシュボードだけ) |

## 横断

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 17 | 最初に読む JS ≤ 430 kB(目標 425 kB) | IMPLEMENTED | `scripts/ci/check_bundle_budget.py`(423.61 kB・gzip 130.23 kB。前半の終わりは 422.41 kB) |
| 18 | 今の6画面の記録を撮り直し、ダッシュボードの旅行中・タブレット・暗い見た目を足す | IMPLEMENTED | `docs/ux/baseline/*.jpg`、`frontend/ux/capture.spec.ts`、`docs/ux/UX-0_baseline.md` §5 |
| 19 | 設計の判断 | IMPLEMENTED | `docs/adr/ADR-ux-information-design.md`・`ADR-design-tokens.md` §2.1・§2.2 |
