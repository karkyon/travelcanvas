# Gate S3 回数制限の共有 トレーサビリティ表

- 対象: SEC-12(共有の回数制限、F07)、SEC-15 の一部(拒否の数を監視へ)
- Gate: S3(migration なし)
- 前提: Gate S2 適用後
- 関連ADR: `docs/adr/ADR-shared-rate-limit.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は `backend/tests/test_gate_s3_rate_limit.py`(B)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 全てのプロセスが同じ数を見る(Redis) | F07 | IMPLEMENTED | B `test_redis_counts_are_shared_between_processes` |
| 2 | 並列でも上限を超えない(原子的) | F07 | IMPLEMENTED | B `test_redis_limit_is_atomic_under_concurrency`(20並列・上限5) |
| 3 | Redis にメール・IP を残さない、キーに期限 | DOC-11 | IMPLEMENTED | B `test_redis_keys_do_not_contain_identifiers` |
| 4 | Redis に届かない時はプロセス内で続け、監視に出す | F07 | IMPLEMENTED | B `test_falls_back_to_memory_when_redis_is_unreachable` |
| 5 | プロセス内の予備のキー数に上限、空のキーを消す | F07 | IMPLEMENTED | B `test_memory_keys_are_bounded_and_empty_keys_removed` |
| 6 | 拒否の数を種類ごとに /metrics へ(値は出さない) | SEC-15 | IMPLEMENTED | B `test_denials_are_counted_by_kind_without_values` |
| 7 | refresh の回数制限 | SEC-12 | IMPLEMENTED | B `test_refresh_is_rate_limited` |
| 8 | 自分の名前空間だけを消せる | 運用 | IMPLEMENTED | B `test_reset_all_only_touches_its_namespace`、Runbook §3.7 |
| 9 | E2E が Redis の制限で通ること | — | IMPLEMENTED | サンドボックスで E2E 40件(Redis 使用、予備への切替 0) |
| 10 | 異常の自動検知・段階的な対応 | SEC-16/17 | NOT STARTED | 次の Gate ※ **SUPERSEDED BY Gate S6 `36eb943`(自動遮断)** |
