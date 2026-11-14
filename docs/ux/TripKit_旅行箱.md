# 旅行箱(TripKit)UI/UX 改修 実装メモ(2026-11-15)

「Claude向け｜TravelCanvas「旅行箱」UI/UX完全実装指示 2026-11-15」と旅行箱のモックアップ(TK-01〜TK-09)にもとづいて、
旅行箱の中の画面を作り直した記録です。DB・API は変えていません(既存の API だけを使う。移行なし)。

## 共通の殻(全画面)

- 見出しの上に「旅程名 › 旅行箱 › 画面名」と、旅行の期間・行き先(読めた時だけ)
- 旅行箱の中のナビ(`nav[aria-label="旅行箱の中の画面"]`): 概要 / 予約・チケット / 準備・持ち物 / 予算・費用 / 文書 / 予約の取込、右に「旅行箱を検索」
- 760px 以下は短い名前(概要・予約・準備・費用・文書・取込)。リンクの名前(aria-label)は長い名前のまま
- 448px 以下は主要 4 つ + 「その他」(文書・取込・検索)。今いる画面が「その他」の中なら、ボタンの名前をその画面にする。Esc・外を押すと閉じる
- 左のレールの「旅行箱」は概要(`/planner/:id/kit`)へ

## 画面と URL

| 画面 | URL | URL に残す条件 | 使う API |
|---|---|---|---|
| TK-01 概要 | `/planner/:id/kit` | なし | 予約・準備状況(readiness)・費用の集計・文書・取込 |
| TK-02 旅行箱を検索 | `/planner/:id/kit/search` | `q` 検索語 / `f` 絞り込み(today・reservation・ticket・hotel・emergency) / `cat` 結果の分類 | `GET /plans/{id}/search`(権限・予約番号は末尾一致) |
| 予約・チケット | `/planner/:id/reservations` | `q` / `type` / `sort` / `st`(状態)/ `open`(詳細を開く)/ `new=1` | 予約・チケット(表示は既存の reveal API の後だけ) |
| 予約の取込 | `/planner/:id/imports` | `st`(review・working・failed・done・rejected) | 取込ジョブ。確定したら `reservations?open=<予約>` へ |
| 文書 | `/planner/:id/documents` | `q` / `cls`(分類)/ `type` / `sort`(new・old・name) | 文書・関連先(`/documents/{id}/links`、開いた時だけ読む) |
| 準備・持ち物 | `/planner/:id/preparation` | `tab` / `pk`(todo・mine・required・buy・personal・unassigned) | 持ち物・やること |
| 予算・費用 | `/planner/:id/expenses` | `tab` | 予算・支出・精算 |

条件は履歴を増やさず置き換える(`useQueryState`)。既定値と同じ時は URL から消す。

## 予約・チケット

- 検索は施設・交通・メモと、予約番号の末尾 3 文字以上だけ(番号の全体は画面に持たない)
- 「要確認」の理由: 未確定 / 変更あり / 取消期限が 72 時間以内 / 未払い・支払状況が未入力(backend の readiness と同じ考え)
- 利用日ごとに区切る(旅行先の時刻帯)
- チケットのコードは既存の表示 API の後だけ。「全画面で見せる」で明るい全画面(期限切れ・使用済み・取消は警告)。Esc で閉じ、元のボタンへ戻る

## 最初に読む JS の上限(430 kB)

画面を足すと router の塊の一覧が増えて上限を超えたため、
`router/index.tsx` の `<ProtectedRoute><X /></ProtectedRoute>` の繰り返しを `guard(<X />)` にまとめ(出来る要素は同じ)、
概要と検索を 1 つの塊(`TripKitRoute`)にした。結果 429.76 kB(当日の改修 #112 と合わせても 429.71 kB)。

## 確認したこと

- tsc・lint・vitest(1387 件)・build・bundle の上限・秘密の文字列の検査
- 画面の試験: 1440 / 448 / 360px × 明るい・暗い で、7 画面の h1・横のはみ出し 0・axe 違反 0(模擬 API)

## まだ出来ていないこと(API が無いため、作り物で埋めていない)

- TK-09 旅程へ追加の「影響の下見」と取り消し(Undo)
- 取込レビューの項目ごとの根拠表示・重複の見比べ
- 費用と領収書(文書)の相互リンク、文書の「どこにもつながっていない」絞り込み
- 検索の担当者などの絞り込み(API の filter にあるものだけ)
- 実機(iOS Safari・Android Chrome)での確認
