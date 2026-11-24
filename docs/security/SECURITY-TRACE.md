# DOC-11 セキュリティ・プライバシーの正本と実装・試験・証跡の対応(Gate Hardening-A・監査 G-09)

> 正本: 資料室 `11_セキュリティ_プライバシー_データ保護詳細仕様_v5.1.md`(DOC-11 v5.1・APPROVED FOR IMPLEMENTATION・発効 2026-09-03。
> 所在は `docs/spec/canonical-sources.json`)。本書は DOC-11 の写しではなく、DOC-11 の項目がリポジトリのどこで実装され、
> どの試験で確かめ、本番の証跡が何で、何が無いかを結ぶ索引。基準: main `a2c419d`(2026-11-17)。以後の行(FR-060〜063・§14 の書き出し・削除)は 2026-11-21〜24 に足した。
> 本書が参照するファイルの実在は `backend/tests/test_gate_hardening_trace.py` が CI で確かめる(消す・名前を変えると落ちる)。

**状態の語:** 実装済み=コードと CI の試験がある / 開発で確認=omega-dev2・GCP 開発環境で手順を実施した記録がある /
本番未証明=本番環境が無いため本番の構成・運用の証跡が無い / 未実装=コードが無い。
**この表は「完璧」「本番で十分」を主張しない。** 本番の入口(HTTPS・WAF・外部監視・KMS・別系統のバックアップ・侵入試験)は
DOC-10 §6 のとおり未着手(PROD-01〜09)。

## 1. データ分類(DOC-11 §2・Field Policy 決定表)

| 分類 | 代表の項目 | 保存(実装) | 共有・出力・オフラインの扱い(実装) | 試験 | 状態 |
|---|---|---|---|---|---|
| CONFIDENTIAL | 予約番号・連絡先・名義・メール | 項目の暗号化(`backend/app/core/crypto.py`)と完全一致・末尾の照合用の HMAC(lookup hash) | 共有の項目規則(`backend/app/services/share_policy.py`・`backend/app/services/member_policy.py`) | `backend/tests/test_gate_r3_8_field_encryption.py`・`backend/tests/test_gate_r3_13_lookup_hash.py`・`backend/tests/test_gate_r3_14_suffix_lookup_hash.py`・`backend/tests/test_gate_f45_share_policy.py` | 実装済み・本番未証明 |
| RESTRICTED | QR・PIN・旅券・健康・実位置 | 旅行・利用者ごとのデータ鍵(DEK)を KEK で包む(`backend/app/services/data_keys.py`)。チケットの payload は暗号化 | チケットは共有の既定で非公開、オフラインは端末ごとの鍵(`backend/app/services/offline_keys.py`) | `backend/tests/test_gate_r3_5_tickets.py`・`backend/tests/test_gate_g3_data_keys.py`・`backend/tests/test_gate_k1_offline_keys.py` | 実装済み・本番未証明 |
| 位置 | GPS の点・軌跡 | 既定 OFF・端末内のみ/暗号化して同期/記録しない(`backend/app/services/location_privacy.py`・`backend/app/services/location_tracks.py`) | 守る範囲(privacy zone)と公開時のぼかし | `backend/tests/test_gate_l5_local_first_location.py`・`backend/tests/test_gate_p13_location_tracks.py`・`backend/tests/test_gate_v2_visits.py` | 実装済み・実機未確認 |
| 写真 | EXIF・顔 | 撮影情報の除去(`backend/app/services/image_metadata.py`)。顔の検査は外部の接続口だけ(`backend/app/services/face_check.py`) | 旅行記の公開前の検査 | `backend/tests/test_gate_q1_photo_metadata.py`・`backend/tests/test_gate_p12_memories.py` | 一部(顔の検査は実の提供元で未確認) |

## 2. 認証・認可・共有(DOC-11 §3〜§5)

