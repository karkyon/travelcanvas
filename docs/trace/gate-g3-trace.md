# Gate G3 トレース(基盤・品質: 外部の判断の要らない残り)

対象: 監査の実行台帳(2026-10-20、`main@af7de3d`)のうち、外部の判断・契約なしで進められる基盤・品質の項目 —
DEP-02・DEP-03・DEP-04・SEC-F5・SEC-F6・CI-02・CI-03・CI-04・CI-05・UX-04。migration 1つ(`a4c8e2f6b1d3`、
Alembic head `a4c8e2f6b1d3`)。FR の状態の遷移なし(横断の基盤)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: K = `backend/tests/test_gate_g3_data_keys.py`、
T = `test_gate_g3_ci_tools.py`、P = `test_gate_g3_perf.py`、E = `test_gate_g3_errors.py`、
N = `frontend/src/test/navigationSafety.test.ts`、S = `frontend/src/test/staticServer.test.ts`。

## DEP-02 画面の移動先(React Router 7 は G2)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 全ての navigate・`<Link to>`・href・window.open・location の書き換えを静的に検査 | IMPLEMENTED | N(TypeScript の構文木で全ファイル。自己試験つき) |
| 2 | 外部の値は safeInternalPath / safeExternalUrl / safeTelHref を通す(`javascript:` 等を開かない) | IMPLEMENTED | `src/utils/safeNavigation.ts`、検索の結果・公式サイト・予約・出典・動画・地図・電話・文書 |
| 3 | `//`・`\`・符号化した区切り・制御文字・絶対 URL の E2E | IMPLEMENTED | E2E `navigation-safety.spec.ts`、`safeNavigation.test.ts` |

## DEP-03 本番の画面の配信

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 4 | 実行の段に vite preview・開発の依存を入れない | IMPLEMENTED | `frontend/Dockerfile`(`node server/static-server.mjs`、dist と server だけ)。`securityHeaders.test.ts` |
| 5 | CSP・HSTS・キャッシュ・圧縮・SPA の経路・受け付ける名前・パスの外へ出ない | IMPLEMENTED | `frontend/server/static-server.mjs`。S(実際に待ち受けて HTTP で確かめる) |
| 6 | nginx・Cloud Run の静的配信 | NOT STARTED | 本番環境(PROD-1、GCP)と同時。今の配信は依存なしで同じ規則 |

## DEP-04 試験の警告

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 7 | console.error・warn(act 警告・未処理の例外・jsdom の通信の失敗)で試験を失敗にする | IMPLEMENTED | `src/test/setup.ts`。act 警告を出していた試験を直した(Testing Library 16) |
| 8 | 単体試験の本物の通信を禁止 | IMPLEMENTED | `src/test/setup.ts`(XMLHttpRequest・fetch) |
| 9 | 標準エラー 0 行を CI の条件にする | IMPLEMENTED | `scripts/ci/check_test_output.py`、ci.yml、パッチ |

## SEC-F5 鍵の破棄による削除(`docs/adr/ADR-data-keys.md`)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 10 | 旅行・利用者ごとのデータ鍵(KEK で包む) | IMPLEMENTED | `app/services/data_keys.py`、`data_keys`。K `test_plan_data_is_encrypted_with_the_plan_data_key` |
| 11 | 旅行の完全削除・アカウントの削除で鍵を破棄 | IMPLEMENTED | K `test_plan_purge_destroys_the_plan_key`・`test_account_deletion_destroys_the_user_key` |
| 12 | DB・バックアップの写しから読めない | IMPLEMENTED | ダンプから除き鍵の写しを別に、`keys purge-escrow`。K `test_escrow_export_import_and_purge`、O1 の復元演習 |
| 13 | 監査に中身を残さず破棄の記録だけ | IMPLEMENTED | `destroyed_at`・`destroy_reason`。点検で erased を別に数える(K) |
| 14 | KEK の切り替え・前の形への戻し | IMPLEMENTED | K `test_kek_rotation_rewraps_data_keys…`・`test_convert_to_envelope_and_back_is_idempotent` |

## SEC-F6 TOTP の秘密の保護

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 15 | TOTP の秘密を版つきの別の鍵(MFA_KEY)で包む・切り替え・失効 | IMPLEMENTED | K `test_totp_secret_uses_mfa_key_with_versions`・`test_rekey_moves_legacy_totp_to_mfa_key` |
| 16 | 解除は理由・申請者・承認者・期限を監査し二者で承認、本人の自己解除の禁止 | IMPLEMENTED | `app/services/mfa_reset.py`、`mfa_reset_requests`。K |

## CI-02〜05

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 17 | coverage(frontend・backend)・migration の構造の差分を保存 | IMPLEMENTED | ci.yml、`app/ops/schema_snapshot.py`。T |
| 18 | 落ちた試験を job の要約に自動表示 | IMPLEMENTED | `scripts/ci/junit_summary.py`。T |
| 19 | mypy を段階導入(基準より増やさない・新しいモジュールは厳しく) | IMPLEMENTED | `backend/mypy.ini`・`mypy-baseline.txt`(1,469件)・`scripts/ci/check_mypy_baseline.py`。T |
| 20 | 再試行で通った試験を別に数え issue 化・固定の待ちの禁止 | IMPLEMENTED | `scripts/ci/e2e_flaky_report.py`、vitest の retry 0。T |
| 21 | 20回連続の実行で flaky 0 | PARTIAL | サンドボックスで実行した回数と結果は下の「検証」 |
| 22 | 大きいデータの p95・SQL の数(N+1)・索引の使用・EXPLAIN の保存 | IMPLEMENTED | P、`.github/workflows/perf.yml`(毎晩)。旅行の詳細の N+1(365日で SQL 367回)を直した。外部キーの索引 101個 |

## UX-04 エラーの説明

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 23 | エラーの一覧(code・HTTP・再試行・利用者向けの文) | IMPLEMENTED | `docs/spec/error-catalog.md`(コードから生成・CI で照合)、`app/core/error_catalog.py` |
| 24 | 問い合わせ番号・再試行の可否を全てのエラーの応答に | IMPLEMENTED | `app/main.py` の例外の処理。E |
| 25 | 生の例外・`[object Object]`・秘密の値を表示しない | IMPLEMENTED | E `test_internal_errors_are_generic_with_support_id`・`test_validation_errors_do_not_echo_input`、`apiErrorDetail.test.ts` |
