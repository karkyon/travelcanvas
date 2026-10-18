# Gate S9 新しい端末からのログインの通知・ログイン中の端末 トレーサビリティ表

- 対象: SEC-09 の一部(乗っ取りの検知)、FR-003 の不足(session一覧UI)
- Gate: S9(migration なし)
- 前提: Gate S8 適用後
- 関連ADR: `docs/adr/ADR-login-alerts.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は B = `backend/tests/test_gate_s9_login_alerts.py`、
U = `frontend/src/components/settings/ActiveSessionsSection.test.tsx`・`frontend/src/pages/SettingsPage.test.tsx`、
E = `frontend/e2e/active-sessions.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 端末の名前・丸めた接続元 | IMPLEMENTED | B `test_device_and_network_labels` |
| 2 | 新しい端末からのログインを本人に1回だけ通知(初回・同じ端末・失敗では出さない) | IMPLEMENTED | B `test_first_login_and_same_device_do_not_alert`、`test_new_device_login_alerts_the_owner_once`、`test_failed_login_from_new_device_does_not_alert`、E |
| 3 | 通知に完全な IP・メール・パスワードを書かない | IMPLEMENTED | B `test_new_device_login_alerts_the_owner_once` |
| 4 | 通知 API から見える | IMPLEMENTED | B `test_alert_is_visible_through_the_notifications_api`、E |
| 5 | ログイン中の端末の一覧(端末・接続元・最終利用・この端末) | IMPLEMENTED | B `test_session_list_shows_device_and_rounded_network`、U、E |
| 6 | ほかの端末をログアウトさせると、そのトークンは使えない | IMPLEMENTED | B 同上、U `ほかの端末をログアウトさせ…`、E |
| 7 | まとめてログアウト・失敗の数を伝える・読み込み失敗の再読み込み | IMPLEMENTED | U |
| 8 | 以前の版のセッションにも名前を付ける | IMPLEMENTED | B `test_old_sessions_without_device_field_still_get_a_label` |
| 9 | 設定のパスワード欄に続けて入力できる・label の結び付け | IMPLEMENTED | U `パスワード欄に続けて入力できる…`、E(axe) |
| 10 | メールでの通知 | NOT STARTED | SMTP の設定が無い |
