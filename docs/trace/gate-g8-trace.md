# Gate G8・G9 トレース(機能: 案の中の区間・予約・所有者の移譲・訂正・定期の処理の記録 / 見た目の準備)

対象: 監査の実行台帳(2026-10-26)の G8(外部の判断なしで閉じられる (部分)・証拠の残り)と、
G9 のうち画面の改修の前に要る3つ(Q03 最初に読む JS の上限・UX-0 今の画面の記録・UX-1 デザインの決まり)。
migration 1つ(`f4d8a2c6e9b1`、Alembic head `f4d8a2c6e9b1`)。
FR の状態の遷移: FR-004・FR-019・FR-039・FR-051 を VERIFIED。FR-021 は VERIFIED のまま、所有者の移譲を解消した。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BR = `backend/tests/test_gate_g8_branch_resources.py`、
OC = `test_gate_g8_ownership_corrections.py`、JR = `test_gate_g8_job_runs.py`、E2E = `frontend/e2e/gate-g8.spec.ts`、
UXB = `frontend/e2e/ux-baseline.spec.ts`。

## FR-019 案の中の移動区間・予約(branch-v2)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 案の中で移動区間を変える(本案と違う項目だけ)・外す・足す(この案の予定どうし。足した予定は key で指す) | IMPLEMENTED | `itinerary_branches.resources`、`app/services/branch_resources.py`、PUT `.../content {events, resources}`・`.../resources`、BR `test_validate_rejects_bad_shapes`・`test_resources_adopt_and_undo_restore_everything`、`BranchResourcesPanel`、E2E |
| 2 | 予約を別の予定へ付け替える・紐付けを外す・取り消す予定にする。確定した紐付けの予約は変えられない | IMPLEMENTED | BR、`BranchResources.test.tsx` |
| 3 | 予約先へは何も送らない。取り消す予定の予約は、採用で紐付けを外し準備の一覧に「予約の取消の手続き」(期限 = 取消期限)を作るだけ | IMPLEMENTED | BR `test_cancel_planned_creates_task_and_never_cancels`、E2E |
| 4 | 採用の前に変更ごとに確かめる(頼る変更・競合・作る準備)。選んだ変更だけを採用し、選ばなかった変更は当てずに閉じる | IMPLEMENTED | GET `.../adoption-preview?only=`、POST `.../adopt {only}`、BR `test_partial_adoption_and_three_way_conflicts`、`AdoptionDialog`、E2E |
| 5 | 分岐の後に本案でも変わった・消えた・確定された区間・予約は採用を止める(三方向の取り込み)。外す予定に付いた区間・予約の扱いを決めるまで採用できない | IMPLEMENTED | BR `test_reservation_changed_in_plan_blocks_and_undo_refuses_after_relink`、`pendingRelations` |
| 6 | 本案の「元に戻す」で予定・区間・予約の紐付け・作った準備まで戻る。採用の後に紐付けを変えていれば 409 | IMPLEMENTED | `plans.py` の undo、BR、E2E |
| 7 | 見せない設定の参加者には予約・費用の変更も競合の詳細も出さない | IMPLEMENTED | BR `test_member_policy_hides_reservation_and_cost_changes` |
| 8 | 比較(G7)に区間・予約の変更を含める(外す区間・取り消す予定の予約の費用は「外す分」) | IMPLEMENTED | `branch_compare.simulate_resources`・`resource_cost_items`、BR |
| 9 | 案どうしの統合(rebase) | NOT STARTED | ADR-branches §3(範囲外) |

## FR-021・FR-039 所有者の移譲

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 10 | 所有者がパスワードで本人確認し、参加済みの会員の共同編集者へ申し出る。相手がパスワードで受け入れた時に替わる。断る・取り下げ・期限(7日) | IMPLEMENTED | `plan_ownership_transfers`、`app/api/v1/ownership.py`、OC `test_transfer_request_accept_and_roles`・`test_transfer_decline_cancel_expire_and_invalidated`、`OwnershipTransferPanel`・`IncomingTransfers`、E2E |
| 11 | 手続き中は1件。旅行の削除・受け取る人を外すことを止める(409)。受け入れの時に確かめ直す(崩れていれば 409) | IMPLEMENTED | 部分の一意の索引、`travel.py`・`share.py` の確認、OC |
| 12 | 前の所有者は選んだ役割で残るか外れる。両者へ通知。監査は ID・役割・結果だけ | IMPLEMENTED | OC |
| 13 | アカウントの削除で手続き中の移譲を取り下げる。旅行の書き出しに含める | IMPLEMENTED | `account_deletion`、`data_export.PLAN_TABLES`、OC `test_account_deletion_closes_transfers_and_export_includes` |

