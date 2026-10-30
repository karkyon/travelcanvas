# Gate GeocodeJP・AdminLayout トレース(旅行相談の地名を日本で照会・管理の画面の余白)

利用者の指摘(2026-10-30): 旅行相談で枚方から伊勢・福井・滋賀が 1900〜2700km・「片道3時間を超える」と出た(実際は 300km 以内)。
管理の画面が上の帯・左の帯に詰まっている。migration なし・API の形の変更なし・FR の状態の遷移なし。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 地名の照会(Nominatim)を日本に絞る(countrycodes=jp)。日本の範囲の外の結果は使わない(not_found) | IMPLEMENTED | `backend/app/services/trip_intent.py`、BE `test_gate_g11_intake.py` |
| 2 | 枚方→伊勢・福井・滋賀は直線で 300km 未満、直線距離の下限(時速100km)で「3時間を超える」と言わない | IMPLEMENTED | BE `test_hirakata_to_ise_fukui_shiga_is_within_three_hours_lower_bound` |
| 3 | 管理の画面(/admin/*)に旅程などと同じ余白 | IMPLEMENTED | `frontend/src/router/guards.tsx`・`styles/shell.css`(.tc-admin-page)、E2E `admin.spec.ts`・`ops-console.spec.ts` |
| 4 | 実の運転時間(道路の提供元) | NOT STARTED | 道路の提供元は未接続(Routes の adapter の後) |
