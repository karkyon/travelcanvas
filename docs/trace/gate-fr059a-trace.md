# Gate FR059-A トレース(外部 API の原価上限・利用者クラス別 quota の正本化)

対象: 資料室の `TravelCanvas_v5.1_仕様追補_旅程API原価上限と利用者クラス別Quota_2026-10-29.md`(追補)と、2026-10-29 の監査
(「50円の上限とクラス別の適用は利用者の明示の要件。再承認を求めない」)。docs だけ(コード・migration なし)。DOC-10 r27。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`(この Gate では文書の状態)。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 追補の決定・数値(1旅行 50円・40円の警告・価格の版と検算 49.55円・クラスの表・feature key・処理の流れ・表・API・運用・セキュリティ・受入条件)を変えずにリポジトリの正本へ移す | IMPLEMENTED | `docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md` §0〜§11 |
| 2 | 追補との差異を全て書く(状態・期間の列・Family の月の枠・支払う人・経路の書き方・Pro の既定・モデル名) | IMPLEMENTED | 同書 §13 D1〜D7 |
| 3 | 資料室の DOC-02/04/05/06/07/09/11/13 との関係(どれが正本か・既存の Cost Guardrail・entitlements・BILL-02 と重ねない) | IMPLEMENTED | 同書 §12、DOC-10 §0.2 |
| 4 | FR-058 の拡張か新しい FR かを根拠つきで決める → **新しい FR-059**(FR-058 は価格・決済の判断待ちで、原価上限は決定済み・有料 provider の前提) | IMPLEMENTED | 同書 §11、`docs/trace/fr-status.json` の FR-058・FR-059 |
| 5 | DOC-10 に FR-059 を SPECIFIED で登録(全59 FR)。実装の無い機能を上げない | IMPLEMENTED | DOC-10 r27(§2・§3・§8・§9)、`test_gate_g1_doc10.py`・`test_gate_g10_quality.py` の数 |
| 6 | クラスの権威はサーバー(entitlement・policy)。`user_type` を quota の根拠にしない | IMPLEMENTED(仕様) | 同書 §4。実装は Gate B |
| 7 | 旅行の予算(FR-027)と外部 API の利用枠を分けて表示する | IMPLEMENTED(仕様) | 同書 §0・§6 |
| 8 | G11 仕様 §9 の段階6 を完了にし、PR #15 の1回目の 429 の失敗と2回目の合格を分けて書く | IMPLEMENTED | `docs/ux/G11_UIUX全範囲_実装仕様.md` §9 |
| 9 | サーバー側の原価の守り(FC-181〜185) | NOT STARTED | Gate FR059-B |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| backend pytest | 1,278 合格・2 飛ばし。1回目は `test_gate_g1_doc10.py` の FR の番号の範囲(1〜58)の2件が失敗 → 範囲を 59 まで直して合格(29 件を再実行) |
| 文書 | DOC-10 r27 の生成部分の一致・V3 再監査 R1〜R8 違反 0・trace の目次・エラーの一覧 |
| frontend・E2E | 変更なし(vitest・tsc・lint・build・bundle は合格) |
