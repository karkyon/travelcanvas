# FC-001〜100 のうち docs/trace から参照されない FC の調査(G2-09-D)

作成: 2026-11-19 / 基準: main `dac0b51` / 生成: `scripts/audit/scan_fc_unreferenced.py`(再生成できる)

> **読み方:** 「語の一致」は、FC の内容に対応する語をコード・試験から検索した結果で、**根拠の候補**にすぎない。一致があっても、その試験が FC の SHALL を満たすことを確かめたわけではない(誤一致を含む)。**未参照=未実装ではない。** 要件の削除・統合・状態の変更はしていない。

未参照: **68 件**(FC-001〜100 の 100 件のうち、docs/trace が番号で参照するのは 32 件)。

## 1. 分類の集計

| 分類 | 件数 |
|---|---|
| 語の一致あり(要確認) | 60 |
| 試験根拠薄 | 3 |
| 未実装(将来要件) | 1 |
| 根拠あり(候補) | 1 |
| 根拠未特定 | 1 |
| 要件との差異の候補 | 1 |
| 試験根拠なし | 1 |

## 2. 一覧

| FC | 名前 | SHALL | 検索語 | 試験の一致 | コードの一致 | 試験の例 | 分類 | 所見 |
|---|---|---|---|---|---|---|---|---|
| FC-002 | メール確認 | tokenは短命・単回使用・ハッシュ保存。再送で旧tokenを失効可能 | `verify[_-]?email／email_verification／EmailVerification` | 3 | 8 | `frontend/e2e/account-recovery.spec.ts`, `frontend/src/pages/AccountRecovery.test.tsx` | 語の一致あり(要確認) |  |
| FC-003 | パスワード変更 | 現在パスワードまたは強化再認証、他セッション失効選択 | `change[_-]?password／password_change／ChangePassword` | 4 | 6 | `backend/tests/test_gate_s2_auth_hardening.py`, `backend/tests/test_sessions.py` | 語の一致あり(要確認) |  |
| FC-004 | アカウントロック | 総当たりと正当利用者のDoSを両方考慮し、段階遅延・通知を使用 | `lockout／account_lock／failed_login／login_attempt` | 1 | 2 | `backend/tests/test_gate_s9_login_alerts.py` | 語の一致あり(要確認) |  |
| FC-005 | 所有者移譲 | 新所有者の受諾後に確定し、監査と取消猶予を持つ | `transfer[_-]?owner／ownership_transfer／owner_transfer` | 1 | 6 | `backend/tests/test_gate_g8_ownership_corrections.py` | 語の一致あり(要確認) |  |
| FC-006 | 旅行複製 | 機密予約・チケット・参加者を既定では複製しない | `duplicate_plan／clone_plan／plan_copy／copy_plan／duplicatePlan` | 3 | 4 | `backend/tests/test_gate39_plan_clone.py`, `backend/tests/test_gate_spot_links.py` | 語の一致あり(要確認) |  |
| FC-007 | テンプレート化 | 個人情報、予約、実費、コメント、位置を除去した構造だけ保存 | `template` | 3 | 9 | `backend/tests/test_gate_g11_guard_report.py`, `backend/tests/test_gate_o1_ops.py` | 語の一致あり(要確認) |  |
| FC-008 | ゴミ箱 | 期限、復元、即時共有失効、完全削除予定日を表示 | `trash／restore_plan／purge_at` | 7 | 39 | `backend/tests/test_gate_g6_location_memory.py`, `backend/tests/test_gate_p12_memories.py` | 語の一致あり(要確認) |  |
| FC-009 | 未定時刻イベント | 日付だけ、時間帯だけ、完全未定を区別し最適化対象条件を設定 | `time_undecided／undated／unscheduled／time_window／tbd` | 6 | 12 | `backend/tests/test_gate_g9_dashboard.py`, `backend/tests/test_gate_home_v2.py` | 語の一致あり(要確認) |  |
| FC-010 | 複数日イベント | 宿泊、クルーズ等を開始終了日へ表示し重複計算を正しく行う | `multi[_-]?day／spans_days` | 0 | 1 | — | 根拠未特定 | 予定(TravelEvent)は1つの日(day_id)に属する。end_at は日をまたいで入れられるが、開始〜終了の各日へ表示する処理・試験は見当たらない(宿泊は予約・移動区間の側で扱う可能性。要確認) |
| FC-011 | 繰返し | 旅行中の毎朝朝食等を生成し、個別変更と系列変更を区別 | `recurr／rrule／repeat_rule` | 4 | 6 | `backend/tests/test_gate_p8_calendar_import.py`, `backend/tests/test_gate_remaining4_billing.py` | 語の一致あり(要確認) |  |
| FC-012 | 一括編集 | 複数イベントのカテゴリ、参加者、日付移動を1変更セットで処理 | `bulk／batch_update／change_set／changeset` | 12 | 21 | `backend/tests/test_gate_b012_plan_deletion.py`, `backend/tests/test_gate_b013_item_deletion.py` | 語の一致あり(要確認) |  |
| FC-014 | 自動保存 | 入力停止後保存、明示状態、失敗時下書き保持、再送の冪等性 | `autosave／auto-save／auto_save／自動保存／保存中` | 0 | 5 | — | 試験根拠なし | 自動保存の文言・処理は画面4か所(SettingsPage・SearchSettingsPage・SpotListPage・PlannerPage)にあるが、「失敗時の下書き保持・再送の冪等性」を固定する試験が見当たらない |
| FC-015 | 日付ジャンプ | 現在日、各旅行日、未定へ即移動。手動閲覧中の自動追従を抑止 | `今日へ／jumpTo／jump_to／scrollToDay／日付へ` | 4 | 2 | `backend/tests/test_gate_booking_import.py`, `frontend/e2e/gate-g10-ux.spec.ts` | 語の一致あり(要確認) |  |
| FC-016 | タイムゾーン | 出発地・目的地・イベントごとの時刻を切替表示し曖昧なDSTを確認 | `timezone_id／tz_display／ambiguous／DST` | 157 | 128 | `backend/tests/test_gate39_plan_clone.py`, `backend/tests/test_gate_b012_plan_deletion.py` | 語の一致あり(要確認) |  |
| FC-017 | イベント依存 | 「ホテルチェックイン後」「チケット受取後」等の先行条件を保持 | `depends_on／dependency／precondition／prerequisite` | 84 | 6 | `backend/tests/conftest.py`, `backend/tests/test_gate39_plan_clone.py` | 語の一致あり(要確認) |  |
| FC-018 | バッファ | 準備、入口、保安検査、荷物、余裕を移動時間と別に表示 | `buffer_min／buffer` | 29 | 26 | `backend/tests/test_gate_g7_memory_deletion.py`, `backend/tests/test_gate_g7_movement.py` | 語の一致あり(要確認) |  |
| FC-021 | 音声検索 | 文字起こし確認後に検索。録音同意と保持期間を表示 | `speech／voice／transcri／SpeechRecognition` | 10 | 34 | `backend/tests/test_gate_p12_memories.py`, `backend/tests/test_gate_remaining4_billing.py` | 語の一致あり(要確認) |  |
| FC-022 | 自然文追加 | 「明日10時に清水寺」をイベント候補へし、日付・時刻・場所を確認 | `natural[_-]?language／parse_text／quick_add／quickAdd／intake` | 10 | 16 | `frontend/e2e/gate-g11-intake.spec.ts`, `frontend/src/components/Remaining7.test.tsx` | 語の一致あり(要確認) |  |
| FC-024 | お気に入り | 旅行横断と旅行内候補を区別し、削除時の参照を維持 | `favorite／favourite／wish_place／WishPlace` | 2 | 15 | `backend/tests/test_gate_wish_places.py`, `backend/tests/test_spots.py` | 語の一致あり(要確認) |  |
| FC-026 | 不適切候補報告 | 閉業、誤住所、危険、重複を報告しソース状態へ反映 | `report_candidate／candidate_report／flag_place／correction` | 8 | 24 | `backend/tests/test_gate_g8_ownership_corrections.py`, `frontend/e2e/gate-g8.spec.ts` | 語の一致あり(要確認) |  |
| FC-029 | 集合地点 | 参加者へ共有する地点、写真、目印、屋内説明を保持 | `meeting_point／meetup／rendezvous／集合` | 22 | 22 | `backend/tests/test_gate_b1_organizations.py`, `backend/tests/test_gate_g1_doc10.py` | 語の一致あり(要確認) |  |
| FC-031 | 価格情報 | 入場料、年齢区分、税、変動価格、取得日を保持 | `price_range／admission／ticket_price／fee` | 15 | 75 | `backend/tests/test_gate_p1_preparation.py`, `backend/tests/test_gate_p2_finance.py` | 語の一致あり(要確認) |  |
| FC-032 | アクセシビリティ | 段差、エレベーター、車いす、ベビーカー、トイレ情報と出典 | `accessibility／wheelchair／stroller／step_free` | 5 | 11 | `backend/tests/test_gate_fr059_tiers.py`, `backend/tests/test_gate_m3_route_options.py` | 語の一致あり(要確認) |  |
| FC-033 | 地図レイヤー | 日別、カテゴリ、候補、宿、緊急、非表示を切替 | `MapLayer／map_layer／layer` | 5 | 25 | `backend/tests/test_gate37_visit_detection.py`, `backend/tests/test_gate_v2_visits.py` | 語の一致あり(要確認) |  |
| FC-034 | 地図共有 | 公開範囲に応じて機密場所や実位置を除去 | `share_policy／redact／public_map` | 9 | 15 | `backend/tests/test_gate2_audit_redaction.py`, `backend/tests/test_gate_f45_share_policy.py` | 語の一致あり(要確認) |  |
| FC-035 | 宿泊予約 | 部屋、宿泊者、朝食、チェックイン、デポジット、取消条件 | `hotel／lodging／check_in／checkin` | 33 | 62 | `backend/tests/test_gate_area_geo.py`, `backend/tests/test_gate_booking_badge.py` | 語の一致あり(要確認) |  |
| FC-036 | 航空予約 | PNR、便、空港、ターミナル、搭乗者、座席、手荷物、運航状態 | `flight／pnr／terminal／boarding` | 22 | 38 | `backend/tests/test_gate_booking_import.py`, `backend/tests/test_gate_h1_public_hosts.py` | 語の一致あり(要確認) |  |
| FC-037 | 鉄道予約 | 列車、区間、号車、座席、改札、乗車券と特急券の関係 | `train／rail／car_number／seat` | 92 | 142 | `backend/tests/test_gate_b012_plan_deletion.py`, `backend/tests/test_gate_b013_item_deletion.py` | 語の一致あり(要確認) |  |
| FC-038 | 飲食予約 | 人数、コース、席、アレルギー連絡、キャンセル料、到着猶予 | `restaurant／dining／allerg` | 49 | 63 | `backend/tests/test_gate_area_geo.py`, `backend/tests/test_gate_b012_plan_deletion.py` | 語の一致あり(要確認) |  |
| FC-039 | 体験予約 | 集合、受付、年齢・装備条件、免責、言語、バウチャー | `activity／experience／voucher` | 24 | 61 | `backend/tests/test_gate_b1_organizations.py`, `backend/tests/test_gate_g11_planner.py` | 語の一致あり(要確認) |  |
| FC-040 | レンタカー | 営業所、車種、運転者、免許条件、燃料、返却、保険 | `rental_car／car_rental／rentacar／レンタカー` | 0 | 18 | — | 試験根拠薄 | レンタカーの語はコードに多いが、試験の一致は fixture だけ |
| FC-041 | 取消・変更 | 原予約と更新・取消メールを同一予約の履歴へ統合 | `cancel／amend／supersed` | 40 | 113 | `backend/tests/test_gate_booking_import.py`, `backend/tests/test_gate_g1_doc10.py` | 語の一致あり(要確認) |  |
| FC-043 | QR表示 | コード種別、原本、明るさ、オフライン、期限、権限、使用済状態 | `qr` | 41 | 71 | `backend/tests/test_gate_b012_plan_deletion.py`, `backend/tests/test_gate_b013_item_deletion.py` | 語の一致あり(要確認) |  |
| FC-044 | Wallet出力 | 対応可能なチケットだけApple/Google Wallet形式を将来提供 | `pkpass／apple_wallet／google_wallet／add_to_wallet` | 0 | 0 | — | 未実装(将来要件) | 要件自体が「将来提供」。pkpass 等の実装なし(Wallet の語は財布のアイコン・持ち物の候補だけ) |
| FC-045 | 文書差替 | 原本を版管理し、どの抽出値がどの版由来か維持 | `document_version／replace_document／supersede` | 3 | 4 | `backend/tests/test_gate_g1_doc10.py`, `backend/tests/test_gate_providerconnect.py` | 語の一致あり(要確認) |  |
| FC-046 | 旅券・ビザ | 本人限定、期限通知、AI既定禁止、共有・印刷既定除外 | `passport／visa` | 5 | 5 | `backend/tests/test_gate_c3_search.py`, `backend/tests/test_gate_m7_document_hardening.py` | 語の一致あり(要確認) |  |
| FC-047 | 保険・緊急 | 証券番号、連絡先、補償資料をオフラインで本人表示可能 | `insurance／emergency_contact` | 4 | 3 | `backend/tests/test_gate_c3_search.py`, `backend/tests/test_gate_g2_member_policy.py` | 語の一致あり(要確認) |  |
| FC-048 | 領収書 | 支出・予約へ関連付け、OCRは金額・税・通貨を確認後確定 | `receipt` | 18 | 21 | `backend/tests/test_gate_b012_plan_deletion.py`, `backend/tests/test_gate_b013_item_deletion.py` | 語の一致あり(要確認) |  |
| FC-049 | 複合交通 | 徒歩＋鉄道＋バス等をleg単位で保持し全体余裕を計算 | `leg／segment` | 90 | 159 | `backend/tests/test_gate34_canonical.py`, `backend/tests/test_gate_admin_uat.py` | 語の一致あり(要確認) |  |
| FC-050 | 乗換余裕 | 標準値だけでなく荷物、年齢、駅規模、アクセシビリティを反映 | `transfer_margin／transfer_buffer／connection_time／乗換` | 3 | 7 | `backend/tests/test_gate_tday_push.py`, `frontend/src/pages/today/live/TodayPushTransit.test.tsx` | 語の一致あり(要確認) |  |
| FC-051 | 最終交通 | 終電・最終入場・門限をハード制約として警告 | `last_train／last_entry／curfew／終電` | 7 | 22 | `backend/tests/test_gate_g11_planner.py`, `backend/tests/test_gate_g4_places.py` | 語の一致あり(要確認) |  |
| FC-052 | 駐車・給油 | 車旅行で駐車場、満空、料金、高さ、燃料、充電を扱う | `parking／fuel／charging` | 9 | 14 | `backend/tests/test_gate_l5_local_first_location.py`, `backend/tests/test_gate_place_lookup_jp.py` | 語の一致あり(要確認) |  |
| FC-053 | 荷物 | コインロッカー、預入、受取、容量、移動負荷をイベント化 | `locker／luggage／baggage` | 6 | 23 | `backend/tests/test_gate_m1_travel_segments.py`, `frontend/src/components/planner/PlanSpotEdit.test.tsx` | 語の一致あり(要確認) |  |
| FC-054 | 休憩・食事間隔 | 旅行者属性に応じ最大連続活動、休憩、食事を制約化 | `rest_break／meal_gap／max_continuous／休憩` | 7 | 23 | `backend/tests/test_gate_g3_perf.py`, `backend/tests/test_gate_g7_movement.py` | 語の一致あり(要確認) |  |
| FC-056 | 営業時間違反 | source freshnessと例外日を含め対象日時で検証 | `opening_hours／OpeningHours／closed_days` | 11 | 23 | `backend/tests/test_gate_c2_candidates_places.py`, `backend/tests/test_gate_g4_places.py` | 語の一致あり(要確認) |  |
| FC-057 | 予約時刻違反 | 到着バッファ、受付終了、遅刻許容を含め判定 | `arrival_buffer／受付終了／late_tolerance／遅刻` | 0 | 0 | — | 試験根拠薄 | 到着の余裕・受付終了・遅刻許容を名前で扱うコードは見当たるが、試験の一致なし |
| FC-059 | 部分最適化 | 選択日・時間帯・未ロック項目だけを対象にする | `partial／is_locked／lock_items` | 88 | 84 | `backend/tests/test_gate_b013_item_deletion.py`, `backend/tests/test_gate_g1_ci_evidence.py` | 語の一致あり(要確認) |  |
| FC-060 | 公平性 | 一人の希望だけを最大化せず、最小満足度や交代を指標化 | `fairness／min_satisfaction／vote` | 17 | 24 | `backend/tests/test_gate_chat_consensus.py`, `backend/tests/test_gate_g4_decisions_comments.py` | 語の一致あり(要確認) |  |
| FC-061 | 招待受諾 | 招待対象とログインIDが異なる場合に確認し誤参加を防ぐ | `invite／invitation` | 24 | 11 | `backend/tests/test_gate_b012_plan_deletion.py`, `backend/tests/test_gate_b013_item_deletion.py` | 語の一致あり(要確認) |  |
| FC-063 | 編集競合 | base revisionとフィールド差分を示し手動マージ可能 | `base_revision／revision_conflict` | 14 | 29 | `backend/tests/test_gate_g2_member_policy.py`, `backend/tests/test_gate_g3_errors.py` | 語の一致あり(要確認) |  |
| FC-064 | 既読確認 | 重大変更、集合変更、B2B改訂の閲覧確認を保持 | `read_receipt／acknowledg` | 10 | 20 | `backend/tests/test_gate_b1_organizations.py`, `backend/tests/test_gate_f45_share_policy.py` | 語の一致あり(要確認) |  |
| FC-075 | 出発通知 | 移動＋余裕から動的に算出し、変更時に古い通知を取消 | `departure_notice／leave_by／depart` | 35 | 52 | `backend/tests/test_gate_booking_import.py`, `backend/tests/test_gate_g7_movement.py` | 語の一致あり(要確認) |  |
| FC-076 | ゲート変更 | 便・列車に紐付け、source timeと旧値を履歴保持 | `gate_change／platform_change／ゲート変更／番線` | 1 | 2 | `frontend/src/components/planner/SegmentPicker.test.tsx` | 試験根拠薄 | 便・列車の状態変化と旧値の履歴を固定する試験は見当たらない(番線などの語の一致のみ) |
| FC-077 | 天候影響 | 天気そのものではなく屋外、移動、装備への影響を表示 | `weather` | 18 | 29 | `backend/tests/test_gate_p10_replans.py`, `backend/tests/test_gate_p1_preparation.py` | 語の一致あり(要確認) |  |
| FC-078 | 休業影響 | 代替候補、予約連絡、費用、移動を再評価 | `closure／closed／replan` | 52 | 91 | `backend/tests/test_gate_c2_candidates_places.py`, `backend/tests/test_gate_chat_consensus.py` | 語の一致あり(要確認) |  |
| FC-079 | 緊急情報 | 公的情報、宿、保険、同行者連絡をオフライン表示 | `emergency` | 1 | 7 | `backend/tests/test_gate_c3_search.py` | 語の一致あり(要確認) |  |
| FC-080 | 位置共有 | 対象者、期間、精度、目的、停止、履歴削除を制御 | `location_share／share_location／location_track／LocationTrack` | 14 | 24 | `backend/tests/test_gate_g10_quality.py`, `backend/tests/test_gate_l5_local_first_location.py` | 語の一致あり(要確認) |  |
| FC-081 | パック選択 | 期間、文書、QR、地図、写真を容量と機密度で選ぶ | `offline_pack／OfflinePack` | 19 | 21 | `backend/tests/test_gate_g1_keys.py`, `backend/tests/test_gate_g6_offline.py` | 語の一致あり(要確認) |  |
| FC-082 | パック失効 | サーバー失効、期限、次回オンライン時削除。完全遠隔消去を過大約束しない | `revoke／expires_at／expiry` | 77 | 138 | `backend/tests/test_gate_a2_admin.py`, `backend/tests/test_gate_admin_uat.py` | 語の一致あり(要確認) |  |
| FC-083 | 同期再送 | 同一operation_idを二重適用せず項目別結果を返す | `operation_id／idempoten` | 119 | 60 | `backend/tests/test_gate_b012_plan_deletion.py`, `backend/tests/test_gate_b013_item_deletion.py` | 語の一致あり(要確認) |  |
| FC-084 | 時計ずれ | server timeとの差を検知しNOW/NEXT誤判定を警告 | `clock_skew／server_time／skew` | 8 | 15 | `frontend/e2e/remaining-external.spec.ts`, `frontend/src/pages/DashboardPage.test.tsx` | 語の一致あり(要確認) |  |
| FC-085 | 低電力 | 地図更新、位置、アニメーションを抑え重要情報を維持 | `low_power／battery／reduced_motion／prefers-reduced` | 6 | 11 | `backend/tests/test_gate_l5_local_first_location.py`, `backend/tests/test_gate_p1_preparation.py` | 語の一致あり(要確認) |  |
| FC-086 | 通知秘匿 | ロック画面に予約番号、健康、位置、旅程詳細を既定表示しない | `lock.?screen／ロック画面／notification_privacy／redact_notification` | 0 | 0 | — | 要件との差異の候補 | Web Push の本文に予定名・出発/開始の時刻を既定で入れている(backend/app/services/today_push.py の depart_messages・morning_message・rain_messages)。「旅程詳細をロック画面に既定表示しない」と食い違う可能性がある。予約番号は入れていない。仕様の判断が要る(コードは変えていない) |
| FC-093 | 写真関連付け | 撮影時刻・位置は同意範囲でイベント候補へ紐付け | `exif／taken_at` | 10 | 15 | `backend/tests/test_gate_booking_import.py`, `backend/tests/test_gate_g11_discover.py` | 語の一致あり(要確認) |  |
| FC-094 | 旅行記公開 | 顔、同行者、位置、予約情報の公開前検査 | `public_journal／journal.*publish／publish` | 17 | 34 | `backend/tests/test_gate_b1_organizations.py`, `backend/tests/test_gate_bookletshare.py` | 語の一致あり(要確認) |  |
| FC-095 | 実績学習 | 本人の同意、説明、停止、削除を提供し生データを必要以上保持しない | `learning／consent` | 36 | 33 | `backend/tests/test_gate_admin_uat.py`, `backend/tests/test_gate_b012_plan_deletion.py` | 語の一致あり(要確認) |  |
| FC-096 | 管理者支援 | impersonationではなく目的付きsupport session、マスク、監査 | `support_access／SupportAccess／support-access／support_session` | 2 | 5 | `backend/tests/test_gate_g2_support_access.py`, `frontend/src/pages/G2.features.test.tsx` | 根拠あり(候補) | backend/tests/test_gate_g2_support_access.py と docs/adr/ADR-support-access.md(目的付きの支援・監査) |
| FC-100 | 障害告知 | 影響機能、期間、データ影響、回避策、復旧を状態ページで通知 | `status_page／incident／maintenance` | 6 | 15 | `backend/tests/test_gate_a2_admin.py`, `backend/tests/test_gate_fr059c_shared_suspension.py` | 語の一致あり(要確認) |  |

## 3. 次の作業(利用者の判断を分ける)

| # | 内容 | 状態 |
|---|---|---|
| 1 | FC-086(通知の秘匿): 本文に予定名・時刻を出す今の挙動を仕様として認めるか、既定で伏せるか | **利用者の判断待ち** |
| 2 | FC-014(自動保存の失敗時の下書き保持・再送)の試験を追加する | 未着手(コードの PR で) |
| 3 | 「語の一致あり」の各 FC を、試験の中身まで読んで docs/trace へ番号で結ぶ | 未着手(FC 単位の照合は別 Gate。`gate-hardening-trace.md` G-01) |
