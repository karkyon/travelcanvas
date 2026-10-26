# Gate G7 トレース(機能: 移動・最適化・案の比較・記録・削除)

対象: 監査の実行台帳(2026-10-20)のうち、外部の判断・契約なしで進められる項目 —
MOVE-03(既定の滞在・疲れと休憩・最終の便)・MOVE-04(目的の内訳・条件の変更・部分の採用)・MEM-03(思い出の残り: 同行者・移動手段の傾向)・
FR-005(日をまたぐ予定・変更の影響の確認・実際のブラウザのドラッグ)・FR-019(もしもの比較)・FR-039(猶予つきの削除)。
migration 1つ(`e8b2c6d0f4a7`、Alembic head `e8b2c6d0f4a7`)。
FR の状態の遷移: FR-005 と FR-057 を VERIFIED。FR-017 は VERIFIED のまま、標準滞在時間・休憩の自動判定・最終の便を解消した(時刻表の照合は残る)。
FR-018 は外部の経路の提供元による実移動時間が、FR-019 は案の中で予約・移動区間そのものを変える分岐が、FR-039 は所有者の移譲・出典つきの訂正が残るため(部分)のまま。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: MV = `backend/tests/test_gate_g7_movement.py`、
OC = `test_gate_g7_optimize_compare.py`、MD = `test_gate_g7_memory_deletion.py`、E2E = `frontend/e2e/gate-g7.spec.ts`。

## MOVE-03 既定の滞在・疲れと休憩・最終の便(FR-017)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 旅行ごとの移動・滞在の既定(歩く速さ3段階・同行者(子ども連れ・高齢の方・人数)・種類ごとの滞在・休憩とみなす空き・休憩なしの上限・1日の上限・最終の便の前の余裕)。版(If-Match)つき・閲覧のメンバーは見るだけ | IMPLEMENTED | `plan_movement_settings`、GET/PUT `/plans/{id}/movement-settings`、`app/services/movement.py`(movement-v1)、MV `test_movement_settings_api_if_match_validation_and_stale`、E2E |
| 2 | 終了時刻の無い予定の滞在を既定で見積もり、移動に間に合うか・営業時間内に終わるか・滞在が短すぎないかを確かめる(見積もりの指摘は「見積もり」と示し、エラーにしない) | IMPLEMENTED | `feasibility-v2` の `ESTIMATED_TRAVEL_SHORTFALL`・`ESTIMATED_PAST_CLOSING`・`SHORT_STAY`、MV `test_estimated_travel_shortfall_is_a_warning_with_evidence`・`test_past_closing_estimate_and_short_stay` |
| 3 | 休憩の自動判定(空き・食事)・休憩の無い連続・長すぎる1日・日ごとの疲れの目安(活動・徒歩・乗り物・最長の連続) | IMPLEMENTED | `NO_BREAK`・`LONG_DAY`・`DAY_FATIGUE_HIGH`、`day_metrics`、MV `test_no_break_long_day_and_fatigue_metrics`、画面「日ごとの疲れの目安」、E2E |
| 4 | 最終の便(区間の `last_departure_at`)に間に合わない・余裕が少ない・確かめられない | IMPLEMENTED | `LAST_TRANSPORT_MISSED`・`LAST_TRANSPORT_TIGHT`・`LAST_TRANSPORT_UNVERIFIED`、移動の画面の入力、MV `test_last_transport_missed_tight_and_unverified`・`test_segment_last_departure_round_trip_and_undo` |
| 5 | 既定を変えると以前の検証の結果を古いと示す。見積もりを使わない設定で以前の検証に戻る | IMPLEMENTED | 入力の指紋に既定の版、MV `test_disabling_movement_returns_to_v1_checks` |
| 6 | 監査に同行者の属性の値を残さない(変えた項目の名前だけ) | IMPLEMENTED | `movement_settings_updated`、MV |
| 7 | 時刻表の照合(実際の便の時刻) | NOT STARTED | 時刻表の提供元(契約の判断待ち)。最終の便は利用者が入れる |

## FR-005 日をまたぐ予定・変更の影響の確認・ドラッグ

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 8 | 終了を「時刻」と「開始の日から何日後か(0〜2)」で持つ(夜行バス・深夜まで続く予定)。前後が逆・72時間を超える・開始の無い終了は 422 | IMPLEMENTED | `app/services/event_times.py`、`local_end_time`・`end_day_offset`、MV `test_cross_day_event_end_offset_and_range_checks` |
| 9 | 開始だけを変えると終了も同じだけずれる。日程を移す・案の採用・同期・思い出からの提案でも同じ | IMPLEMENTED | `shift_end_with_start`、`branches._apply_time`、`sync._apply_fields`、MV |
| 10 | 保存する前に変更の影響を確かめる(新たに出る問題・解消する問題・つながる移動と予約。旅程は変えない) | IMPLEMENTED | POST `/plans/{id}/events/{event_id}/impact-preview`、編集の画面の「変更の影響を確かめる」、MV `test_impact_preview_does_not_change_plan`、`EventTimeImpact.test.tsx`、E2E |
| 11 | 役割・部外者・版の競合 | IMPLEMENTED | MV `test_event_time_edit_permissions_and_conflicts` |
| 12 | 実際のブラウザでのドラッグの並べ替え(以前は旅行と日の ID を '-' で分けていたため UUID で切れて何もしなかった。下へ動かすと1つずれていた) | IMPLEMENTED | `useDragDrop.containerId`・`finalIndexForGap`、`useDragDrop.test.tsx`、E2E(マウスのドラッグ) |
| 13 | 画面の表示「(翌日)」・オフラインでは終了の変更を溜めない(通信できる時に保存) | IMPLEMENTED | `ScheduleItem`、`planStore.updateScheduleItem`、`planStore.test.ts` |