| DOC-11 | 実装 | 試験 | 状態 |
|---|---|---|---|
| §3 認証(パスワード・MFA・passkey・refresh の回転・全端末の失効・再認証) | `backend/app/core/auth.py`・`backend/app/core/password_policy.py`・`backend/app/services/mfa.py` | `backend/tests/test_gate_s2_auth_hardening.py`・`backend/tests/test_gate_s11_admin_mfa.py`・`backend/tests/test_gate_remaining7_passkeys.py`・`backend/tests/test_sessions.py` | 実装済み。passkey は実機未確認、メールの確認・再設定は SMTP の後に実メールで未確認 |
| §4 認可(role × 項目 × 操作) | `backend/app/core/plan_access.py`・`backend/app/core/route_index.py` | `backend/tests/test_gate_s4_authz_matrix.py`(全ルートの認可の網羅) | 実装済み |
| §5 共有(token の hash・期限・回数・PIN・noindex・no-store) | `backend/app/services/share_view.py`・`backend/app/services/share_policy.py` | `backend/tests/test_gate41_guest_share_view.py`・`backend/tests/test_gate_f45_share_policy.py`・`backend/tests/test_gate_g4_guest_abuse.py` | 実装済み |

## 3. 暗号・鍵(DOC-11 §6)

| 項目 | 実装 | 試験・手順 | 状態 |
|---|---|---|---|
| 項目の暗号化・鍵の版・前の鍵での復号・掛け直し | `backend/app/core/crypto.py`・`backend/app/core/key_inventory.py` | `backend/tests/test_gate_g1_keys.py`・`docs/ops/KEY-INVENTORY.md` | 実装済み。定期の切り替えの演習の記録は無い |
| DEK/KEK・鍵の破棄による削除 | `backend/app/services/data_keys.py` | `backend/tests/test_gate_g3_data_keys.py` | 実装済み。**KEK は .env(KMS・HSM ではない)** |
| KMS・Secret Manager(SEC-F3) | 無い(運用コンソールの鍵はアプリの DB に暗号化して保存) | — | **未実装**(本番環境と同時。DOC-10 §6) |
| 開発の環境の間で同じ鍵を写す例外(2026-11-17 利用者の判断) | `scripts/ops/tc_transfer.py`(本番・ステージングでは止まる) | `backend/tests/test_ops_tc_transfer.py`・`docs/runbooks/gcp-data-transfer.md` §4 | 実装済み(監査 G-10 の制限を Hardening-A で追加)。本番の鍵との分離の確認は本番を作る時 |

## 4. ログ・通知・出力・ファイル(DOC-11 §10〜§13)

