# Gate G6 トレース(機能: オフライン・位置・記録)

対象: 監査の実行台帳(2026-10-20、`main@af7de3d`)のうち、外部の判断・契約なしで進められる項目 —
OFF-01・OFF-02・LOC-02・MEM-01。migration 1つ(`d7f1b5c9e2a6`、Alembic head `d7f1b5c9e2a6`)。
FR の状態の遷移: FR-048 を VERIFIED(Offline Travel Pack)。FR-033 は VERIFIED のまま残りの不足(予定以外のオフラインの編集)を解消した。
FR-051 は(部分)を外した(共有・公開での出発・帰着の地点のぼかし)。FR-037 は顔の検査・MEMORY MAP(外部の提供元)が残るため(部分)のまま。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: OF = `backend/tests/test_gate_g6_offline.py`、
LM = `test_gate_g6_location_memory.py`、E2E = `frontend/e2e/gate-g6.spec.ts`。

## OFF-01 端末ごとのオフラインの鍵(FR-048)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 鍵を端末ごとに導出する(利用者・版・端末の ID。鍵そのものは保存しない) | IMPLEMENTED | `app/services/offline_keys.derive_device_key`、`offline_devices`、OF `test_device_keys_are_separate_and_revocable` |
| 2 | 鍵の期限(既定30日)。期限を過ぎた端末の鍵は、通信して受け取り直すまで使わない | IMPLEMENTED | 応答の `expires_at`、`frontend/src/utils/offlineVault.ts` の `storedKeyFor`、`offlinePack.test.ts` |
| 3 | 1台だけの失効(他の端末はそのまま)。失効した端末は次の通信で 410 を受け取り、保存したデータと鍵を消す | IMPLEMENTED | POST `/offline-pack/devices/{id}/revoke`、410 `offline_device_revoked`、OF・`offlinePack.test.ts`・E2E |
| 4 | 端末の一覧(名前はブラウザと OS の種類だけ。本人の端末だけ) | IMPLEMENTED | GET `/offline-pack/devices`、データとプライバシーの「オフラインで使う端末」、OF `test_device_label_keeps_only_families`・`test_devices_are_own_only` |
| 5 | 端末の数の上限(10台。失効した端末は数えない) | IMPLEMENTED | 409 `too_many_offline_devices`、OF `test_device_limit` |
| 6 | 以前の利用者ごとの鍵の互換(古い画面)と、端末の鍵へ移る時の古いデータの消去 | IMPLEMENTED | `device_id` の無い要求は以前の鍵、`purgeRevoked`、`offlinePack.test.ts` |
| 7 | 端末の ID をログアウト・localStorage の消去の後も保つ(同じ端末として受け取り直す) | IMPLEMENTED | IndexedDB の `meta/device_id`、`offlineDeviceId`、E2E `offline-pack.spec.ts`(再ログイン) |
| 8 | 通信しない端末の遠隔の消去 | PARTIAL | 原理的に次の通信まで消せない。鍵の期限(30日)の後は開けない |

## OFF-02 予定以外のオフラインの編集(FR-033)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 9 | 日程の作成・変更・削除(同じ日付は既存の日程を使う。予定のある日程は削除しない) | IMPLEMENTED | `sync_operations.entity_type='day'`、OF `test_day_create_merges_existing_date_and_update_conflict`・`test_day_delete_only_when_empty_and_viewer_cannot_sync`、E2E |
| 10 | 日程の中の予定の並び(サーバーの予定の集まりと違えば競合。確定した予定は動かさない) | IMPLEMENTED | `entity_type='order'`・`action='reorder'`、OF `test_order_conflict_when_server_added_event_and_locked` |
| 11 | 依存の順(端末で作った日程へ予定を足す・その並び。送る順が違っても正しく適用する) | IMPLEMENTED | `app/services/sync.dependency_order`、OF `test_dependency_order_unit`・`test_offline_day_event_and_order_in_one_batch_out_of_order` |
| 12 | 予約(予約番号・チケット等の機密)はオフラインで変えない(常にオンラインの本人確認の後) | IMPLEMENTED | `entity_type='reservation'` は `online_required` で断る、OF |
| 13 | 競合の画面で日程・並びを比べる(並びは予定名で示す) | IMPLEMENTED | `frontend/src/pages/sync/syncModel.ts`、`SyncConflictsPage.test.tsx`(実 backend の応答) |

