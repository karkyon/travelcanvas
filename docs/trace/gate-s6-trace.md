# Gate S6 不審な接続元の自動遮断 トレーサビリティ表

- 対象: SEC-16(異常検知)・SEC-17(自動の隔離)・SEC-18(監視・通知)・SEC-27(攻撃の型の回帰試験)
- Gate: S6(migration なし)
- 前提: Gate S5 適用後
- 関連ADR: `docs/adr/ADR-threat-guard.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は `backend/tests/test_gate_s6_threat_guard.py`(B)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 接続元ごとに失敗を点数にして時間窓で合計する | SEC-16 | IMPLEMENTED | B `test_score_reaches_warning_then_block`、`test_classification` |
| 2 | 段階的な対応(注意→遮断→再犯は長く) | SEC-17 | IMPLEMENTED | B `test_score_reaches_warning_then_block`、`test_repeat_offender_gets_longer_block` |
| 3 | 入口を変えた ID の推測を止める | SEC-27 | IMPLEMENTED | B `test_id_enumeration_across_endpoints_gets_blocked` |
| 4 | メールを変えたパスワードリスト攻撃を止める | SEC-27 | IMPLEMENTED | B `test_credential_stuffing_with_rotating_emails_gets_blocked` |
| 5 | 偽トークンの連続を止める | SEC-27 | IMPLEMENTED | B `test_forged_token_spray_gets_blocked` |
| 6 | 別サイトからの操作・大きすぎる本文・ウイルスを点数にする | SEC-27 | IMPLEMENTED | B `test_explicit_signals_from_handlers_count`、`test_oversized_bodies_are_counted` |
| 7 | 普通の利用・監視の入口は止めない | — | IMPLEMENTED | B `test_normal_use_is_not_blocked`、`test_id_enumeration_…`(/health) |
| 8 | 遮断の 429 は数え直さない | — | IMPLEMENTED | B `test_requests_refused_by_the_guard_are_not_counted_again` |
| 9 | 遮断の応答に CORS・セキュリティヘッダー | — | IMPLEMENTED | B `test_block_response_has_cors_and_security_headers` |
| 10 | 信頼する接続元・無効化・解除 | 運用 | IMPLEMENTED | B `test_trusted_ips_are_never_counted`、`test_disabled_guard_does_nothing`、`test_reset_unblocks`、Runbook §3.9 |
| 11 | 全プロセスで共有(Redis)、IP を残さない | SEC-16 | IMPLEMENTED | B `test_guard_state_is_shared_through_redis` |
| 12 | 遮断・急増・監査の欠落を監視で通知 | SEC-18 | IMPLEMENTED | B `test_monitor_reports_blocks_spikes_and_audit_failures`、`test_block_and_warn_are_counted`、Runbook §7 |
| 13 | 外部の監視サービス(死活の外部確認) | SEC-18 | NOT STARTED | omega-dev2 の外からの確認は別途 |
