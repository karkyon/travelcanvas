# ADR: DB の権限の分離(Gate G2 SEC-F4)

- 状態: 採用(2026-10-21)
- 関連: 監査の実行台帳 SEC-F4、DOC-11 §8(最小権限)、Runbook §8.6、`backend/app/ops/db_roles.py`

## 背景

backend は DB の所有者(表を作る・変える・消す・migration の版を書き換えられる)で接続していた。アプリに SQL の注入・
任意のコードの実行の欠陥があると、表の削除・migration の版の改ざん・権限の付け替えまで届く。

## 決定

1. ロールを分ける(すべて `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`):
   - 所有者(`.env` の `DATABASE_URL`。postgres のコンテナの初期ユーザー): 表の所有・migration・ロールの設定・運用の道具
   - `tc_app`(`NOINHERIT`・接続 200 まで): public の表の SELECT/INSERT/UPDATE/DELETE・連番の USAGE/SELECT/UPDATE だけ。
     `alembic_version` は読むだけ。パスワードは SCRAM-SHA-256 の検証子(クライアントで作り、平文を DB のログに出さない)
   - `tc_backup`: 読むだけ(pg_dump)。パスワード無し
   - `tc_readonly_monitor`: `pg_monitor` と `alembic_version` を読むだけ。パスワード無し
2. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`。所有者が作る今後の表・連番には `ALTER DEFAULT PRIVILEGES` で同じ権限を付ける
   (migration で表を足しても `tc_app` が使える)。
3. compose に一回きりの `migrate` サービス(所有者の資格情報を持つのはこれだけ)を置き、`alembic upgrade head` →
   `python -m app.ops.db_roles apply` を流す。backend は `migrate` の成功を待ち、`APP_DATABASE_URL`(tc_app)だけを受け取る
   (`DATABASE_URL`・`DB_PASSWORD`・`DB_APP_PASSWORD` は空で上書き)。
4. `python -m app.ops.db_roles check [--expect-app]` で、接続しているロールの権限(最小権限・表の DML・migration の版の保護)
   を JSON で確かめる。CI の e2e ジョブと omega-dev2 のパッチがこれで止める。
5. 運用の道具(`tcops.py`)の点検・復元演習は所有者で行う。所有者の URL はコマンドの引数ではなく環境変数(`-e OPS_DATABASE_URL`)
   で backend のコンテナへ渡す。

## 試験

`backend/tests/test_gate_g2_db_roles.py`(実 PostgreSQL で: tc_app は表を作る・変える・消す・版を書き換えると拒否、DML は可、
今後の表にも権限が付く、check の判定、compose・CI の構成、資格情報が引数に出ない)。

## 影響・戻し方

- 既存の環境では最初の `docker compose up` で migrate がロールを作る。`.env` に `DB_APP_PASSWORD`・`APP_DATABASE_URL` が要る
  (パッチが作る)。戻す時は `APP_DATABASE_URL` を所有者の URL にする(ロールは残してよい)。
