# Gate G4 トレース(機能: 外部の判断の要らない残り)

対象: 監査の実行台帳(2026-10-20、`main@af7de3d`)のうち、外部の判断・契約なしで進められる機能の項目 —
MAP-02・MAP-03・COL-02・COL-03・COL-05・FC-097。migration 1つ(`b5d9f3a7c2e4`、Alembic head `b5d9f3a7c2e4`)。
FR の状態の遷移: FR-022 を VERIFIED(合意形成)。FR-008・FR-024 は外部の提供元(地図・メール)が残るため(部分)のまま。
FR-009・FR-040・FR-044 は VERIFIED のまま、残りの不足を解消した。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: PL = `backend/tests/test_gate_g4_places.py`、
CM = `test_gate_g4_commands.py`、DC = `test_gate_g4_decisions_comments.py`、GA = `test_gate_g4_guest_abuse.py`、
E2E = `frontend/e2e/gate-g4.spec.ts`。

## MAP-02 場所(FR-008)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 例外の日(臨時休業・特別営業・年末年始)を通常の営業時間より優先 | IMPLEMENTED | `place_special_hours`、`app/services/place_hours.py`、PL `test_day_hours_special_overrides_weekly_and_overnight`、E2E |
| 2 | 日跨ぎ(前の日から続く深夜営業)・昼休みのある店(1日3区切り) | IMPLEMENTED | PL、`feasibility._check_opening_hours`(CLOSED_ON_DATE・OUTSIDE_OPENING_HOURS) |
| 3 | 最終入場(ERROR)・ラストオーダー(食事だけ WARNING) | IMPLEMENTED | `opening_hours.last_entry・last_order`、PL `test_feasibility_split_hours_last_entry_last_order_and_special` |
| 4 | 入口ごとの別地点(正面・駐車場・駅の出口、段差) | IMPLEMENTED | `place_entrances`、PUT `/places/{id}/entrances`、E2E |
| 5 | 複数の出典の比較(値が出典で違う項目) | IMPLEMENTED | 詳細の `source_history`、PL `test_source_history_shows_values_per_source`、場所の画面「出典による違い」 |
| 6 | 祝日の暦の自動の取得・ジオコードの確認 | NOT STARTED | 外部の暦・地図の提供元(MAP-05)。例外の日は手で登録できる |

## MAP-03 検索のコマンド(FR-009)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 7 | 検索と操作を分ける(`>` から始めるとコマンド。読み取りは何も変えない) | IMPLEMENTED | `app/services/commands.py`、CM `test_preview_is_read_only_and_execute_is_idempotent`、E2E |
| 8 | command registry・権限(閲覧だけの人は理由を示して実行させない) | IMPLEMENTED | GET `/plans/{id}/commands`、CM `test_viewer_can_preview_and_validate_but_not_mutate` |
| 9 | 確認の画面・idempotency・競合(If-Match) | IMPLEMENTED | POST `/commands/execute`(Idempotency-Key 必須・`command_runs` の一意)、CM |
| 10 | 監査(コマンドの名前だけ。入力値は残さない)・Undo(本人・後の変更が無い時だけ) | IMPLEMENTED | CM `test_undo_only_latest_and_only_own`・`test_candidate_command_and_undo`、E2E |

## COL-02 合意(FR-022)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 11 | decision state machine(回答中 → 締切 → 決定 → 採用) | IMPLEMENTED | `consensus.phase`、DC `test_phase_tie_and_quorum` |
| 12 | 投票の締切(締切前の知らせ・締め)・quorum・同票(自動で決めない) | IMPLEMENTED | `app/services/poll_deadlines.py`(`tcops jobs poll-deadlines`)、DC `test_deadline_sweep_reminds_then_closes`・`test_quorum_tie_and_decision_lock` |
| 13 | 採用の preview・ChangeSet・Undo・採用の競合 | IMPLEMENTED | `app/api/v1/decisions.py`、DC `test_adopt_candidate_option_and_remove_others_with_undo`・`test_adoption_undo_refused_after_later_change`、E2E |
| 14 | 候補箱との統合(候補を選択肢にし、採用で予定に置く) | IMPLEMENTED | `poll_options.candidate_id`、DC、E2E |
| 15 | 決定後の変更(採用後は決定の変更・再開・削除をしない) | IMPLEMENTED | 409 `poll_adopted`、DC |