| DOC-11 | 実装 | 試験 | 状態 |
|---|---|---|---|
| §11 ログの禁止の項目・マスク | `backend/app/core/log_safety.py` | `backend/tests/test_gate_o2_log_safety.py`・`backend/tests/test_zz_log_leak_scan.py`(試験中の全ログの漏れの検査) | 実装済み。本番のログの DLP の定期の検査は無い |
| §12 通知の本文に秘密を出さない | `backend/app/services/notify.py`・`backend/app/services/web_push.py` | `backend/tests/test_gate_p3_discussion.py`(通知の本文に予約番号を入れない)・`backend/tests/test_gate_tday_push.py` | 実装済み。実機のロック画面は未確認 |
| §13 PDF・公開(noindex・透かし・項目の選択) | `backend/app/services/booklet.py`・`backend/app/services/server_render.py` | `backend/tests/test_gate_p4_booklet.py`・`backend/tests/test_gate_bookletshare.py`・`backend/tests/test_gate_remaining5_server_exports.py` | 実装済み。サーバー側の PDF は画像のページ(文字の検索ができない) |
| §10 ファイル(MIME・容量・ウイルス検査・署名つき URL) | `backend/app/services/malware_scan.py`・`backend/app/services/storage_backend.py` | `backend/tests/test_gate_m7_document_hardening.py`・`backend/tests/test_gate_m5_object_storage.py` | 実装済み。ClamAV の常時運用・本番の Object Storage は本番未証明 |
| §9 AI/OCR(目的別の同意・最小化・出力の検証) | `backend/app/services/consult_ai.py`・`backend/app/services/consult_turn.py`・`backend/app/services/receipt_extract.py`・`backend/app/services/cost_guard.py`・`backend/app/api/v1/discussion.py`(相談の選択肢の案: 名前を送らない・伏せ字・根拠の無い案を捨てる) | `backend/tests/test_gate_consult_ai.py`・`backend/tests/test_gate_f07_turn.py`・`backend/tests/test_gate_receipt.py`・`backend/tests/test_gate_fr059_cost_guard.py`・`backend/tests/test_gate_chat_consensus.py` | 一部。実の AI の送信内容・請求の照合は未実施(FR-059)。prompt injection は SEC-010 の試験 |
| §9 位置(スポットモードの今いる場所。FR-060) | `backend/app/api/v1/spot_areas.py`(周りを探す)・`frontend/src/pages/SpotModePage.tsx`・`frontend/src/pages/today/live/TodaySpotStrip.tsx` | `backend/tests/test_gate_spot_mode.py::test_nearby_filters_by_radius_and_area_without_storing_location`・`frontend/src/pages/SpotModePage.test.tsx` | 実装済み。今いる場所は「周りを探す」を押した時だけ送り、保存・監査に残さない。近づいたかの判定は端末の中だけ(位置の許可が既にある時だけ)。エリアの情報は端末に暗号化して保存(offlineVault)。別行動は集合の約束だけを共有し、位置を受け取らない(`test_split_off_and_rejoin_shares_only_the_promise`)。旅帖の歩いた順に位置を入れない |
| §9 位置(今度行きたい・日帰りの今いる場所。FR-061・FR-062) | `backend/app/api/v1/spots.py`(近くの候補)・`backend/app/services/wishes.py`・`backend/app/services/day_trip.py`・`frontend/src/components/wishes/useNearbyWishReminder.ts`・`frontend/src/pages/spots/wishKindModel.ts` | `backend/tests/test_fr062_quick_wish.py::test_nearby_candidates_rounds_position_and_returns_8_within_300m`(小数 4 桁に丸め・保存しない・ログの捕まえで位置が無い)・`backend/tests/test_fr061_day_trip.py::test_promote_sets_trip_style_and_export_has_routes`(出発地は小数 2 桁で保存・書き出しも丸め)・`frontend/src/components/wishes/useNearbyWishReminder.test.ts`・`frontend/src/pages/SpotListPage.wishKinds.test.tsx`(近い順・知らせは端末の中だけ) | 実装済み。近くの候補は丸めて 1 回だけ送り、保存・ログをしない。近い順・近くに来たら知らせるは端末の中だけ(サーバーへ送らない)。日帰りの出発地は約 1km に丸めた値と地名だけを保存・書き出す |
| §9 好みの傾向・行きたい場所(FR-061・FR-062) | `backend/app/services/preference_profile.py`・`backend/app/services/again_candidates.py`・`backend/app/api/v1/spots.py` | `backend/tests/test_fr061_day_trip.py::test_preference_profile_weights_decay_and_off`・`backend/tests/test_fr062_again.py::test_four_sources_merge_and_only_own_records`(ほかの人の訪問・写真を入れない)・`backend/tests/test_fr062_again.py::test_key_is_signed_and_scoped`(key は署名・改ざんは 422)・`backend/tests/test_fr062_quick_wish.py::test_patch_wish_fields_and_owner_only`(本人だけ) | 実装済み。好みの傾向は保存せず本人の応答だけ(設定で切れる)。行きたい場所は本人だけ。「また行きたい」の候補は本人の記録だけから作る |
| §8 外への送信(Routes の field mask。FR-061) | `backend/app/services/provider_calls.py`(`ROUTES_LINE_FIELD_MASK`・`route_line`)・`backend/app/services/day_trip.py` | `backend/tests/test_fr061_day_trip.py::test_google_request_modifiers_and_toll_parsing`・`backend/tests/test_fr061_day_trip.py::test_route_uses_google_first_then_osrm_then_straight` | 実装済み。決まった送り先・計算の用途だけの field mask。config_hash に入るため、反映の後に管理画面で Google のサーバー用キーの「有効性を確認」をやり直す(利用者の操作)。利用枠(cost_guard)を通す |
| §9 SNS・リール(FR-063) | `backend/app/services/social_draft.py`・`backend/app/api/v1/social.py`・`frontend/src/pages/social/reelRender.ts` | `backend/tests/test_fr063_social.py::test_home_near_names_and_time_are_excluded`(自宅の近く 1km・時刻・人の名前を外す)・`backend/tests/test_fr063_social.py::test_only_allowed_photos_and_own_audio`(許していない写真・ほかの人の声を出さない)・`backend/tests/test_fr063_social.py::test_route_shape_is_normalized_and_home_cut`(形だけ)・`backend/tests/test_fr063_social.py::test_reel_export_record_has_no_photo_ids_and_validation`・`backend/tests/test_fr063_social.py::test_polish_sends_only_text_and_face_boxes_need_key`(AI の利用の同意が無ければ送らない)・`frontend/e2e/social.spec.ts` | 実装済み。動画は端末の Canvas に描いて作るので元の写真の Exif(位置)は入らず、端末だけに置く。音楽は付けない。アプリは投稿しない(SNS の API とつながない)。顔の検査は選んだ時だけ・自分の写真を縮めて送り、枠だけを受け取って端末でぼかす(保存しない)。AI で整えるは押した時だけ・登録した利用者で AI の利用に同意している時だけ・文だけを送る |
| §14 データの書き出し・削除(FR-039。行きたい場所・回数の上限・ファイルの削除の失敗) | `backend/app/api/v1/data_export.py`(本人ごとの回数の上限・429・Retry-After)・`backend/app/services/account_deletion.py`(行きたい場所: 非公開は削除・公開は本人の思いの列だけ消す・リールの記録・保存先のファイルの削除の失敗を数える)・`backend/app/utils/rate_limiter.py`・`frontend/src/services/api/core.ts`(ファイルで受ける要求の失敗の説明) | `backend/tests/test_gate2_account_wish_spots.py::test_wish_spots_are_exported_and_deleted_with_the_account`・`backend/tests/test_gate2_account_wish_spots.py::test_data_export_is_rate_limited_per_user`・`frontend/src/services/api/blobError.test.ts` | 実装済み(2026-11-23〜24)。前段(Tailscale Serve)に回数の制限は無いのでアプリで数える。保存先を走査して残ったファイルを消す仕組みは無い(消えなかった数を監査と運用の記録に出す)。本番未証明 |

