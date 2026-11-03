# Gate AreaAI2 — 方面の選んだ理由・代表画像・入力の欄・地図の選択・方面の詳細の場所の種類と絞り込み

正本: 利用者の UAT(2026-11-03 09:07、main `83c3406`)。相談文「…関西圏や四国、大阪寄りの東海や北陸などまで…候補は4エリアぐらいに
絞り込んでくれ」。ChatGPT の回答(伊勢・淡路島・福井・南紀白浜。片道の目安・観光の場所・特色)と比べて、選んだ理由が分からない・
未照会ばかり、と指摘。

## 観測した原因

| # | 観測 | 原因 |
|---|---|---|
| 1 | 方面が「条件から選んだ方面」(内蔵の候補表・直線距離の目安)になり、AI の案(和倉温泉・淡路島のうずしお・白浜温泉)は目安なしで別の欄 | 指示の先頭の「書かれていないことは null・推測で埋めない」が AI の案の所要時間にも効き、gpt-5-nano が目安を null で返した → 目安の無い案は比べる方面にしない決まりで、候補表で補った |
| 2 | 選んだ理由が短い一言だけ | schema に特色・代表的な場所・注意が無かった |
| 3 | 方面の詳細の「見つかった場所 30件」に鳥羽市・鳥羽町・商工会議所・図書館・信号場など | Wikipedia の位置つきの記事を、駅・学校などの一部の語だけで除いていた。種類が無く、何の場所か分からない。希望(過ごし方)を使っていない |

## 対応

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | AI の案は「相談員としての提案」として目安・見どころを必ず入れる(条件の読み取りの「推測しない」と分ける) | IMPLEMENTED | `consult_ai.INSTRUCTIONS` | `test_ai_area_details_are_kept_and_cleaned` |
| 2 | 選んだ理由: 特色・代表的な場所 3 つ(名前・種類・特色)・希望に合う理由・注意(渋滞など)・片道の目安 | IMPLEMENTED | schema `areas_suggested.summary/spots/caution`、サーバーで長さ・種類を確かめる。画面 `AreaInsight`(確認の画面・方面の比較) | 同上・`Consult.test.tsx`(AreaAI) |
| 3 | 方面の代表画像(無料) | IMPLEMENTED | `GET /trip-intents/area-images`(Wikipedia の記事の代表画像・自由なライセンスの画像だけ・転送先を辿る・24 時間メモリ)。画面は写真と「写真: Wikipedia」(記事へのリンク)、無い時は色の帯。CSP img-src に upload.wikimedia.org | `test_area_images_*`・`Consult.test.tsx` |
| 4 | 相談の入力の欄: キーボード(鉛筆)と音声(声の大きさの棒のアニメーション)を背景で区別 | IMPLEMENTED | `tc-input-mode`。音声は録音中だけマイクの音を端末の中で測る(保存・送信なし)。測れない時は飾りの棒。動きを減らす設定では止める | `ConsultInputs.test.tsx`・`Consult.test.tsx`(InputMode) |
| 5 | 方面の比較の地図: 選んだ方面を目立たせる | IMPLEMENTED | 大きな印・波紋のアニメーション・「選択中: 名前」の常時表示・実線の太い線・他の印は小さく薄く・画面の外なら寄せる | (地図は試験では置き換え。目視の UAT) |
| 6 | 方面の詳細の場所: 種類(神社・寺/城・史跡/博物館/自然/公園/温泉/テーマパーク/町並み/食事/カフェ/買い物/宿泊)・観光でない記事の除外・代表画像・説明 | IMPLEMENTED | `place_kinds.py`、Wikipedia は generator=geosearch で画像と説明を 1 回の要求で取る。応答に `kind`・`thumbnail_url`・`description` | `test_place_kinds_classify_wikipedia_and_osm`・`test_sightseeing_uses_wikipedia_geosearch_when_overpass_times_out`・`test_spot_dict_has_kind_thumbnail_and_description` |
| 7 | 希望(過ごし方)の反映・絞り込み | IMPLEMENTED | 希望に合う種類を先に(静かな希望ではテーマパークを後に)・「希望に合う: 歴史・文化」のバッジ・種類のチップで絞り込み・「希望に合う種類だけ」・「この候補の探し方」の説明 | `PlaceSearchPanel.test.tsx`(PlaceKinds) |

**原価**: 追加の有料の要求は無い(AI は同じ 1 回・出力の枠はクラスの上限 2,000 token の内。画像・場所は Wikipedia・無料)。
**未確認**: 実 AI(gpt-5-nano)が目安・代表的な場所を埋めるか、出力が 2,000 token に収まるか、写真の当たり外れ(記事の代表画像が方面の
イメージに合うか)は omega-dev2 の UAT で確かめる。
