"""[Gate G2] SEC-F4 DB の権限の分離(docs/adr/ADR-db-roles.md・Runbook §8.7)。

役割(PostgreSQL のロール):

- 所有者(migrator): 表・索引・型を持ち、migration(alembic)を流す。docker compose では POSTGRES_USER(``.env`` の
  ``DB_USER``)。backend のアプリは**この資格情報を持たない**(compose の ``migrate`` サービスだけが使う)。
- ``tc_app``: backend のアプリが使う。公開スキーマ(public)の表の読み書き(SELECT・INSERT・UPDATE・DELETE)と連番だけ。
  表を作る・変える・消す(CREATE・ALTER・DROP・TRUNCATE)はできない。``alembic_version`` は読むだけ(``/ready`` の確認)。
  他のロールへの切り替え・ロールの作成・DB の作成はできない。
- ``tc_backup``: バックアップ(pg_dump)だけ。全ての表・連番の読み取り。パスワードは持たない(postgres のコンテナの中の
  ソケットからだけ使う)。
- ``tc_readonly_monitor``: 監視だけ。``pg_monitor``(統計の読み取り)と ``alembic_version`` の読み取り。パスワードは持たない。

    python -m app.ops.db_roles apply   # 所有者で実行: ロールの作成・パスワード・権限・既定の権限(何度実行しても同じ)
    python -m app.ops.db_roles check   # いまの接続のロールの権限を確かめる(値・パスワードは出さない)

``apply`` は ``TC_DB_APP_PASSWORD``(``.env`` の ``DB_APP_PASSWORD``)を ``tc_app`` のパスワードにする。パスワードは
手元で SCRAM-SHA-256 の検証子にしてから送る(DB のログに平文が残らない)。新しい表(後の migration)にも同じ権限が付く
よう、所有者の既定の権限(ALTER DEFAULT PRIVILEGES)を設定する。``alembic_version`` は migration のたびに作り直され得る
ため、``apply`` は alembic の後に実行する(compose の migrate サービスがこの順で実行する)。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection
from sqlalchemy.pool import NullPool

APP_ROLE = "tc_app"
BACKUP_ROLE = "tc_backup"
MONITOR_ROLE = "tc_readonly_monitor"
SCRAM_ITERATIONS = 4096
MIN_PASSWORD_LENGTH = 24
APP_CONNECTION_LIMIT = 200


@dataclass(frozen=True)
class RoleNames:
    app: str = APP_ROLE
    backup: str = BACKUP_ROLE
    monitor: str = MONITOR_ROLE

    def all(self) -> List[str]:
        return [self.app, self.backup, self.monitor]


def _ident(name: str) -> str:
    if not name or not all(c.isalnum() or c == "_" for c in name) or not name[0].isalpha() or len(name) > 63:
        raise ValueError("ロール名は英字で始まる英数字・_ の63文字以内にしてください")
    return '"%s"' % name


def scram_verifier(password: str, salt: Optional[bytes] = None, iterations: int = SCRAM_ITERATIONS) -> str:
    """PostgreSQL の SCRAM-SHA-256 の検証子(RFC 5802/7677。サーバーへは平文ではなくこれを送る)。"""
    salt = salt if salt is not None else secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return "SCRAM-SHA-256$%d:%s$%s:%s" % (iterations, b64(salt), b64(stored_key), b64(server_key))


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _ensure_role(conn: Connection, name: str) -> bool:
    exists = conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :n"), {"n": name}).first() is not None
    if not exists:
        conn.exec_driver_sql("CREATE ROLE %s LOGIN" % _ident(name))
    return not exists


def apply(conn: Connection, app_password: str, names: RoleNames = RoleNames()) -> Dict[str, object]:
    """所有者の接続で、ロール・パスワード・権限・既定の権限を設定する(何度実行しても同じ)。"""
    if not app_password or len(app_password) < MIN_PASSWORD_LENGTH:
        raise ValueError("TC_DB_APP_PASSWORD(DB_APP_PASSWORD)が未設定か %d 文字未満です" % MIN_PASSWORD_LENGTH)
    owner = str(conn.execute(text("SELECT current_user")).scalar())
    database = str(conn.execute(text("SELECT current_database()")).scalar())
    if owner in names.all():
        raise ValueError("apply は所有者(migration を流すロール)で実行してください")
    app, backup, monitor = (_ident(n) for n in names.all())
    created = [n for n in names.all() if _ensure_role(conn, n)]
    # アプリ: ログインだけ。特権(ロールの作成・DB の作成・複製・RLS の迂回・他のロールの継承)は持たない
    # 検証子は ":" を含むため、SQLAlchemy の名前付きの値として解釈させない(exec_driver_sql。値は渡さない)
    conn.exec_driver_sql(
        "ALTER ROLE %s WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS "
        "CONNECTION LIMIT %d PASSWORD %s" % (app, APP_CONNECTION_LIMIT, _sql_literal(scram_verifier(app_password))))
    for role in (backup, monitor):
        conn.exec_driver_sql("ALTER ROLE %s WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS "
                             "PASSWORD NULL" % role)
    db = _ident(database)
    statements = [
        # 公開スキーマに誰でも表を作れる古い既定(PostgreSQL 14 以前)を外す
        "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
        "REVOKE ALL ON SCHEMA public FROM %s, %s, %s" % (app, backup, monitor),
        "GRANT CONNECT ON DATABASE %s TO %s, %s, %s" % (db, app, backup, monitor),
        "REVOKE CREATE ON DATABASE %s FROM %s, %s, %s" % (db, app, backup, monitor),
        "GRANT USAGE ON SCHEMA public TO %s, %s, %s" % (app, backup, monitor),
        # アプリ: 表の読み書きと連番だけ
        "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s" % app,
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %s" % app,
        "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %s" % app,
        # バックアップ: 読み取りだけ
        "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s" % backup,
        "GRANT SELECT ON ALL TABLES IN SCHEMA public TO %s" % backup,
        "GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %s" % backup,
        # 監視: 統計と migration の版だけ
        "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s" % monitor,
        "GRANT pg_monitor TO %s" % monitor,
        # 後の migration で作る表・連番にも同じ権限
        "ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %s"
        % (_ident(owner), app),
        "ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %s"
        % (_ident(owner), app),
        "ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT SELECT ON TABLES TO %s" % (_ident(owner), backup),
        "ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public GRANT SELECT ON SEQUENCES TO %s"
        % (_ident(owner), backup),
    ]
    for sql in statements:
        conn.exec_driver_sql(sql)
    has_version = conn.execute(text("SELECT to_regclass('public.alembic_version')")).scalar() is not None
    if has_version:
        # migration の版はアプリから書き換えさせない(読むのは /ready の確認)
        conn.exec_driver_sql("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.alembic_version FROM %s" % app)
        conn.exec_driver_sql("GRANT SELECT ON public.alembic_version TO %s" % monitor)
    tables = conn.execute(text(
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")).scalar()
    return {"ok": True, "database": database, "owner_is_current_user": True, "roles_created": created,
            "tables": int(tables or 0), "alembic_version_protected": has_version}


def drop(conn: Connection, names: RoleNames) -> None:
    """試験用: この DB での権限を外してロールを消す(他の DB に権限が残っていると失敗する)。"""
    for n in names.all():
        if conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :n"), {"n": n}).first() is None:
            continue
        conn.exec_driver_sql("DROP OWNED BY %s" % _ident(n))
        conn.exec_driver_sql("DROP ROLE %s" % _ident(n))


def check(conn: Connection) -> Dict[str, object]:
    """いまの接続のロールが何をできるか(SEC-F4 の確認。値は出さない)。"""
    row = conn.execute(text(
        "SELECT current_user, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, "
        "has_schema_privilege(current_user, 'public', 'CREATE'), "
        "has_database_privilege(current_user, current_database(), 'CREATE') "
        "FROM pg_roles r WHERE r.rolname = current_user")).first()
    if row is None:
        raise RuntimeError("現在のロールを pg_roles から読めません")
    owned = conn.execute(text(
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user")).scalar()
    missing = conn.execute(text(
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'alembic_version' "
        "AND NOT (has_table_privilege(current_user, c.oid, 'SELECT') "
        "AND has_table_privilege(current_user, c.oid, 'INSERT') "
        "AND has_table_privilege(current_user, c.oid, 'UPDATE') AND has_table_privilege(current_user, c.oid, 'DELETE'))"
    )).scalar()
    version_writable = conn.execute(text(
        "SELECT CASE WHEN to_regclass('public.alembic_version') IS NULL THEN false "
        "ELSE has_table_privilege(current_user, 'public.alembic_version', 'UPDATE') END")).scalar()
    version_readable = conn.execute(text(
        "SELECT CASE WHEN to_regclass('public.alembic_version') IS NULL THEN false "
        "ELSE has_table_privilege(current_user, 'public.alembic_version', 'SELECT') END")).scalar()
    out = {
        "role": row[0], "superuser": bool(row[1]), "createrole": bool(row[2]), "createdb": bool(row[3]),
        "bypassrls": bool(row[4]), "can_create_in_public": bool(row[5]), "can_create_schema": bool(row[6]),
        "owns_tables": int(owned or 0), "tables_without_dml": int(missing or 0),
        "alembic_version_writable": bool(version_writable), "alembic_version_readable": bool(version_readable),
    }
    out["least_privilege"] = not any((out["superuser"], out["createrole"], out["createdb"], out["bypassrls"],
                                      out["can_create_in_public"], out["can_create_schema"], out["owns_tables"],
                                      out["alembic_version_writable"]))
    out["app_ready"] = out["least_privilege"] and out["tables_without_dml"] == 0 and out["alembic_version_readable"]
    return out


def _engine(url: Optional[str] = None):
    url = url or os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL が設定されていません")
    return create_engine(url, poolclass=NullPool, hide_parameters=True, isolation_level="AUTOCOMMIT")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DB の権限の分離(SEC-F4)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("apply", help="所有者で実行: ロール・権限を設定する")
    p = sub.add_parser("check", help="いまの接続のロールの権限を確かめる")
    p.add_argument("--expect-app", action="store_true", help="アプリのロールとして最小権限でなければ終了コード 1")
    args = parser.parse_args(argv)
    engine = _engine()
    try:
        with engine.connect() as conn:
            if args.cmd == "apply":
                result = apply(conn, os.environ.get("TC_DB_APP_PASSWORD", ""))
            else:
                result = check(conn)
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 2
    finally:
        engine.dispose()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    if args.cmd == "check" and args.expect_app and not result["app_ready"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
