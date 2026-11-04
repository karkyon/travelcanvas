# Gate MockFit — ホームをモックアップ v2 の通りに・しおりの Web 公開・写真/声/SNS から探す

正本: 利用者の UAT(2026-11-04 20:49)。「モックアップの通りに実装してない」「しおりの作成機能(印刷用と Web でページ生成)」
「スポット検索で写真で探す・音声で探すを正確に、SNS から探すを追加」「旅行の作成時のスポットの検索でも同じ機能を共有」。

## 対応

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | ホームの表紙をモックアップ v2 の通りに: 写真(無ければ絵)の上に状態・行き先・人数、旅行名、日付・予定の数・移動手段の決定数、出発までの日数(旅行中は何日目)、旅程を開く+この旅行の操作(予約・準備・しおり・招待)、右上に旅の準備の段階 | IMPLEMENTED | `PlanningHero` | `DashboardPage.test.tsx`・E2E `gate-g9` |
| 2 | 右の列は「次にやること」だけ(「この旅行でできること」の箱をやめ、表紙の操作にまとめる) | IMPLEMENTED | `DashboardPage` | 同上 |
| 3 | 左の帯・スマホの下の帯をモックアップ v2 に: ホーム / 旅行 / 旅の記録と思い出 / 行きたい場所 / 発見 / 旅行相談。旅行を開いている時だけ「この旅行」(旅程・今日・旅行箱・共有・比較)を区切りの下に | IMPLEMENTED | `railItems`・`AppRail` | `AppRail.test.tsx`・`Header.test.tsx` |
| 4 | 旅の記録と思い出の画面(/memories): 最近の旅の写真・旅の足あと・行った旅(写真・メモの数、振り返り・しおりへ) | IMPLEMENTED | `MemoriesHomePage` | `router.test.tsx` |
| 5 | しおりの Web のページ: 版を「Web のページとして公開」すると URL を作る(鍵の値は SHA-256 だけを保存・作り直すと前の URL は使えない)。機密項目を含む版は公開できない。止める・失効で見られない。閲覧はログイン不要・noindex・no-store・回数制限。印刷は従来の印刷用の画面と、公開ページの「印刷・PDF」 | IMPLEMENTED | migration `b7d2f4a6c8e1`(列の追加)、`POST/DELETE /plans/{id}/booklet-exports/{eid}/publish`、`GET /public/booklets/{token}`、`PublicBookletPage`(/b/:token) | `test_web_publish_public_view_and_stop`・`BookletPage.test.tsx`(BookletWeb) |
| 6 | 写真から探す: 写真(JPEG)の撮影場所(Exif の GPS)を端末の中で読み、その周り 2km の場所を探す。写真は送らない。位置の無い写真は理由を示す | IMPLEMENTED | `findModel.readExifGps`・`FindByOther` | `findModel.test.ts`・`SearchPage.test.tsx` |
| 7 | 声で探す: 端末の音声認識で文字にして、その言葉で探す(録音は保存しない) | IMPLEMENTED | `FindByOther`(`VoiceInput` を共有) | 実機の UAT(音声) |
| 8 | SNS から探す: 投稿の文からハッシュタグ・「」・位置の印・「〜へ行った」の語を拾い、押すとその言葉で探す。URL の中身は取りに行かない(URL だけの時は文を貼るよう案内) | IMPLEMENTED | `findModel.snsKeywords`・`FindByOther` | 同上 |
| 9 | 旅行をつくる時の場所の検索でも同じ部品: 旅行相談の方面の詳細(候補を探す)・旅程の「近くを発見」 | IMPLEMENTED | `PlaceSearchPanel`・`NearbyDiscover` | 既存の試験 |

**限界(正直に)**: 写真から探すは撮影場所の位置情報が入った JPEG のときだけ(写っている建物を画像で見分ける AI は使っていない)。
SNS は投稿を自動で集めない(各社の規約と個人の投稿を集めないため)。声は端末・ブラウザの音声認識が使える時だけ(HTTPS が必要)。
