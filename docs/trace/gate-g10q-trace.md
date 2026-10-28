# Gate G10-Q トレース(品質: V3 再監査・E2E の不安定の根治・mypy の削減)

対象: 監査書「最新コード完全再監査 HEAD-3c23828(2026-10-28)」§9 の G10-Q。開始点は main `3c23828`。migration なし(Alembic head は
`f4d8a2c6e9b1` のまま。ORM の定義を書き換えたが DDL は変えていない。下の #3 の証拠)。FR の状態の遷移なし(DOC-10 r21 は
実測値・基準 commit・品質の基盤の記載だけを更新)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: Q = `backend/tests/test_gate_g10_quality.py`、
VL = `backend/tests/test_gate_v1_verification_ledger.py`、PF = `backend/tests/test_gate_g3_perf.py`、
AD = `frontend/e2e/account-deletion.spec.ts`、DP = `frontend/src/pages/DataPrivacyPage.test.tsx`、
AP = `frontend/src/pages/AccountDeletedPage.test.tsx`。

## 1. V3 再監査(58 FR × 台帳・証拠・E2E)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 58 FR の状態を、VERIFIED の証拠の台帳・E2E の spec と機械で突き合わせる(R1〜R8: 台帳と状態の一致・(部分)を VERIFIED にしない・E2E の印と spec・不足の記載・RELEASED 0) | IMPLEMENTED | `scripts/ci/audit_v3.py`、Q `test_v3_audit_rules_hold` |
| 2 | 結果: VERIFIED 38・INTEGRATED 19(うち(部分)17)・SPECIFIED 1・RELEASED 0。加重 81.9%(厳しめ 73.1%)。**誤った VERIFIED は 0**。状態の是正は無し | IMPLEMENTED | `python3 scripts/ci/audit_v3.py` の出力(PR の本文に貼る) |
| 3 | 見つけた不整合: FR-001・002・006・044 は VERIFIED だが、台帳の E2E の spec に FR の番号が無かった(内容は該当の機能を確かめていた)。spec の説明に番号を書き、「VERIFIED は番号を名乗る E2E が1本以上」を CI の検査にした | IMPLEMENTED | `quickdraft-flow`・`auth-flows`・`today-mode-mobile`・`share-clone` の spec、VL `test_verified_features_are_named_by_an_e2e_spec` |
| 4 | INTEGRATED で(部分)でない FR-014・015 の「E2E 一部」は、区間・経路を触る spec(gate-g7・gate-g8 等)の範囲と一致。Undo の E2E が残る(G12-Self) | IMPLEMENTED(記録) | `docs/trace/fr-status.json` の gaps |

## 2. E2E の不安定の根治(account-deletion.spec.ts)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 5 | 原因: 削除の後、完了の画面(`AccountDeletedPage`)はオフラインのデータの消去(IndexedDB)を待ってからログイン状態を消していた。その間に会員の定期の取得(見出しの未読数、60秒ごと)が当たると、失効したトークンで 401 → 更新も 401 → `window.location.href = '/login'` で強制的に移った(まれ。DOC-10 r20「計算の確認を常に求める設定で1回だけ落ちる」)。利用者には「削除の完了の画面がログイン画面に変わる」実害 | IMPLEMENTED | `services/api/core.ts` の 401 の処理、`components/Header.tsx` の定期の取得 |
| 6 | 修正: 削除が成功したら、API の共通処理の「401 で /login へ強制的に移す」を止めてから完了の画面へ移す(`api.suppressAuthRedirect()`。完了の画面 `/account-deleted` でも移さない)。完了の画面は最初にログイン状態を消し(定期の取得が止まる)、その後に止めた移動を戻してからオフラインのデータを消す。固定の待ち・再試行は使わない。※ 移る前に画面側でログイン状態を消す案は、保護の付いた設定の画面が先に /login へ移すため採らなかった(サンドボックスで 20 回とも失敗を確認) | IMPLEMENTED | `services/api/core.ts`・`pages/DataPrivacyPage.tsx`・`pages/AccountDeletedPage.tsx`、DP、AP、`services/api/core.silent.test.ts` |
| 7 | E2E の強化: 削除の後に `/login` へ移らないこと・失効したトークンで API を呼ばないことを記録して確かめる。エラーの表示は削除のカードの中だけを見る(他のカードの読み込みの失敗の `role=alert` と取り違えない) | IMPLEMENTED | AD |
| 8 | 連続 20 回・再試行 0 で合格(通常の設定・計算の確認を常に求める設定の両方) | IMPLEMENTED | PR の本文の実測 |

