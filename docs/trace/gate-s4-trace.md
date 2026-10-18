# Gate S4 文書の配信条件・アップロード・トークン トレーサビリティ表

- 対象: F08、F09、F18、SEC-10、トークン・cookie の棚卸し(セキュリティ整理 §7)
- Gate: S4(migration なし)
- 前提: Gate S3 適用後
- 関連ADR: `docs/adr/ADR-document-delivery-hardening.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は `backend/tests/test_gate_s4_security.py`(B)、
`backend/tests/test_gate_s4_authz_matrix.py`(M)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 共有を取り消すと発行済みの URL が使えない | F08 | IMPLEMENTED | B `test_download_url_stops_working_when_collaborator_is_removed` |
| 2 | 分類・名前を変えると発行済みの URL が使えない | F08 | IMPLEMENTED | B `test_download_url_stops_working_when_document_changes` |
| 3 | ログアウトすると発行済みの URL が使えない | F08 | IMPLEMENTED | B `test_download_url_stops_working_after_logout` |
| 4 | 無効にした利用者の URL が使えない | F08 | IMPLEMENTED | B `test_inactive_holder_cannot_use_old_url` |
| 5 | 古い形・壊れたトークンを拒否、期限は短く | F08 | IMPLEMENTED | B `test_unbound_or_garbage_download_tokens_are_rejected`、`test_download_url_carries_user_and_revision_and_short_ttl` |
| 6 | 配信の応答を保存させない・画面として開かせない | F08 | IMPLEMENTED | B 同上(no-store・sandbox・nosniff) |
| 7 | 本文の上限(宣言・chunked)、413 にも CORS | F09 | IMPLEMENTED | B `test_oversized_json_body_is_rejected_before_reading`、`test_chunked_body_over_limit_is_cut_off`、`test_upload_paths_get_the_document_limit` |
| 8 | 上限で読むのを止める | F09 | IMPLEMENTED | B `test_read_upload_limited_stops_early` |
| 9 | ウイルス(EICAR)を保存しない(文書・写真) | F09 | IMPLEMENTED | B `test_eicar_document_is_rejected_and_not_stored`、`test_eicar_memory_photo_is_rejected` |
| 10 | ClamAV の INSTREAM(clean / FOUND)・届かない時 | F09 | IMPLEMENTED | B `test_clamav_instream_protocol`、`test_clamav_clean_result_is_stored`、`test_unreachable_scanner` |
| 11 | 検査必須の時は未検査を受け付けず・配らない | F09 | IMPLEMENTED | B `test_require_clean_scan_without_scanner_refuses_upload_and_download` |
| 12 | refresh の JWT・セッションの無い・他人のセッション・exp の無いトークンを拒否 | §7 | IMPLEMENTED | B `test_refresh_type_jwt_is_not_accepted_as_access_token` ほか3件 |
| 13 | 行の無い・昇格済みのゲストトークンを拒否 | §7 | IMPLEMENTED | B `test_guest_token_without_user_row_is_rejected`、`test_old_guest_token_stops_working_after_upgrade` |
| 14 | cookie の操作を別のサイトから呼ばせない | SEC-B CSRF | IMPLEMENTED | B `test_refresh_from_foreign_origin_is_blocked` |
| 15 | 期限切れでもログアウトでセッションが消える・偽の cookie では消えない | §7 | IMPLEMENTED | B `test_logout_with_expired_access_token_still_revokes_cookie_session`、`test_logout_with_forged_cookie_does_not_revoke` |
| 16 | staging 等でも cookie が Secure | F10 | IMPLEMENTED | B `test_refresh_cookie_is_secure_in_every_strict_environment` |
| 17 | 監査の書き込み失敗・防御の働きを数える | F18 | IMPLEMENTED | B `test_audit_write_failure_is_counted`、`test_security_events_are_exposed_in_metrics` |
| 18 | 全ルートの認可(資格情報なし・他人・ゲスト) | SEC-10 | IMPLEMENTED | M 全5件(251ルート) |
| 19 | 設定の綴り誤り・矛盾を拒否 | F10 | IMPLEMENTED | B `test_scan_settings_are_validated` |
| 20 | 本物の ClamAV での受入 | F09 | PARTIAL | compose の `malware-scan` プロファイルを用意。omega-dev2 での起動は任意(Runbook §3.8) |
| 21 | 異常の自動検知・段階的な対応 | SEC-16/17 | NOT STARTED | 次の Gate |
