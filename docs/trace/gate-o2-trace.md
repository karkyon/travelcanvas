# Gate O2 B-009 トレーサビリティ表

- 対象: B-009(backend のログの個人情報・秘密の自動検査)、DOC-11(ログの最小化)
- Gate: O2(DB変更なし。backend のログの出口で伏せる処理・出どころの修正・試験中と実コンテナのログの検査)
- 設計: `docs/adr/ADR-log-safety.md`、手順: `docs/ops/RUNBOOK.md` §3.6

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。証拠の B は `tests/test_gate_o2_log_safety.py`、S は全試験中のログの検査
(`tests/conftest.py` + `tests/test_zz_log_leak_scan.py`)、P は omega-dev2 でパッチが行う E2E 後のコンテナのログの検査。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | SQL の値をログ・DB エラーの文面に出さない(echo を DEBUG から分離、hide_parameters) | B-009 | IMPLEMENTED | B `test_sql_echo_is_off_by_default_and_parameters_are_hidden`, `test_sql_log_and_db_errors_do_not_show_parameters` |
| 2 | アクセスログの共有トークン・ダウンロードのトークンを伏せる | B-009、FR-021/013 | IMPLEMENTED | B `test_uvicorn_access_log_is_redacted`; P |
| 3 | メール・JWT・暗号文・ハッシュ・Bearer・資格情報・秘密のパラメータを伏せる(冪等、伏せすぎない) | DOC-11 | IMPLEMENTED | B `test_redact_rules`, `test_redact_keeps_non_secrets` |
| 4 | PostgreSQL のエラー文の値を伏せる | B-009 | IMPLEMENTED | B `test_redact_rules`(DETAIL・invalid input・LINE), `test_sql_log_and_db_errors_do_not_show_parameters` |
| 5 | 本文・引数・例外の文面のどれにも効く、数値の整形を壊さない | B-009 | IMPLEMENTED | B `test_factory_redacts_message_args_and_exceptions` |
| 6 | backend のどのプロセスにも入る | B-009 | IMPLEMENTED | B `test_installed_for_backend_process`, `test_log_safety_is_stdlib_only` |
| 7 | URL を出すライブラリ(httpx 等)のログを抑える | B-009 | IMPLEMENTED | B `test_log_safety_is_stdlib_only`; S(修正前は httpx の69件を検出) |
| 8 | ログイン失敗・メール通知・外部検索の失敗・関数呼び出しのログから個人情報を除く | B-009 | IMPLEMENTED | B `test_login_for_unknown_account_does_not_log_the_identifier`, `test_search_failure_does_not_log_the_query`, `test_no_logging_call_passes_sensitive_variables` |
| 9 | ログ呼び出しに個人情報・秘密を表す変数を渡さない(静的検査) | B-009 | IMPLEMENTED | B `test_no_logging_call_passes_sensitive_variables` |
| 10 | 試験の全実行中のログの自動検査(伏せる前の出どころと実際の出力、試験中に発行した秘密の照合) | B-009 | IMPLEMENTED | S; B `test_collector_registers_issued_tokens_and_passwords` |
| 11 | 実際のコンテナのログの検査(E2E のパスワードも照合)、見つけた値を表示しない | B-009 | IMPLEMENTED | B `test_log_scan_command_on_file`, `test_log_scan_compose_command_arguments`; P |
| 12 | 毎日の定期検査と監視(`log_leak`)・Runbook | B-009、B-010 | IMPLEMENTED | B `test_monitor_and_schedule_include_log_scan`; RUNBOOK §3.6 |
| 13 | 形で判別できない自由記述(メモ・予定名)の出口での検出 | DOC-11 | PARTIAL | 静的検査(#9)と既知の値の照合(#10・#11)で代替。出口の形による検出はしない(ADR §4) |
| 14 | 構造化ログ(JSON)・ログの保存期間 | DOC-11 | NOT STARTED | ADR §3 |
