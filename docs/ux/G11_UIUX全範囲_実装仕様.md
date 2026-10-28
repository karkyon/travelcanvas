# Gate G11 UI/UX 全範囲 実装仕様(正本)

- 文書の位置づけ: Gate G11 の実装の正本。`claude/TravelCanvas_UIUXモック実装仕様_2026-10-28.md`(前の版)を置き換える
- 版: r4(2026-10-28 JST。r4: 段階3 の縮小画像の API の形・発見の置き場所・E2E の外部の差し替え。r3: r3: 段階2 の mode の CHECK の migration(§1.0)。r2: 段階1 の実装に合わせ、表紙の API の If-Match をやめた・「写真を外す」の確認を置かない・migration の revision を記した)
- 基準: main `540955d40edc0ccc31df877a1435868bee5edaf7`(G10-UX)、DOC-10 `v5.1-r22`、Alembic head `f4d8a2c6e9b1`
- CI の基準: main の CI run 40647781901(secret-scan・dependency-audit・frontend・backend・e2e の5つが合格。2026-10-28 に GitHub API で確認)
- 画面の正本: `docs/ux/references/TravelCanvas_UIUX_Mock_2026-10-28.html`(ブラウザで開ける。4つの見た目の比較・各画面の操作)
- 利用者の決定(2026-10-28 18:00 JST):
  1. **案A を承認**(旅行の表紙を `travel_plans.cover_memory_id` で持つ migration)
  2. **前の版で「対象外」とした項目を全て G11 に入れる**: 外部の画像検索・SNS の取り込み・場所の写真の自動提案・トリミング(位置の調整)・営業時間の UI・全日程のチャート・モックの4つの見た目を製品の設定にする
  3. 仕様書・作業指示・ハンドオフを、別の Claude の会話でも続けられるよう、整合を保って更新する

この文書だけで G11 の残りを続けられるように書く。進み具合は §9 の表を正とし、段階を終えるごとに更新する。

---

## 0. 守ること(G10 までの決まりを引き継ぐ)

- main へ直接 push しない。段階ごとに `gate/g11-<段階>` の branch と PR。CI の全ジョブ合格後に squash で入れ、新しい clone で tree の一致を確かめる
- `git add -A` は使わない。DOC-10・Alembic head・`config.py`・CI の設定は、同時に複数の PR で変えない(段階は順番に入れる)
- GCP の関係のファイル(`deploy-gcp-dev.yml`・`backend/Dockerfile`・`migrate.sh`・`gunicorn.conf.py`・`scripts/ops/*`・`docs/runbooks/*`)は触らない
- 写真を公開 URL にしない。配信は権限を確かめる API だけ(`Cache-Control: no-store`)。撮影情報(EXIF/XMP/IPTC/PNG text)を除去できない写真は受け付けない(fail closed)
- 外部の API は必ず provider の interface を通す。設定で止められる(既定は止めた状態でも全ての画面が壊れない)。取得に失敗した時に値を作らない(`search_provider.py` の規則と同じ)
- 外部から取った本文(SNS の題名など)は信用しないデータとして扱う。AI に命令として渡さない。非公開の情報を付けて外部へ送らない
- ライセンスが不明・非商用・改変禁止の画像は取り込まない(§5.3)
- E2E の失敗を再試行・sleep・skip で隠さない。DOC-10 の数字だけを上げない
- サンドボックス・CI・omega-dev2・本番の完了を混同しない

---

## 1. DB の変更(migration `g11a_media_cover`、承認済み)

1つの migration にまとめる(revision `a7c3e5f9b2d4`、down_revision = `f4d8a2c6e9b1`。ファイル `backend/alembic/versions/a7c3e5f9b2d4_gate_g11_media_cover.py`)。

