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
| 10 | 旅程: page-head(旅行の名前が h1・期間・「＋ 予定を追加」)・plan-controls(日別/全日程・近くを発見・日の操作を1行)・3列(時間の流れのカード「行き先 · DAY n · LOCAL TIME」・日のタブ・移動手段の凡例・時刻と点と線の予定の行・↑↓は右・「＋ 日程に追加する」/ 地図に日の印と凡例 / 選んだ予定)。表紙・利用枠・ほかの画面への移動は3列の後。1180px 以下は2列、760px 以下は縦(地図が上・300px) | IMPLEMENTED | `PlannerPage.tsx`・`components/DayView.tsx`・`planner/ScheduleItem.tsx`・`planner/SelectedEventCard.tsx`、FE `PlannerG11.test.tsx`、E2E `gate-g9`・`gate-g10-ux`・`ux-baseline`・`gate-ux6-icons` |
| 11 | 選んだ予定の欄(未選択なら最初の予定): 時刻・場所・営業時間の照合(この画面で照合した結果。登録が無ければ「未登録」)・出典・この予定へ着く移動(区間が無ければ「区間なし」)・確定。地図は位置がある時だけ外の地図を開く | IMPLEMENTED | `SelectedEventCard.tsx` |
| 12 | クイック(左の帯・ホームの「旅行をつくる」はモックと同じくページ、「＋ 新しいプラン」は作成の画面): 左に入力(旅行の名前・行き先・出発日・帰着日・最初の予定)、右に旅行カードの予告と①〜④。モックの「誰と行く」「旅のテーマ」は保存先が無いため出さない(入力を捨てる欄を作らない) | IMPLEMENTED | `PlannerPage.tsx`、E2E `quickdraft-flow.spec.ts` |

## 旅行の中の画面(UI/UX モック)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 19 | 今日: page-head(つながりの状態・現地の時刻・最終同期)・live-hero(曜日・行き先・旅行の名前・今日の予定の数。天気など取れない値は出さない)・NOW(大きな時刻・残りと進み・地図)・NEXT(出発まで)・今日の旅程(全ての予定。済・NOW・NEXT・チケットを文字で)・旅の操作 | IMPLEMENTED | `pages/TodayPage.tsx`・`today/TodayParts.tsx`、FE `TodayPage.test.tsx`、E2E `gate-g10-ux`・`today-mode-mobile` |
| 20 | 旅行箱: 予約・チケット / 準備・持ち物 / 予算・費用 / 文書 / 予約の取込 の切り替えと旅行の期間。予約の一覧と「秘密情報の扱い」(番号は伏せて表示・予約を予定につなぐ・チケット) | IMPLEMENTED | `components/shell/TripKitNav.tsx`・`pages/ReservationsPage.tsx`・`PreparationPage.tsx` |
| 21 | 共有: 左に共有リンクの設定、右に相手の画面(ゲスト表示。使用回数を減らさない共有前プレビュー)、下に一緒に計画する人 | IMPLEMENTED | `pages/SharePage.tsx`、FE `SharePage.test.tsx`・`SharePage.f45.test.tsx` |
| 22 | 記録: ふり返りの帯(記録・写真・記録のある予定の数は実際の数)・写真とメモのカード・記録を追加の欄・公開前チェック(下書きの確認へ) | IMPLEMENTED | `pages/MemoriesPage.tsx`、FE `MemoriesPage.test.tsx`、E2E `memories`・`gate-g6` |
| 23 | 発見: 近くを探す・SNS の投稿の2列、候補箱をカード(画像は「画像のイメージ」と明示) | IMPLEMENTED | `pages/CandidatesPage.tsx`、E2E `candidates`・`gate-g11-discover` |
| 24 | 比較: 候補を所要時間・距離・費用の数字で並べ「この案を採用する」。外部の経路検索は未接続(数字は手で入力)と明示 | IMPLEMENTED | `pages/RouteOptionsPage.tsx` |
| 25 | 旅行の中の画面を直に開いても上の帯に旅行の名前(旅行を読み、切り替えへ写す) | IMPLEMENTED | `hooks/useTripContext.ts` |
| 26 | モックの「天気」「利用者の写真の枚数の例」「架空の予約」は出さない(取れない値・作った値) | IMPLEMENTED | 値を作らない |

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
