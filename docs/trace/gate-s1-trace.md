# Gate S1 セキュリティ基盤の仕上げ トレーサビリティ表

- 対象: SEC-00(CI の復旧)、SEC-01(ログ保護の仕上げ、F02〜F04)、SEC-23(依存の脆弱性)
- Gate: S1(DB・API の変更なし。依存の更新あり)
- 前提: Gate K1 適用後
- 関連ADR: `docs/adr/ADR-security-baseline.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_s1_log_output.py`(B)、`frontend/src/utils/safeNavigation.test.ts`(F)、
`scripts/security/*.py --self-test`(S)、CI `dependency-audit`。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | CI の秘密情報検査が誤検知で止まらない | F01 | IMPLEMENTED | `scan_secrets.py` 0件、試験の接続文字列を `dummy-` 化 |
| 2 | 検査が同じ行の本物の資格情報を見逃さない | F01 | IMPLEMENTED | S `scan_secrets.py --self-test` |
| 3 | extra=… の入れ子の値を伏せる | F02 | IMPLEMENTED | B `test_structured_formatter_hides_nested_extra_data`, `test_extra_attributes_with_secret_names_are_hidden` |
| 4 | extra で基本の項目を上書きできない | F02 | IMPLEMENTED | B `test_extra_data_cannot_overwrite_base_fields` |
| 5 | 構造化ログの例外の本文・トレースバックを伏せる | F03 | IMPLEMENTED | B `test_structured_formatter_hides_exception_text` |
| 6 | `password=%s` 等を整形してから伏せる | F04 | IMPLEMENTED | B `test_placeholders_next_to_secret_names_format_and_hide` |
| 7 | 整形できない記録でも stderr に生の引数を出さない | F04 | IMPLEMENTED | B `test_unformattable_record_does_not_print_raw_args_to_stderr` |
| 8 | アクセスログの引数整形を保ち、トークンを伏せる | O2 | IMPLEMENTED | B `test_uvicorn_access_log_keeps_args_and_hides_tokens`、O2 の既存試験 |
| 9 | 全ログ検査が extra も見る | F02 | IMPLEMENTED | B `test_leak_collector_inspects_extras` |
| 10 | backend の依存に既知の脆弱性が無い | SEC-23 | IMPLEMENTED | pip-audit(requirements-dev.txt)0件 |
| 11 | 使っていない依存を外す | SEC-23 | IMPLEMENTED | requirements.txt を import している部品だけに |
| 12 | JWT を保守されている実装へ、方式を HMAC に限定 | SEC-23 | IMPLEMENTED | PyJWT 2.15、`JWT_ALGORITHM` の検証、認証の既存試験 |
| 13 | 新しい FastAPI でもルートの列挙が壊れない | — | IMPLEMENTED | `route_index.py`、/ready・/metrics・CORS の既存試験(新旧の依存で合格) |
| 14 | frontend のブラウザへ届く依存の修正 | SEC-23 | PARTIAL | axios・react-router 6 の範囲で修正。react-router の2件は到達しないため期限付き例外 |
| 15 | 依存の検査を CI で止める(例外は理由・期限つき) | SEC-23 | IMPLEMENTED | CI `dependency-audit`、S `audit_deps.py self-test` |
| 16 | 画面内の移動先をアプリ内のパスに限る | GHSA-wrjc | IMPLEMENTED | F `safeNavigation.test.ts`、準備状況の「開く」 |
| 17 | vite・tailwind・vitest・react-router のメジャー更新 | SEC-23 | NOT STARTED | ADR §3(期限 2026-12-31) |
| 18 | main ブランチの保護 | SEC-24 | NOT STARTED | GitHub の設定(ADR §3) ※ **SUPERSEDED BY Gate S11・H1(必須の CI・管理者にも適用で保護済み。G1 で設定を docs/ops/evidence/ に記録)** |
