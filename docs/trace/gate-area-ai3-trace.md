# Gate AreaAI3 — AI の方面の案を必ず出す・方面の代表的な場所(伊勢神宮など)・方面の写真・日本語の質問・モーダルの余白・始め方の写真・下書きの種類

正本: 利用者の UAT(2026-11-03 20:42 / 20:55、main `c561ff4`)。
「伊勢なのに伊勢神宮がないのはなんでや」。方面が再び「条件から選んだ方面」(内蔵の候補表)になり、AI の質問は英語、
方面の写真は出ず「イメージ」のまま。予定の写真のモーダルに余白が無い。下書き(工程表)に `shrine_temple` など英語の種類名。
始め方の 2 つのカードに利用者が用意した写真を使う。

## 観測した原因

| # | 観測 | 原因 |
|---|---|---|
| 1 | AI の方面の案が出ず、内蔵の候補表で補った | 条件の読み取りと方面の案を 1 回の呼び出しでまとめていた。gpt-5-nano(reasoning minimal)が読み取りを優先し、案を空・目安なしで返す |
| 2 | 鳥羽の詳細に伊勢神宮が無い | 近くの検索は方面の中心から半径 10km・近い順 50 件。伊勢神宮(内宮)は鳥羽駅から約 12km で範囲の外。提案の「代表的な場所」は画面に出すだけで場所に結び付けていなかった |
| 3 | 方面の写真が出ない | 画像の要求が失敗した時に null を画面の保存(sessionStorage)へ残し、以後は取りに行かなかった。題名が一致しない方面(例: あわら温泉)は記事を引けなかった |
| 4 | AI の質問が英語 | 指示に出力の言語を書いていなかった |
| 5 | モーダルの端に文字・ボタンが貼り付く | `Modal` は `Modal.Body` / `Footer` を使った中身にだけ余白があった。写真のモーダルなど 7 画面が素の中身を渡していた |

## 対応

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | 方面の案が足りない時だけ、案だけを頼む 2 回目の呼び出し(条件の要約だけを送る。相談の原文・目的は送らない) | IMPLEMENTED | `consult_ai.propose_areas`・`conditions_text`、`extract` の後段(別の Idempotency-Key) | `test_extract_asks_second_call_for_proposals_only_when_needed`・`test_conditions_text_for_second_proposal_call_has_no_raw_text` |
| 2 | 出力は日本語 | IMPLEMENTED | `INSTRUCTIONS` | 実 AI の UAT |
| 3 | 方面の代表的な場所: 提案の代表的な場所を Wikipedia の記事に結び付ける(無料)。AI が使える時は方面ごとに 1 回おすすめの場所を聞く(AI 1 回。もう一度はボタン) | IMPLEMENTED | `POST /trip-intents/spots/resolve`・`POST /trip-intents/ai/spots`、`spot_resolver.resolve`(題名 → 検索の順・観光でない記事を除く・中心から 40km 以内)。画面は方面の詳細の上に「代表的な場所(おすすめ)」(特色・おすすめの理由・種類・写真・距離・旅程案に入れる) | `test_spot_resolver_uses_titles_then_search_and_drops_far_or_non_tourist`・`test_spots_resolve_is_free_and_returns_candidates`・`test_ai_spots_needs_consent_and_uses_one_ai_call`・`PlaceSearchPanel.test.tsx`(AreaSpots) |
| 4 | 近くの検索の並べ方: おすすめ順(希望 → 人気=記事の大きさ → 近さ)/近い順 | IMPLEMENTED | `PlaceSearchPanel`、応答に `popularity` | `PlaceSearchPanel.test.tsx`(AreaSpots) |
| 5 | 方面の写真: 失敗は保存しない(次に取り直す)・題名が無い時は検索で探す・画面の保存の名前を変えて古い null を捨てる | IMPLEMENTED | `area_images.lookup`、`areaPhotos` | `test_area_images_*` |
| 6 | モーダルの余白: `Modal.Body` を使わない中身にも余白 | IMPLEMENTED | `Modal`(`usesSections`) | `Modal.test.tsx` |
| 7 | 始め方の 2 つのカードの写真(利用者提供) | IMPLEMENTED | `public/start/quick-plan.webp`・`trip-consult.webp` | 目視の UAT |
| 8 | 下書き(工程表)の種類を日本語のバッジと絵で出す | IMPLEMENTED | `TripDraftPage` | `Consult.test.tsx`(DraftLook) |

**原価**: 2 回目の呼び出しは方面の案が足りない時だけ(出力の枠はクラスの上限の内、約 0.3 円以下)。おすすめの場所は方面ごとに AI 1 回
(自動は 1 回だけ)。結び付け・写真は Wikipedia・無料。
**未確認**: 実 AI(gpt-5-nano)が 2 回目で方面の案を返すか、代表的な場所に伊勢神宮を挙げるか、写真の当たり外れは omega-dev2 の UAT で確かめる。
**次の段階**: 旅程の画面(日別の予定・場所の詳細)をモックアップ(DOC04-A)の構成に寄せる(予定の種類の絵・場所の写真・移動の区間)。
予定に場所の写真を持たせるため、データの持ち方から設計する。
