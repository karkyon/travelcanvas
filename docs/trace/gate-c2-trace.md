# Gate C2 トレース(FR-007 候補箱・FR-008 場所の一元管理)

基準: Gate Q1(tree `e8000623…`)。migration `c4f2a8e1d9b6`(plan_candidates、places の列の追加)。
B = backend `tests/test_gate_c2_candidates_places.py`、U = vitest(`services/api/c2candidates.test.ts`・`pages/CandidatesPage.test.tsx`・
`pages/PlacePage.test.tsx`)、E = `frontend/e2e/candidates.spec.ts`。画面 `/planner/:planId/candidates`・`/planner/:planId/places/:placeId`。

## FR-007 候補箱(DOC-02「URL、テキスト、画像、音声、地図、共有から未確定候補を収集。出典、登録者、取得時刻、重複候補、確定状態を保持。
旅程へ配置しても元出典を失わない」)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | URL・テキスト・手入力・検索結果から候補を足す | IMPLEMENTED | `POST /plans/{id}/candidates`・`/candidates/from-search`(本人の検索結果だけ)。B・E |
| 2 | 出典・登録者・取得時刻 | IMPLEMENTED | source_url(正規化)・provider・retrieved_at・created_by。U・E |
| 3 | URL の正規化と SSRF の防止(FC-019) | IMPLEMENTED | http/https だけ、追跡用のパラメータ・断片・既定のポートを外す、利用者名つき・制御文字を拒否。**URL の先を取りに行かない**。B |
| 4 | 重複の候補(FC-023) | IMPLEMENTED | 提供元の ID・名前(全角半角・記号を無視)・100m 以内・住所・URL。近いだけは重複にしない。自動で消さず、まとめる(merge)。B・U・E |
| 5 | 旅程へ配置しても出典を失わない | IMPLEMENTED | 旅程に追加で場所(出典つき)と予定を作り、候補は「予定に配置済み」で残る。変更セット source=candidate で元に戻せる。B・E |
| 6 | 予定から外したら候補に戻す(DOC-14 §3.1) | IMPLEMENTED | 予定が消えた候補は読む時に「候補」。B(元に戻す)・E(予定の削除) |
| 7 | 競合・権限 | IMPLEMENTED | If-Match、viewer は見るだけ、他人は見えない。監査に名前・URL を残さない。B |
| 8 | 画像・音声からの候補(FC-020/021) | NOT STARTED | OCR・音声認識の提供元が未接続 |
| 9 | 候補への投票・提案理由(FC-025) | NOT STARTED | 投票は P3 の投票(予定・候補の比較)を使う。候補カードには無い |
| 10 | URL のタイトル・画像の自動取得 | NOT STARTED | SSRF を避けるため取りに行かない(外部の取得サービスを使う時に設計) |

→ INTEGRATED(部分、E2E有)。

## FR-008 場所の一元管理(DOC-02「正式名、別名、住所、緯度経度、入口、階、電話、URL、営業時間、休業日、予約要否、価格帯、
アクセシビリティ、メモ。同名施設を地理IDと提供元IDで区別。地図、イベント、予約、移動、PDFは同じ場所IDを参照」)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 項目(正式名・別名・住所・座標・入口・階・電話・Web・休業日・予約の要否・価格帯・アクセシビリティ・メモ) | IMPLEMENTED | places の列の追加、`PATCH /places/{id}`(If-Match)。B・U・E |
| 2 | 営業時間(曜日ごと・1日3区切り・日をまたぐ営業) | IMPLEMENTED | `PUT /places/{id}/opening-hours`。B・E |
| 3 | 項目ごとの出典(SC-09「矛盾時はソース比較」) | IMPLEMENTED(最新の出典) | field_sources に検索の提供元・取得時刻/利用者の入力。複数の出典の比較の画面は無い |
| 4 | 同じ場所 ID を予定・移動区間・候補が参照 | IMPLEMENTED | 旅行の場所の一覧 `GET /plans/{id}/places`、場所を使う予定の一覧 |
| 5 | 権限(SC-09 Owner/Editor 編集、Voter/Viewer 閲覧) | IMPLEMENTED | 見る: 作った人・使う旅行のメンバー。直す: 使う全ての旅行を編集できる人。見られなければ 404。B |
| 6 | 電話は確認後に発信(SC-09) | IMPLEMENTED | U |
| 7 | 例外日・祝日・最終入場・ラストオーダー(FC-030) | NOT STARTED | 曜日ごとの営業時間だけ |
| 8 | ジオコードの確認(FC-027)・入口の別地点(FC-028) | NOT STARTED | 入口は文で持つ。地図の提供元が未接続 |

→ INTEGRATED(部分、E2E有)。

## 既存の不具合の修正(IDOR)

- 他の人の検索結果(search_candidates)を ID だけで採用できた → 本人の検索結果だけ(`POST /search/candidates/{id}/adopt`)。B
- 場所を ID を知っていれば誰でも見られた(`GET /search/places/{id}`)→ 見られる人だけ(404)。B
- 他の人の場所を自分の予定に付けられた(`POST /plans/{id}/events` の place_id)→ 見られる場所だけ(404)。B

データの書き出しに plan_candidates を含める(plan_id を持つ全表の検査試験)。
