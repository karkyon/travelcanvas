# Gate P13 FR-038 トレーサビリティ表

- 対象: FR-038 任意の位置軌跡(DOC-02)、SC-43、CA-013/014
- Gate: P13(DB・API・UI・E2Eの縦切り)
- 前提: Gate P12適用後
- 関連ADR: `docs/adr/ADR-location-tracks.md`
- migration: `c1e7a9b3d5f2`(revises `b9d5f3a7c1e4`、2テーブル新設のみ)

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_p13_location_tracks.py`(B)、`frontend/src/...`(F)、`frontend/e2e/location-track.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 既定OFF・明示的な開始・同意が必要 | CA-013、P9 | IMPLEMENTED | B `test_start_requires_consent_period_and_defaults`; F `LocationTrackPage.test.tsx`; E |
| 2 | 旅行期間限定(期間外は開始できない・自動停止・期間外の点は保存しない) | FR-038 | IMPLEMENTED | B `test_start_requires_consent_period_and_defaults`, `test_auto_stop_and_consent_withdrawal`, `test_pure_functions` |
| 3 | 精度選択(保存する座標の丸め・取得設定・間引き) | FR-038、CA-014 | IMPLEMENTED | B `test_pure_functions`, `test_synced_points_encrypted_idempotent_and_lifecycle`; F `trackRecorder.test.ts`; E |
| 4 | 即停止・一時停止・再開 | FR-038、DOC-14 §4.4 | IMPLEMENTED | B `test_synced_points_encrypted_idempotent_and_lifecycle`; F; E |
| 5 | 後削除(任意の時間帯・軌跡全体) | FR-038、DOC-14 §4.4 | IMPLEMENTED | B `test_delete_range_track_export_and_account_deletion`; F; E |
| 6 | 端末内のみ(座標を送らない) | CA-013 | IMPLEMENTED | B `test_start_requires_consent_period_and_defaults`; F `LocationTrackPage.test.tsx` |
| 7 | 暗号化保存・再送の冪等性 | DOC-11、CA-013 | IMPLEMENTED | B `test_synced_points_encrypted_idempotent_and_lifecycle`; F `trackRecorder.test.ts` |
| 8 | 同意撤回で止める | DOC-11 §15 | IMPLEMENTED | B `test_auto_stop_and_consent_withdrawal` |
| 9 | 参加者への位置共有と本人の記録の分離(本人以外に見せない) | FR-038 | IMPLEMENTED | B `test_tracks_are_private_to_the_recorder` |
| 10 | 記録中の常時表示 | CA-014、DOC-14 §4.4 | PARTIAL | F; E。画面を開いている間だけ(バックグラウンド記録は未) |
| 11 | 書き出し・アカウント削除 | FR-039 | IMPLEMENTED | B `test_delete_range_track_export_and_account_deletion` |
| 12 | 監査に座標を残さない | DOC-11 | IMPLEMENTED | B `test_synced_points_encrypted_idempotent_and_lifecycle` |
| 13 | API契約(実backend応答のdecoder検証) | DOC-06 | IMPLEMENTED | F `contract.test.ts`(location_* 10種), `p13location.test.ts` |
| 14 | アクセシビリティ(axe) | DOC-04 §7 | IMPLEMENTED | E(開始前・記録中) |
| 15 | 参加者への現在地の共有 | FR-038 | NOT STARTED | ADR §4 |
| 16 | 予定ルートと実績の比較・地図表示・旅行記への利用 | DOC-14 §4.4/4.5 | NOT STARTED | ADR §4 |
| 17 | 端末だけの点の暗号化 | CA-013 | NOT STARTED | ADR §4(鍵管理の決定待ち) |
