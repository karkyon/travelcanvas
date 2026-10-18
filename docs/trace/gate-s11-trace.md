# Gate S11 管理者の多要素認証・CI の復旧・main の保護 トレーサビリティ表

- 対象: SEC-06(管理者の多要素認証)、SEC-24(main の保護)、CI の backend の恒常的な失敗、E2E の不安定(preparation)
- Gate: S11(migration `e8b4c2a6d1f9`: 新しい表 `user_mfa` を1つ追加するだけ)
- 前提: Gate S10 `5b3ff04` 適用後
- 関連ADR: `docs/adr/ADR-admin-mfa.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は B = `backend/tests/test_gate_s11_admin_mfa.py`、
C = `backend/tests/test_gate_s11_ci_gate.py`、U = `frontend/src/services/api/s11mfa.test.ts`・
`frontend/src/store/authStore.mfa.test.ts`・`frontend/src/pages/LoginPage.test.tsx`・
`frontend/src/components/settings/MfaSection.test.tsx`・`frontend/src/components/admin/AdminMfaGate.test.tsx`、
E = `frontend/e2e/mfa.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | TOTP が RFC 6238 の試験値と一致・時計のずれ±30秒・形の検査 | IMPLEMENTED | B `test_totp_matches_rfc6238_vectors`、`test_match_rejects_replay_and_far_clock`、E(端末側の計算と一致) |
| 2 | 設定は再認証が要り、確認コードで登録を確かめてから有効になる | IMPLEMENTED | B `test_enroll_login_with_code_and_session_marked`、U、E |
| 3 | 秘密は暗号化、回復コードは平文で残さない。ログに出ない | IMPLEMENTED | B 同上(保存の形)・全試験のログ検査(秘密・回復コード・合図を照合)、`*_ciphertext` で復号確認の対象 |
| 4 | ログインの2段目: 確認コードの前にセッション・cookie を作らない | IMPLEMENTED | B 同上、U、E(cookie が無いこと) |
| 5 | 同じ確認コード・同じ合図・同じ回復コードは2回使えない | IMPLEMENTED | B 同上、`test_recovery_code_works_once` |
| 6 | 合図の偽造・期限切れ・アクセストークンの流用を拒否、1つの合図で5回まで | IMPLEMENTED | B `test_mfa_token_must_be_genuine` |
| 7 | 管理者の API: 未設定・未確認・確認が古い時は 403、確認すれば通る | IMPLEMENTED | B `test_admin_api_requires_enrolled_and_fresh_mfa`、U `AdminMfaGate` |
| 8 | 無効化はパスワード + 確認コード、ほかの端末をログアウト | IMPLEMENTED | B `test_disable_requires_password_and_code_and_logs_out_others`、U |
| 9 | 回復コードの作り直し(古いものは使えない) | IMPLEMENTED | B `test_regenerate_recovery_codes` |
| 10 | ゲスト・未ログインは使えない | IMPLEMENTED | B `test_guest_and_anonymous_cannot_use_mfa`、`test_gate_s4_authz_matrix.py`(verify だけ公開) |
| 11 | 誤りは自動遮断の点数になる | IMPLEMENTED | B `test_failed_codes_are_counted_by_the_guard` |
| 12 | アカウント削除で設定を消す | IMPLEMENTED | B `test_account_deletion_removes_mfa` |
| 13 | 本番で管理者の多要素認証を外せない | IMPLEMENTED | B `test_production_refuses_admin_mfa_off` |
| 14 | 運用者による解除(確認つき・全端末のログアウト・監査) | IMPLEMENTED | B `test_operator_reset_requires_confirmation`、Runbook §8.3 |
| 15 | 本人への通知(有効化・無効化・回復コードの使用) | IMPLEMENTED | B(通知の件数) |
| 16 | 画面: ログインの2段目・設定(QR は端末内で作る)・管理者の確認 | IMPLEMENTED | U、E(axe 込み) |
| 17 | passkey(WebAuthn) | NOT STARTED | ADR の限界 |
| 18 | CI の backend の失敗(34件)を解消 | IMPLEMENTED | `tests/conftest.py` の試験だけの既定値。CI と同じ構成(Python 3.12・PostgreSQL 16・.env なし)で全件合格 |
| 19 | 必須の CI の一覧が ci.yml と一致・gate/** でも CI が走る・合否の判定 | IMPLEMENTED | C |
| 20 | main の保護(必須の CI・管理者にも適用・強制 push と削除の禁止) | PARTIAL | `scripts/ops/ci_gate.py protect`。設定には管理者の GitHub のトークンが要る(無ければ画面の手順を表示) |
| 21 | パッチは CI に合格した commit だけを main へ送る | IMPLEMENTED | Gate S11 のパッチ(gate/s11 → `ci_gate.py wait` → main) |
| 22 | E2E の不安定(遷移中の localStorage の読み取り) | IMPLEMENTED | `e2e/support/guestPlan.ts` の `guestTokenFrom`(応答の本文から取る)。9本の spec を置き換え |
