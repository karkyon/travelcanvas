# ADR: 文書の配信条件・アップロードの上限とウイルス検査・トークンの確認(Gate S4)

- 状態: 採用(2026-10-18)
- 対象: F08(文書 URL の再確認)、F09(上限・未検査ファイル)、F18(監査の書き込み失敗)、SEC-10(認可の網羅試験)、
  トークンの種類・ゲストの行・CSRF の追加の棚卸し(セキュリティ整理 §7 の末尾)
- migration: なし

## 背景

1. 文書のダウンロード URL は「発行時に権限を確かめ、受け取り口は署名と期限だけを見る」作りだった。共有を取り消した・
   分類を restricted に変えた・ログアウトした後も、15分の期限内は URL で取れた。
2. アップロードは全部をメモリに読んでから大きさを測り、検査なし(not_scanned)のまま保存・配信していた。要求の本文の上限も無かった。
3. API の認証はトークンの種類を見ておらず、更新用(refresh)の JWT もアクセストークンとして通った。ゲストトークンは
   users に行が無くても通り、会員へ昇格した後も古いゲストトークンが使えた。セッションの無い会員トークンも通った。
4. 更新用 cookie の Secure は APP_ENV が "production" ちょうどの時だけ。ログアウトはアクセストークンが期限切れだと 401 になり、
   cookie もセッションも残った。cookie だけで動く操作(更新)に Origin の確認が無かった。
5. 監査ログの書き込み失敗は warning だけで、続いても誰も気付けなかった。

## 決定

### F08 文書 URL
- トークン(v2)に「文書・利用者・文書の版(revision)・セッション・期限」を入れて署名する。受け取り口で
  版が同じ・利用者が有効・セッションが有効・今も plan の viewer 以上・restricted なら持ち主、を確かめ直す。
  どれかが崩れたら 403(監査 `document_download_denied` と理由、計数 `download_denied`)。
- 期限の既定を 120 秒にする(画面は受け取ってすぐ開く)。古い形(利用者の無い)トークンは受け付けない。
- 応答に `Cache-Control: no-store, private`・`nosniff`・`CSP: default-src 'none'; sandbox` を付ける。
- URL にトークンを置く方式自体は維持する(画面がリンクのクリックでダウンロードするため)。uvicorn のアクセスログでは
  token= は伏せられる(Gate O2)。

### F09 アップロード
- `BodySizeLimitMiddleware`: Content-Length が上限超なら本文を読まずに 413。chunked は読みながら数えて打ち切る。
  上限は通常 2MB、ファイルの受け取り口は文書の上限 + 1MB。CORS の内側に置き、413 にも CORS のヘッダーが付く。
- ハンドラでも 1MB ずつ読んで上限で止める(`read_upload_limited`)。
- `malware_scan`: 方式は none / clamav(clamd に INSTREAM)。EICAR は内蔵の照合で必ず検出(本物を使わずに経路を試験できる)。
  感染していれば保存せずに 422(隔離して残さない)。`DOCUMENT_REQUIRE_CLEAN_SCAN=true` なら、検査できない時は 503、
  clean 以外の文書は配らない(409)。感染・隔離の文書はいつでも配らない。
- ClamAV は compose の `malware-scan` プロファイル(既定では起動しない。メモリ約1.5GB)。

### トークン・cookie
- API に使えるのはアクセス・ゲストトークンだけ。exp の無い JWT は拒否。会員トークンはセッション必須で、
  セッションの持ち主がトークンの利用者と一致すること。
- ゲストは users の行が有り、user_type が guest で、有効な時だけ。
- 更新用 cookie は `settings.is_production`(production / prod / staging)で必ず Secure。
- 更新・ログアウトは、許可していない Origin と `Sec-Fetch-Site: cross-site` を 403(監査 `cross_site_request_blocked`)。
- ログアウトはアクセストークンが無効でも受け付け、cookie の更新鍵が今のものと一致するセッションも失効させる。

### 計数(F18 と攻撃の兆候)
- `/metrics` に `travelcanvas_security_events_total{kind}`: audit_write_failed / body_too_large / upload_too_large /
  malware_rejected / malware_scan_unavailable / download_denied。値・利用者・IP は入れない。

### SEC-10 認可の網羅試験
- `tests/test_gate_s4_authz_matrix.py`: 全ルート(251)を列挙し、資格情報なし → 公開と決めたルート以外は 401/403、
  関係のない会員・ゲスト → 他人のプランのルート(約170)は 403/404/422(ゲストは会員限定で 401)、
  正しい本文でも主な書き込み口は 403/404。新しいルートで認可を付け忘れると落ちる。公開ルートは理由と一緒に一覧へ足す。
- 結果: 認可の抜けは見つからなかった(ログアウトが資格情報なしで 200 になるのは仕様。上記で cookie を確かめる形にした)。

## 採らなかった案
- 受け取り口で Authorization を必須にする: 画面がリンクのクリック(Authorization を付けられない)でダウンロードするため、
  画面の作りを変える必要がある。結び付けと再確認で、取消・変更・ログアウトは即座に効く。
- 感染ファイルを隔離して残す: 復号・配信の経路に乗せないため、受け取らない方を選んだ。
- plan が無い時と権限が無い時の 404/403 の統一: plan の ID は推測できない UUID のため、既存の挙動を維持する。

## 残り
- 管理者の多要素認証・CAPTCHA(SEC-06/07)、異常の自動検知と段階的な対応(SEC-16/17)は次の Gate。
- アクセストークンをブラウザの保存領域に置かない(F15)は次の Gate(画面側)。
