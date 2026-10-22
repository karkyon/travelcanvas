# Gate A2 トレース(FR-040 管理・監査)と E2E の安定化

基準: main `4775f95`(Gate C1)。migration なし。B = backend `tests/test_gate_a2_admin.py`(多要素認証は `test_gate_s11_admin_mfa.py`)、
U = vitest、E = `frontend/e2e/admin.spec.ts`。

## FR-040 管理・監査(DOC-02「ユーザー状態、共有失効、外部連携障害、ジョブ、濫用、容量、セキュリティイベントを管理する。
サポート閲覧は同意・目的・時間制限・監査を必要とする」)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 管理者だけが使える(管理者以外は何も返さない) | IMPLEMENTED | B `test_non_admin_gets_nothing`、S4 の全ルートの認可の網羅 |
| 2 | 管理者は多要素認証が必須(S11) | IMPLEMENTED | E(設定するまで「管理者の確認」だけ。設定するとダッシュボード)、S11 の試験 |
| 3 | 管理者の権限は運用者だけが付ける・外す | IMPLEMENTED | `scripts/security_incident.py grant-admin / revoke-admin`(--yes、端末をログアウト、監査)。B `test_grant_and_revoke_admin`、Runbook §8.5 |
| 4 | ユーザー状態(停止・復活・認証) | IMPLEMENTED | 停止した人の端末をすぐログアウト(以前は発行済みのトークンが期限まで使えた)。確認つき。B・E |
| 5 | 自分自身・ほかの管理者を画面から止められない(締め出し・乗っ取った管理者による停止の防止) | IMPLEMENTED | 409 `self_target`・`admin_target`、一部だけ止めない。B・E |
| 6 | セキュリティイベント(監査ログ) | IMPLEMENTED | 監査ログの画面 `/admin/audit-logs`(種類・対象・期間・ページ)。U `AdminAuditLogs.test`、E |
| 7 | 運用者にも利用者の情報を必要以上に見せない | IMPLEMENTED | 監査ログの接続元は末尾を伏せる(IPv4 `x.x.x.x`、IPv6 は前の3区切り)、端末の種類は120文字まで。B |
| 8 | 管理者の閲覧・操作の監査 | IMPLEMENTED | 一覧・詳細・監査ログを見たことを残す(検索語・メールアドレスは残さない)。B |
| 9 | 検索の LIKE の特殊文字 | IMPLEMENTED | `%`・`_` を文字として扱う(以前は `%` で全件が当たった)。B |
| 10 | 応答の形の検査 | IMPLEMENTED | 管理者の5つの API を decoder で検査(以前は型の付いていない取得)。U `a2admin.test`・contract |
| 11 | サポート閲覧(同意・目的・時間制限) | NOT STARTED | — ※ **SUPERSEDED BY Gate G2(本人の許可・目的・1〜72時間・読み取り専用・監査・本人への知らせ。gate-g2-trace.md #G2-40)** |
| 12 | 共有の失効・外部連携障害・ジョブ・容量の管理画面 | NOT STARTED | 運用の道具(tcops.py monitor・/metrics)にはあるが、管理者の画面には無い ※ **SUPERSEDED BY Gate G2(管理者の「運用とサポート」画面。gate-g2-trace.md #G2-40)** |

→ INTEGRATED(部分、E2E有)。

既存の不具合の修正: 管理者の画面が `user_type === 'admin'` だけを見て is_superuser の管理者を追い返していた(判定は AdminRoute と
backend に一本化)。user_type が admin の人がアカウントの削除の画面から自分を消せた。管理者ダッシュボードの文字のコントラスト、
一覧の検索・絞り込みに名前が無かった(axe)。

## E2E の安定化(C1 の CI で e2e が1回目に落ちた件)

- 原因: CI は全ての E2E を同じ接続元から流し、点数(S6)を途中で消さない。それまでの試験の失敗(誤ったパスワード・他人の
  データへの 403 等)が積み上がり、最後の zz-security-challenge の時点で計算の確認(S7)の難しさが上がって、遅い CI の
  機械では 30 秒以内に解けなかった。再試行では1回目の点数が残り、最初の会員登録の応答が 428 になって試験の下準備が落ちた。
- 対処: 試験の下準備(`support/api.ts`・account-deletion)は、計算の確認の後に画面が自動で送り直した最後の応答を待つ。
  zz-security-challenge は時間に余裕を持たせ、応答の列を「最初が 428・途中も 428 だけ・最後が 200」で確かめる。
  さらに、点数が遮断の閾値(150)まで積み上がると 429 になる(サンドボックスで点数 120 から再現)ため、zz-security-challenge は
  最初に運用の道具(`security_incident.py unblock-all`、`e2e/support/admin.ts`)で点数を消してから、自分で点数 30 を作る。
  利用者の画面の動き(428 → 自動で解いて送り直す)と、遮断の仕組みは変えていない。
  docker の無い環境では `E2E_OPS_CMD`(security_incident.py の引数を後ろに付けて動かすコマンド)で差し替える。

## 会員登録の回数制限と E2E(A2 v1 の omega の E2E で collaboration・document-wallet が落ちた件)

- 会員登録は接続元ごとに1分5回まで(backend `RATE_LIMIT_AUTH`)。E2E は1つの接続元から多くの会員を作るため、試験の速さに
  よって別の spec の登録と同じ1分に重なり 429「登録試行回数が上限」になった(サンドボックスでは重ならず合格していた)。
- 対処: 全ての spec の会員登録を `e2e/support/api.ts` の `registerAccount` に一本化(計算の確認 428 の送り直しを待つ・429 の
  時は1分の枠が過ぎるのを待って最大2回やり直し、待つ分だけ試験の時間を延ばす)。回数制限そのものは変えない。
  サンドボックスで先に5回登録して枠を使い切った状態から collaboration が合格することを確認した。

## vitest の未処理の例外(A2 v2 の CI の frontend ジョブ)

- `AdminUsers.test.tsx` は services/api を丸ごと差し替えていた(v1 は一部、v2 は全てを空の関数)。authStore の再水和のタイマーが
  動くと restoreMemberSession が `error instanceof AuthApiError` を評価し、差し替えに AuthApiError が無いため例外になって
  「Errors 1」(試験は全部合格でも終了コード 1)。動く時刻によって起きたり起きなかったりした(サンドボックスでは5回中0回)。
- 対処: `getAdminUsers` だけを差し替え、残りは本物(`importOriginal`)。復元の処理を試験の中で明示的に動かして例外が無いことを
  確かめる試験を追加(前の差し替えに戻すと落ちることを確認)。

## Redis の接続先の設定の不具合(A2 v3 の CI の e2e で zz-security-challenge が落ちた件)

- 原因: docker-compose は backend に `REDIS_HOST=redis` を渡すが、設定(app/core/config.py)は `REDIS_URL` しか読まず、
  無ければ `redis://localhost:6379/0` だった。omega-dev2 の `.env` には REDIS_URL があるため動いていたが、CI の `.env` には無く、
  **CI の backend はずっと Redis に届かず**、回数制限(S3)・怪しさの点数(S6)・共同編集の知らせ(C1)をプロセスの中だけで
  数えていた。運用の道具(別のプロセス)は CI の backend の点数を消せず、`unblock-all` が「Redis に届かない」(終了コード 4)で失敗した。
- 対処: `REDIS_URL` が無い・空の時は `REDIS_HOST`・`REDIS_PORT`・`REDIS_PASSWORD`・`REDIS_DB` から作る(`resolve_redis_url`)。
  REDIS_URL があればそのまま使う(omega-dev2 の動きは変わらない)。試験 `tests/test_gate_a2_redis_config.py`。
- E2E の下準備の強化: ゲストの開始・ログイン・昇格の応答も、計算の確認(428)の後に画面が送り直した最後の応答を待つ。
  画面を通らない API の下準備(admin.spec のゲストの開始)は `e2e/support/challenge.ts` で計算の確認を解いて送り直す。
- 確かめ方(サンドボックスで CI と同じ条件を作った): Redis を 6380 番で動かし、REDIS_URL を設定せず、CI の `.env` と
  docker-compose の environment と同じ値で backend と運用の道具を動かす。
  - 直す前の設定: `unblock-all` が終了コード 4、zz-security-challenge が CI と同じエラーで失敗(再現)
  - 直した後: E2E 全47件が合格。続けて点数を消さずにもう1回流しても合格。backend が Redis を使っている(キーが入る)


## v4 の CI の secret-scan で落ちた件(v5 で修正)

- 現象: `backend/tests/test_gate_a2_redis_config.py:10` の試験用の接続文字列(利用者名とパスワードが1文字ずつの例)が「平文の資格情報」と判定された。
- 原因: 値がダミーと分かる印(dummy など)を含んでいなかった。パッチの中の検査は `git ls-files`(commit 済みのファイル)しか見ないため、
  新しいファイルを見逃して CI で初めて見つかった。
- 対策: 利用者名とパスワードを dummy にした。パッチの秘密の検査は、写しのインデックス(GIT_INDEX_FILE)に新しいファイルも登録して
  CI と同じ範囲を検査する(本物のインデックスは変えない)。古い値で検出されること、直した値で合格することを確認した。