## 3. 型の品質(mypy 1,382 → 0)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 9 | models を SQLAlchemy 2.0 の `Mapped[...]` / `mapped_column` へ(1,195 列)。DB が NULL を許す列は `Optional`、既定値つきの列は `nullable=True` を明示して値ありとして扱う(DDL は変えない) | IMPLEMENTED | `app/models/models.py`、Q `test_orm_columns_match_migrated_database`(alembic の compare_metadata で列・型・NULL の差 0)・`test_models_use_typed_mapped_columns` |
| 10 | 呼び出し元が無く壊れていた ghost code を削除: `schemas/schemas.py`(import した瞬間に TypeError)・`schemas/travel.py`・`common.py`・`auth.py`・`user.py`・`crud/`・`utils/helpers.py`・`services/notification.py`(引数の合わない send_email・存在しない設定)・`AuthManager.login_user` 等(create_session を誤った引数で呼ぶ)・`core/logging.py` の存在しない設定を読む3関数・`utils/validators.py` の未使用の関数 | IMPLEMENTED | Q `test_dead_modules_removed`・`test_broken_auth_manager_methods_removed`・`test_broken_logging_helpers_removed`・`test_validators_keep_only_used_constants` |
| 11 | 型で見つかった None の扱いの漏れを直した: パスワードの無い利用者の照合・名前やメールが NULL の利用者の応答(500 になり得た)・時刻の読めない軌跡の点(TypeError)・2回目のセッションの取得が無い多要素認証(500)・案の中の更新で予定が消えていた時(500)・gather の CancelledError・判定の記録の再読込が無い時 など | IMPLEMENTED | Q `test_verify_password_rejects_missing_hash`・`test_user_response_tolerates_null_name_and_email`・`test_split_range_keeps_points_with_unreadable_time`、`docs/spec/error-catalog.md` の `sync_operation_missing` |
| 12 | 型の検査の設定: pydantic の mypy plugin(Settings() の必須の値は環境変数)・不要になった `type: ignore` も失敗にする(78 → 8 件)。基準は空(1件でも新しい型の誤りがあれば CI が落ちる) | IMPLEMENTED | `backend/mypy.ini`、`backend/mypy-baseline.txt`、`scripts/ci/check_mypy_baseline.py` |

## 4. 毎晩の性能の検査(perf)の失敗

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 13 | main の毎晩の perf が `99744c3`(G8・G9 前半)から失敗していた(`validation_run: SQL の数 34(少ない時 29)`)。G7 の日ごとの判定(休憩・疲れ)で、365 日 × 1 万件の旅行の判定の結果が数千件になり、1つの一括の INSERT が 1,000 行ずつの文に分かれていた | IMPLEMENTED(原因) | PF の再現(サンドボックス、予定 10,000・通知 100,000) |
| 14 | 計測: 同じ一括の INSERT の分割だけを1文として数える(行ごとの問い合わせの N+1 は従来どおり検出) | IMPLEMENTED | PF `count_queries` |
| 15 | 本当の非効率も直した: 判定の記録が 20 件を超えた時、古い記録の指摘を ORM が全て読み込んでから1行ずつ消していた → DB の外部キー(ON DELETE CASCADE)に任せ、記録だけを1文で消す | IMPLEMENTED | `app/api/v1/validation.py` `_prune_old_runs`、Q `test_prune_old_validation_runs_is_bulk` |
| 16 | 結果: 全 10 の画面の API で SQL の数が少ない時+2 以内、p95 は上限内(validation_run 約 3.0 秒 / 上限 8 秒) | IMPLEMENTED | PF(TC_PERF=1) |

## 4b. 単体試験の実行順・乱数による不安定(全体の実行で見つかったもの)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 17 | Header・Dashboard の試験: トークンの無い会員の状態を入れていたため、authStore が読み込み時に予約した `initialize()`(setTimeout 0)が「再読込の後」とみなして本物の `POST /auth/refresh` を呼ぶことがあった(実行順で `差し替えていない通信` が出る)。試験の会員にトークンを入れ、初期化済みにする | IMPLEMENTED | `frontend/src/components/Header.test.tsx`・`frontend/src/pages/DashboardPage.test.tsx`(vitest 全体を2回、838 合格・標準エラー 0 行) |
| 18 | 隠した費用・説明文が応答に無いことを、応答の文字列に `"900"`・`"3500"`・`"1234"` が無いことで調べていたため、乱数の ID・時刻にその数字が含まれると落ちた(G8 の試験で実際に1回)。JSON の値として調べる(`900.00` などの形も)・説明文は文の形で調べる。持ち主には値が見えること(検査が効くこと)も確かめた | IMPLEMENTED | `backend/tests/test_gate_g8_branch_resources.py`・`test_gate_g7_optimize_compare.py`・`test_gate_p8_calendar_import.py` |
| 19 | E2E `gate-g9.spec.ts`「オフラインはつながると読み直す」: プランナーへ移る時、URL は先に変わり画面の塊の読み込み中はダッシュボードの見出しが残るため、`h1` が見えるだけの待ちでは移り終わる前に通信を切ることがあった(閉じていないダッシュボードへ戻るだけで読み直さず、オフラインの表示が出ない)。プランナーの見出しが出てダッシュボードの見出しが消えたことを待つ(固定の待ち・再試行なし、10 回連続合格) | IMPLEMENTED | `frontend/e2e/gate-g9.spec.ts` |
| 20 | 依存の監査: 新しく公開された `deepmerge` の助言(GHSA-gcqx-w48m-w2h4、直った版なし)で CI が失敗。経路の `vite-plugin-pwa` は設定で使われていないため外した(例外にしない。他の依存の版は不変・最初に読む JS も不変) | IMPLEMENTED | `frontend/package.json`・`package-lock.json`、`scripts/security/audit_deps.py node` 失敗 0 件 |

## 5. 維持した基準

bundle 430 kB 以内・frontend の標準エラー 0・flake8 0・axe 0・migration の往復・本番用の Docker の build・秘密の検査・依存の監査は
変えていない(CI の5ジョブで確かめる)。GCP の関係のファイル・Alembic・CI の設定は変更していない。
