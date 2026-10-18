# Gate S2 認証の強化と応答ヘッダー トレーサビリティ表

- 対象: SEC-02(本番設定の検査、F10)、SEC-03(応答ヘッダー)、SEC-05(パスワード規則、F05)、SEC-08(refresh の競合、F06)、SEC-09(重要操作の再認証、F14)
- Gate: S2(migration なし)
- 前提: Gate S1 適用後
- 関連ADR: `docs/adr/ADR-auth-hardening.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_s2_auth_hardening.py`(B)、`frontend/src/test/securityHeaders.test.ts`(F)、`frontend/e2e/security-headers.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 登録・昇格・変更で同じパスワード規則 | F05 | IMPLEMENTED | B `test_register_rejects_weak_password_with_reason`, `test_guest_upgrade_enforces_the_same_policy`, `test_change_password_…` |
| 2 | bcrypt の72バイトを超える入力・よくあるもの・識別子を含むものを拒否 | F05 | IMPLEMENTED | B `test_password_problems`, `test_password_must_not_contain_identifiers` |
| 3 | refresh の検証・入れ替えを行ロックの中で行う | F06 | IMPLEMENTED | B `test_parallel_refresh_with_the_same_token_rotates_once`(実 DB・2スレッド。ロックを外すと失敗することを確認) |
| 4 | 複数タブの同時 refresh を盗用扱いにしない | F06 | IMPLEMENTED | B `test_refresh_within_grace_…`、`test_refresh_grace_expires` |
| 5 | 猶予を過ぎた再利用はセッションを失効 | F06 | IMPLEMENTED | `test_sessions.py::test_refresh_reuse_of_old_token_revokes_session` |
| 6 | セッション一覧に内部の値を出さない | — | IMPLEMENTED | B `test_session_list_hides_internal_refresh_state` |
| 7 | メールアドレスの変更に再認証、未確認へ、ほかの端末を失効 | F14 | IMPLEMENTED | B `test_email_change_requires_current_password_…`; E |
| 8 | 新しいアドレスの確認メール・旧アドレスへの通知 | F14 | NOT STARTED | メール送信の基盤待ち(ADR §3) |
| 9 | 本番で危険な設定のまま起動しない | F10 | IMPLEMENTED | B `test_production_refuses_unsafe_settings`(8通り)、`test_production_settings_pass_when_safe` |
| 10 | 本番で API 一覧を出さない | SEC-03 | IMPLEMENTED | `main.py`(is_production) |
| 11 | backend の全応答にセキュリティヘッダー | SEC-03 | IMPLEMENTED | B `test_security_headers_on_api_responses`, `test_hsts_in_production_and_no_csp_on_docs`; E |
| 12 | 画面の CSP 等。主な画面で違反0 | SEC-03 | IMPLEMENTED | F; E `画面と API の応答に…` |
| 13 | production build で source map を公開しない | SEC-03 | IMPLEMENTED | `vite.config.ts`(dist に .map なし) |
| 14 | 未使用の IP 位置取得(外部送信)を削除 | DOC-11 | IMPLEMENTED | `utils/geolocation.ts` 削除 |
| 15 | 管理者 MFA・CAPTCHA・共有のレート制限 | SEC-06/07/12 | NOT STARTED | 次の Gate |