## MOVE-04 目的の内訳・条件の変更・部分の採用(FR-018)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 14 | 目的の内訳(移動距離・検証と制約・疲れ・公平さ。値・重み・点)を今の順と候補ごとに示す | IMPLEMENTED | `app/services/optimizer.objective`、OC `test_objective_breakdown_and_weights`、画面「目的の内訳」 |
| 15 | 公平さ(日ごとの移動の偏り)・疲れの指標 | IMPLEMENTED | `optimizer.fairness`・`day_movement`、OC `test_weights_objective_and_partial_order_units` |
| 16 | 条件(重み 0〜5)を変えて計算し「条件に合わせた案」を足す | IMPLEMENTED | `weights`、OC、E2E |
| 17 | 選んだ予定だけを動かした結果を確かめ、選んだ予定だけを適用する(入力の指紋・版つき。監査に部分の印) | IMPLEMENTED | POST `.../optimization-candidates/partial-preview`、apply の `event_ids`、OC `test_partial_preview_and_apply_only_selected`、E2E |
| 18 | 外部の経路の提供元による実移動時間 | NOT STARTED | 経路の提供元(契約の判断待ち)。直線距離と移動区間の時間で見積もる |

## FR-019 もしもの比較

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 19 | 本案と案(最大3つ)を並べて比べる: 検証の件数・守れていない制約・移動の概算・疲れ・費用(通貨ごと)・変更の数 | IMPLEMENTED | GET `/plans/{id}/branches/{branch_id}/comparison`・`/plans/{id}/branches-comparison?ids=`、`app/services/branch_compare.py`、OC `test_branch_comparison_columns_diff_costs_and_budget`、E2E |
| 20 | 外す予定に紐付く予約・費用を分けて示す(予約は自動では取り消さない)・予算の目標に届くか | IMPLEMENTED | `affected_reservations`・`costs.removed`・`budget_target`、OC |
| 21 | 見せない設定の費用・予約は比較にも出さない | IMPLEMENTED | `member_policy`、OC `test_comparison_hides_costs_and_reservations_by_member_policy` |
| 22 | 案の中で予約・移動区間そのものを変える分岐 | NOT STARTED | 案の内容は予定だけ(ADR-branches §3) |

## MEM-03 思い出の残り(FR-057)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 23 | 同じ同行者(人数・子ども連れ・高齢の方)の旅行を優先して傾向を出し、どちらで比べたかを根拠に書く | IMPLEMENTED | `memory_replan.same_party`・`basis`(memory-replan-v2)、MD `test_party_basis_and_transport_units`、E2E `memory-replan.spec.ts`・`gate-g7.spec.ts` |
| 24 | 移動手段の傾向(その手段の後に予定より遅れて着く)から、区間の前の余裕を足す提案(120分まで・元に戻せる) | IMPLEMENTED | `transport_insights`・`transport_proposals`、MD `test_transport_tendency_proposal_apply_and_undo`、E2E |

## FR-039 猶予つきのアカウントの削除

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 25 | 14日後の削除の申し込み(確認の文字・パスワード)・取り消し・申し込みの間はいつも通り使える。ゲストは申し込めない | IMPLEMENTED | POST `/privacy/account-deletion/schedule`・`/cancel`、`users.deletion_requested_at`・`deletion_due_at`、MD `test_schedule_cancel_and_preview`、E2E |
| 26 | 予定日を過ぎた申し込みを毎日の処理で削除する(すぐの削除と同じ手順。管理者は飛ばす) | IMPLEMENTED | `tcops.py jobs account-deletions`(毎日 04:20)、MD `test_due_requests_are_deleted_by_job_except_admins`・`test_job_entry_and_schedule_line` |
| 27 | 所有者の移譲・出典つきの訂正 | NOT STARTED | 次の Gate |

## 横断

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 28 | migration の往復(表・列・制約・部分索引) | IMPLEMENTED | `e8b2c6d0f4a7` |
| 29 | 書き出し・旅行の複製に移動の既定を含める | IMPLEMENTED | `data_export.PLAN_TABLES`、`travel.clone`、MV `test_clone_and_export_include_movement_settings` |
| 30 | 応答の形の検査(実 backend の応答) | IMPLEMENTED | `frontend/src/services/api/__fixtures__/g7Responses.json`、`g7.test.ts` |
| 31 | 最初に読む JS を増やさない | IMPLEMENTED | API は `frontend/src/services/api/g7.ts`、画面は後から読む塊(bundle-budget) |
| 32 | 知らせ(Toast)の閉じるボタンに名前が無かった(axe button-name) | IMPLEMENTED | `components/common/Toast.tsx`、E2E の axe |
| 33 | 設計の判断 | IMPLEMENTED | `docs/adr/ADR-movement-rules.md` |