| 表 | 列・制約 | 意味 |
|---|---|---|
| travel_plans | `cover_memory_id UUID NULL` FK → `memories.id` **ON DELETE SET NULL** | 旅行の表紙に使う写真(Memory の kind=photo) |
| travel_plans | `cover_focus_x SMALLINT NOT NULL DEFAULT 50`、`cover_focus_y SMALLINT NOT NULL DEFAULT 50`(CHECK 0〜100) | 表紙の写真のどこを中心に見せるか(%)。CSS `object-position` |
| travel_plans | `cover_zoom SMALLINT NOT NULL DEFAULT 100`(CHECK 100〜300) | 拡大(%)。表紙は `object-fit: cover` の上に `scale` |
| travel_plans | 部分の索引 `ix_travel_plans_cover_memory`(`cover_memory_id IS NOT NULL`) | 記録を消す時の SET NULL を速くする |
| travel_events | `image_memory_id UUID NULL` FK → `memories.id` **ON DELETE SET NULL** + 部分の索引 | 予定のカードの写真(場所の写真の提案から差し込む) |
| memories | `source JSONB NULL` | 外部から取り込んだ写真の出典(§5.3 の形)。手で上げた写真は NULL |
| plan_candidates | CHECK `ck_plan_candidates_source_kind` に `'social'` を足す | SNS の投稿 URL から作った候補 |

- 同じ旅行の写真だけを選べること(`memories.plan_id = travel_plans.id`、`kind='photo'`)は API で確かめる(表をまたぐ CHECK は作れないため)
- upgrade: 列・FK・索引・CHECK を足す。既存の行は NULL / 既定値(表示は今と同じ)
- downgrade: 足したものを消す。CHECK は元の4つ(`url,text,manual,search`)へ戻す(`social` の行があれば `manual` に直してから戻す)
- 試験: CI の往復(upgrade → downgrade → upgrade の構造一致)、schema の写し(`app/ops/schema_snapshot`)

### 1.0 段階2 の migration `b8d4f6a0c3e5`(down `a7c3e5f9b2d4`)

§4 の語彙(shinkansen・helicopter)を区間に保存するため、`travel_segments`・`route_legs` の `mode` の CHECK
(`ck_travel_segments_mode_vocab`・`ck_route_legs_mode_vocab`)を広げる。r1 では API の MODES だけで足りると書いたが、DB に
CHECK があり、実装の時に分かった(保存すると 500 になる)。承認済みの §4 の範囲の中の変更として段階2 の PR に入れ、PR と報告に明記する。
downgrade は shinkansen → train、helicopter → mixed に直してから元に戻す。

### 1.1 場面ごとの動き(dangling reference を作らない)

| 場面 | 動き |
|---|---|
| 非公開(private)の写真を表紙にする | visibility は変えない。他のメンバーには表紙の情報を返さず、グラデーションを出す(存在も知らせない) |
| 記録を削除(ゴミ箱へ移す・G6) | 行が消えるので FK で表紙・予定の写真は NULL。ゴミ箱から戻しても表紙には戻さない(選び直す) |
| 記録を書いた人が退会 | その人の記録が消える → NULL |
| 旅行の複製(`/travel-plans/{id}/clone`) | 表紙・予定の写真はコピーしない(記録は複製されないため) |
| 所有者の移転 | 参照はそのまま。見えるかどうかは記録の公開範囲で決まる |
| 旅行の完全削除 | 子と一緒に消える |
| 共有リンク・公開の旅行記 | 表紙の写真は出さない(共有の方針の項目に「表紙の写真」が加わるまで。G11 では常にグラデーション) |
| `PUT /travel-plans/{id}` | 表紙の列はこの API では変えない(TravelPlanUpdate に入れない) |

---

## 2. API(全て `/api/v1` 配下)

### 2.1 表紙(段階1)
- `GET /plans/{plan_id}/cover` (viewer 以上): `{cover: {memory_id, focus_x, focus_y, zoom, source, visibility, by_me} | null, can_edit}`。見えない記録の表紙は `null`
- `PUT /plans/{plan_id}/cover` (editor 以上): body `{memory_id, focus_x?, focus_y?, zoom?}`(整数だけ。真偽値は拒否)。記録は同じ旅行・photo・本人に見えること。監査 `plan.cover_set`(memory_id・visibility・外部の写真か だけ)
- 表紙は旅程(日・予定)の変更ではないため **旅行の revision を進めず、If-Match も要らない**(旅程の編集の If-Match と競合させない。後から保存した方が残る)。r1 の案(If-Match・revision +1)から実装の時に変えた
- `PATCH /plans/{plan_id}/cover` (editor 以上): 位置の調整だけ `{focus_x, focus_y, zoom}`。表紙が無い・本人に見えない時は 404
- `DELETE /plans/{plan_id}/cover` (editor 以上): 参照だけ外す。記録は消さない。監査 `plan.cover_clear`
- `GET /plans/{plan_id}/cover/media` (viewer 以上): 表紙の写真。`GET /memories/{id}/media` と同じ守り(見えなければ 404、撮影情報を配信時にも除去、`no-store`・`nosniff`・CSP sandbox)
- `GET /travel-plans/`・`GET /dashboard` の各旅行に `cover: {memory_id, focus_x, focus_y, zoom} | null` を足す(見える人だけ)
- 写真の新しい取り込みは既存の `POST /plans/{plan_id}/memories/upload`(kind=photo, visibility=private)を使い、返った id で PUT する

