# Gate AppShell トレース(UI/UX モックの殻・ホーム・旅程の3列・クイックの作成・検索の言葉を実際に合わせる・ゲストの設定)

対象: 監査 2026-10-30(UI/UX 再監査)Gate App UX・Gate Honesty、UI/UX モック `TravelCanvas_UIUX_Mock_2026-10-28.html`。
migration なし・API の変更なし・FR の状態の遷移なし(DOC-10 は変えない)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = vitest、E2E = Playwright。

## 殻(モックの topbar・rail)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 上の帯 72px(スマホ 60px): 印・今の旅行の切り替え(旅行名+日付。旅行の外では「旅行を選ぶ」→一覧)・検索・通知・利用者 | IMPLEMENTED | `components/Header.tsx`・`styles/shell.css`、FE `Header.test.tsx`、E2E `gate-g9.spec.ts`(高さ) |
| 2 | 左の帯 82px: ホーム・旅程・発見・今日・旅行箱・共有・記録・旅行相談・クイック・比較+設定(モックと同じ順)。今の画面に `aria-current` | IMPLEMENTED | `components/shell/AppRail.tsx`・`railItems.ts`、FE `AppRail.test.tsx` |
| 3 | 旅行の中の項目は今の旅行(最後に開いた旅行)へ。旅行を開いていない時は一覧へ移り、「旅行を選ぶと開きます」と読み上げる(押しても何も起きない項目を作らない) | IMPLEMENTED | FE `AppRail.test.tsx` |
| 4 | スマホ(760px 以下): 下の帯に最初の5項目、全ての項目は上の帯の「メニュー」から | IMPLEMENTED | `shell.css`、FE `Header.test.tsx` |
| 5 | 利用者のメニュー・スマホのメニューは開いた時に読む(最初に読む JS 429.50 → 428.12 kB、上限 430) | IMPLEMENTED | `components/shell/HeaderMenus.tsx`、bundle budget |
| 6 | ゲストの案内の帯は上の帯の上(流れる)。殻はログイン・登録・公開の共有と旅行記・ランディングには出さない | IMPLEMENTED | `components/Layout.tsx` |
| 7 | 見た目の系統(Atlas など)・明るい/暗いは決まり(`--tc-*`)に従う。既定の系統は「標準」のまま(既定を Atlas に変えるかは利用者の判断) | PARTIAL | 設定 → 表示 で Atlas を選ぶとモックと同じ配色 |

## ホーム・旅程・クイック

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 8 | ホーム: page-head「YOUR JOURNEY / 次の旅を、楽しみに変える」・旅の表紙(写真が無ければモックの山並み)・4つの数(実際の値だけ: 日数・人数・確認が要る準備・遅延と休業)・旅のつづき・次に決めること・この旅行でできること | IMPLEMENTED | `pages/DashboardPage.tsx`・`dashboard/DashboardParts.tsx`、FE `DashboardPage.test.tsx`、E2E `gate-g9.spec.ts` |
| 9 | 旅程の一覧: page-head。空の時は始め方を2つ(行き先が決まっている → クイック / まだ → 旅行相談) | IMPLEMENTED | `pages/PlannerPage.tsx`(`planner-empty`) |
| 10 | 旅程: 「PLAN · 旅程を組み立てる」・操作の行(日別/全日程/近くを発見)・3列(予定の流れ・地図・選んだ予定)。地図と選んだ予定は読み進めても見えたまま。1180px 以下は2列、760px 以下は縦 | IMPLEMENTED | `PlannerPage.tsx`・`components/planner/SelectedEventCard.tsx` |
| 11 | 選んだ予定の欄は実際の値(時刻・場所・メモ・確定)だけ。営業時間・移動の時間のような確かめていない値は出さない | IMPLEMENTED | `SelectedEventCard.tsx` |
| 12 | クイックの作成: 左に入力(旅行の名前・行き先・出発日・帰着日・最初の予定)、右に旅行カードの予告と①〜④。モックの「誰と行く」「旅のテーマ」は保存先が無いため出さない(入力を捨てる欄を作らない) | IMPLEMENTED | `PlannerPage.tsx`、E2E `quickdraft-flow.spec.ts` |

## 正直さ(Gate Honesty)・ゲスト

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 13 | スポット検索: 「AI がインターネットを解析」「AI 画像解析」「AI 音声認識」「AI 検索エンジンが待機中」「AI 信頼度」を外し、実際(Wikipedia・OpenStreetMap をキーワードで引く・AI と有料の提供元は未接続)を書く | IMPLEMENTED | `pages/SearchPage.tsx`、FE `SearchPage.test.tsx` |
| 14 | 写真から探す・声で探す は「準備中」。写真・録音を受け付けない(解析しないのに送らせない)。言葉で探す方へ戻れる | IMPLEMENTED | FE `SearchPage.test.tsx` |
| 15 | 全ての結果に付けていた値段の段階(既定の ¥¥)を外し、出典を出す。0件・失敗は文で伝える | IMPLEMENTED | FE `SearchPage.test.tsx` |
| 16 | 検索の設定: 題を「検索の設定」に。検索に使う項目(候補数・座標)と使わない項目(趣味・予算など=準備中)を示す | IMPLEMENTED | `pages/SearchSettingsPage.tsx` |
| 17 | ゲストの設定: 以前は保存を押した後に「ログインが必要」と知らせた → 先に保存できないことを示し、保存のボタンの代わりにアカウントを作る・ログインの入口。入力は消さない | IMPLEMENTED | `pages/SettingsPage.tsx`、FE `SettingsPage.test.tsx` |
| 18 | 使われていない部品(VoiceSearch・ImageSearch・SpotSearch)の AI の言葉 | NOT STARTED | 画面から到達しない。部品を消すかは別に判断する |

## 地図

サンドボックスは地図の画像(タイル)の配信元へつながらないため、撮った画面では地図の中が空になる(CI・omega-dev2 では表示される)。
