# Gate UX6-Icons2 トレース(画面に出る残りの飾りの絵文字を共通のアイコンへ・確定の予定の印)

対象: 監査 2026-10-30k §5・作業指示 §3(Gate B)、`gate-ux6-icons-trace.md` の 6。G11 の段階9・UX6-Icons と同じ
`UiIcon`(lucide の SVG・読み上げから外す・文字の色に従う)を使う。migration なし・API の変更なし・FR の状態の遷移なし(DOC-10 は変えない)。

## 数え方(main `0c4fa84` を機械で数え直した)

対象の文字: OS のカラー絵文字として描かれるもの = `Emoji_Presentation`、絵文字の表示を求める U+FE0F、U+1F000 以上の
`Extended_Pictographic`(`🖼` のように既定が「文字」でも多くの OS で絵文字の字形で描かれる)。`frontend/src` の試験以外の
`.ts`・`.tsx`、注釈の行を除く。✓・✕・⚠・♥・★・←・↑ のような文字の記号は、文字と組で状態を示す印(色だけで伝えない)として対象にしない。

| | 箇所 | ファイル |
|---|---|---|
| main `0c4fa84` | 247 | 36 |
| 置き換えた(画面に出る飾り) | 103 | 22 |
| 残り: 開発者の console の出力(画面に出ない) | 24 | 6(LoginPage・RegisterPage・SearchPage・authStore・config/env・utils/Storage) |
| 残り: どこからも使われていない部品・参照の無い対応表(画面に出ない) | 120 | 8(SpotSearch・ImageSearch・VoiceSearch・layout/Header・Navbar・common/MapView・utils/index の categoryIcons・config/constants の *_ICONS) |

前回の「約 39 ファイル」は文字の記号も含めた概数だった(この Gate で正確な数に置き換えた)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FE = vitest、E2E = `frontend/e2e/gate-ux6-icons.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 旅程の日の集計(件数・時間・費用・移動)・空の状態 | IMPLEMENTED | `components/DayView.tsx`、E2E |
| 2 | 予定のカテゴリの印を UiIcon に。カテゴリの名前を読み上げ用の文字で出す(以前は OS の絵文字の名前が読まれた)。写真のボタンの `🖼` | IMPLEMENTED | `components/planner/ScheduleItem.tsx`、FE `ScheduleItem.marks.test.tsx` |
| 3 | 確定の予定に「確定」の印(鍵のアイコン+文字)を出す。以前は知らせが「確定(🔒)の予定」と書くのに行に印が無かった。知らせは「確定の予定」に | IMPLEMENTED | `ScheduleItem`(`locked`)・`DayView`・`plannerModel`・`ReorderPreview`・`ReorderImpact`、FE、E2E(API で確定にした予定に印) |
| 4 | 360px で時刻と題を折り返す(以前は題が1文字ずつ折れ、印も縦に折れた) | IMPLEMENTED | `ScheduleItem`(`flex-wrap`・印に `whitespace-nowrap`)、360px・暗い見た目で撮って確認 |
| 5 | 知らせ(toast)の印: 旅程の store のオフラインの知らせ(5か所)は絵文字の印を外し、文で伝える(最初に読む JS を増やさないため)。検索の画面の案内の知らせは UiIcon の印 | IMPLEMENTED | `store/planStore.ts`、`components/common/toastIcons.ts`・`pages/SearchPage.tsx`、FE `planStore.offline.test.ts` |
| 6 | エラーの画面・管理の画面(統計・操作)・ランディング・検索・検索の設定・共有・設定・スポット一覧と登録・移動区間・経路の比較・遅延の対応・旅行相談(運転の行・プライバシーの知らせ)・削除した旅行の行き先 | IMPLEMENTED | 各画面。E2E(旅程・移動区間・経路の比較・遅延の対応・共有・設定・検索・検索の設定・スポット一覧・旅行相談の本文にカラー絵文字 0) |
| 7 | `<option>`・入力欄の placeholder は SVG を入れられないため、絵文字を外して文字だけに。値段の段階は 💰 の数 → 「¥」の数 | IMPLEMENTED | `SharePage`・`AdminUsers`・`SearchPage` |
| 8 | 画面の全てのファイルにカラー絵文字を使わないことを試験で守る(除外は理由つきの一覧だけ。console の出力の行は除く) | IMPLEMENTED | FE `UiIcon.test.tsx` |
| 9 | 使われていない部品・参照の無い対応表の絵文字 | NOT STARTED | 画面に出ないため置き換えない。部品を消すかは別に判断する(利用者の判断。消せば対象が無くなる) |
| 10 | 利用者の入力(旅行名・メモ)・外部の題名の中の絵文字 | — | 対象外(利用者・外部の内容。置き換えない) |
| 11 | 管理の画面の見た目の確認 | PARTIAL | 管理者の権限が要るため E2E では本文の検査をしていない(FE の試験の全ファイルの検査で守る)。omega-dev2 で管理者が確認する |

試験の名前の変更: `DeletedPlansSection.test.tsx`(`'📍 京都'` → `'京都'`)、`planStore.offline.test.ts`(toast の印)、
`PlannerG11.test.tsx`(`確定(🔒)の予定` → `確定の予定`)。E2E の名前は部分一致で探しており、そのまま通る。

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-30) |
|---|---|
| 見た目 | 1280px(明)・360px(暗)の旅程、暗い見た目の検索の設定を撮って確かめた |
| bundle | 最初に読む JS 428.64 kB(main)→ 429.50 kB(上限 430 kB)。最初に読むエラーの画面のアイコンの分。余裕が小さいため、次に最初に読む部品へ足す時は分割を先に考える |
| 全検証(`verify.sh` 17 項目) | **失敗 0**(main `5ef2a09` の上で)。backend 1,309 合格・2 飛ばし、vitest 927 合格・標準エラー 0 行。1回目は直に書いた色のクラスが基準より 1 件多く失敗(ランディングに足した `text-blue-600`)→ 決まりの色 `text-accent` にして 1,632 → 1,630、基準も下げた |
| E2E(全件・Redis と DB を空にして) | 1回目(main `0c4fa84` の上): 94 合格・再試行 0。2回目(main `5ef2a09` の上・全検証を並行): **93 合格・flaky 1**(`gate-g11-discover.spec.ts:41`。この Gate で変えていない画面。SNS の投稿の確認の送信が1回目に起きなかった。単独・負荷ありで各 12 回繰り返して再現せず。原因は未確定のため隠さず issue #28 に記録) |
