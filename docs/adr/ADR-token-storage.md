# ADR: 会員のアクセストークンを端末に保存しない(Gate S5)

- 状態: 採用
- 対象: セキュリティ整理 F15(トークンの保存場所)、SEC-04 の一部
- 関連: Gate #28(refresh token を httpOnly cookie で発行)、Gate S2(refresh の行ロック・猶予)、Gate S4(cookie 操作の CSRF 対策)

## 背景

画面は会員のアクセストークンを `localStorage`(`auth_token`・`access_token`・`auth-storage` の `token`)に保存していた。
XSS・悪意あるブラウザ拡張・共有端末で読まれると、期限まで本人として API を使われる。
更新用の鍵(refresh token)は既に httpOnly cookie にあり、スクリプトからは読めない。

## 決定

1. 会員のアクセストークンはメモリだけに持つ(`ApiCore.setAccessToken` は既定で保存しない)。
   `auth-storage` は版1にし、`token` を保存しない。古い版が保存した `token`・`auth_token`・`access_token` は読み込み時に捨てる。
2. 再読込の後は、保存してある利用者情報があれば `POST /auth/refresh`(cookie)でトークンを取り直してから画面を出す。
   同時に何度初期化しても更新は1回だけ送る(S2 の猶予と合わせ、複数タブでも失効しない)。
3. 更新が 401/403 ならログアウトした状態にする。通信できない時(旅先のオフライン)はログイン中のまま続け、
   端末に置いたオフライン鍵(Gate K1)で保存データを開ける。通信が戻って 401 になれば、APIクライアントが cookie で取り直す。
4. ゲストには cookie の更新鍵が無いため、ゲストのトークンだけは従来どおり保存する(権限はそのゲストのデータだけ)。
   昇格すると会員になり、保存したゲストのトークンは消える。
5. `localStorage` が使えない環境(プライベートブラウズ等)でも止まらないよう、読み書きを try/catch で包む。

## 影響

- 再読込のたびに `/auth/refresh` が1回走る(S3 の回数制限は IP ごと1分60回)。
- E2E は会員のトークンを `localStorage` から読まず、登録・ログインの応答から受け取る(`e2e/support/api.ts`)。
