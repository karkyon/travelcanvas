# FC-001〜100 の残り 81 件の照合(2026-11-20。main `1aeab35` 時点)

> `2026-11-19_fc_code_verification.md`(19 件)の続き。**要求の文(DOC-02 v6.0 §9)と、それを確かめている試験の名前・コード**を
> 突き合わせた。番号の言及の集計は証拠にしていない。判定は「コードと試験を読んだ範囲」のもので、実機・実 API・実旅行の確認ではない。
> 要件の削除・統合・状態の変更はしていない。
>
> 判定: **実装あり**=要求の中心を試験が確かめている / **一部**=一部だけ、または試験が要求の一部だけ / **未実装**=要求の中心のコードが無い /
> **要確認**=コードはあるが、要求の通りかを試験で確かめられていない。根拠の試験は代表 1〜2 件(`tests/` は backend、`.test.ts(x)` は frontend)。

## 1. 照合の結果

| FC | 名前 | 判定 | 根拠(試験・コード) | 足りないもの |
|---|---|---|---|---|
| FC-001 | ゲスト回復 | 一部 | `test_gate35_guest.py::test_guest_upgrade_preserves_plan_ownership`・ゲストの統合(`guest_merge.py`) | 別端末へ移す回復の手段(回復情報だけで乗っ取れないこと)の試験 |
| FC-002 | メール確認 | 実装あり | `test_gate_remaining6_account.py::test_email_verify_flow`・`test_verify_token_dies_when_email_changes` | — |
| FC-003 | パスワード変更 | 実装あり | `test_gate_s2_auth_hardening.py::test_change_password_enforces_policy_and_requires_a_new_value`・`test_sessions.py::test_password_change_revokes_other_sessions_but_keeps_current` | 他の端末を失効させるかの「選択」(現状は常に失効) |
| FC-004 | アカウントロック | 実装あり | `test_gate_s6_threat_guard.py::test_score_reaches_warning_then_block`・`test_repeat_offender_gets_longer_block`・ログインの通知(S9) | — |
| FC-005 | 所有者移譲 | 実装あり | `test_gate_g8_ownership_corrections.py::test_transfer_request_accept_and_roles` | — |
| FC-006 | 旅行複製 | 実装あり | `test_gate_g4_guest_abuse.py::test_clone_copies_only_allowed_fields`・`test_gate39_plan_clone.py` | — |
| FC-008 | ゴミ箱 | 実装あり | `test_gate_b012_plan_deletion.py`(猶予・完全削除・猶予内は消さない) | — |
| FC-009 | 未定時刻イベント | 一部 | 時間帯(`test_gate_l4_optimization.py::test_classify_and_time_slots`)・終了未定の検証(`feasibility.py` STAY_LENGTH_UNKNOWN) | 「日付だけ」「完全未定」の区別と最適化の対象の条件 |
| FC-011 | 繰返し | 未実装 | カレンダーの取り込みは RRULE を展開せず取り込まない(`calendar_import.py:4,137`) | 毎朝の朝食などの繰り返しの予定・系列の変更 |
| FC-013 | Undo/Redo | 実装あり | `test_gate_g4_decisions_comments.py::test_adoption_undo_refused_after_later_change`・`test_gate_plan_spot_edit.py`(変更セットで戻す・後の変更があれば断る) | Redo |
| FC-015 | 日付ジャンプ | 一部 | `DateNavigation.test.tsx`(現在日の追従・再スクロールしない) | 「未定へ」の移動 |
| FC-016 | タイムゾーン | 実装あり | `test_gate2_day_timezone.py`・`test_gate_l1b_today_timezone.py::test_dst_transition_day_uses_correct_offset`・`PlannerG11` の現地時刻 | 曖昧な DST の時刻の確認の画面 |
| FC-019 | URL取込 | 実装あり | `test_gate_hardening_ssrf.py`(内部アドレス・スキーム・名前解決)・`test_gate_wish_places.py`(ページの構造化データ) | — |
| FC-020 | 画像検索 | 一部 | `test_gate_mymaps_photomap.py::test_device_location_is_confirmed_and_exif_not_stored`・予約の画像の OCR(`test_gate_booking_import.py`) | ランドマークの認識 |
| FC-021 | 音声検索 | 一部 | `ConsultInputs.test.tsx`(録音→停止→文字起こしを直してから追加。自動では送らない) | 録音の同意・保持期間の表示の試験 |
| FC-022 | 自然文追加 | 実装あり | コマンド「予定を追加 11/3 10:00 清水寺」の解析と確認(`test_gate_g4_commands.py::test_parse_commands`・`test_preview_is_read_only_and_execute_is_idempotent`) | 「明日」などの相対の表現 |
| FC-023 | 重複候補 | 実装あり | `CandidatesPage.test.tsx`(重複の理由を出し、まとめる)・`e2e/candidates.spec.ts`・`candidates.duplicate_reasons` | — |
| FC-024 | お気に入り | 実装あり | `test_gate_wish_places.py`・`test_gate_spot_info.py::test_wish_spot_extras_create_update` | 削除時の参照の維持の試験 |
| FC-027 | ジオコード確認 | 未実装 | 住所→位置の検索はある(`test_gate_g11_intake.py::test_nominatim_geocode_maps_statuses`)が、住所と地図のピンが離れている時に確定を求める処理は見当たらない | 距離の判定と確認 |
| FC-028 | 入口管理 | 一部 | `test_gate_g4_places.py::test_special_hours_entrances_day_hours_api`・場所の `entrance_note` | 入口を場所と別の行で持つ(現状はメモ) |
| FC-029 | 集合地点 | 一部 | スポットモードの別行動の集合(FR-060、`test_gate_spot_mode.py`) | 写真・目印・屋内の説明 |
| FC-030 | 営業時間 | 実装あり | `test_gate_g4_places.py::test_feasibility_split_hours_last_entry_last_order_and_special`・`test_gate_remaining2_external.py::test_japan_holidays_2026` | — |
| FC-031 | 価格情報 | 一部 | 場所の `price_range`(`models.py`) | 年齢区分・税・変動価格・取得日 |
| FC-032 | アクセシビリティ | 一部 | 場所の `accessibility_note`・経路の点数(`test_gate_m3_route_options.py::test_accessibility_score_out_of_range_rejected`) | 項目ごとの情報と出典 |
| FC-034 | 地図共有 | 実装あり | `test_share.py::test_public_resolve_redacts_sensitive_itinerary_fields`・`test_gate_mymaps_photomap.py::test_mymaps_kml_has_numbers_times_colors_and_no_secrets` | — |
| FC-035 | 宿泊予約 | 一部 | `test_gate_booking_import.py::test_rules_read_japanese_hotel_mail`・`test_real_stay_mail_reads_every_field` | 部屋・朝食・デポジットの専用の項目 |
| FC-036 | 航空予約 | 一部 | `test_gate_booking_import.py::test_rules_read_english_flight` | ターミナル・座席・手荷物・運航状態 |
| FC-037 | 鉄道予約 | 一部 | 取り込みの列車・座席(`reservation_extract.py:212,229`)・移動区間の列車番号・番線 | 乗車券と特急券の関係 |
| FC-039 | 体験予約 | 一部 | 種類 `activity` と共通の項目 | 集合・受付・年齢・装備・免責・言語 |
| FC-041 | 取消・変更 | 未実装 | 予約メールの取り込みはある(`test_gate_booking_import.py`)が、更新・取消のメールを元の予約の履歴へまとめる処理は見当たらない | — |
| FC-043 | QR表示 | 実装あり | `test_gate_r3_5_tickets.py`(伏せた保存・本人だけの表示・監査)・`TicketFullscreen` | 「使用済」の状態の試験 |
| FC-044 | Wallet出力 | 未実装(将来要件) | 前回の照合と同じ | — |
| FC-045 | 文書差替 | 未実装 | 文書の保存・厳重管理はある(`test_gate_m7_document_hardening.py`)が、原本の版の管理は見当たらない | 版と抽出値の由来 |
| FC-046 | 旅券・ビザ | 一部 | 厳重管理の文書は本人だけ・共有既定除外(`test_restricted_document_hidden_from_non_owner_editor`・`test_gate_f45_share_policy.py::test_default_link_shows_internal_only_and_never_restricted`) | 期限の通知・AI 既定禁止の試験 |
| FC-047 | 保険・緊急 | 一部 | 文書として保存でき、圏外パックに入る | 証券番号・連絡先をまとめて出す画面 |
| FC-048 | 領収書 | 実装あり | `test_gate_receipt.py`・`test_gate_p2_finance.py::test_related_and_receipt_validation` | — |
| FC-049 | 複合交通 | 実装あり | 経路の leg(`test_plan_map.py::test_route_preview_computes_legs_between_known_coordinates`・`test_gate_road_route.py`) | — |
| FC-051 | 最終交通 | 一部 | 最終入場・ラストオーダーの検証(`test_gate_g4_places.py::test_feasibility_split_hours_last_entry_last_order_and_special`) | 終電・門限 |
| FC-052 | 駐車・給油 | 一部 | 飲食の駐車場の情報(`dining.test.tsx`) | 車の旅行の満空・料金・高さ・燃料・充電 |
| FC-053 | 荷物 | 一部 | 移動区間の `luggage_note` | ロッカー・預入をイベントにする |
| FC-054 | 休憩・食事間隔 | 実装あり | 移動の規則(連続の上限・休憩、子ども・高齢で下げる。`movement.py`、`test_gate_g7_movement.py`) | — |
| FC-055 | 予算上限 | 実装あり | `test_gate_p2_finance.py::test_budgets_and_private_member_budget`・`p2finance.test.ts`(他人の個人予算が返らない) | — |
| FC-056 | 営業時間違反 | 実装あり | `test_gate_l3_validation.py::test_opening_hours_closed_day_outside_hours_overnight_and_unknown`・`test_opening_hours_from_database` | 出典の鮮度での判定の試験 |
| FC-058 | 最適化再現 | 一部 | `algorithm_version`(`optimizer.py:28`)・入力の fingerprint(`test_gate_l4_optimization.py::test_fixed_events_stay_and_stale_fingerprint`) | seed・係数の保存と再現の試験 |
| FC-059 | 部分最適化 | 実装あり | `test_gate_l4_optimization.py::test_fixed_events_stay_and_stale_fingerprint`(固定の予定は動かさない) | — |
| FC-060 | 公平性 | 要確認 | 最適化の重みに「公平さ」がある(`optimizer.py:259-261`) | 最小満足度・交代の指標を確かめる試験 |
| FC-062 | リンク閲覧 | 実装あり | `test_share.py`(期限・回数・パスコード・失効・アクセス記録)・`test_gate41_guest_share_view.py`・`test_gate_p4_booklet.py::test_public_share_is_noindex` | — |
| FC-063 | 編集競合 | 実装あり | If-Match と revision(`test_gate_r3_0_reservation.py::test_update_requires_if_match_and_bumps_revision`)・項目ごとの差分(e2e `gate-g11-layout` の編集の競合) | — |
| FC-064 | 既読確認 | 未実装 | 閲覧の確認(重大な変更・集合の変更)を持つ処理は見当たらない(公開前の確認 `test_publish_requires_acknowledgement` は別の要求) | — |
| FC-065 | 投票期限 | 実装あり | `test_gate_g4_decisions_comments.py::test_deadline_sweep_reminds_then_closes`・`test_gate_chat_consensus.py::test_simple_poll_one_choice_per_member` | — |
| FC-066 | 懸念解決 | 実装あり | `p3discussion.test.ts`(懸念の解決)・`DiscussionPage.test.tsx` | — |
| FC-067 | 秘匿回答 | 実装あり | `test_gate_p3_discussion.py::test_anonymous_poll_hides_individuals_until_threshold` | — |
| FC-068 | 担当割当 | 実装あり | `test_gate_p1_preparation.py::test_create_shared_item_with_assignee_and_audit_without_name`・`test_task_lifecycle_with_criteria_assignee_due` | — |
| FC-069 | スマート持ち物 | 一部 | 理由付きの候補(`packing_suggestions.py` の Rule の reason) | 天候(提供元が未接続のため判定しない: 同 7 行目) |
| FC-070 | 薬・健康用品 | 一部 | 常備薬の候補は個人の持ち物・医療の判断はしない(`packing_suggestions.py:126-127`) | 時刻の通知 |
| FC-071 | 予算版 | 実装あり | `test_gate_g5_finance.py::test_budget_versions_are_snapshots`・e2e `gate-g5` | — |
| FC-072 | 通貨換算 | 実装あり | 為替の記録(`ExpensesPage.g5.test.tsx`・`g5decoders.test.ts`) | 手数料の項目の試験 |
| FC-073 | 不均等分割 | 実装あり | `test_gate_p2_finance.py::test_split_ratio_amount_none_and_errors`・`test_split_equal_puts_remainder_on_first_participants` | — |
| FC-074 | 返金・取消料 | 実装あり | `test_gate_p2_finance.py::test_refund_reduces_balances_and_is_bounded`・`ExpensesPage.test.tsx`(元の支出を指定) | 取消料の別明細の試験 |
| FC-075 | 出発通知 | 一部 | 移動の時間から出発の時刻を出して通知(`today_push.py:89-117`、tag で同じ予定の通知を置き換え)・`test_gate_tday_push.py` | 変更時に古い通知を取り消す試験 |
| FC-077 | 天候影響 | 実装あり | `test_gate_planb_variants.py::test_weather_fit_common_sense`・`test_gate_planb_next.py::test_weather_forecast_rounds_coordinates_caches_and_suggests_rain_variant` | — |
| FC-078 | 休業影響 | 実装あり | `test_gate_p10_replans.py::test_closure_and_weather_candidates` | — |
| FC-080 | 位置共有 | 実装あり | `test_gate_p13_location_tracks.py::test_start_requires_consent_period_and_defaults`・軌跡の削除(`trackRecorder.test.ts`) | — |
| FC-081 | パック選択 | 要確認 | 圏外パックの保存・鍵(`k1offlinePack.test.ts`) | 期間・文書・写真を容量と機密度で選ぶ画面の試験 |
| FC-082 | パック失効 | 実装あり | 鍵の失効(`k1offlinePack.test.ts`)・期限の表示(#132) | — |
| FC-083 | 同期再送 | 実装あり | `test_gate_p11_sync.py::test_offline_create_update_delete_with_temp_id_and_replay`・`test_clean_fields_and_conflicts` | — |
| FC-084 | 時計ずれ | 実装あり(**2026-11-20 訂正**) | **当初「未実装」と判定したのは誤り。** 当日の画面・ホームの旅行中の欄は `server_time` との差(`offsetMs`)で端末の時計を直して NOW/NEXT を判定していた(`TodayPage.tsx` の `nowMs = clock + offsetMs`、`TripLiveHome.tsx`)。欠けていた「警告」を足した(`todayModel.clockSkewNotice`・2 分以上のずれで表示。`TodayPage.test.tsx`・`todayModel.test.ts`) | — |
| FC-085 | 低電力 | 一部 | 位置の記録の省電力の段階(`adaptiveSampler.test.ts`・`LocationTrackPage.test.tsx`) | 地図・アニメーションを抑える |
| FC-087 | 公開版 | 実装あり | `test_gate_p4_booklet.py::test_web_publish_public_view_and_stop`・`test_public_share_is_noindex` | — |
| FC-088 | 機密印刷版 | 実装あり | `BookletPage.test.tsx`(版・透かし・有効期限を印字)・`p4booklet.test.ts` | — |
| FC-089 | 白黒印刷 | 実装あり | `bookletModel.test.ts`(予定の種類は文字で示す) | — |
| FC-091 | ICS出力 | 一部 | `test_gate_remaining5_server_exports.py::test_calendar_feed_lifecycle` | UID・sequence・取消の表現の試験 |
| FC-092 | KML/GPX | 実装あり | `test_gate_p5_itinerary_export.py::test_gpx_and_kml`・`test_gate_g6_location_memory.py::test_gpx_export_drops_points_in_owner_zones`・`ExportsPage.test.tsx` | — |
| FC-093 | 写真関連付け | 実装あり | `test_gate_mymaps_photomap.py::test_device_location_is_confirmed_and_exif_not_stored` | — |
| FC-094 | 旅行記公開 | 一部 | 公開前の確認(`MemoriesPage.test.tsx`・e2e `memories.spec.ts`)・位置を隠す(`test_publish_requires_acknowledgement_and_hides_coordinates`) | 顔・同行者の検査 |
| FC-095 | 実績学習 | 一部 | 過去の旅からの提案と元に戻す(`test_gate_p17_memory_replan.py::test_insights_and_apply_with_undo`) | 同意・停止・削除の試験 |
| FC-096 | 管理者支援 | 実装あり | `test_gate_g2_support_access.py`(目的・再認証・マスク・監査・通知) | — |
| FC-097 | 濫用対応 | 実装あり | `test_gate_g4_guest_abuse.py::test_scan_detects_scraping_bruteforce_spam`・`test_reports_auto_revoke_and_admin_actions` | — |
| FC-098 | データ輸出 | 実装あり | `test_gate_p6_data_export.py::test_plan_export_contents_and_privacy`・`test_document_manifest` | 暗号化の配布の試験 |
| FC-099 | 完全削除 | 実装あり | `test_gate_b012_plan_deletion.py::test_purge_removes_every_owned_row_and_file_but_keeps_outside_records`・`test_gate_m7_document_hardening.py::test_delete_document_purges_storage_file_immediately` | 索引・キャッシュの追跡の試験 |
| FC-100 | 障害告知 | 一部 | 警戒モード(`test_gate_s8_incident.py`)・お知らせの送信(`test_gate_remaining3_mail.py::test_notice_push_sends_recent_direct_once`) | 状態ページ(影響・期間・回避策・復旧) |

## 2. まとめ(この 81 件)

| 判定 | 件数 |
|---|---:|
| 実装あり | 46(FC-084 を訂正して含める) |
| 一部 | 27 |
| 未実装 | 6(FC-011・027・041・044・045・064。FC-044 は将来要件) |
| 要確認 | 2(FC-060・081) |

前回の 19 件(実装あり 2・一部 10・未実装 5・この作業で実装 1(FC-042)・判断待ち 1)と合わせた **FC-001〜100 の全体**:
実装あり **49**(FC-042・FC-084 を含む)・一部 **37**・未実装 **11**・要確認 **2**・判断待ち **1**(FC-086)= 100 件。
(2026-11-20 訂正: FC-084 は時計の補正が既にあり、当初の「未実装」は誤り。警告を足して実装ありにした)
(前回の表で FC-061 を「実装あり」と「一部(案内)」の両方に数えていたので、実装ありの 1 件だけにした)

- **未実装の 11 件**: FC-007・011・012・017・026・027・041・044・045・064・076。どれも新しい機能で、作るかと優先度は利用者の判断(勝手に作らない)。FC-044 は要求自体が将来の提供、FC-076 は運行情報の提供元(実 API)が前提。
- 「一部」の多くは、項目(予約の種類ごとの詳細など)が足りないか、試験が要求の一部しか確かめていないもの。
- この照合は **FC-101〜180(FR-043〜058 の観点別)を含まない**。それらは親 FR の状態で管理されている(`2026-11-19_fc101-180_lineage.md`)。


## 追記(2026-11-21 夜): FC-041 を実装した(利用者の指示「未実装の作業をすべて継続しろ」による。上の判定の行は消さずに残す)

| FC | 名前 | 判定(新) | 根拠 |
|---|---|---|---|
| FC-041 | 取消・変更 | **実装あり**(自動ではまとめない形) | 予約番号が同じ 2 件(FC-042 の候補)のうち後から入った方を、利用者が「変更としてまとめる」「取消としてまとめる」を選んだ時だけ、元の予約へまとめる(`POST /plans/{id}/reservations/{id}/absorb`)。変更は値の入っている項目を写して状態を「変更あり」に、取消は状態を「取消」にする。後から入った方の旅程の紐付け・チケット・区間は元の予約へ移してから消す。記録は新しい表 `reservation_history`(migration `f1b5d3a9c7e2`。**値は持たず項目の名前だけ**)に残し、予約の詳細に「変更・取消の記録」として出す(`GET …/history`)。試験: `test_gate2_reservation_history.py`(変更・取消・予約番号が違う/無い・古い版・閲覧だけのメンバー)、`ReservationsPage.history.test.tsx` |

| FC-027 | ジオコード確認 | **実装あり** | 予定の新規追加の窓(`NewEventForm`): 「住所から位置を探す」の結果が今の地図の印から 500 m を越えて離れていたら、黙って動かさず「住所の位置にする / 今の印のままにする」を選んでもらう。住所から探した後に印を 500 m を越えて動かしたら、離れたことを示して「住所の位置に戻す」を出す。予定の編集の窓: 位置の候補ごとに、今の印から 500 m を越えて離れていれば距離を示す(選ぶのは前から利用者)。距離は大円距離(`components/planner/geoCheck.ts`)。試験: `NewEventForm.geo.test.tsx`(新規の窓の 3 つの場合・距離と境)。編集の窓の距離の表示は自動の試験が無い |

| FC-026 | 不適切候補報告 | **実装あり** | 候補箱の候補の詳細の「情報の問題を報告」: 旅行のメンバー(閲覧だけの人も)が閉業・休業/住所・位置の誤り/危険・注意/重複を選び、ひとこと(任意)を付けて報告する(`POST /plans/{id}/candidates/{id}/reports`。1 人 1 候補 5 件まで)。候補が場所に紐付いていれば、その場所の出典を「要確認」(`freshness_state = stale`)にする(**ソース状態へ反映**。候補・場所の値は変えない)。候補の一覧に理由ごとの件数を出す(誰が報告したかは出さない)。表 `candidate_reports`(migration `a3c7e9b1d5f4`)。試験: `test_gate2_candidate_reports.py`・`CandidateDetailDialog.test.tsx` |

| FC-064 | 既読確認 | **一部**(B2B の改訂は対象外) | 相談の画面の「確認してほしいお知らせ」: 編集できる人が重大な変更・集合の変更を出す(`POST /plans/{id}/notices`)。メンバーへ通知(種類 `important_notice`。即時のメールの対象。通知の本文は題名だけ)。各メンバーが「確認しました」(`…/ack`。二度押しでも 1 行)。編集できる人には、まだの人・確認済みの人の名前を出す。閲覧だけの人には自分の状態と件数だけ。表 `plan_notices`・`plan_notice_acks`(migration `b8d2f4a6c1e3`)。試験: `test_gate2_plan_notices.py`・`ImportantNotices.test.tsx`。**範囲の外:** 予定・別行動の集合の変更から自動でお知らせを作ること(今は人が出す)、B2B の改訂(B2B の機能が無い) |

| FC-007 | テンプレート化 | **実装あり** | 旅行の一覧のカードの「テンプレートに」: 旅行の複製(`POST /travel-plans/{id}/clone`)に `as_template` を足し、日・予定の名前・種類・時刻・場所だけを写した新しい旅行(題名に「(テンプレート)」、`preferences.template = true`)を作る。自由に書いた文(旅行の説明・日のメモ・予定の説明)・電話・予算は写さない。予約・費用・コメント・位置の記録・メンバーは複製と同じく写さない。試験: `test_gate39_plan_clone.py::test_clone_as_template_keeps_structure_and_drops_free_text`・`TripList.test.tsx` |

| FC-017 | イベント依存 | **実装あり** | 予定の編集の窓の「この予定の前に終えておく予定(任意)」で、同じ旅行の別の予定を先行条件にする(列 `travel_events.after_event_id`・migration `c5e1a7d3b9f2`)。自分・循環・別の旅行の予定は断る(`invalid_prerequisite`)。先行の予定を消すと外れる。旅程の確認(検証)は、先行の予定の終わり(無ければ始まり)より前に始まる予定を `PREREQUISITE_ORDER`(注意)として出す。時刻の無い予定は確かめられない数として数える。試験: `test_gate2_event_prerequisite.py`・`planStore.test.ts` |

| FC-012 | 一括編集 | **一部**(参加者は対象外) | 旅程の「まとめて編集」: この日の予定から選び、種類を変える・別の日へ移す(`POST /plans/{id}/events/bulk`。最大 50 件)。1 つの変更の組で記録し、元に戻すで一度に戻る。移した予定はその日の最後へ選んだ順に並ぶ。鍵をかけた予定・エリア(とエリアの中の予定の日の移動)は断る(全部か、何もしないか)。**参加者**は予定ごとに持たない項目のため対象外。試験: `test_gate2_bulk_edit.py`・`BulkEditDialog.test.tsx` |

**集計(FC-001〜100):** 実装あり 54・一部 39・未実装 4・要確認 2・判断待ち 1(11-20 の 49・37・11・2・1 から FC-041・FC-027・FC-026・FC-007・FC-017 が実装ありへ、FC-064・FC-012 が一部へ)。残りの未実装: FC-011(繰り返し)・FC-045(文書の版)・FC-076(運行情報の提供元の契約が前提)・FC-044(要件自体が将来。Wallet の証明書・契約が前提)。

範囲の外: メールの本文から「これは変更・取消のメールだ」と自動で判定する所は作っていない(誤ってまとめる危険を避け、利用者が選ぶ)。実機・実際の予約メールでの確認は無い。
