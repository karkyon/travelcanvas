# 鍵の一覧と切り替えの手順(Gate G1・SEC-F1/F2)

> 機械が読む版は `backend/app/core/key_inventory.py`。鍵を足したらこの文書にも書く(書き忘れは
> `backend/tests/test_gate_g1_keys.py::test_key_inventory_document_lists_every_key` が落とす)。
> 鍵の値は文書・ログ・画面・バックアップの目録に出さない。出すのは版の名前(指紋。SHA-256 の先頭12桁)だけ。

## 1. 一覧

| 鍵 | 用途 | 切り替え方 | 切り替えた時に起きること | 本番で必須 |
|---|---|---|---|---|
| `ENCRYPTION_KEY` | データの暗号化(全ての `*_ciphertext` 列と保存ファイル。予約番号・チケット・秘匿制約・位置・文書・TOTP の秘密・Webhook の鍵) | 版の切り替え(§2) | 掛け直しが終わる前に前の鍵を外すと、その暗号文が読めない | ○ |
| `ENCRYPTION_KEYS_PREVIOUS` | 前の暗号化の鍵(復号だけ。カンマ区切り)。切り替えの途中だけ置く | 掛け直しが終わったら外す(失効) | 外した鍵の暗号文は読めない | — |
| `MFA_KEY` | [Gate G3] SEC-F6 多要素認証(TOTP)の秘密を包む鍵(データの暗号化の鍵とは別。未設定なら `ENCRYPTION_KEY`) | 版の切り替え(§2 と同じ手順。前の値は `MFA_KEYS_PREVIOUS`) | 掛け直しが終わる前に前の鍵を外すと、その人は確認コードでログインできない(回復コード・§3.1 の解除) | ○ |
| `MFA_KEYS_PREVIOUS` | 前の TOTP の鍵(復号だけ。カンマ区切り) | 掛け直しが終わったら外す | 外した鍵の暗号文は読めない | — |
| `LOOKUP_INDEX_KEY` | 暗号化した値の検索の索引(HMAC の盲索引。予約番号・同行者名) | 替えたら索引を作り直す(`python -m app.ops.backfill_lookup_index --all`) | 作り直すまで検索で見つからない | ○ |
| `DOCUMENT_DOWNLOAD_SIGNING_KEY` | 文書の期限付きダウンロード URL の署名 | いつでも | 発行済みの URL(既定2分)が無効 | ○ |
| `JWT_SECRET_KEY` | ログインのトークンの署名 | 侵害が疑われる時(Runbook §8) | 全員が再ログイン | ○ |
| `OFFLINE_PACK_KEY_SECRET` | オフラインパックの鍵の元(未設定なら `ENCRYPTION_KEY` から導出) | 原則替えない | 全員の端末のオフラインデータの取り直し | ○(`ENCRYPTION_KEY` と分ける) |
| `CHALLENGE_SECRET_KEY` | 計算の確認の問題の署名(未設定なら `JWT_SECRET_KEY` から導出) | いつでも | 出題中の問題(既定2分)が無効 | — |
| `METRICS_TOKEN` | 監視の計測値(`/metrics`)を見る合言葉 | 監視の道具と同時に | 替えるまで監視が 401 | ○ |

**使い回しの禁止:** 上の鍵どうし、および DB のパスワードで同じ値を使わない。本番(`APP_ENV=production`)は
同じ値・弱い鍵・`OFFLINE_PACK_KEY_SECRET` の未設定で起動しない。開発環境でも
`python3 scripts/ops/tcops.py keys check` で同じ点検ができる(値は出さない)。

### 1.1 DB のロールのパスワード(Gate G2 SEC-F4)

| 値 | 用途 | 切り替え方 |
|---|---|---|
| `DB_PASSWORD`(`DATABASE_URL` に含む) | DB の所有者(migration・ロールの設定・運用の道具だけ。backend には渡さない) | postgres の `ALTER ROLE` と `.env` を同時に |
| `DB_APP_PASSWORD`(`APP_DATABASE_URL` に含む) | アプリのロール `tc_app`(表の読み書きだけ) | `.env` の2つを直して `docker compose up -d --force-recreate migrate backend`(Runbook §8.6) |

`tc_backup`・`tc_readonly_monitor` はパスワードを持たない(postgres のコンテナの中だけで使う)。

## 2. 暗号化の鍵の版の切り替え(`ENCRYPTION_KEY`)

暗号文の書式(Fernet)は変えないので、DB の変更は要らない。どの鍵の暗号文かは、各鍵で検証して判定する。

1. **前提:** `OFFLINE_PACK_KEY_SECRET` を設定してある(未設定のまま `ENCRYPTION_KEY` を替えると、端末のオフライン
   データが読めなくなる)。`tcops.py backup` でバックアップを取る(バックアップの目録には鍵の指紋が残る)。
