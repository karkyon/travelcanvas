# Gate S10 CSP 違反の報告 トレーサビリティ表

- 対象: SEC-15(検知の材料)・SEC-18(監視)
- Gate: S10(migration なし)
- 前提: Gate S9 適用後
- 関連ADR: `docs/adr/ADR-csp-reporting.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は B = `backend/tests/test_gate_s10_csp_reports.py`、
U = `frontend/src/test/securityHeaders.test.ts`、E = `frontend/e2e/csp-report.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | CSP に報告先を付ける(API クライアントと同じ基底 URL) | IMPLEMENTED | U、E |
| 2 | 止めた実行をブラウザが報告し、backend が受け取る | IMPLEMENTED | E(差し込んだインラインのスクリプトを止めて報告、204) |
| 3 | 2つの形式を受け取り、指示と止めた先のオリジンだけを残す | IMPLEMENTED | B `test_legacy_report_is_counted_without_values`、`test_reporting_api_format_is_counted`、`test_origin_only_is_kept` |
| 4 | 未知の指示で /metrics の種類を増やさない | IMPLEMENTED | B `test_unknown_directives_do_not_add_new_metric_kinds` |
| 5 | 形式違い・大きすぎる・多すぎる報告を断る | IMPLEMENTED | B `test_malformed_reports_are_refused`、`test_large_reports_are_refused`、`test_reports_are_rate_limited` |
| 6 | 自動遮断の点数に入れない | IMPLEMENTED | B `test_reports_never_feed_the_threat_guard` |
| 7 | 認証なしで受け取り、CORS で画面から送れる | IMPLEMENTED | B `test_no_authentication_needed_and_cors_allows_the_app` 、`test_gate_s4_authz_matrix.py` の公開ルートに理由つきで登録 |
| 8 | 急増を監視で通知 | IMPLEMENTED | B `test_monitor_warns_on_csp_spikes`、Runbook §3.11・§7 |
