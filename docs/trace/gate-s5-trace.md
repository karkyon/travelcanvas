# Gate S5 トークンの保存場所 トレーサビリティ表

- 対象: F15(会員のアクセストークンを端末に保存しない)
- Gate: S5(migration なし、frontend だけ)
- 前提: Gate S4 適用後
- 関連ADR: `docs/adr/ADR-token-storage.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は U = `frontend/src/store/authStore.test.ts`、E = `frontend/e2e/auth-flows.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | ログイン・登録・昇格の後、会員のトークンが localStorage に無い | IMPLEMENTED | U `ログイン後に保存される内容にアクセストークンが無い`、E ログイン・昇格(保存内容の全体にトークンが無い) |
| 2 | 再読込の後も cookie でログインが続く | IMPLEMENTED | U `再読込の後(利用者だけが残っている)…`、E ログイン後の再読込で `/auth/refresh` 200 |
| 3 | cookie が切れていればログアウト状態 | IMPLEMENTED | U `cookie のログインが切れていれば(401)…` |
| 4 | オフラインではログイン中のまま(保存データを開ける) | IMPLEMENTED | U `通信できない時(オフライン)は…`、E `offline-pack.spec.ts` |
| 5 | 同時の初期化で更新は1回 | IMPLEMENTED | U `同時に何度初期化しても、更新は1回だけ送る` |
| 6 | 古い版が保存したトークンを捨てる | IMPLEMENTED | U `以前の版が保存した会員のトークンは読み込み時に捨てる` |
| 7 | ゲストのトークンは保存する | IMPLEMENTED | U `ゲストのトークンは保存する…`、E ゲスト開始 |
| 8 | console にトークン・パスワード・メールを出さない | IMPLEMENTED | U `expectNoSecretsLogged`、E ログイン・昇格 |
