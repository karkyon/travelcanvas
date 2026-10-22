"""[Gate G2] SEC-F4 DB の権限の分離(backend/app/ops/db_roles.py)。

- アプリのロールは表の読み書き(SELECT・INSERT・UPDATE・DELETE)だけ。表を作る・変える・消す・空にする、migration の版を
  書き換える、ロールを作る・切り替えることはできない。後の migration で作る表にも同じ権限が付く(既定の権限)
- バックアップのロールは読み取りだけ、監視のロールは統計と migration の版だけ
- パスワードは SCRAM-SHA-256 の検証子で送り、実際にそのパスワードでログインできる
- 何度実行しても同じ。アプリのロールで実行すると拒否する
- 運用の道具(tcops)は所有者の接続を backend のコンテナへその実行のときだけ渡し、表示には出さない
- docker compose: backend は tc_app の接続文字列だけを持ち、migrate サービスが成功してから起動する
"""
import uuid
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.ops import db_roles

ROOT = Path(__file__).resolve().parents[2]
PASSWORD = "g2-test-only-app-role-password-" + uuid.uuid4().hex


def _owner_engine():
    return create_engine(settings.DATABASE_URL, poolclass=NullPool, isolation_level="AUTOCOMMIT")


def _url_as(user: str, password: str) -> str:
    parts = urlsplit(settings.DATABASE_URL)
    host = parts.hostname or "localhost"
    netloc = "%s:%s@%s%s" % (quote(user), quote(password), host, ":%d" % parts.port if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


@pytest.fixture()
def roles():
    suffix = uuid.uuid4().hex[:8]
    names = db_roles.RoleNames(app="tcg2_app_" + suffix, backup="tcg2_backup_" + suffix,
                               monitor="tcg2_monitor_" + suffix)
    probe = "tcg2_probe_" + suffix
    engine = _owner_engine()
    with engine.connect() as conn:
        conn.execute(text('CREATE TABLE public."%s" (id integer PRIMARY KEY, note text)' % probe))
        conn.execute(text('INSERT INTO public."%s" VALUES (1, \'before\')' % probe))
    try:
        yield names, probe, engine
    finally:
        with engine.connect() as conn:
            conn.execute(text("RESET ROLE"))
            for t in (probe, probe + "_later"):
                conn.execute(text('DROP TABLE IF EXISTS public."%s"' % t))
            db_roles.drop(conn, names)
        engine.dispose()


def _denied(conn, sql: str, autocommit: bool = False) -> bool:
    try:
        if autocommit:  # 自動確定の接続(所有者の接続から SET ROLE した時)では SAVEPOINT を使えない
            conn.execute(text(sql))
            return False
        with conn.begin_nested():
            conn.execute(text(sql))
    except DBAPIError as e:
        return "permission denied" in str(e.orig).lower() or "must be owner" in str(e.orig).lower()
    return False


def test_scram_verifier_format():
    v = db_roles.scram_verifier("x" * 30, salt=b"0123456789abcdef")
    assert v.startswith("SCRAM-SHA-256$4096:") and v.count("$") == 2 and v.count(":") == 2
    assert v == db_roles.scram_verifier("x" * 30, salt=b"0123456789abcdef")
    assert "x" * 30 not in v


def test_app_role_can_read_write_but_not_change_schema(roles):
    names, probe, engine = roles
    with engine.connect() as conn:
        result = db_roles.apply(conn, PASSWORD, names)
        assert result["ok"] and set(result["roles_created"]) == set(names.all())
        # 後の migration で作った表(既定の権限で同じ権限が付く)
        conn.execute(text('CREATE TABLE public."%s_later" (id integer PRIMARY KEY)' % probe))

    app_engine = create_engine(_url_as(names.app, PASSWORD), poolclass=NullPool)
    try:
        with app_engine.connect() as conn:
            assert conn.execute(text("SELECT current_user")).scalar() == names.app
            # 読み書きはできる(既存の表・後で作った表とも)
            with conn.begin_nested():
                conn.execute(text('INSERT INTO public."%s" VALUES (2, \'by app\')' % probe))
                conn.execute(text('UPDATE public."%s" SET note = \'updated\' WHERE id = 1' % probe))
                conn.execute(text('DELETE FROM public."%s" WHERE id = 2' % probe))
                conn.execute(text('INSERT INTO public."%s_later" VALUES (1)' % probe))
                assert conn.execute(text("SELECT count(*) FROM users")).scalar() is not None
            assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() >= 1
            # 表を作る・変える・消す・空にする・版を書き換える・ロールを作る・切り替えるはできない
            assert _denied(conn, 'CREATE TABLE public."%s_evil" (id int)' % probe)
            assert _denied(conn, 'ALTER TABLE public."%s" ADD COLUMN x int' % probe)
            assert _denied(conn, 'DROP TABLE public."%s"' % probe)
            assert _denied(conn, 'TRUNCATE public."%s"' % probe)
            assert _denied(conn, "CREATE INDEX tcg2_evil_idx ON users (email)")
            assert _denied(conn, "UPDATE alembic_version SET version_num = version_num")
            assert _denied(conn, "DELETE FROM alembic_version")
            assert _denied(conn, "CREATE ROLE tcg2_evil_role")
            assert _denied(conn, "CREATE SCHEMA tcg2_evil")
            owner = urlsplit(settings.DATABASE_URL).username
            assert _denied(conn, 'SET ROLE "%s"' % owner)
            info = db_roles.check(conn)
            assert info["least_privilege"] is True and info["app_ready"] is True
            assert info["owns_tables"] == 0 and info["tables_without_dml"] == 0
            assert info["alembic_version_writable"] is False and info["alembic_version_readable"] is True
            # アプリのロールで apply は拒否する(ロールを作れない・所有者でない)
            with pytest.raises(Exception):
                db_roles.apply(conn, PASSWORD, names)
    finally:
        app_engine.dispose()


def test_backup_and_monitor_roles_are_read_only(roles):
    names, probe, engine = roles
    with engine.connect() as conn:
        db_roles.apply(conn, PASSWORD, names)
        conn.execute(text('SET ROLE "%s"' % names.backup))
        assert conn.execute(text('SELECT count(*) FROM public."%s"' % probe)).scalar() == 1
        assert conn.execute(text("SELECT count(*) FROM users")).scalar() is not None
        assert _denied(conn, 'INSERT INTO public."%s" VALUES (9, \'x\')' % probe, autocommit=True)
        assert _denied(conn, 'CREATE TABLE public."%s_evil" (id int)' % probe, autocommit=True)
        conn.execute(text("RESET ROLE"))
        conn.execute(text('SET ROLE "%s"' % names.monitor))
        assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() >= 1
        assert conn.execute(text("SELECT count(*) FROM pg_stat_activity")).scalar() >= 1
        assert _denied(conn, "SELECT count(*) FROM users", autocommit=True)
        assert _denied(conn, 'SELECT count(*) FROM public."%s"' % probe, autocommit=True)
        conn.execute(text("RESET ROLE"))


def test_apply_is_idempotent_and_changes_password(roles):
    names, _probe, engine = roles
    new_password = PASSWORD + "-rotated"
    with engine.connect() as conn:
        db_roles.apply(conn, PASSWORD, names)
        second = db_roles.apply(conn, new_password, names)
        assert second["roles_created"] == []
        owner_info = db_roles.check(conn)
        assert owner_info["least_privilege"] is False  # 所有者は最小権限ではない
    old = create_engine(_url_as(names.app, PASSWORD), poolclass=NullPool)
    new = create_engine(_url_as(names.app, new_password), poolclass=NullPool)
    try:
        with pytest.raises(Exception):
            with old.connect():
                pass
        with new.connect() as conn:
            assert conn.execute(text("SELECT current_user")).scalar() == names.app
    finally:
        old.dispose()
        new.dispose()


def test_apply_rejects_short_password_and_bad_names(roles):
    names, _probe, engine = roles
    with engine.connect() as conn:
        with pytest.raises(ValueError):
            db_roles.apply(conn, "short", names)
    with pytest.raises(ValueError):
        db_roles._ident('bad"name')


def test_cli_check_outputs_flags_without_secrets(capsys, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", settings.DATABASE_URL)
    assert db_roles.main(["check"]) == 0
    out = capsys.readouterr().out
    assert '"least_privilege": false' in out  # 試験の DB は所有者で接続している
    assert db_roles.main(["check", "--expect-app"]) == 1
    password = urlsplit(settings.DATABASE_URL).password or "no-password"
    assert password not in capsys.readouterr().out


def test_tcops_passes_owner_url_to_backend_only_and_hides_it(monkeypatch):
    from app.ops import cli

    secret_url = "postgresql://owner:dummy-very-secret-owner-pass@postgres:5432/travelcanvas"
    monkeypatch.setattr(cli, "read_dotenv_value", lambda name: secret_url if name == "DATABASE_URL" else None)
    ex = cli.ComposeExecutor()
    backend_args = ex.exec_args("backend", {"OPS_TARGET_DB": "travelcanvas_restore_drill"})
    # 資格情報は引数(ps で見える)に書かず、名前だけを渡す。値は docker compose の環境変数で渡る
    assert all("very-secret" not in a and "postgresql://" not in a for a in backend_args)
    i = backend_args.index("OPS_DATABASE_URL")
    assert backend_args[i - 1] == "-e"
    assert "OPS_DATABASE_URL" not in ex.exec_args("postgres")
    assert all("very-secret" not in a for a in ex.exec_args("postgres"))
    seen = []
    monkeypatch.setattr(cli.Executor, "run", lambda self, argv, env=None, **kw: seen.append((list(argv), env)))
    ex.run(backend_args + ["python", "-m", "x"])
    ex.run(ex.exec_args("postgres") + ["true"])
    assert seen[0][1]["OPS_DATABASE_URL"] == secret_url
    assert "OPS_DATABASE_URL" not in (seen[1][1] or {})
    assert "very-secret" not in cli.Executor.describe(backend_args + ["python", "-m", "x"])
    assert "very-secret" not in cli.opslib.mask_url("failed: " + secret_url)


def test_db_inventory_prefers_ops_database_url(monkeypatch):
    from app.ops import db_inventory

    monkeypatch.setenv("DATABASE_URL", "postgresql://tc_app:dummy-not-a-password@nowhere:5432/a")
    monkeypatch.setenv("OPS_DATABASE_URL", settings.DATABASE_URL)
    engine = db_inventory.engine_for(None)
    try:
        assert engine.url.username == urlsplit(settings.DATABASE_URL).username
    finally:
        engine.dispose()


def test_compose_runs_app_with_least_privilege_role():
    compose = ROOT / "docker-compose.yml"
    if not compose.is_file():
        pytest.skip("リポジトリの根が無い(backend コンテナの中)")
    import yaml

    doc = yaml.safe_load(compose.read_text(encoding="utf-8"))
    backend = doc["services"]["backend"]
    migrate = doc["services"]["migrate"]
    env = backend["environment"]
    assert env["DATABASE_URL"].startswith("${APP_DATABASE_URL:?")
    assert env["DB_PASSWORD"] == "" and env["DB_APP_PASSWORD"] == ""
    assert backend["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    cmd = " ".join(migrate["command"])
    assert cmd.index("alembic upgrade head") < cmd.index("app.ops.db_roles apply")
    assert migrate["environment"]["TC_DB_APP_PASSWORD"].startswith("${DB_APP_PASSWORD:?")
    assert migrate["restart"] == "no" and "ports" not in migrate
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "app.ops.db_roles check --expect-app" in ci and "APP_DATABASE_URL=" in ci