### 2.2 予定の写真(段階3)
- `PUT /plans/{plan_id}/events/{event_id}/image`(editor 以上): `{memory_id}`。同じ確認
- `DELETE /plans/{plan_id}/events/{event_id}/image`
- `GET /plans/{plan_id}/events/{event_id}/image/media`

### 2.3 営業時間の照合(段階2)
- `GET /plans/{plan_id}/hours-check?day_id=` (viewer 以上): その日の予定ごとに
  `{event_id, place_id, status, reason, window_label, last_entry, last_order, closes_at, source, retrieved_at, stale}`
  - status: `ok`(時間内) / `near_close`(閉店・最終入場まで30分未満) / `last_entry`(最終入場より後) / `last_order`(飲食で L.O. より後) / `closes_during`(滞在中に閉店) / `closed`(休業日・閉店後に到着) / `unknown`(営業時間の登録が無い・時刻が無い・場所が無い)
  - `stale`: 出典の取得から 90日を超える。stale の時は ok を出さず `unknown` 扱いの注意を添える
  - 判定は `app/services/place_hours.day_hours`(例外の日 → 曜日 → 前の日から続く深夜営業)。日付は旅程の日の現地の日付、時刻は場所の現地の時刻
  - 自動で予定を動かさない(提案は既存の再計画・最適化の流れ)

### 2.4 発見(段階3)
- `POST /search/spots` に `category`(`all|food|market|shopping|viewpoint`)を足す。Overpass のタグに対応させる(food: amenity=restaurant|cafe|fast_food|food_court、market: amenity=marketplace / shop=greengrocer|seafood|deli、shopping: shop=*、viewpoint: tourism=viewpoint|attraction)
- 各結果に `distance_m`(基点からの大円距離)と `within_radius`(bool)を返す。provider が範囲を保証しない時は画面に「周辺優先」と出し、半径内と言い切らない
- Overpass の名前の条件は正規表現の特別な文字を逃がす(今は利用者の文字をそのまま入れている)
- `POST /plans/{plan_id}/candidates/social-preview` (editor 以上): `{url}` → `{platform, status, title, author, retrieved_at, place_suggestions[], fallback}`。保存しない
  - status: `ok` / `unsupported`(対応外の SNS) / `unavailable`(取得できない・ログインが要る・消えた) / `disabled`(provider が止めてある)
  - provider: YouTube・TikTok は公式の oEmbed(鍵が要らない)。Instagram は oEmbed に鍵が要る(`SOCIAL_INSTAGRAM_OEMBED_TOKEN` が無ければ `unavailable`)
  - 場所の候補: 題名の文字から地名らしい語を取り、既存の検索の provider(Nominatim)で照合した結果を `confidence: low|medium` で返す(高とは言わない)
  - 画像はコピーしない(権利が不明)。サムネイルも表示しない(第三者への通信を増やさないため)
  - URL は既存の追跡の query 除去(CandidatesPage と同じ)をサーバーでも行う。http/https 以外・私的な IP・localhost は拒否(SSRF 対策)
- `POST /plans/{plan_id}/candidates` の `source_kind` に `social` を許す(preview を確かめた後の保存)
- `GET /media-providers/images?q=&lat=&lng=` (ログイン必須): 外部の画像の候補 `[{provider, provider_id, title, thumb_proxy_id, author, license, license_url, attribution, source_page_url, width, height, retrieved_at}]`
- `POST /plans/{plan_id}/memories/import-external` (editor 以上): `{provider, provider_id}` → サーバーが provider から取り直し(利用者が送った URL は使わない)、上限・形式・ウイルス検査・撮影情報の除去を通し、**非公開の Memory(kind=photo、`source` 付き)** として保存して返す。そのあと表紙・予定の写真に設定できる
- 候補の縮小画像はサーバーが中継する(`GET /media-providers/images/thumb?provider=&id=`、ログイン必須、`Cache-Control: private, max-age=300`)。サーバーは provider_id から提供元の API で URL を引き直す(利用者の URL を使わない・状態を保存しない)。ブラウザから外部へ直接読みに行かない
- 予定の写真の一覧: `GET /plans/{plan_id}/event-images`(見える写真だけ。予定 → 写真の記録)

