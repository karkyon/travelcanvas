# ADR: 管理者の多要素認証(TOTP)と main の保護(Gate S11、SEC-06・SEC-24)

- 状態: 採用(2026-10-19)
- 関連: `backend/app/services/mfa.py`、`backend/app/api/v1/mfa.py`、`backend/app/api/v1/admin.py`(require_admin)、
  `frontend/src/components/settings/MfaSection.tsx`、`frontend/src/components/admin/AdminMfaGate.tsx`、
  `scripts/ops/ci_gate.py`、Runbook §8.3・§9、トレース `docs/trace/gate-s11-trace.md`

## 背景

AI を使ったパスワードリスト攻撃(他サイトで漏れた組の大量・分散の試行)は、S3〜S7 の回数制限・自動遮断・計算の確認で
減らせるが、正しいパスワードを1回で当てられた時は止められない。管理者のアカウントは全利用者の一覧・アカウント停止・
監査ログに届くため、パスワードだけで守るのは不十分(セキュリティ整理 SEC-06)。

また、GitHub の main に保護が無く、CI は 2026-09-17 以降ずっと不合格だった(backend の試験が CI の環境に
ENCRYPTION_KEY・CORS_ORIGINS・文書の保存先が無いため34件失敗)。CI が守りとして働いていなかった(SEC-24)。

## 決定

1. **TOTP(RFC 6238、HMAC-SHA1・30秒・6桁)** を採用する。passkey(WebAuthn)は端末・ブラウザの対応差と実装量が大きく、
   まず全端末で使える認証アプリの方式を入れる。外部ライブラリは使わず標準ライブラリで実装し、RFC の試験値で確かめる。
2. 秘密は `user_mfa.totp_secret_ciphertext`(ENCRYPTION_KEY の Fernet)に保存する。名前が `*_ciphertext` なので
   `tcops.py drill` の復号確認の対象になる。回復コード10個は利用者ごとの塩 + PBKDF2-SHA256(6万回)のハッシュだけを持ち、
   使ったものは消す。
3. **同じ確認コードは2回使えない**(最後に受け付けた区切り `last_used_step` 以前は拒否)。検証は行ロックの中で行い、
   同時の送信は1つだけ通る。前後1区切り(±30秒)の時計のずれまで受け付ける。
4. ログインは2段階: パスワードが正しく、多要素認証が有効なら、セッションを作らず「確認待ちの合図」(用途 `mfa_pending`・
   5分・jti 付きの JWT)を返す。`POST /auth/mfa/verify` で合図と確認コード(または回復コード)を受け取ってからセッションを作る。
   1つの合図で試せるのは5回、成功は1回だけ。利用者ごと15分10回、接続元ごとその3倍の回数制限。誤りは自動遮断の点数
   (`mfa_failed` 5点)になる。
5. セッションの `device_info` に確認した時刻(`_mfa_verified_at`)を残す(migration を増やさない。一覧の応答には出さない)。
   **管理者の API は、多要素認証を設定し、このセッションで12時間(`ADMIN_MFA_MAX_AGE_HOURS`)以内に確認コードを通した時だけ**
   使える。未設定は `mfa_enrollment_required`、確認がまだ・古い時は `mfa_step_up_required` の 403。画面は管理者のページの前で
   状態を確かめ、設定への案内か確認コードの入力を出す(確認の前に管理者のデータを読まない)。
6. 本番(APP_ENV=production 等)で `ADMIN_MFA_REQUIRED=false` なら起動しない(S2 の本番の検査に追加)。
7. 設定・無効化・回復コードの作り直しは現在のパスワードで再認証する。無効化はさらに確認コードを求め、ほかの端末を
   ログアウトさせる。設定・無効化・回復コードの使用は本人に通知する。端末と回復コードを両方なくした人は、運用者が本人確認の上
   `tcops.py security mfa-reset --email … --yes` で外す(全端末もログアウト、監査に残す)。
8. **main の保護**: 必須の CI(secret-scan / dependency-audit / frontend / backend / e2e)、管理者にも適用、強制 push・削除の禁止、
   直線の履歴。PR は求めない。パッチは検証した commit を `gate/<名前>` へ送り、CI の全ジョブの合格を待ってから同じ commit を
   main へ送る(GitHub は他のブランチで必須の CI に合格した commit なら、保護された main への直接の push を受け付ける)。
   CI が不合格なら main は変えず、手元を元に戻す。設定は `scripts/ops/ci_gate.py protect`(管理者のトークンが要る)か画面で行う。

## 結果・限界

- XSS で画面を乗っ取られた場合、ログイン中のセッションの操作は多要素認証では防げない(CSP・S5 で別に抑える)。
- フィッシングで確認コードをその場で中継されると防げない(passkey が必要。SEC-06 の残り)。
- SMS・メールでの確認コードは提供しない(SIM の乗っ取り・メールの侵害に弱く、SMTP も未設定のため)。
- 確認待ちの合図の「使用済み」は回数制限の仕組み(Redis)で共有する。Redis が落ちている時はプロセスごとになる(S3 と同じ)。
- main の保護の設定には管理者の GitHub の権限が要る。この Gate のパッチは、トークンがあれば設定し、無ければ画面の手順を表示する。