## COL-03 コメント・通知(FR-024)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 16 | 予定・予約・費用ごとのコメントの画面 | IMPLEMENTED | 相談の画面 `?target=event|reservation|expense&id=`、各画面の「コメント」、E2E |
| 17 | 対象の権限(見られない対象の人はメンションできない・通知しない) | IMPLEMENTED | `discussion._can_see_target`、DC `test_comment_notifications_follow_preferences_and_target_visibility` |
| 18 | 通知の設定(全体・旅行ごと。すべて/自分あて/なし)・まとめ(画面・メール) | IMPLEMENTED | `notification_preferences`、`app/services/notify.py`、GET `/notifications/digest`、DC、E2E |
| 19 | メールの失敗の再送・dead・本文の秘匿(件数と旅行名だけ) | IMPLEMENTED | `email_outbox`、`tcops jobs email-outbox`、DC `test_digest_and_outbox_retry` |
| 20 | メールの提供元(SMTP)の設定・即時の配信 | PARTIAL | 設定(`SMTP_*`)は運用の判断。即時の配信は COL-01 の配信の仕組み(G2 の SSE)へ載せる |

## COL-05 Guest Travel View(FR-044)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 21 | 使用回数を preview(確認・見直し)で消費しない | IMPLEMENTED | GET `/public/share/{token}/info`・`/view`(一時トークン)、GA `test_info_does_not_consume_and_view_token_does_not_consume`、E2E |
| 22 | 失効・期限・合言葉の変更で一時トークンが即無効 | IMPLEMENTED | `app/services/share_view.py`(共有・リンク・合言葉に結び付けた署名)、GA |
| 23 | policy の説明(見える項目・見えない項目・どの共有でも見えない物) | IMPLEMENTED | `policy_explained`、公開の画面 |
| 24 | 複製は許可項目だけ(所有者が allow_clone にした共有だけ) | IMPLEMENTED | POST `/public/share/{token}/clone`、GA `test_clone_copies_only_allowed_fields`、E2E |

## FC-097 濫用への対応(FR-040)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 25 | phishing・malware・spam の通報と自動の失効(別々の3人) | IMPLEMENTED | POST `/public/share/{token}/report`、`app/services/abuse.py`、GA `test_reports_auto_revoke_and_admin_actions` |
| 26 | scraping・合言葉の総当たり・共有の乱造・感染した文書の自動の検知 | IMPLEMENTED | `tcops jobs abuse-scan`、GA `test_scan_detects_scraping_bruteforce_spam` |
| 27 | 管理者の画面(却下・失効・戻す。所有者に知らせる。監査) | IMPLEMENTED | `/admin/abuse`、`frontend/src/pages/Admin/AdminAbuse.tsx`、GA |

## 横断

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 28 | 新しい表・列の migration の往復・既存データ | IMPLEMENTED | `b5d9f3a7c2e4`(足すだけ。downgrade で消す) |
| 29 | 旅行の書き出し・アカウントの削除に新しい表を含める | IMPLEMENTED | `data_export.PLAN_TABLES`、`account_deletion`(コマンドの記録・通知の設定・送信待ちのメール) |
| 30 | 公開のルートの見直し(資格情報なしで開けるルートの一覧) | IMPLEMENTED | `test_gate_s4_authz_matrix.PUBLIC_ROUTES` |
| 31 | 型の検査(新しい誤りを足さない) | IMPLEMENTED | `backend/mypy-baseline.txt` 1,401 件(G3 の 1,457 件から減) |
