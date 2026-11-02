# Gate AreaAI — 旅行相談の方面は AI が条件から選ぶ(片道の目安つき・追加の費用なし)

正本: 利用者の指摘(2026-11-03 07:44)。ChatGPT に「片道高速を使用して3時間の道のり、出発地点を大阪の枚方からとした場合の観光地の
候補を4つ挙げて」と聞けば、伊勢・淡路島・福井市・南紀白浜が片道の目安と見どころつきで返る。旅行相談でも AI の 1 回の読み取りで
4 方面が決まるべきで、方面ごとに Google Routes(1 区間 約 1.14 円)で調べる設計(PR #51 Gate AreaRoutes)は不要。
**PR #51 は統合しない**(方面の詳細の「経路を調べる」は利用者が押した時だけの既存の操作として残す)。

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | AI の読み取りと同じ 1 回の要求で、条件(出発地・移動の手段・片道の上限・地域・過ごし方・人数・泊数)に合う具体的な行き先を頼まれた件数(既定 4)出す | IMPLEMENTED | `consult_ai.INSTRUCTIONS`・schema `areas_suggested`(name・prefecture・reason・highlights・drive_minutes_min/max)。出力の枠 2,000 token(クラスの上限と同じ。1 回の最大の原価は変わらない 約 0.30 円) | `test_gate_area_geo.py::test_ai_proposals_with_estimates_become_the_compared_areas` |
| 2 | AI の案をサーバーで確かめる(送らない) | IMPLEMENTED | 地方・地域の語・出発地・移動の語は捨てる。「福井市・越前方面」→「福井市」。地域の範囲の外は捨てる。片道の目安の下限が上限の 1.15 倍を超える案・直線距離だけで上限を明らかに超える案は捨てる。直線距離と目安が合わない(時速 110km 超)目安は使わない | 同上(札幌・東海・高山を外す、金沢の 30 分の目安は使わない) |
| 3 | 行き先が無い・候補を頼まれた時は、AI の案(目安つき)を比べる方面にする。足りない分だけ内蔵の候補表で補う | IMPLEMENTED | `consult_ai.merge` | 同上・`test_ai_proposals_named_places_are_kept_and_count_is_respected` |
| 4 | 比較の画面: 片道の目安(AI の目安・休憩と渋滞は含まない)で条件を判定(✓ 以内 / △ 前後 / ⚠ 超えそう)。超えそうな方面は地図に置かない | IMPLEMENTED | `estimateLimit`・`minutesRange`・`AreasStep` | `Consult.test.tsx`(AreaAI) |
| 5 | 同じ名前の別の場所を避ける | IMPLEMENTED | AI の案の都道府県を `area_prefs` で送り、表の地名が別の県なら使わず「地名 都道府県」で照会 | `test_compare_uses_prefecture_hint_for_same_name_places` |
| 6 | 「他にも候補を2つ」の「他に」等を方面にしない | IMPLEMENTED | `is_not_place`(数・ひらがなだけ・他/ほか/あと) | 同上 |

**原価**: 方面の提案は AI の読み取りの 1 回(Journey の AI 10 回の 1 回)に含まれ、道路の提供元(有料)へは送らない。
**限界**: 片道の目安は AI(gpt-5-nano)の推定で、道路の提供元の照会ではない(サーバーは明らかな誤りだけを外す)。
実 AI での品質(目安の精度・地域の偏り)は omega-dev2 の UAT で確かめる(未実施)。gpt-5-nano は 2026-12-11 に停止予定。
