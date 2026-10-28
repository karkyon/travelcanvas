# Gate G10-UX トレース(UX-5 当日の画面・UX-6 共通の部品・UX-8 暗い見た目を全体へ)

対象: 監査書「最新コード完全再監査 HEAD-3c23828(2026-10-28)」§8・§9 の G10-UX(G10-Q の後の別 PR)。migration なし
(Alembic head は `f4d8a2c6e9b1` のまま)。FR の状態の遷移なし(画面の改修。DOC-10 の UX 品質の記載だけを更新)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: DB = `frontend/src/styles/darkBridge.test.ts`、
TR = `frontend/src/components/design/ThemeRoot.test.tsx`、HD = `frontend/src/components/Header.test.tsx`、
TP = `frontend/src/pages/TodayPage.test.tsx`、TM = `frontend/src/pages/today/todayModel.test.ts`、
TK = `frontend/src/styles/tokens.test.ts`、BT = `frontend/src/components/Button.test.tsx`、
E2E = `frontend/e2e/gate-g10-ux.spec.ts`、UXB = `frontend/e2e/ux-baseline.spec.ts`、TD = `frontend/e2e/today-mode-mobile.spec.ts`。

## UX-8 暗い見た目を全ての画面へ

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 見た目の選択(明るい・暗い・端末に合わせる)をアプリの全体で1つにし、`<html data-theme>`・`color-scheme`・`theme-color` に当てる。この端末に覚える | IMPLEMENTED | `hooks/useThemePreference.ts`、`components/design/ThemeRoot.tsx`、`App.tsx`、TR |
| 2 | 選べる場所: 見出しのユーザーのメニュー(表示)・設定の「テーマ」(以前は保存だけで効いていなかった。ラベルと選択肢の結び付けも無かった)・ダッシュボード | IMPLEMENTED | `components/Header.tsx`、`pages/SettingsPage.tsx`、HD、E2E |
| 3 | 今の画面の Tailwind の色を、暗い見た目の中だけ読める値へ置き換える橋渡し(生成の CSS)。src の全ての色のクラスが置き換えか「そのままで良い」に入る(漏れ 0)。置き換えた文字は暗い地・面・淡い地で 4.5:1 以上 | IMPLEMENTED | `styles/darkBridge.ts`・`styles/theme-dark.css`、DB |
| 4 | 主な9画面(ダッシュボード・プランナー・今日・予約・共有・準備・費用・データとプライバシー・設定)を暗い見た目の 1440px・360px で開き、地が暗い・横にはみ出さない・axe 違反 0。読み直しても続く | IMPLEMENTED | E2E |
| 5 | 印刷(しおり)は白い紙のまま(暗い見た目は `@media screen` だけ。しおりの部品は置き換えの対象外) | IMPLEMENTED | `styles/tokens.css`、`styles/darkBridge.ts` |
| 4b | 暗い見た目で地が明るいままの画面があった: `[data-theme=dark]` は `<html>` を塗るが、`index.css` の `body` が明るい地(#f9fafb)を自分で塗って隠していた(E2E の「地が暗くない」で検出)→ 暗い見た目では `body` も塗り直す(印刷は対象外のまま) | IMPLEMENTED | `styles/tokens.css`、E2E |
| 4c | issue #7(CI の `offline-sync.spec.ts` が再試行で合格): 通信できない時の予定の削除・変更で、API の共通処理が「ネットワークエラー」を出し、続けて画面が「端末に保存しました」と出す食い違い。削除ごとに積み重なった通知がクリックした位置の下へ届くと、通知が止まり(hover で一時停止)同期の通知が消えなかった → 端末に溜める5つの書き込み(日程の追加・予定の追加・変更・削除・並べ替え)は応答の無い失敗だけ共通の表示を出さない(`offlineQueueable`。サーバーが答えた失敗は従来どおり・溜められない時は画面が失敗を伝える) | IMPLEMENTED | `services/api/core.ts`・`endpoints/plans.ts`、`services/api/core.silent.test.ts`、`e2e/offline-sync.spec.ts`(10 回連続合格) |
| 5b | 最初に読む JS を上限(430 kB)の内に保つ: 根の ThemeRoot が `theme-color` のために色の一覧(tokens.ts、4.5 kB)全体を最初の読み込みへ入れていた → 地の2色だけを `styles/themeColor.ts` に分け、tokens.ts もその値を使う(正本は1か所)。431.07 → 426.08 kB | IMPLEMENTED | `styles/themeColor.ts`、`scripts/ci/check_bundle_budget.py`、TR・TK |

## UX-6 共通の部品をデザインの決まりへ

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 6 | Button(強調色の1色・`on-accent`・`danger-solid`・`focus`)・Card・Input・Modal・Toast・LoadingSpinner・Layout・見出しのメニューを tokens へ | IMPLEMENTED | `components/common/*`、`components/Layout.tsx`、BT、TK(`on-accent`・`danger-solid` の AA) |
| 7 | 見つけた不具合: Modal の覆いが真っ黒(Tailwind v4 で `bg-opacity-50` が無い)→ `bg-black/50`。読み込み中の通知の青が白い文字と 3.7:1 → #1d4ed8(6.7:1) | IMPLEMENTED | `components/common/Modal.tsx`、`App.tsx` |
| 8 | 全ての画面の文字の灰色・白い面を決まりの名前へ(1,589 か所)。画面に直に書いた色のクラス 3,338 → 1,632 件、基準より増やさない | IMPLEMENTED | DB `[UX-6] 画面に直に書いた色のクラスは増やさない` |
| 9 | 残りの直書きの色(状態の色・淡い地など 1,632 件)の置き換え | PARTIAL | 暗い見た目では橋渡しで読める。画面ごとに基準を下げる |

## UX-5 当日の画面

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 10 | 今(NOW): 残りの分と進み(`progressbar`)・地図・チケット。次(NEXT): 出発まで・遅延・地図・チケット。見出しつきの区切り | IMPLEMENTED | `pages/TodayPage.tsx`・`pages/today/TodayParts.tsx`、TP、E2E、TD |
| 11 | この後の予定(NOW・NEXT を重ねない)・済んだ数。簡易表示は今と次だけ(端末に覚える) | IMPLEMENTED | `todayModel.ts` `computeTodayFlow`、TM、TP、E2E |
| 12 | つながりの状態(最新・保存済み)を文字とアイコンで。オフラインの表示・最終取得の時刻(L1b のまま) | IMPLEMENTED | TP、TD |
| 13 | スマホでは当日の操作を画面の下(親指の届く所)に固定、押せる高さ 44px 以上。明るい・暗いで axe 違反 0 | IMPLEMENTED | E2E |
| 14 | 地図を背景にした当日の表示・外部の運行情報 | NOT STARTED | 地図・運行の提供元の判断待ち |
