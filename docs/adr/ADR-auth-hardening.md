# ADR: 認証の強化と応答ヘッダー(Gate S2)

- 状態: 採用(Gate S2)
- 前提: Gate S1 適用後
- 関連: セキュリティ整理(2026-10-17)SEC-02・SEC-03・SEC-05・SEC-08・SEC-09、監査 F05・F06・F10・F14
- トレーサビリティ: `docs/trace/gate-s2-trace.md`

## 1. 背景

AI を使った攻撃は、弱いパスワードの総当たり・漏洩したパスワードの使い回し(パスワードリスト)・盗んだ
refresh token の並列利用・乗っ取ったセッションからの連絡先の書き換えを、休まず自動で試す。調査時点では:

- 登録・ゲストの昇格は `password: str` をそのまま hash していた(1文字でも登録できた)。変更だけ8文字の検査。
- refresh は「読む→比べる→無条件に書き換える」で行ロックが無く、同じ token の並列要求が両方成功し得た。
- メールアドレスの変更は即時で、再認証も確認状態の解除も無かった。
- 本番向けの設定の検査が無く、既定は DEBUG=True。API 一覧(/docs)も常に公開。
- 応答にセキュリティヘッダーが無く、画面は外部の何でも読み込めた。production build は source map を公開していた。
- 使われていない `utils/geolocation.ts` が、利用者の IP を外部サービスへ送り座標をコンソールに出す処理を持っていた。

## 2. 決定

- **パスワード**(`app/core/password_policy.py`): 登録・昇格・変更で同じ規則。8文字以上・bcrypt の72バイト以内・
  前後の空白と制御文字の禁止・よく使われるもの/同じ文字の繰り返し/連続した文字の禁止・メールアドレスのローカル部と
  利用者名を含むものの禁止。文字種の組み合わせは強制しない(NIST SP 800-63B)。変更は現在と同じ値を拒否。
  画面は8文字の最小長を事前に確かめ、それ以外はサーバーの理由をそのまま出す。
- **refresh**: `SELECT … FOR UPDATE` で行をロックし、検証・入れ替え・失効を1つのトランザクションで行う。
  直前の token のハッシュと入れ替え時刻を `user_sessions.device_info` に置き(migration なし)、入れ替えから
  20秒以内に直前の token が来たら「同じブラウザの複数タブの同時 refresh」としてアクセストークンだけを返す
  (cookie は先の応答が更新済み)。猶予を過ぎた再利用は従来どおり盗用としてセッションを失効させ、監査に残す。
  セッション一覧には内部の値を出さない。
- **メールアドレスの変更**: 現在のパスワードを必須にし(失敗は監査 `reauth_failed`)、変更後は `is_verified=False`、
  ほかの端末のセッションを失効、監査 `email_changed`(メールアドレスは残さない)。1分の試行回数を制限。
- **本番の設定**(`APP_ENV=production|prod|staging`): DEBUG・SQL_ECHO が有効、JWT_SECRET_KEY・ENCRYPTION_KEY・
  LOOKUP_INDEX_KEY・DOCUMENT_DOWNLOAD_SIGNING_KEY(・OFFLINE_PACK_KEY_SECRET)が32文字未満/見本の値/同じ値の使い回し、
  METRICS_TOKEN が無い、CORS_ORIGINS に https 以外・*・localhost、のどれかがあれば起動しない(値はエラーに出さない)。
  本番では /docs・/redoc・/openapi.json を出さない。
- **backend の応答ヘッダー**(`app/core/security_headers.py`): nosniff、X-Frame-Options DENY、Referrer-Policy
  no-referrer、COOP same-origin、Permissions-Policy、CSP `default-src 'none'; frame-ancestors 'none'` …(/docs を除く)、
  認証・オフライン鍵・プライバシーの応答は no-store、本番は HSTS。未捕捉の例外の 500 応答にも付ける。
- **画面の応答ヘッダー**(`frontend/src/config/securityHeaders.ts`、`vite preview`): CSP は self と API のオリジン、
  地図のタイル・Google Fonts・Google Maps、blob:/data: だけを許す。script に unsafe-inline/eval を付けない
  (style だけ、通知の部品のため)。Referrer-Policy は strict-origin-when-cross-origin(共有リンクのパスを外部へ送らない)。
  E2E で主な画面に CSP の違反が出ないことを確かめる。
- production build の source map は既定で作らない(`VITE_SOURCEMAP=true` の時だけ)。
- `utils/geolocation.ts` を削除。

## 3. 範囲外・残り

- 管理者の MFA、CAPTCHA、共有のレート制限(SEC-06/07/12)は次の Gate。
- 新しいメールアドレスの確認メール・旧アドレスへの通知は、メール送信の基盤ができてから(今は未確認に戻すだけ)。
- `vite preview` での配信自体を、本番では静的ファイルの配信(nginx 等)へ置き換える(SEC-D)。
- Google Fonts は外部から読む(利用者の IP が Google へ渡る)。自前で配信するかは別途判断。
