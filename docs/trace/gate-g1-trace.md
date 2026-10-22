# Gate G1 トレース(正本の統制・鍵の版の切り替え・CI の証拠)

対象: 監査の実行台帳(2026-10-20、`main@af7de3d`)の §15 の順序 1〜3(D1・RDB1・SEC-F1)と、同じく migration の要らない
GOV-02/03/04・SEC-F2・CI-01/02・DEP-05・REP-01/02。migration なし(Alembic head `e6b4c8d2f3a5` のまま)。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は B1 = `backend/tests/test_gate_g1_keys.py`、
B2 = `backend/tests/test_gate_g1_doc10.py`、B3 = `backend/tests/test_gate_g1_ci_evidence.py`。

| # | 監査 ID | 要件 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | GOV-01 | DOC-10 の本体を全58行で作り直し、基準 commit・migration head・試験件数・全 FR の状態・部分・証拠・次の Gate を統合 | IMPLEMENTED | `docs/spec/DOC-10_*.md`(v5.1-r13)、`docs/trace/fr-status.json`。B2 `test_doc10_generated_parts_match_status`・`test_doc10_states_migration_head_and_baseline_commit` |
| 2 | GOV-01 | CI で基準 HEAD・台帳の不一致を検出 | IMPLEMENTED | B2(基準 commit が HEAD の履歴にある・Alembic head が一致・VERIFIED が ledger と一致)。backend の checkout は履歴を全部取る |
| 3 | GOV-02 | 正本の配置と版管理(リポジトリ・資料室・ハンドオフの関係) | IMPLEMENTED | DOC-10 §0.2。資料室の旧版は廃止と明記(資料室の写しは commit を書く) |
| 4 | GOV-03 | VERIFIED の証拠がこの実行で合格したことを CI が確かめる(削除・skip・失敗で落ちる) | IMPLEMENTED | `scripts/ci/check_ledger_results.py`(backend・e2e)、B3 `test_ledger_results_backend`・`test_ledger_results_e2e`。CI の backend・e2e ジョブ |
| 5 | GOV-03 | 各 FR の証拠を API・DB・UI・a11y・性能まで構造化 | PARTIAL | E2E・権限・競合・セキュリティ・運用までは ledger にある。性能・復旧の機能別の証拠は次の V3 |
| 6 | GOV-04 | 後の Gate で解消した旧 trace の行に SUPERSEDED BY、今の状態の索引 | IMPLEMENTED | 17行に追記、`docs/trace/INDEX.md`(`scripts/ci/render_trace_index.py`)。B2 `test_trace_index_lists_every_trace_and_superseded_rows_are_marked` |
| 7 | REP-01 | `backend/dump.rdb` を追跡から外し、`.rdb` 等を CI で拒否 | IMPLEMENTED | `.gitignore`、`scripts/security/scan_secrets.py` の `FORBIDDEN_PATH_PATTERNS`(.env・鍵・証明書・DB のファイル・Redis のダンプ)と自己試験。B3 `test_secret_scanner_rejects_forbidden_files_and_nothing_is_tracked` |
| 8 | REP-02 | 公開範囲の方針・脆弱性の報告の窓口 | IMPLEMENTED | `SECURITY.md`(public のまま運用する理由・β 前に見直す)、`ci_gate.py enable-vuln-reporting`(パッチが実行) |
| 9 | SEC-F1 | 前の鍵で復号・今の鍵で暗号化 | IMPLEMENTED | `app/core/crypto.py`(MultiFernet)。B1 `test_previous_key_decrypts_and_new_writes_use_active_key` |
| 10 | SEC-F1 | 掛け直し(全件・再開・同時の書き込みを上書きしない・読めない値の隔離・保存ファイル) | IMPLEMENTED | `app/ops/rekey.py`、`tcops.py keys status/rekey`。B1 `test_rekey_*` |
| 11 | SEC-F1 | 前の鍵を外すと読めない(失効) | IMPLEMENTED | B1 `test_removed_key_is_revoked` |
| 12 | SEC-F1 | 戻す(rollback) | IMPLEMENTED | 鍵の入れ替えと再度の掛け直し(KEY-INVENTORY §2)。掛け直しは双方向で同じ処理 |
| 13 | SEC-F2 | 鍵の一覧(用途・切り替え方・影響)、用途を越えた同じ値・弱い鍵の検出、起動時の検査 | IMPLEMENTED | `app/core/key_inventory.py`、`docs/ops/KEY-INVENTORY.md`、`tcops.py keys check`、本番の起動の拒否。B1 `test_reuse_problems_*`・`test_key_inventory_document_lists_every_key`・`test_production_requires_separate_offline_pack_key` |
| 14 | SEC-F2 | `LOOKUP_INDEX_KEY` を替えた後の索引の作り直し | IMPLEMENTED | `backfill_lookup_index --all`。B1 `test_lookup_index_rebuild_after_key_change` |
| 15 | SEC-F3 | KMS / Secret Manager | NOT STARTED | 本番環境(PROD)と同時 |
| 16 | SEC-F4 | DB の権限の分離 | NOT STARTED | 次の Gate ※ **SUPERSEDED BY Gate G2(tc_app・tc_backup・tc_readonly_monitor、compose の migrate。gate-g2-trace.md #SEC-F4)** |
| 17 | SEC-F5 | 鍵の破棄による削除 | NOT STARTED | ADR-key-rotation §3 |
| 18 | CI-01 | main の保護の設定を監査の記録として保存 | IMPLEMENTED | `ci_gate.py export` → `docs/ops/evidence/branch-protection.json`(トークンのある omega-dev2 のパッチが作る)。B3 `test_protection_evidence_records_policy_without_secrets`・`test_recorded_branch_protection_meets_policy` |
| 19 | CI-02 | JUnit・E2E の報告・SBOM を合否に関わらず保存 | IMPLEMENTED | `.github/workflows/ci.yml`(upload-artifact、30〜90日)。B3 `test_workflow_keeps_results_and_checks_evidence` |
| 20 | CI-02 | coverage・migration の schema 差分の保存 | NOT STARTED | 次の Gate |
| 21 | DEP-05 | bundle の上限を CI で固定(最初に読む JS 450kB・gzip 150kB・1つの塊 500kB) | IMPLEMENTED | `scripts/ci/check_bundle_budget.py`(G1 時点: 442kB・gzip 136kB)。B3 `test_bundle_budget` |
| 22 | DEP-05 | 重い依存の遅延読込で余裕を作る | NOT STARTED | 主な中身は react-dom 130kB・API の窓口 96kB・axios 52kB・router 49kB。API の窓口の分割は DEP-1 と合わせる |
| 23 | SEC-23 | v2 の適用中に GitHub の CI で公表直後の脆弱性が見つかった: certifi 2026.7.22(PYSEC-2026-4320 / GHSA-6q48-6c7w-9gw2、鍵が漏れた eMudhra の中間 CA につながる根証明書) | IMPLEMENTED | `backend/requirements.txt` の certifi を 2026.10.19 へ(例外にしない。HTTPS の相手の確認に使う実行時の依存) |
| 24 | SEC-23 | 同じ日に公表された vite(launch-editor)の3件(GHSA-587h-7wmj-h5pm・GHSA-698v-4r3x-3vcv・GHSA-r825-w8mm-5pxw) | IMPLEMENTED | 既存の vite の build-only 例外(期限 2026-12-31、DEP-1 で解消)へ追加。`/__open-in-editor` は開発サーバーだけにあり `vite preview` に無いことを確認 |
| 25 | SEC-23 | 依存の検査を push の前に omega で行う(公表直後の脆弱性で GitHub の CI まで行ってから落ちない) | IMPLEMENTED | パッチが backend のコンテナの pip-audit と、npm audit を CI と同じ判定(`scripts/security/audit_deps.py`)で実行 |
