# Gate O1 B-010 トレーサビリティ表

- 対象: B-010(backup/restore・監視・Runbook・rollback 演習)、DOC-10 §0.3「運用証拠」、FR-004 の残り(完全削除バッチの定期実行)
- Gate: O1(運用。DB変更なし。backend に `/metrics` と `/ready` の項目を追加、ホスト側の運用 CLI を追加)
- 設計: `docs/adr/ADR-operations.md`、手順: `docs/ops/RUNBOOK.md`、初回演習の記録: `docs/ops/drills/gate-o1-drill.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。証拠の B は backend 試験(`tests/test_gate_o1_ops.py`)、D は omega-dev2 での演習記録。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | DB と保存ファイルのバックアップ(目録・ハッシュ・件数) | B-010 | IMPLEMENTED | B `test_manifest_build_and_problems`, `test_local_drill_end_to_end`; D §1 |
| 2 | 作成直後の検証、途中で止まったものを使わない | B-010 | IMPLEMENTED | B `test_backup_id_roundtrip_and_listing`(.partial と目録無しを除外); D §1 |
| 3 | 改ざん・破損の検出 | B-010 | IMPLEMENTED | B `test_manifest_build_and_problems`, `test_local_drill_end_to_end`(改ざん後は復元しない) |
| 4 | 世代管理(日次7・週次4・最低3) | B-010 | IMPLEMENTED | B `test_select_backups_to_prune_keeps_daily_weekly_and_minimum` |
| 5 | 別名の DB への復元(運用中の DB・試験用 DB を拒否) | B-010、DOC-11 | IMPLEMENTED | B `test_check_drill_database_name`, `test_local_drill_end_to_end`; D §2 |
| 6 | 復元の確認: 表ごとの件数(運用中の変化を区別)・alembic の版 | B-010 | IMPLEMENTED | B `test_compare_table_counts`, `test_db_inventory_counts_and_revision`; D §2 |
| 7 | 復元の確認: 保存ファイル(件数・ハッシュ・DBが参照するのに無いもの) | B-010、FR-013/037 | IMPLEMENTED | B `test_compare_file_listings_and_archive_paths`; D §2 |
| 8 | 復元の確認: 暗号化列が今の鍵で復号できる・鍵の指紋の一致 | DOC-11 §14 | IMPLEMENTED | B `test_decrypt_check_detects_undecryptable_values`, `test_key_fingerprint_does_not_reveal_key_and_detects_mismatch`; D §2 |
| 9 | 展開先の外を指す tar を拒否 | セキュリティ | IMPLEMENTED | B `test_cli_archive_listing_rejects_path_traversal` |
| 10 | migration の rollback 演習(実データの複製で downgrade→upgrade) | B-010 | IMPLEMENTED | B `test_local_drill_end_to_end`; D §3 |
| 11 | コードの rollback 計画(戻し先までに必要な downgrade) | B-010 | IMPLEMENTED | B `test_rollback_plan_on_real_graph`, `test_real_migration_graph_has_single_head_matching_alembic`; D §4 |
| 12 | `/metrics`(ルートの型・状態の種類・応答時間、IDを含めない、アクセス制限) | B-010、DOC-11 | IMPLEMENTED | B `test_metrics_endpoint_records_route_template_not_ids`, `test_metrics_access_rule`, `test_unhandled_exception_counts_as_5xx` |
| 13 | `/ready` で DB の版とコードの migration head の一致を確認 | B-010 | IMPLEMENTED | B `test_ready_reports_migration_current`, `test_ready_is_503_when_db_is_behind_code` |
| 14 | 監視の判定(停止・未準備・コンテナ・5xx・遅延・ディスク・バックアップと演習の鮮度、再起動で誤検知しない) | B-010 | IMPLEMENTED | B `test_evaluate_monitor_healthy_and_problems`, `test_parse_prometheus_and_quantile`; D §5 |
| 15 | 通知は状態が変わった時だけ | B-010 | IMPLEMENTED | B `test_alert_transitions_only_on_change` |
| 16 | 定期実行(バックアップ・完全削除・毎週の演習・監視)の登録・解除 | B-010、FR-004 | IMPLEMENTED | B `test_cron_block_render_and_idempotent_merge`。登録は利用者が1度 `schedule install` を実行 |
| 17 | 秘密を出さない(接続文字列・鍵・パスワード) | DOC-11 | IMPLEMENTED | B `test_mask_url_hides_credentials_and_key_values`, `test_cli_compose_commands_never_embed_credentials`, `test_drill_report_has_no_secrets`, `test_storage_facts_lists_files_and_fingerprints_only` |
| 18 | Runbook(障害対応・復元・rollback の手順) | B-010 | IMPLEMENTED | `docs/ops/RUNBOOK.md` |
| 19 | バックアップの別機械・クラウドへの複製 | B-010 | NOT STARTED | ADR §4 |
| 20 | SLO・外部監視サービス・Prometheus/Grafana | DOC-07 | NOT STARTED | ADR §4(`/metrics` の形式は対応) |
| 21 | 保存ファイルの中身の復号確認 | DOC-11 | NOT STARTED | ADR §4 |
