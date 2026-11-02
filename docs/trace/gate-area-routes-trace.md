# Gate AreaRoutes — 比べる方面の片道の時間を道路(Google Routes)で調べる

正本: 利用者の指摘(2026-11-03 07:12)「直線距離だけでは全く参考にならない。Route で計算しろ」。
Gate AreaLogic の候補の選び方は直線距離 × 道路の係数の目安だけで、比較の画面の運転時間は「未照会」だった。

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | 比べる方面(最大 4)の道路の所要時間・道のりをまとめて調べる | IMPLEMENTED | `POST /trip-intents/ai/routes`(Google Routes computeRoutes を方面ごと。1 方面 = 1 区間 routes.element。cost_guard で枠・停止・鍵を 1 区間ずつ判定。途中で枠が尽きたら残りは送らず理由。保存しない・監査は件数だけ) | `test_gate_consult_ai.py`(4 区間・二度課金なし・枠の超過・一部だけ・入力の検証・Free は送らない) |
| 2 | 「高速を使わない」相談は一般道で調べる | IMPLEMENTED | `routeModifiers.avoidHighways` | 同上 |
| 3 | 片道の条件を道路の時間で判定する(直線距離の判定より優先) | IMPLEMENTED | `routeLimit`(✓ 以内 / ⚠ 希望を約 N 分超える / ✕ 絶対条件を超える)。超える方面は地図に置かない | `AreaRoutes.test.tsx`・`Consult.test.tsx`(AreaRoutes) |
| 4 | 押した時だけ送る(有料)・届いたか分からない失敗のやり直しは同じ Idempotency-Key | IMPLEMENTED | 比較の画面の「道路で片道の時間を調べる(N方面)」。使えない理由(クラス・鍵・停止・出発地の位置)を示す | `AreaRoutes.test.tsx` |
| 5 | 表示: 所要時間・道のり・出典(Google Routes)・高速の有無・取得時刻・出発の時刻と渋滞は考えない | IMPLEMENTED | `AreasStep` | 同上 |

**枠**: 料金版 2026-11-02.1 の経路は Trip/Journey/Explorer とも 4 区間 / 相談(1 区間 約 1.14 円)。4 方面を調べると方面の詳細の
「経路を調べる」の枠は残らない。枠を増やすかは所有者の判断(新しい料金版の migration が要る。既存の版は変えない)。
**未確認**: omega-dev2 の Google Routes の鍵(Maps のサーバーの鍵)の確認・実環境の UAT は未実施。
