# Gate L5 Local-first Location・適応型GPS記録 トレーサビリティ表

- 対象: FR-055(DOC-15 CA-013)、FR-056(CA-014)。FR-038・FR-052 の拡張
- Gate: L5(migration `f2a6c8e4b1d7`: 新しい表2つ・列1つ・検査制約の作り直し)
- 前提: Gate S11 `865f06a` 適用後
- 関連ADR: `docs/adr/ADR-local-first-location.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は B = `backend/tests/test_gate_l5_local_first_location.py`、
U = `frontend/src/utils/adaptiveSampler.test.ts`・`areaCells.test.ts`・`src/services/api/l5location.test.ts`・
`src/pages/LocationTrackPage.test.tsx`・`src/components/location/RecordingIndicator.test.tsx`、
E = `frontend/e2e/location-local-first.spec.ts`・`location-track.spec.ts`。

| # | 要件(CA) | 状態 | 証拠 |
|---|---|---|---|
| 1 | 初期値は OFF(選ぶまで記録しない)| IMPLEMENTED | B `test_trip_mode_controls_recording`、U、E |
| 2 | 端末内のみ/暗号化同期/記録しないを旅行単位で選ぶ(013)| IMPLEMENTED | B 同上・`test_first_start_records_the_choice`、U、E |
| 3 | 端末内のみでは生GPSを送らない(013)| IMPLEMENTED | P13 の試験(device_only は 409)、U |
| 4 | 集計済み訪問地域だけを同期する選択肢(013)| IMPLEMENTED | B `test_areas_only_accepts_cells_not_points`、U `areaCells`、E(要求の本文に座標が無い)|
| 5 | 区画の検査(格子・期間・滞在時間)、送り直しで増えない | IMPLEMENTED | B `test_pure_cells_and_sampling`、`test_cells_require_areas_only_and_period_and_consent` |
| 6 | 区画を Atlas に滞在時間で載せる・本人以外に見せない | IMPLEMENTED | B `test_areas_only_accepts_cells_not_points`、E |
| 7 | 書き出し・時間帯の削除・軌跡の削除・アカウント削除で扱う | IMPLEMENTED | B 同上、`account_deletion.py` |
| 8 | AI入力から正確な位置を除外(013)| NOT STARTED | AI 未使用(対象なし) |
| 9 | 速度・停止・電池・精度で取得頻度を変える(014)| IMPLEMENTED | U `adaptiveSampler`(段階の判定・間引き)、`LocationTrackPage`(省電力で間隔の取得へ切替)、E |
| 10 | geofence・significant-location-change・写真EXIF(014)| NOT STARTED | ブラウザに無い / EXIF は別 Gate ※ **SUPERSEDED BY Gate Q1(写真の撮影情報の除去は実装。geofence 等はブラウザに無いため残り)** |
| 11 | 手動記録(014)| IMPLEMENTED | U、E |
| 12 | 記録中をアプリ内で常時明示(014)| IMPLEMENTED | U `RecordingIndicator`、E |
| 13 | 低電力モード・一時停止・旅行終了時の自動停止(014)| IMPLEMENTED | U・E(省電力)、P13(一時停止・自動停止) |
| 14 | 電池の消費量と欠測率を観測(014)| IMPLEMENTED | B `test_sampling_report`、U `SamplingStats`・観測値の再開、E |
| 15 | バックグラウンドでの記録 | NOT STARTED | ブラウザの制約(ADR の限界) |

## r2(CI の E2E の揺れへの対処)

- 1回目(a3ed29e)は omega では全試験に合格したが、GitHub の CI の e2e が不合格。同じ時間帯に L5 を含まない 865f06a の
  main の CI も e2e が不合格(その10分前の gate/s11 では合格)で、L5 の変更とは別の揺れと判断した。サンドボックスで
  ブラウザ・backend を UTC にして全45本を2回流しても再現しない。CI のログは開発環境から取得できなかった。
- 対処: CI の実行環境を `ubuntu-24.04` に固定(`ubuntu-latest` は 2026-10-19 から Ubuntu 26 へ順次移る)。Playwright の失敗を
  GitHub の注記に出す(`github` の reporter)。`ci_gate.py` は不合格の時に注記とログの要点を表示し、e2e だけの不合格は1回だけ
  再実行して、合格なら「不安定」と表示する(試験 `test_gate_s11_ci_gate.py` に4本)。