## FR-039 出典・確認・履歴つきの訂正

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 14 | 表示名・メールアドレスを出典(本人の申告・公的な書類・予約の確認書・その他)と補足つきで直す。前後の値は本人のデータ鍵で暗号化 | IMPLEMENTED | `data_corrections`、`app/api/v1/corrections.py`、OC `test_self_correction_history_revert_and_email_reauth`、`CorrectionsCard`、E2E |
| 15 | メールアドレスはパスワードで本人確認(確認済みの印を外し他の端末を失効)。取り消しは今の値が訂正の後のままの時だけ | IMPLEMENTED | OC |
| 16 | 参加者が旅行の所有者へ訂正を申し出る(旅行のデータ鍵で暗号化)。所有者が対応・見送りを理由つきで記録し通知 | IMPLEMENTED | OC `test_correction_requests_to_owner`、`CorrectionRequestsPage`、E2E |
| 17 | 暗号化できない時は値を変えずに 503 | IMPLEMENTED | OC `test_corrections_without_encryption_change_nothing`(E2E の予行で、鍵の無い環境で 500 になる不具合を見つけて直した) |
| 18 | アカウントの書き出しに入り、アカウントの削除で消える | IMPLEMENTED | `api/v1/data_export.py`、`account_deletion` |

## FR-004 定期の処理の記録・2つの端末の同時の編集

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 19 | 9つの定期の処理の実行(時刻・成否・件数だけ)を残し、30日で消す | IMPLEMENTED | `ops_job_runs`、`app/ops/job_runs.py`、JR `test_recorded_success_failure_and_states`・`test_old_runs_are_pruned`・`test_existing_jobs_record_runs` |
| 20 | 続いて動いているかの判定(ok・overdue・failing・never)。CLI・管理者の画面・監視で同じ判定 | IMPLEMENTED | `python -m app.ops.job_runs status`、GET `/admin/ops/jobs`、`tcops.py monitor`、JR `test_monitor_flags_overdue_and_failing_only`・`test_admin_jobs_endpoint_requires_admin`、`AdminJobsPanel`、E2E |
| 21 | 同じ会員の2つの端末で同じ予定を同時に直すと、あとの保存は違いを示し、重ねて保存できる | IMPLEMENTED | E2E(2つのブラウザの文脈・同じ会員) |

## FR-051 訪問の訂正・除外(V3 の証拠の整理)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 22 | 訂正(確定・通過・取消・非表示・戻す)の If-Match・権限・守る範囲の除外の証拠を台帳に登録 | IMPLEMENTED | `v1-verification-ledger.json` FR-051(`test_gate_v2_visits.py::test_visit_flow`・`test_gate_g6_location_memory.py`)、E2E `visits.spec.ts` |

## G9 Q03・UX-0・UX-1

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 23 | Q03 最初に読む JS の上限を 450 → 430 kB。API の応答の検査(decoder)を使う時に読む塊へ分けた(約 27 kB 減) | IMPLEMENTED | `scripts/ci/check_bundle_budget.py`、`services/api/decodersCore.ts`(最初に要る分だけ)、各 endpoints の `DL()` |
| 24 | UX-0 今の6画面(ダッシュボード・プランナー・今日・予約・共有・設定)を PC・スマホで撮り、優先する作業と壊してはいけない所を記録 | IMPLEMENTED | `docs/ux/UX-0_baseline.md`、`docs/ux/baseline/*.jpg`、撮影 `frontend/ux/capture.spec.ts`(CI では動かさない) |
| 25 | UX-0 壊してはいけない所(目印・見出し・主な情報・横のはみ出し・axe)を PC・スマホの幅で CI で確かめる | IMPLEMENTED | UXB |
| 26 | UX-1 デザインの決まり(色・面4種類・角・影・余白・文字・動き)の正本と CSS 変数の一致、文字と地の AA、強調色の補正 | IMPLEMENTED | `src/styles/tokens.ts`・`tokens.css`・`tokens.test.ts`、ADR-design-tokens |
| 27 | UX-1 面の部品と一覧(明るい・暗い)に axe 違反が無い。すりガラスを使えない環境の逃げ道 | IMPLEMENTED | `components/design/Surface.tsx`、`/design-system`、E2E |
| 28 | 既存の画面の部品をデザインの決まりへ置き換える | NOT STARTED | UX-6(今の見た目を変えないため、本 Gate では置き換えない) |

## 横断

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 29 | migration の往復(表・列・制約・部分の一意の索引・外部キーの索引) | IMPLEMENTED | `f4d8a2c6e9b1` |
| 30 | 応答の形の検査(実 backend の応答) | IMPLEMENTED | `__fixtures__/g8Responses.json`、`g8.test.ts`、`backendRoutes.json`(URL の実在) |
| 31 | UX-0 の記録・検査で見つけた不具合: プランナーの操作のボタンが画面の外に出て押せない・日付の無い旅行の「Invalid Date」・スマホで題名が1文字ずつ折り返す・スマホのヘッダーのボタンに名前が無い・補足の文字のコントラスト不足(お知らせ・ダッシュボードほか) | IMPLEMENTED | `PlannerPage.tsx`(`planner-actions`)・`PlanHeader.tsx`・`Header.tsx`・`NotificationsPage.tsx` ほか、UXB・E2E の axe、`docs/ux/UX-0_baseline.md` §2.1 |
| 32 | 設計の判断 | IMPLEMENTED | `docs/adr/ADR-branches.md` §2.5・`ADR-ownership-corrections.md`・`ADR-operations.md` §2.6・`ADR-design-tokens.md` |