2. 新しい鍵を作る: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`。
3. `.env` を書き換える: 今の `ENCRYPTION_KEY` の値を `ENCRYPTION_KEYS_PREVIOUS` へ移し、新しい値を `ENCRYPTION_KEY` に入れる。
   `docker compose up -d --force-recreate backend`。この時点で、新しく書く値は新しい鍵、古い値は前の鍵で読める。
4. 件数を見る: `python3 scripts/ops/tcops.py keys status`(鍵ごとの件数。`undecryptable` が0であること)。
5. 掛け直す: `python3 scripts/ops/tcops.py keys rekey`(何度実行しても同じ。止めても続きから。利用者が同時に書き換えた行は
   上書きせず次の実行で掛け直す)。大きい時は `--max-rows 10000` で段階的に。
6. もう一度 `keys status` を見て `previous_keys_removable: true` になったら、`.env` から `ENCRYPTION_KEYS_PREVIOUS` を消して
   backend を作り直す(**失効**)。外した鍵で作られた暗号文は、以後どの経路でも読めない。
7. バックアップを取り直す(前の鍵の暗号文を含む古いバックアップは、前の鍵を別に保管していないと復元できない)。

**戻す:** 6 の前なら、`ENCRYPTION_KEY` と `ENCRYPTION_KEYS_PREVIOUS` の値を入れ替えて backend を作り直し、`keys rekey` を
実行する(掛け直した値も元の鍵へ戻る)。6 の後は前の鍵の値を `ENCRYPTION_KEYS_PREVIOUS` に戻せば読める。

**読めない値(`undecryptable`):** 掛け直しは変えずに残し、「表.列」と件数だけを出す(中身・ID は出さない)。原因は
鍵の取り違え(バックアップの目録の指紋と比べる)か、値の破損。前の鍵を外してはいけない。

## 3. まだ無いもの(次の Gate)

- 鍵管理サービス(Cloud KMS / Secret Manager)への移行(SEC-F3)。今は `.env` にある。
- 利用者・旅行ごとのデータ鍵と、鍵の破棄による削除(cryptographic erasure、SEC-F5)。
- DB の権限の分離(SEC-F4)。


## 3. データ鍵(DEK)と鍵の破棄による削除(Gate G3・SEC-F5)

- 旅行の中身(予約番号・名義・電話・チケット・秘匿制約・持ち物・予算・しおり・文書の名前と中身・取り込みの候補・旅の記録の
  ファイル)は**旅行ごとのデータ鍵**、秘匿プロフィール・位置の軌跡は**利用者ごとのデータ鍵**で暗号化する
  (暗号文は `tc2:dek:<鍵のID>:…`)。データ鍵は `ENCRYPTION_KEY` で包んで `data_keys` に持つ。
- `ENCRYPTION_KEY` を切り替えた時の掛け直し(§2)は、`data_keys` の行(包んだ鍵)を包み直す。データの暗号文は触らない。
- 旅行の完全削除・アカウントの削除で、その対象のデータ鍵を**破棄**する(包んだ鍵を消し、破棄した日時と理由だけを残す)。
- バックアップの DB(pg_dump)には `data_keys` の行を入れず、鍵の写し `<ID>.keys.jsonl` を別に置く。破棄した鍵は
  `tcops.py keys purge-escrow`(毎日 03:45、バックアップの直後にも実行)が**全ての世代の写しから消す**。
  そのため、古いバックアップを復元しても、破棄した鍵の暗号文は読めない(点検では `erased` に数える。失敗ではない)。
- 外部へ写したバックアップ(別の機械・別のリージョン)を持つ時は、`keys purge-escrow` の後に鍵の写しも写し直す。
- このGateより前の暗号文(ENCRYPTION_KEY だけのもの)は `tcops.py keys convert --to envelope` でデータ鍵へ移す
  (パッチが実行する)。前のコードへ戻す時は先に `--to legacy` で戻す(パッチの戻しが行う)。

### 3.1 多要素認証の解除(二者の確認、SEC-F6)

端末と回復コードを両方なくした人の多要素認証の解除は、管理者 A の申請と、別の管理者 B の承認で行う。対象の本人は申請も承認もできない。

```
python3 scripts/ops/tcops.py security mfa-reset-request --email user@example.com --requested-by a@example.com --reason "端末の紛失(電話で本人確認)"
python3 scripts/ops/tcops.py security mfa-reset --request <申請のID> --approved-by b@example.com --yes
```

申請は24時間で期限切れ。承認すると対象の全端末をログアウトし、本人へ知らせ、監査に申請者・承認者・理由を残す。
管理者が1人しかいない環境に限り、申請した人が承認できる(監査に `single_operator` と残る)。