## LOC-02 位置のぼかし(FR-051)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 14 | 守る範囲(自宅・職場など。中心と半径 100〜5000m、10件まで。中心は利用者のデータ鍵で暗号化) | IMPLEMENTED | `privacy_zones`、`/privacy-zones`、LM `test_privacy_zone_api_is_encrypted_and_own_only`、E2E |
| 15 | 書き出し(GPX・KML)から守る範囲の中の地点を外す(旅行の所有者と書き出す本人の範囲の両方) | IMPLEMENTED | `itinerary_export.waypoints(zones=…)`、LM `test_gpx_export_drops_points_in_owner_zones` |
| 16 | 軌跡の両端の切り落とし(300m)・約1kmの格子・格子の点が範囲に入れば出さない | IMPLEMENTED | `app/services/location_privacy.project_track`、LM `test_zones_and_track_projection` |
| 17 | 読めない範囲は「無い」でなく全ての位置を出さない側に倒す | IMPLEMENTED | `zones_for` → `(0, 0, -1)`、LM |

## MEM-01 旅行記の公開・記録の削除の取り消し(FR-037)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 18 | 公開の前の確認(公開する内容そのもの・確認の項目。全て確かめた時だけ公開) | IMPLEMENTED | POST `/memories/publications/preview`、422 `acknowledgement_required`、LM・E2E |
| 19 | 公開するのは本人の記録だけ。座標・音声・他のメンバーの記録は含めない。場所は「出さない」か「地名だけ」(守る範囲の中の地名は出さない) | IMPLEMENTED | `memory_publish._build`、LM `test_publish_requires_acknowledgement_and_hides_coordinates`、E2E |
| 20 | 公開の URL は推測できない値で、サーバーには照合用のハッシュだけを残す。作った時だけ示す | IMPLEMENTED | `memory_publications.token_hash`、LM |
| 21 | 公開の閲覧(資格情報なし・検索エンジンに載せない・保存させない・回数の制限)と写真(撮影情報を消す) | IMPLEMENTED | `/public/journal/{token}`(`X-Robots-Tag`・`no-store`)、画面 `/journal/:token`、LM・E2E |
| 22 | 公開の失効(すぐに開けない)・閲覧の回数・会員だけが公開できる | IMPLEMENTED | DELETE `/memories/publications/{id}`、403 `members_only`、LM `test_publish_none_location_and_guest_cannot_publish`・E2E |
| 23 | 記録の削除を7日間は元に戻せる(本文は暗号化して保管。期限の後は定期の処理がファイルごと消す) | IMPLEMENTED | `memory_trash`、POST `/memories/{id}/restore`、`tcops.py jobs memory-trash`、LM `test_memory_delete_can_be_restored_then_purged`・E2E |
| 24 | 顔の検査・MEMORY MAP | NOT STARTED | 画像認識・地図の提供元(契約の判断待ち)。公開の前の確認で「写真に人が写っていないか」を確かめる |

## 横断

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 25 | migration の往復(downgrade は足した表を消し、新しい対象の同期の記録を消してから制約を戻す) | IMPLEMENTED | `d7f1b5c9e2a6` |
| 26 | 書き出し・アカウントの削除・旅行の削除に新しい表を含める | IMPLEMENTED | `data_export.PLAN_TABLES`(公開・保管)、本人の守る範囲・端末、`account_deletion`、`plan_deletion` の保管のファイル |
| 27 | 応答の形の検査(実 backend の応答) | IMPLEMENTED | `frontend/src/services/api/__fixtures__/g6Responses.json`、`g6.test.ts` |
| 28 | 最初に読む JS を増やさない | IMPLEMENTED | API は `frontend/src/services/api/g6.ts`、画面は後から読む塊(bundle-budget) |
| 29 | 型の検査(新しい誤りを足さない) | IMPLEMENTED | `backend/mypy-baseline.txt`(1,390 件。基準より減った) |
| 30 | 試験の偶然の失敗を除く(「金額が監査に出ない」の確かめで、乱数の ID・時刻が同じ数字を含むと落ちた。予行で1回) | IMPLEMENTED | `backend/tests/_scrub.py`(ID・時刻を伏せてから確かめる。P1・P2・G2 の試験) |
