# Gate GeocodeJP・AdminLayout トレース(旅行相談の地名を日本で照会・管理の画面の余白)

利用者の指摘(2026-10-30): 旅行相談で枚方から伊勢・福井・滋賀が 1900〜2700km・「片道3時間を超える」と出た(実際は 300km 以内)。
管理の画面が上の帯・左の帯に詰まっている。
追加の指摘(同日 22:18): 方面の地図がばらばら・入力欄の人数(1)が文章(家族4人)より黙って優先・方面を選んだのに「行きたい場所がまだ選ばれていません」・観光が「見つかりませんでした」。
migration なし。API は項目の追加だけ(extract の `date_status`、/search/spots の `unavailable_providers`)。FR の状態の遷移なし。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 地名の照会(Nominatim)を日本に絞る(countrycodes=jp)。日本の範囲の外の結果は使わない(not_found) | IMPLEMENTED | `backend/app/services/trip_intent.py`、BE `test_gate_g11_intake.py` |
| 2 | 枚方→伊勢・福井・滋賀は直線で 300km 未満、直線距離の下限(時速100km)で「3時間を超える」と言わない | IMPLEMENTED | BE `test_hirakata_to_ise_fukui_shiga_is_within_three_hours_lower_bound` |
| 3 | 管理の画面(/admin/*)に旅程などと同じ余白 | IMPLEMENTED | `frontend/src/router/guards.tsx`・`styles/shell.css`(.tc-admin-page)、E2E `admin.spec.ts`・`ops-console.spec.ts` |
| 4 | 地図の CSS(leaflet.css)を読む。無いと地図の画像が枠の外へばらばらに並ぶ(方面の比較・旅程の地図) | IMPLEMENTED | `AreaMap.tsx`・`PlanMap.tsx`、E2E `gate-g11-intake.spec.ts`(.leaflet-tile が absolute) |
| 5 | 人数が入力欄と文章で違う時は黙って選ばず、確認の画面で選んでもらう(選ぶまで条件に使わない) | IMPLEMENTED | `trip_intent.py`、BE `test_extract_party_conflict_between_field_and_text_is_asked_not_guessed`、FE `Consult.test.tsx` |
| 6 | 「日付が決まっている」で入れた日付は、決まっている日付として確認の画面へ渡す | IMPLEMENTED | `trip_intents.py`(date_status)、BE `test_extract_fixed_date_from_screen_stays_fixed` |
| 7 | 方面の詳細: 行き先(方面)は決まっていると示し、開いたら観光を自動で探す。立ち寄る場所は任意で、選ばなくても下書きを作れる | IMPLEMENTED | `AreaDetailStep.tsx`、FE `Consult.test.tsx`、E2E `gate-g11-intake.spec.ts` |
| 8 | 近くの検索: 敷地(way・relation)も探す。提供元が応答しない時は「見つからない」と言わない | IMPLEMENTED | `search_provider.py`・`search.py`、BE `test_search_provider.py` |
| 9 | 実の運転時間(道路の提供元) | NOT STARTED | 道路の提供元は未接続(Routes の adapter の後) |