---

## 3. 画面(段階ごと)

### 3.1 表紙の写真(段階1。モック: ホーム・共有・記録の表紙)
- `TripCover` に `photo` を足す: `{src: string(blob の一時 URL), focusX, focusY, zoom, alt}`。写真の上に暗い重ね(下から上へ 0.65→0.15 の黒)を敷き、白い文字の 4.5:1 を保つ。読み込みに失敗したら写真を外してグラデーション
- 写真の取得は `useCoverPhoto(planId, cover)`: `GET /plans/{id}/cover/media` を blob にし、一時 URL を作って片付ける。オフライン・403/404・失敗はグラデーション(画面は壊さない)
- PlanHeader の表紙: 編集できる人にだけ「写真を設定」(無い時)/「写真を変更」「写真を外す」(有る時)
- `CoverPhotoDialog`(既存の Modal を使う):
  1. 「この旅行の写真から選ぶ」(見える写真の一覧。各写真に公開範囲「自分だけ」「メンバー」)
  2. 「写真を取り込む」(対応形式 JPEG/PNG/WebP/GIF、上限は `max_upload_bytes`。「この旅行内に非公開で保存します。撮影情報(撮影位置など)は取り除きます」)
  3. 「外部の写真を探す」(段階3。provider が止めてあれば項目ごと出さない)
  4. 位置の調整: 横・縦(0〜100%)・拡大(100〜300%)の range input と矢印のボタン。hero / header / card の3つの大きさのプレビューを並べる
  5. 「この写真を旅行の表紙に使う」で保存。非公開の写真の時は「表紙はあなたにだけ写真で表示されます(他の人にはこれまでの色の表紙)」と明示
- 「写真を外す」(選ぶ画面の中)は参照だけ外す。写真の記録は残り、選び直せば戻せるため確認の手順は置かない。写真そのものは記録の画面から消す(既存のゴミ箱の流れ)
- 保存の後、PlanHeader・ダッシュボードの大きな表紙・旅行のカードが同じ表紙を出す(react-query のキーを無効にする)
- 外部の画像の時は表紙の右下に出典の表示(作者・ライセンス)を出す(§5.3)

### 3.2 旅程の画面(段階2。モック: 旅程)
- 予定のカード(`ScheduleItem`):
  - 移動手段は「アイコン + 名前 + 所要時間」(例「🚶 徒歩 · 18分」)。名前は §4 の表。不明・未設定は「移動手段未設定」で、既定の電車のアイコンを出さない。所要時間が無い時は「所要時間未計算」(0分と区別)
  - 営業時間の帯: `hours-check` の status ごとに記号と文字(✓ 時間内 / ⚠ 閉店まで◯分 / ⚠ 最終入場 HH:MM を過ぎる / ⚠ L.O. HH:MM を過ぎる / ✕ 休業日・閉店後 / ? 営業時間未確認)と出典・確認日。色だけで伝えない
  - 予定の写真があれば左に小さく出す(段階3)
  - 並べ替え: 既存のドラッグと矢印キーに加え、触って使える「上へ」「下へ」のボタン(各 44px 以上、`aria-label`)。動かした後に aria-live で「◯番目へ移しました。営業時間と移動を確かめています」と知らせ、焦点を動かしたカードに残す。照合が終わるまで古い判定を「確認中」にする
- 日の見出し: 「現地時間 · Asia/Tokyo」のように IANA の名前を常に出す(端末と同じでも省く)
- 時差をまたぐ移動(区間の出発と到着の日の timezone_id が違う): 出発地と到着地の日付・時刻・zone を並べ、日付が変わる時は「翌日着」「前日着」の印。同じ1つの UTC の時刻から両方へ変換する。zone が無効なら「時刻帯未確認」
- 「日別」「全日程」の切り替え(DateNavigation の上): 全日程はモックの「全日程の横断チャート」
  - 各日が1列(幅に応じて 3列→2列→1列。4日を超えると横に流し、流せることを示す)
  - 列の見出しに日付・曜日・題名・zone、要約(予定の数・最初と最後の時刻・移動の合計・空き時間・予約で固定の数)
  - 列の中は同じ時刻の物差し(その旅行で最も早い開始〜最も遅い終了)の上に予定の帯を置く(時刻・名前・移動手段のアイコン+名前・営業時間の記号)
  - 帯・列を押すとその日の日別へ戻る。キーボードで日を移れる。既存の「概要を表示」の要約は残す
  - 空き時間・移動の合計は重なりを二重に数えない

