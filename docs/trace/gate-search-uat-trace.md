# Gate SearchUAT — 旅行相談の場所の検索の入口の統一と、検索の失敗(OpenStreetMap)の是正

基点: `gate/admin-ops-uat` `04f7537`。正本: 「旅行相談UATの追加是正指示：場所検索の入口統一と検索失敗への対応」(2026-11-01)。
外への通信の試験は httpx.MockTransport・CI の模擬の提供元・E2E の要求の差し替え。模擬の成功は実の API の成功ではない。

## UAT 不具合の記録

| ID | 現象(omega-dev2・方面「伊勢」の詳細) | 原因 | 是正 |
|---|---|---|---|
| UAT-S1 | 上の「候補を探す(OpenStreetMap)」と下の「Google で場所を探す」が並び、違いを知らないと使えない | 場所の検索の口が2つ(AreaDetailStep と ConsultLookupPanel) | 入口を「候補を探す」の1つにし、検索元(OpenStreetMap / Google)を同じ欄で選ぶ。Google の場所の検索の欄は廃止。経路は別の枠 |
| UAT-S2 | 「候補を探す」が失敗し「提供元が応答しませんでした。時間をおいて…」と出る | **未確定**。コードで確かめた不足: Overpass への要求に User-Agent が無い(httpx の既定 `python-httpx/…`)。公開の server の利用条件は識別できる User-Agent を求め、他の利用者の報告では 2026-04 頃から 406 を返す。方面の位置の照会(Nominatim)は User-Agent を付けていて成功していた。失敗は全て「unavailable」で、HTTP の状態をログにも残していなかった | 識別できる User-Agent を Overpass・Nominatim・Wikipedia に付ける。失敗を分類し、画面・API(`provider_errors`)・利用の記録・ログ(分類と HTTP の状態)に残す。応答の構造を確かめ、`elements: []` だけを「該当なし」、remark つきの一部だけの結果を `partial_providers` として区別する |
| UAT-S2 の実環境の確認 | — | omega-dev2 では未確認(このセッションは omega-dev2 に届かず、外への要求も止められている) | `scripts/ops/search_diag.sh`(反映の後に自動で実行): backend コンテナから DNS・アプリと同じ要求(伊勢 10km の観光・食べ物・市場)・**同じ送り先と本文で User-Agent だけを変えた順の比較(アプリ → なし → アプリ)**・直近 7 日の利用の記録の分類を出す。反映の前のログの失敗の型は `predeploy-search-log-*.txt` に残す。原因は比較・ログ・画面の検索の結果を合わせて判断する(比較だけで断定しない) |
| UAT-S3(CI #390) | PR #45 の PR 側の CI の E2E で `zz-security-challenge` が 1 回目に失敗(登録の後の `waitForURL` が 100 秒で時間切れ)、再試行で合格(flaky)。push 側の CI は成功していたため、反映の道具は merge へ進み GitHub に断られた | 手元で再現: 直前の1分に同じ接続元から登録が4回あると、試験の2回目の登録が **429(登録の回数制限 1分5回・接続元ごと)** で止まり、画面は遷移せず `waitForURL` が時間切れ(同じ 89 行・同じ表示)。CI では全ての試験が同じ接続元から登録し、試験の順と速さで直前の試験の登録が同じ1分に重なる。再試行は1分以上後なので通る。CI #390 の trace は未確認(このセッションは GitHub の artifact を読めない) | 試験の初めと2回目の登録の前に、試験の環境だけの `e2e-reset-rate-limits`(本番では断る)で回数の記録を消す。本番の制限は変えない。認証の応答の列(状態・難しさ・理由の文・時刻)を記録し、最後の応答が 200 でなければ 100 秒を待たずに列を示して止める。手元で条件を作った再現: 旧の試験は失敗、新しい試験は合格。retries=0 で 10 回連続合格 |
| UAT-S4(F01) | 反映の道具が push 側の CI だけを見て merge へ進んだ | `cmd_merge` は push の CI だけを確かめていた | push の後に PR 側の必須の検査(無ければ全ての検査)を待ち、失敗・取り消し・未完了なら名前と URL を出して止める。merge の前にも確かめる。GitHub が断った時は mergeStateStatus・レビューを出す。`--admin`・保護の解除はしない |

## 要件

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 入口は「候補を探す」の1つ(カテゴリ・名前や雰囲気・検索範囲・検索元・実行) | IMPLEMENTED | `PlaceSearchPanel.tsx`・vitest `PlaceSearchPanel.test.tsx`・E2E `zz-consult-ai.spec.ts`(`consult-places-search` が無い) |
| 2 | 経路の検索は場所の検索と分ける | IMPLEMENTED | `ConsultLookupPanel`(経路だけ) |
| 3 | 今の検索元を表示。Google は DB 登録の鍵の確認・会員クラス・停止・利用枠を判定し、使えない時は理由と解決の操作を検索欄の近くに出す | IMPLEMENTED | `googleSearchAvailability`・vitest(ゲスト・クラス・鍵・停止・枠) |
| 4 | 有料の検索への切り替えは利用者が選ぶ。無料の失敗から自動で切り替えない(同じ欄で「Google で探す」を案内) | IMPLEMENTED | vitest・E2E(失敗の時 `consultPlaces` を呼ばない) |
| 5 | 「該当なし」と「通信・提供元の失敗」を分ける。失敗しても入力・前の結果・選んだ候補を残し、もう一度探せる。[F06] 構造の無い応答は「該当なし」にせず、一部だけの結果は区別して示す | IMPLEMENTED | `test_gate_search_uat.py`・vitest・E2E |
| 6 | 検索元を問わず、選ぶ・外す・下書きへの引き継ぎが同じ操作。出典・取得時刻・未確認のことを示す | IMPLEMENTED | `consult-picked`(右の一覧で外せる)・`draftInputOf`・`DraftIn.google_places` |
| 7 | 提供元の利用条件: Google の場所は place ID と Google マップの URL だけを下書きに保存(名前・住所・位置は保存しない)。OpenStreetMap は出典(ODbL)を示す | IMPLEMENTED | `test_draft_keeps_google_place_id_and_url_but_not_name` |
| 8 | 連打で二重に送らない・二重に数えない(押している間は送らない。Google は同じ入力の再試行に同じ Idempotency-Key) | IMPLEMENTED | vitest(連打で1回・処理中の時に同じ鍵)。サーバーの二重計上の防止は Gate ConsultAI(送信権の確保) |
| 8b | [F03] 応答が届かなかった(通信・時間切れ・5xx・処理中)後のやり直しは同じキー(旅行相談の AI の読み取りも同じ)。済んだ要求(idempotent_replay)は「原価は計上済み・結果を受け取れなかった」と示し、探し直しは利用者が選ぶ新しい検索 | IMPLEMENTED | `keepIdempotencyKey`・vitest(通信・5xx は同じキー、4xx は新しいキー、replay の表示)・`test_places_resend_after_lost_response_sends_once_and_uses_radius`(Google へ1回・確定1回) |
| 8c | [F04] Google にも画面の検索範囲を送る(locationBias の円の半径。指紋にも含める)。範囲は優先だけで範囲外も出ると示す | IMPLEMENTED | 同上の試験・vitest |
| 9 | 実環境(omega-dev2)で伊勢の 観光・食べ物・市場、0件、Google 不可、利用枠、PC・スマートフォンでの検索 → 選ぶ → 下書き | NOT_RUN(runbook `consult-uat-omega-dev2.md` §2b。時間切れ・提供元の失敗は実環境では起こせないため模擬で確認) | — |

## 範囲外(次の段階)

監査 F07 と「会話理解・原価削減・10回相談」の指示書(会話の状態と差分の送信・追加・訂正・取消・矛盾の構造・予算の複数条件・
Journey/Explorer の AI 10 回の保護枠・料金の版・実のモデルの原価の比較)は、この Gate では実装していない(NOT_IMPLEMENTED)。
この Gate の安定版は「検索の UAT の準備」で、「10回の相談・会話の品質の完成」ではない。