## 5. DOC-11 §18 セキュリティ試験(SEC-001〜020)の対応

| SEC | 内容 | 対応する試験(ファイル) | 判定 |
|---|---|---|---|
| SEC-001 | 他の旅行の actor で全 resource を要求 | `backend/tests/test_gate_s4_authz_matrix.py` | 有 |
| SEC-002 | viewer の応答・DOM・cache に秘密が無い | `backend/tests/test_gate_g2_member_policy.py`・`backend/tests/test_gate_f45_share_policy.py` | 有(API。DOM・cache は E2E の一部) |
| SEC-003 | 共有の期限切れ・失効・回数・パスコード | `backend/tests/test_gate41_guest_share_view.py`・`backend/tests/test_share.py` | 有 |
| SEC-004 | URL・Referer・ログに共有の token が無い | `backend/tests/test_zz_log_leak_scan.py`・`backend/tests/test_gate_o2_log_safety.py` | 有 |
| SEC-005 | refresh の再利用で family を失効 | `backend/tests/test_sessions.py`・`backend/tests/test_gate_s2_auth_hardening.py` | 有 |
| SEC-006 | reveal の再認証・役割・回数・監査 | `backend/tests/test_gate_r3_0_reservation.py`・`backend/tests/test_gate_tripkit_security.py` | 有 |
| SEC-007 | QR のオフラインの権限とメンバーの削除 | `backend/tests/test_gate_k1_offline_keys.py`・`backend/tests/test_gate_g6_offline.py` | 有(実機は未確認) |
| SEC-008 | ファイルの MIME の偽装・ウイルス・zip bomb | `backend/tests/test_gate_m7_document_hardening.py` | 有 |
| SEC-009 | URL の SSRF・内部の DNS・転送 | `backend/tests/test_gate_c2_candidates_places.py`(URL の正規化)・`backend/tests/test_gate_remaining6_account.py`(画面の文)・`backend/tests/test_gate_hardening_ssrf.py`(内部・ループバック・リンクローカル・metadata・CGNAT の宛先、混ざった DNS の答え、内部への転送の拒否を、判定を差し替えずに確かめる。Hardening-A で追加) | 有 |
| SEC-010 | prompt injection・道具の濫用 | `backend/tests/test_gate_hardening_prompt_injection.py`(Hardening-B。乗っ取られた AI の答えを直接与えて確かめる: 旅行相談は許した操作・項目の外を捨て、根拠が最新の発言に無い操作・状態に無い ID を捨て、結果は状態を変えない案。予約メールは伏せ字の後の本文に引用が無い値・予約番号/PIN/氏名/電話を AI から受けず、規則の値を上書きしない。レシートはリンクを捨て規則の値を上書きしない)・`backend/tests/test_gate_f07_turn.py` | 有(残り: 根拠の語が発言にあれば関係の薄い操作も案に残る。案は確認が要るので適用はされない) |
| SEC-011 | PDF の描画の外部・内部の取得 | `backend/tests/test_gate_remaining5_server_exports.py`(Pillow で描く。HTML を描かない) | 有(方式で回避) |
| SEC-012 | 役割の失効の後のリアルタイムの配信 | `backend/tests/test_gate_g2_realtime.py`(`test_stream_access_rules_and_limit`: 配信中にメンバーから外すと access_lost を送って閉じる・上限) | 有(2026-11-17 DocsV6-1 で確認し訂正) |
| SEC-013 | 検索の件数・時間から秘密を推測できない | `backend/tests/test_gate_c3_search.py` | 有(件数。時間の差の計測は無い) |
| SEC-014 | 秘匿の制約の集計からの推測 | `backend/tests/test_gate_c1_collaboration.py`(秘匿プロフィールは暗号化し、旅行には充足だけ使う) | **一部**(少人数の集計からの推測を防ぐ閾値の専用の試験は無い) |
| SEC-015 | 鍵の切り替え・古い暗号文・バックアップの復元 | `backend/tests/test_gate_g1_keys.py`・`backend/tests/test_gate_o1_ops.py`・`docs/ops/drills/gate-o1-drill.md` | 有(開発で確認。本番の復元演習は無い) |
| SEC-016 | ログ・エラー・分析の DLP | `backend/tests/test_zz_log_leak_scan.py` | 有(試験の範囲。本番の定期の検査は無い) |
| SEC-017 | 削除の後に索引・保存・cache が残らない | `backend/tests/test_gate_p9_account_deletion.py`・`backend/tests/test_gate_g3_data_keys.py` | 有 |
| SEC-018 | サポートの許可の範囲・期限・監査 | `backend/tests/test_gate_g2_support_access.py` | 有 |
| SEC-019 | オフラインの重複・競合・失効した端末 | `backend/tests/test_gate_p11_sync.py`・`backend/tests/test_gate_k1_offline_keys.py` | 有 |
| SEC-020 | 公開の PDF・HTML の metadata の漏れ | `backend/tests/test_gate_p4_booklet.py`・`backend/tests/test_gate_q1_photo_metadata.py` | 有(画像の撮影情報と公開の規則) |

