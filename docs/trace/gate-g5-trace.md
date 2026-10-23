# Gate G5 トレース(機能: 費用・使用量・組織)

対象: 監査の実行台帳(2026-10-20、`main@af7de3d`)のうち、外部の判断・契約なしで進められる項目 —
FIN-01・FIN-02・BILL-02・ORG-01。migration 1つ(`c6e0a4b8d3f5`、Alembic head `c6e0a4b8d3f5`)。
FR の状態の遷移: FR-027 を VERIFIED(予算・費用)。FR-028 は VERIFIED のまま残りの不足を解消した。
FR-041 は組織の料金(FR-058、製品の判断待ち)が残るため(部分)のまま。FR-058 は使用量の上限の仕組みだけ(料金は実装しない)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: FN = `backend/tests/test_gate_g5_finance.py`、
UO = `test_gate_g5_usage_org.py`、E2E = `frontend/e2e/gate-g5.spec.ts`。

## FIN-01 予算(FR-027)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 予算の版(当初・更新・確定・実績)。作った時点の写しで上書きしない | IMPLEMENTED | `budget_versions`、`/plans/{id}/budget-versions`、FN `test_budget_versions_are_snapshots`、E2E |
| 2 | 為替の出典・取得時刻・基準日の記録。支出は使ったレートを指す(後の記録で過去の換算が変わらない) | IMPLEMENTED | `fx_rates`、`expenses.fx_rate_id`、FN `test_fx_rates_recorded_and_used_by_expense_and_reservations`、E2E |
| 3 | 予約額の換算(記録した為替の最新)。為替の無い通貨は基準通貨の合計に混ぜず通貨ごとに示す | IMPLEMENTED | `finance.reserved_amounts`、集計の `reserved.unconverted_by_currency`、FN |
| 4 | 為替の自動の取得 | NOT STARTED | 外部の為替の提供元(契約・利用規約の判断待ち)。出典つきの手入力で代える |

## FIN-02 精算(FR-028)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 5 | 支出の取消(理由つき。消さずに集計・精算・返金の合計から外す。返金のある支出は取り消せない) | IMPLEMENTED | `expenses.voided_at・void_reason`、POST `/expenses/{id}/void`、FN `test_void_keeps_row_but_leaves_totals`、E2E |
| 6 | 端数の規則(換算の丸め方・割り切れない端数の配り方)。既定は以前と同じ結果 | IMPLEMENTED | `plan_finance_settings.rounding_mode・remainder_to`、FN `test_rounding_and_remainder_rules`・`test_rounding_policy_applies_to_new_expenses` |
| 7 | 精算の締め(締めた後は支出・精算・設定を変えない。解除は所有者だけ・理由つき) | IMPLEMENTED | `plan_finance_settings.locked_at`、`/finance-lock`、409 `finance_locked`、FN `test_finance_lock_freezes_changes`、E2E |
| 8 | 領収書を紐付ける画面(この旅行の文書から選ぶ) | IMPLEMENTED | 支出の入力の「領収書」、`frontend/src/pages/ExpensesPage.g5.test.tsx` |
| 9 | 精算の記録の冪等(Idempotency-Key。同じ内容は最初の記録、違う内容は 409。同時の要求も一意の索引で1件) | IMPLEMENTED | `settlements.idempotency_key`(一意)、FN `test_settlement_idempotency_key` |

## BILL-02 使用量の上限(FR-058 の仕組み)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 10 | 利用者・組織・月ごとの使用量(アップロードの量・取込・移動の候補・共有リンク・組織の配布) | IMPLEMENTED | `usage_counters`、`app/services/usage.py`、UO `test_uploads_imports_routes_are_counted`・`test_distributions_count_against_org` |
| 11 | 上限の確認と加算を1文で(同時の要求でも越えない)。断った要求は何も変えない・失敗した操作では数が戻る | IMPLEMENTED | `UPDATE ... WHERE used + n <= 上限`、UO `test_consume_is_atomic_under_concurrency`・`test_share_links_hard_limit_soft_warning_and_rollback` |
| 12 | soft(8割で注意)・hard(429 `quota_exceeded`) | IMPLEMENTED | 設定 → 使用量、組織の画面、UO |
| 13 | 管理者の上書き(理由つき・監査) | IMPLEMENTED | PUT `/admin/usage/override`、UO `test_admin_override_with_reason`、管理の画面 |
| 14 | 料金・支払い・プランの区分 | NOT STARTED | 製品の判断待ち(FR-058) |

## ORG-01 組織(FR-041)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 15 | ロゴ(中身で形式を判定・大きさ・画素の上限・ウイルス検査・PNG に作り直して撮影情報を残さない。メンバーだけに配信) | IMPLEMENTED | `app/services/org_branding.py`、`/organizations/{id}/logo`、UO `test_logo_is_validated_and_rewritten`、E2E |
| 16 | 独自のドメインの所有の確認(DNS の TXT。確認済みは1つの組織だけ。組織を閉じると取り消す) | IMPLEMENTED | `organization_domains`(一意の部分索引)、UO `test_domain_verification_with_mocked_dns`(名前解決は差し替え)、E2E は登録まで |
| 17 | 席の上限(足す時に直列に数える。今の人数より下げない。席の記録) | IMPLEMENTED | `organizations.seat_limit`、`organization_seat_events`、UO `test_seat_limit`、E2E |
| 18 | 本番の DNS での確認 | PARTIAL | backend から外の DNS に届く環境で確かめる(RELEASE-1) |

## 横断

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 19 | 新しい表・列の migration の往復 | IMPLEMENTED | `c6e0a4b8d3f5`(足すだけ。downgrade で消す) |
| 20 | 旅行の書き出し・アカウントの削除に新しい表を含める | IMPLEMENTED | `data_export.PLAN_TABLES`(為替の記録・予算の版)、`account_deletion`(本人の使用量)、退会の席の記録は本人を残さない |
| 21 | 最初に読む JS を増やさない | IMPLEMENTED | 画面は後から読む塊、API は `frontend/src/services/api/g5.ts`(bundle-budget) |
| 22 | 型の検査(新しい誤りを足さない) | IMPLEMENTED | `backend/mypy-baseline.txt` |