### 3.3 発見の画面(段階3。モック: 発見)
- 置き場所: 旅行の **候補箱の画面**(`/planner/{id}/candidates`。保存先の旅行が決まっている所)の上部に「近くの「行きたい」を集める」と「SNS の投稿から取り込む」を置く(r3 で決めた。旧来の SearchPage・SpotSearch は変えない)。「基点」(現在地 / 旅程の場所 / 地図の地点 / 地名の入力)・半径・カテゴリ(すべて・食べ物・市場・買い物・絶景)。位置の許可を断っても地名で探せる
- 候補のカード: 名前・カテゴリ・距離(「半径内」/「周辺優先」)・出典・取得時刻・「候補箱へ」・「写真を探す」
- SNS から取り込む: URL を貼る →「URL を確かめる」→ 確認のカード(SNS の名前・作者・題名・取得時刻・場所の候補と確からしさ「低」「中」)→ 利用者が直す →「候補箱へ追加」(source_kind=social)。取れない時は「URL とメモを出典として保存」に切り替え、取れたように見せない
- 場所の写真の提案: 予定・候補の「写真を探す」→ 外部の画像の候補(作者・ライセンス・出典のページ・取得日)→「この予定のカードに使う」「旅行の表紙に使う」→ 非公開の記録として取り込み → 設定

### 3.4 見た目の系統(段階4。モックの4案を製品の設定へ)
- 設定 → 表示 に「見た目の系統」: 標準(G10 のまま)・Atlas・Editorial・Daylight・Studio。明るい・暗い・端末に合わせる とは別の軸(組み合わせ 5×3)
- 当て方: `<html data-style="atlas">` と CSS 変数(`--tc-accent` など)の上書きだけ(画面の部品は変えない)。系統ごとに明暗の両方の値を `tokens.ts` に持ち、`tokens.css` に生成して一致を試験する
  - Atlas: 地の色 `#f5f4ee`、強調 `#385a55`(暗い `#8fc2b0`)、角 16px
  - Editorial: 地 `#f7f3f0`、強調 `#65463a`(暗い `#e2b29c`)、見出しの書体を明朝(`--tc-font-display` を本文の見出しにも)
  - Daylight: 地 `#eef3f8`、強調 `#2451a4`(暗い `#9cc0f5`)、文字を太め・ボタン 48px(当日の画面向け)
  - Studio: 地 `#f4f6fa`、強調 `#4338ca`(暗い `#a5b4fc`)、詳細の面だけ glass
- 全ての系統×明暗で `TEXT_PAIRS` の AA(本文 4.5:1・部品 3:1)を試験で確かめる
- 保存は端末(localStorage `tc.style`)とアカウント(`users.preferences["ui_style"]`、migration なし)。ログインした時はアカウントの値を優先
- モックの系統の切り替え(上の帯のボタン)は製品には置かない。設定だけ

---

## 4. 移動手段の名前(DOC-13 の語彙に足す)

| 値 | 表示 | 備考 |
|---|---|---|
| walking | 🚶 徒歩 | |
| bicycle | 🚲 自転車 | |
| bus | 🚌 バス | |
| train | 🚃 鉄道 | 新幹線と推測しない |
| shinkansen | 🚄 新幹線 | 新しい値(区間で明示された時だけ) |
| driving / car | 🚗 車 | |
| taxi | 🚕 タクシー | |
| ferry | ⛴️ 船 | |
| flight / plane | ✈️ 飛行機 | |
| helicopter | 🚁 ヘリ(要手配) | 新しい値。所要時間は「未確定」とし、推定しない |
| mixed | 🔀 乗り継ぎ | |
| (空・不明) | 移動手段未設定 | アイコンを出さない |

`segments.py` の MODES と `branch_resources.py` の MODES に `shinkansen`・`helicopter` を足す。`route_estimator` は helicopter の時に推定しない(所要時間 NULL・理由「要手配」)、shinkansen は train と同じ扱いで推定する。

---

## 5. 外部の provider

