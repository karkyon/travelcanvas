# Gate SecretPolicy — 外部 API 鍵の取得元の一本化

基点: main `31016201cf35698d6de4f2ef0c40a5294e6a2a04`。実 API は呼ばない(adapter は未実装のまま)。提供元の認証の検証・Secret Manager・adapter は別 Gate。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 取得元は DB の有効な登録版だけ。.env・環境変数・settings へ戻らない | IMPLEMENTED | `test_no_db_version_never_falls_back_to_env`、`test_db_value_wins_and_env_is_never_read` |
| 2 | 無効化は保持され missing と区別。無効後も .env へ戻らない | IMPLEMENTED | `test_disabled_stays_disabled_even_with_env_left` |
| 3 | サンプル値(CHANGE_ME 等)を登録・移行で拒否。保存済み・.env の検出でも同じ規則 | IMPLEMENTED | `test_known_samples_are_placeholders`、`test_cms_rejects_placeholder_and_keeps_active_version`、`test_stored_placeholder_is_unusable_and_visible`、`test_env_placeholder_is_not_a_key` |
| 4 | 不正な候補で正常な有効版を壊さない | IMPLEMENTED | 同上 |
| 5 | 状態を分離(登録・形・取得・提供元認証)。登録済み≠提供元が認めた | IMPLEMENTED | `test_registered_is_not_provider_verified`、`test_corrupt_ciphertext_is_decrypt_failed_and_does_not_use_env` |
| 6 | 旧 .env は管理者の明示操作でだけ取り込む(理由必須・監査・値は返さない・.env は消さない) | IMPLEMENTED | `test_explicit_import_from_env`、`test_import_requires_admin` |
| 7 | 同時登録は 409、監査が書けなければ鍵も変えない(同一 transaction) | IMPLEMENTED | `test_conflict_is_reported_and_changes_nothing`、`test_audit_failure_changes_nothing` |
| 8 | 鍵の取得口は provider_secrets だけ。SDK の自動取得・静的なブラウザ鍵の経路が無い | IMPLEMENTED | `test_no_code_outside_provider_secrets_reads_provider_key_settings`、`test_frontend_has_no_static_google_maps_key_path` |
| 9 | 提供元への実接続の検証(1回の確認)・adapter・Secret Manager・鍵の入れ替え手順 | NOT_IMPLEMENTED(別 Gate) | — |
| 10 | 実機 192.168.1.11 の受入 | NOT_RUN(この Gate の変更の試験結果は上の自動試験のみ。過去の合格は流用しない) | — |
