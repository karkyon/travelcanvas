# Gate SearchUAT — 旅行相談の場所の検索の入口の統一と、検索の失敗(OpenStreetMap)の是正

基点: `gate/admin-ops-uat` `04f7537`。正本: 「旅行相談UATの追加是正指示：場所検索の入口統一と検索失敗への対応」(2026-11-01)。
外への通信の試験は httpx.MockTransport・CI の模擬の提供元・E2E の要求の差し替え。模擬の成功は実の API の成功ではない。

## UAT 不具合の記録

| ID | 現象(omega-dev2・方面「伊勢」の詳細) | 原因 | 是正 |
|---|---|---|---|
| UAT-S1 | 上の「候補を探す(OpenStreetMap)」と下の「Google で場所を探す」が並び、違いを知らないと使えない | 場所の検索の口が2つ(AreaDetailStep と ConsultLookupPanel) | 入口を「候補を探す」の1つにし、検索元(OpenStreetMap / Google)を同じ欄で選ぶ。Google の場所の検索の欄は廃止。経路は別の枠 |
| UAT-S2 | 「候補を探す」が失敗し「提供元が応答しませんでした。時間をおいて…」と出る | コード上の原因: Overpass への要求に User-Agent が無い(httpx の既定 `python-httpx/…`)。公開の overpass-api.de は 2026-04 頃から識別できない User-Agent に HTTP 406 を返す(OSM コミュニティの報告)。方面の位置の照会(Nominatim)は User-Agent を付けていたため成功していた。失敗は全て「unavailable」で、HTTP の状態をログにも残していなかった | 識別できる User-Agent(`TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)`)を Overpass・Nominatim・Wikipedia に付ける。失敗を分類(blocked・rate_limited・timeout・server_error・network・unreadable・provider_timeout)し、画面・API(`provider_errors`)・利用の記録・ログ(分類と HTTP の状態)に残す。200 でも remark の runtime error だけの応答を「該当なし」にしない |
| UAT-S2 の実環境の確認 | — | omega-dev2 では未確認(このセッションは omega-dev2 に届かず、外への要求も止められている) | `scripts/ops/search_diag.sh`(反映の後に自動で実行): backend コンテナから DNS・アプリと同じ要求(伊勢 10km の観光・食べ物・市場)・比較の User-Agent なしの要求・直近 7 日の利用の記録の分類を出す。反映の前のログの失敗の型は `predeploy-search-log-*.txt` に残す |

## 要件

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 入口は「候補を探す」の1つ(カテゴリ・名前や雰囲気・検索範囲・検索元・実行) | IMPLEMENTED | `PlaceSearchPanel.tsx`・vitest `PlaceSearchPanel.test.tsx`・E2E `zz-consult-ai.spec.ts`(`consult-places-search` が無い) |
| 2 | 経路の検索は場所の検索と分ける | IMPLEMENTED | `ConsultLookupPanel`(経路だけ) |
| 3 | 今の検索元を表示。Google は DB 登録の鍵の確認・会員クラス・停止・利用枠を判定し、使えない時は理由と解決の操作を検索欄の近くに出す | IMPLEMENTED | `googleSearchAvailability`・vitest(ゲスト・クラス・鍵・停止・枠) |
| 4 | 有料の検索への切り替えは利用者が選ぶ。無料の失敗から自動で切り替えない(同じ欄で「Google で探す」を案内) | IMPLEMENTED | vitest・E2E(失敗の時 `consultPlaces` を呼ばない) |
| 5 | 「該当なし」と「通信・提供元の失敗」を分ける。失敗しても入力・前の結果・選んだ候補を残し、もう一度探せる | IMPLEMENTED | `test_gate_search_uat.py`・vitest・E2E |
| 6 | 検索元を問わず、選ぶ・外す・下書きへの引き継ぎが同じ操作。出典・取得時刻・未確認のことを示す | IMPLEMENTED | `consult-picked`(右の一覧で外せる)・`draftInputOf`・`DraftIn.google_places` |
| 7 | 提供元の利用条件: Google の場所は place ID と Google マップの URL だけを下書きに保存(名前・住所・位置は保存しない)。OpenStreetMap は出典(ODbL)を示す | IMPLEMENTED | `test_draft_keeps_google_place_id_and_url_but_not_name` |
| 8 | 連打で二重に送らない・二重に数えない(押している間は送らない。Google は同じ入力の再試行に同じ Idempotency-Key) | IMPLEMENTED | vitest(連打で1回・処理中の時に同じ鍵)。サーバーの二重計上の防止は Gate ConsultAI(送信権の確保) |
| 9 | 実環境(omega-dev2)で伊勢の 観光・食べ物・市場、0件、Google 不可、利用枠、PC・スマートフォンでの検索 → 選ぶ → 下書き | NOT_RUN(runbook `consult-uat-omega-dev2.md` §2b。時間切れ・提供元の失敗は実環境では起こせないため模擬で確認) | — |