## 6. 監視・可用性(DOC-11 §19〜§21・DOC-07)と本番のゲート

| 項目 | 今あるもの | 無いもの(本番リリースのゲート) |
|---|---|---|
| 監視 | `docs/ops/RUNBOOK.md`(5 分ごとの監視・状態の変化の通知・5xx/遅延/ディスク/古いバックアップ/ログの漏れ/queue の滞留) | 外部の監視・通知の受け手・SLO と当番・管理画面の提供元の障害の表示(FR-040 ADM-01) |
| 防御 | 回数制限・自動遮断・CSP・セキュリティヘッダー・依存の監査・秘密の検査(CI) | 本番の HTTPS/WAF・外部の侵入試験 |
| 可用性 | 別 DB への復元演習・rollback の手順 | 複数の障害領域・DB/Redis の冗長化・別系統のバックアップ・本番の RTO/RPO の演習 |
| 事故対応 | `backend/app/services/incident.py`・`backend/tests/test_gate_s8_incident.py` | 予約・QR の漏えい時の事業者との連携の手順の演習 |

**判定:** 設計・実装・試験は DOC-11 の大部分に対応している。**本番の構成・運用の証跡(KMS・WAF・外部監視・HA・侵入試験)が
無いため、本番リリースのゲートは未通過。** 総合テストの開始の条件ではない(`docs/audit/2026-11-17_product-hardening-gate_addendum.md` §4)。
