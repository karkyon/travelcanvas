# ADR: 外部の画像・SNS の provider(Gate G11-Discover)

- 状態: 採用(2026-10-28。利用者が G11 の全範囲を入れる決定をした。仕様 `docs/ux/G11_UIUX全範囲_実装仕様.md` §5)
- 関係: `ADR-memories.md`(写真の記録)、`ADR-security-baseline.md`(SSRF・ログ)、DOC-11(プライバシー)、DOC-15(競合の機能)

## 1. 決めたこと

| 項目 | 決定 |
|---|---|
| 入口 | `backend/app/services/media_providers/`(interface・ライセンスの判定・上限つきの読み込み)と `registry.py`(設定 `IMAGE_PROVIDERS`・`SOCIAL_PROVIDERS`・`SOCIAL_INSTAGRAM_OEMBED_TOKEN`)。空にすると止まり、`GET /media-providers/status` が空を返し、画面はその項目を出さない |
| 画像の最初の provider | **Wikimedia Commons**(API キー不要)。各ファイルのライセンスに従い、作者・ライセンス・出典を表示する |
| 取り込めるライセンス | CC0・Public domain(PD-*)・CC BY・CC BY-SA(各版)。NC・ND・GFDL のみ・不明・その他は取り込まない(候補には「使えないライセンス」と出す) |
| 取り込み | サーバーが provider_id から取り直す(利用者の URL を使わない)。画像は `upload.wikimedia.org` からだけ。redirect を追わない。上限 `DOCUMENT_MAX_UPLOAD_SIZE_BYTES`。記録の写真と同じ検査(形式・先頭の中身・ウイルス・撮影情報の除去)・暗号化で **非公開(自分だけ)の記録** にし、`memories.source` に provider・作者・ライセンス・出典・取得日時を残す。公開の旅行記へ自動で出さない |
| 縮小画像 | `GET /media-providers/images/thumb?provider=&id=` がサーバーで中継する(ブラウザから外部へ直接読みに行かない。`private, max-age=300`。状態を保存しない) |
| SNS | YouTube・TikTok の **公式の oEmbed**(鍵不要)。Instagram の oEmbed は鍵がある時だけ。投稿の URL へは直接つながない(決まった endpoint に URL を渡すだけ)。ログインの壁を越えない。題名・作者は HTML を除いた文字として表示するだけ(AI に渡さない)。画像・サムネイルは取り込まない・表示しない |
| 場所の候補 | 題名の中の地名らしい語(漢字・カタカナ・英数字の本体 + 寺・駅・市場などの語尾、ハッシュタグ)を既存の Nominatim の検索で照合。確からしさは「低」「中」だけ(高とは言わない)。利用者が選び直してから候補箱へ |
| 取れない時 | 対応外・止めてある・鍵が無い・見つからない・ログインが要る → `fallback: url_and_note`。画面は「URL とメモを出典として保存」に切り替え、取れたように見せない |
| 近くの検索 | カテゴリ(食べ物・市場・買い物・絶景)は OpenStreetMap のタグに対応させ、Overpass だけで探す。距離は基点からの大円距離。半径を保証するのは Overpass だけ(他は「周辺優先」)。利用者の文字は Overpass の正規表現・文字列として逃がす(以前はそのまま入れていた) |
| 試験 | 外部へつながない。backend は `httpx.MockTransport`、E2E は外部に頼る応答だけ `page.route` で差し替える |

## 2. 代替案

| 案 | 採らなかった理由 |
|---|---|
| SNS の投稿のページを取りに行って本文・画像を読む | 利用規約・ログインの壁・SSRF・権利の問題。公式の oEmbed に限る |
| 縮小画像の URL をブラウザへ渡して直接読ませる | 第三者へ利用者の接続元が渡る・CSP を広げる必要がある |
| 外部の画像を記録にせず URL だけで表紙にする | 消える・差し替わる・公開 URL を経由する。取り込んで非公開の記録にすれば、表紙・予定の写真と同じ守りで配信できる |
| 有料の画像検索 API・地図の写真 API | 鍵・契約・利用条件の判断が要る(利用者の判断待ち。interface に足せばよい) |

## 3. 未実装・制約

- SNS 以外の URL の題名・画像の取得(FR-007 の gaps)
- 顔の検査(FR-037 の gaps)。外部の写真の取り込みの前の顔の確認はしない(非公開で保存し、公開の旅行記には自動で出さない)
- 提供元の応答のキャッシュ(毎回取り直す)