### 5.1 interface(`backend/app/services/media_providers/`)
- `ImageProvider`: `name`、`async search(query, lat, lng, limit) -> List[ImageCandidate]`、`async fetch(provider_id) -> FetchedImage(bytes, mime, meta)`。失敗は空・例外を `ProviderUnavailable` にまとめる。値を作らない
- `SocialProvider`: `platforms`、`async preview(url) -> SocialPreview`
- 登録: `IMAGE_PROVIDERS`(既定 `wikimedia_commons`)、`SOCIAL_PROVIDERS`(既定 `youtube_oembed,tiktok_oembed`)。空にすると止まり、画面はその項目を出さない(`GET /media-providers/status`)
- 通信: `httpx` の timeout 8秒、応答の上限(画像は `DOCUMENT_MAX_UPLOAD_SIZE_BYTES`、JSON は 1MB)、利用者が渡した URL へ直接つながない(画像は provider_id から provider が URL を作る。SNS の oEmbed は決まった公式の endpoint だけ)、redirect は provider の決まった host の中だけ

### 5.2 最初の provider
- **Wikimedia Commons**(API キー不要。利用条件: 各ファイルのライセンスに従い、作者・ライセンスを表示する)。`action=query&list=geosearch` / `generator=search` + `prop=imageinfo&iiprop=url|mime|size|extmetadata`
- **YouTube oEmbed**(`https://www.youtube.com/oembed`)、**TikTok oEmbed**(`https://www.tiktok.com/oembed`)。鍵不要、題名・作者だけを使う
- **Instagram oEmbed**: 鍵(`SOCIAL_INSTAGRAM_OEMBED_TOKEN`)がある時だけ。無ければ unavailable

### 5.3 写真のライセンスと出典(`memories.source`)
- 取り込める: `CC0`・`Public domain`・`CC BY`・`CC BY-SA`(各版)。取り込めない: `NC`・`ND`・不明・その他(候補にも「使えないライセンス」と出し、取り込みの操作を出さない)
- `source` の形: `{"kind":"external","provider":"wikimedia_commons","provider_id":"File:…","source_page_url":"https://commons.wikimedia.org/wiki/File:…","author":"…(HTML を除いた文字)","license":"CC BY-SA 4.0","license_url":"…","attribution":"…","retrieved_at":"ISO8601","modified":"cropped"}`
- 表紙・予定の写真が外部の写真の時は、作者・ライセンス・出典のリンクを表示する(BY・BY-SA の表示義務)。位置の調整は「改変(トリミング)」として `modified` に記す
- 取り込んだ写真も非公開の記録(既定 private)。公開の旅行記へ自動で出さない

---

## 6. 受入条件(UIX-M、DOC-10 の FR とは別の番号)

| ID | 条件 | 段階 |
|---|---|---|
| UIX-M01 | 4つの系統を設定で選べ、明暗と組み合わせても AA を満たす。モックの比較の帯は製品に無い | 4 |
| UIX-M02 | 日のタブを変えると予定・地図・詳細が同じ日・同じ予定にそろう | 2 |
| UIX-M03 | ドラッグ・触る・キーボードで順を変えられ、変えた後に営業時間・移動の再確認が出る。確定の予定を黙って変えない | 2 |
| UIX-M04 | 移動手段に名前があり、train を新幹線と言わず、ヘリは要手配 | 2 |
| UIX-M05 | 各日に IANA の zone が見え、時差をまたぐ区間は両端の現地の日時が同じ瞬間から整合(日付変更・夏時間の試験) | 2 |
| UIX-M06 | 全日程のチャートが日ごとの時刻の物差しで予定を並べ、押すと日別へ戻る。既存の要約は残る | 2 |
| UIX-M07 | 営業時間の照合が 時間内・閉店間際・最終入場・L.O.・滞在中に閉店・休業・未確認・古い を区別し、出典と取得日を出す | 2 |
| UIX-M08 | 近くの検索が 基点・半径・カテゴリ を示し、距離を実際に計算し、半径を保証できない時は言い切らない | 3 |
| UIX-M09 | SNS の URL は確認のカードと利用者の確認を通る。取れない時も URL とメモを保存でき、取れたと偽らない。外部の本文を命令として扱わない。SSRF を拒む | 3 |
| UIX-M10 | 表紙・予定の写真は非公開の暗号化した記録を権限付きで配信し、撮影情報の除去に失敗したら拒む。公開 URL を作らない。失敗の時はグラデーション | 1・3 |
| UIX-M11 | 明暗・端末、360px/1440px、キーボード、axe、読み込み中・空・失敗・オフラインで G10 を後退させない | 全て |
| UIX-M12 | DOC-10 の証拠、DOC-13 の語彙、DOC-11 のプライバシーをこの仕様と合わせる | 全て |
| UIX-M13 | 表紙の位置の調整(横・縦・拡大)が hero/header/card で同じ見え方になり、保存される | 1 |
| UIX-M14 | 外部の写真はライセンスの許すものだけ取り込め、作者・ライセンス・出典を表示する | 3 |

---

## 7. 試験の方針

- backend: 表紙の API(権限: 所有者・editor・viewer・他人の非公開・他の旅行の記録・音声の記録・存在しない)、If-Match、SET NULL(記録の削除・ゴミ箱)、複製でコピーしない、`PUT /travel-plans` で変わらない、配信の撮影情報の除去(GPS 付きの JPEG を作って確かめる)、監査に本文・ファイル名が無い。hours-check の各 status(例外の日・深夜営業・最終入場・L.O.・未登録・古い)。provider は `httpx.MockTransport` で外へつながない(ライセンスの判定・redirect の拒否・上限・SSRF)
- frontend: TripCover の写真・失敗時のグラデーション・重ねのコントラスト、CoverPhotoDialog の権限ごとの表示、ScheduleItem の移動手段の名前と営業時間の帯、全日程のチャート、時差の表示(夜行便・日付変更線)、系統×明暗のトークンの AA と CSS の一致
- E2E: 表紙の設定→PlanHeader・ダッシュボードに出る→外す、閲覧者に操作が無い、全日程の切り替え、系統の切り替えが再読み込みで続く。各 spec は台帳の証拠に足す
- E2E は外部の提供元(OpenStreetMap・oEmbed・Wikimedia Commons)へつながない。外部に頼る応答だけを `page.route` で差し替え(gate-g9 と同じ)、保存は本物の backend を通す。提供元の取り込み・ライセンス・SSRF の守りは backend の試験(`httpx.MockTransport`)で確かめる

---

## 8. DOC-10 の扱い

- FR-037(写真・旅行記): 表紙の写真が加わる。残りの gaps(顔の検査・MEMORY MAP)は変わらないので INTEGRATED(partial)のまま
- FR-005(日・イベント): 触って使う並べ替えのボタン(実機の確認は omega-dev2 で別に記録)
- FR-008(場所)・FR-017(実行可能性): 予定のカードの営業時間の照合
- FR-014(移動区間): 移動手段の語彙・時差の表示
- FR-010 等の検索の FR: カテゴリ・距離・SNS 取り込み(取り込みの provider は SNS の公式 oEmbed だけ)
- 状態を上げるのは、証拠(試験の名前・E2E の spec)を `v1-verification-ledger.json` に足し、CI で合格した時だけ。revision は段階ごとに r23, r24…

---

## 9. 進み具合(段階を終えるごとに更新する)

| 段階 | branch | 内容 | 状態 |
|---|---|---|---|
| 1 Media | gate/g11-media | migration `a7c3e5f9b2d4`(§1 の全て)・表紙の API・TripCover の写真・CoverPhotoDialog・位置の調整・試験 | **完了**: PR #9、CI 5ジョブ合格、main `b21e47b`(新しい clone で tree 一致)。DOC-10 r23。omega-dev2 は未反映 |
| 2 Planner | gate/g11-planner | migration `b8d4f6a0c3e5`(§1.0)・hours-check・営業時間の帯・移動手段の名前・shinkansen/helicopter・日の zone・時差の区間・触る並べ替え・全日程のチャート | 実装済み・PR で CI の確認中(`docs/trace/gate-g11-planner-trace.md`)。DOC-10 r24 |
| 3 Discover | gate/g11-discover | provider の interface・Wikimedia Commons・SNS oEmbed・social-preview・import-external・予定の写真・カテゴリ・距離・Overpass の逃がし | 実装済み・PR で CI の確認中(`docs/trace/gate-g11-discover-trace.md`、`docs/adr/ADR-media-providers.md`)。DOC-10 r25 |
| 4 Style | gate/g11-style | 4つの系統の tokens・`data-style`・設定・アカウントへの保存・AA の試験 | 未着手 |

各段階の記録は `docs/trace/gate-g11-<段階>-trace.md` に残す。
