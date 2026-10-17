"""[Gate O2] ログの個人情報・秘密の保護(B-009)の試験。

- 伏せる規則(app/core/log_safety.py)の正しさ・冪等性・伏せすぎないこと
- 記録の工場に入れた伏せる処理が、本文・引数・例外・uvicorn のアクセスログに効くこと
- SQL の値がログ・DBエラーの文面に出ないこと(hide_parameters、SQL_ECHO の既定 off)
- 出どころの修正(ログイン失敗・検索の失敗・関数呼び出しのログ)
- ログ呼び出しの引数に、個人情報・秘密を表す名前の変数を渡していないこと(静的検査)
- 運用コマンド log-scan と監視・定期実行への組み込み
全実行中のログの検査そのものは tests/conftest.py と tests/test_zz_log_leak_scan.py。
"""
import ast
import json
import logging
import subprocess
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core import log_safety
from app.core.log_safety import find_leaks, redact

BACKEND_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- 伏せる規則

@pytest.mark.parametrize("raw,expected", [
    ('"POST /api/v1/public/share/AbCdEf123456789xyz/resolve HTTP/1.1" 200',
     '"POST /api/v1/public/share/***/resolve HTTP/1.1" 200'),
    ("GET /api/v1/plans/documents/download?token=abc.def123&x=1", "GET /api/v1/plans/documents/download?token=***&x=1"),
    ("/s/Zx9_kLm-QwErTy12", "/s/***"),
    ("User not found: taro.yamada+tc@example.co.jp", "User not found: <email>"),
    ("db postgresql://travelcanvas_app:pw@postgres:5432/tc", "db postgresql://***@postgres:5432/tc"),
    ("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abcdef", "Authorization: Bearer ***"),
    ("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_abcdef end", "token <jwt> end"),
    ("payload=b'gAAAAABlqx_" + "x" * 60 + "=='", "payload=b'<ciphertext>'"),
    ("hash $2b$12$" + "a" * 53, "hash <password-hash>"),
    ('password=hunter2 secret: zzz "password": "p@ss"', 'password=*** secret: *** "password": "***"'),
    ('DETAIL:  Key (email)=(taro@example.com) already exists.', 'DETAIL:  Key (email)=(***) already exists.'),
    ('invalid input syntax for type integer: "山田花子"', 'invalid input syntax for type integer: "***"'),
    ("LINE 1: SELECT CAST('山田花子' AS integer)", "LINE 1: <sql>"),
])
def test_redact_rules(raw, expected):
    assert redact(raw) == expected
    assert redact(expected) == expected  # 冪等


@pytest.mark.parametrize("keep", [
    "plan_id=6f1e1a3c-0d7b-4c39-9a3f-6a0f0d9a2b11 status=409",
    "sha256=" + "a" * 64,
    "GET /api/v1/plans/6f1e1a3c-0d7b-4c39-9a3f-6a0f0d9a2b11/events?page=2 HTTP/1.1",
    "token expired; refresh required",
    "2026-10-17T03:10:00Z backup tc-20261017T031000Z",
    "メールアドレスまたはパスワードが正しくありません",
    "/api/v1/public/share/***/resolve",
])
def test_redact_keeps_non_secrets(keep):
    assert redact(keep) == keep


def test_find_leaks_reports_kinds_without_values():
    secret = "S3cr3t-Value-for-O2"
    lines = [
        "INFO sqlalchemy.engine.Engine [generated in 0.0003s] {'title': '京都'}",
        "login for hanako@example.org",
        "debug " + secret,
        "/api/v1/public/share/abcdefghijklmnop/resolve",
        "ok [generated in 0.1s] [SQL parameters hidden due to hide_parameters=True]",
        "from noreply@travelcanvas.app",
    ]
    found = find_leaks("\n".join(lines), [secret, "short"], allow_emails=["noreply@travelcanvas.app"])
    kinds = sorted(f["kind"] for f in found)
    assert kinds == ["email", "known_secret", "share_token", "sql_parameters"]
    dumped = json.dumps(found, ensure_ascii=False)
    for value in (secret, "hanako@example.org", "abcdefghijklmnop", "京都"):
        assert value not in dumped
    assert log_safety.summarize(found) == {"email": 1, "known_secret": 1, "share_token": 1, "sql_parameters": 1}
    assert find_leaks(redact("\n".join(lines[1:2] + lines[3:4]))) == []


# ---------------------------------------------------------------- 記録の工場

class _ListHandler(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.lines = []
        self.setFormatter(logging.Formatter("%(message)s"))

    def emit(self, record):
        self.lines.append(self.format(record))


@pytest.fixture()
def captured():
    handler = _ListHandler()
    logger = logging.getLogger(log_safety.SELFTEST_LOGGER_PREFIX + ".o2")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    yield logger, handler
    logger.removeHandler(handler)


def test_installed_for_backend_process():
    import app  # noqa: F401 - パッケージの読み込みで入る

    assert log_safety.installed()
    log_safety.install()  # 2回目は何もしない
    assert log_safety.installed()


def test_factory_redacts_message_args_and_exceptions(captured):
    logger, handler = captured
    logger.warning("login for %s with %r", "a.b@example.com", {"email": "c@d.ee", "n": 1})
    logger.info("count %d amount %.1f ok=%s", 3, Decimal("2.5"), True)
    logger.info(f"f-string user x@y.zz token=abc{uuid.uuid4().hex}")
    try:
        raise RuntimeError("cannot reach postgresql://u:pw@db/x for owner@example.net")
    except RuntimeError:
        logger.exception("failed for %s", "zz@example.com")
    joined = "\n".join(handler.lines)
    for leaked in ("a.b@example.com", "c@d.ee", "x@y.zz", "owner@example.net", "zz@example.com", "u:pw@"):
        assert leaked not in joined
    assert "count 3 amount 2.5 ok=True" in joined
    assert "<email>" in joined and "RuntimeError" in joined and "token=***" in joined


def test_uvicorn_access_log_is_redacted():
    from uvicorn.logging import AccessFormatter

    handler = _ListHandler()
    handler.setFormatter(AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False))
    logger = logging.getLogger(log_safety.SELFTEST_LOGGER_PREFIX + ".uvicorn.access")
    logger.addHandler(handler)
    logger.propagate = False
    try:
        logger.info('%s - "%s %s HTTP/%s" %d', "192.168.1.5:5000", "POST",
                    "/api/v1/public/share/AbCdEf123456789xyz/resolve", "1.1", 200)
        logger.info('%s - "%s %s HTTP/%s" %d', "192.168.1.5:5000", "GET",
                    "/api/v1/plans/documents/download?token=a1b2c3.d4e5f6", "1.1", 200)
    finally:
        logger.removeHandler(handler)
    assert handler.lines == [
        '192.168.1.5:5000 - "POST /api/v1/public/share/***/resolve HTTP/1.1" 200 OK',
        '192.168.1.5:5000 - "GET /api/v1/plans/documents/download?token=*** HTTP/1.1" 200 OK',
    ]


# ---------------------------------------------------------------- SQL の値

def test_sql_echo_is_off_by_default_and_parameters_are_hidden():
    from app.core.config import Settings
    from app.core.database import engine

    assert Settings.model_fields["SQL_ECHO"].default is False
    assert engine.echo is False
    assert engine.hide_parameters is True


def test_sql_log_and_db_errors_do_not_show_parameters(db_session):
    from app.core.database import engine

    handler = _ListHandler()
    sql_logger = logging.getLogger("sqlalchemy.engine.Engine")
    old = sql_logger.level
    sql_logger.addHandler(handler)
    sql_logger.setLevel(logging.INFO)
    try:
        # SQL を出すかは接続を作った時点で決まるので、新しい接続で実行する
        with engine.connect() as conn:
            conn.execute(text("SELECT :email AS e"), {"email": "param-leak@example.com"}).all()
    finally:
        sql_logger.setLevel(old)
        sql_logger.removeHandler(handler)
    joined = "\n".join(handler.lines)
    assert "SELECT" in joined and "param-leak@example.com" not in joined and "parameters hidden" in joined
    with pytest.raises(Exception) as exc:
        db_session.execute(text("SELECT CAST(:v AS integer)"), {"v": "secret-param-value-o2"})
    # PostgreSQL 自身のエラー文には値が入る(LINE 1: … '値' など)。ログへ出る時は伏せられること
    assert "secret-param-value-o2" in str(exc.value)
    assert "secret-param-value-o2" not in redact(str(exc.value))
    db_session.rollback()


# ---------------------------------------------------------------- 出どころの修正

def _raw_messages(func):
    seen = []
    log_safety.set_raw_inspector(lambda r: seen.append(r.getMessage()))
    try:
        func()
    finally:
        from tests.conftest import LEAK_COLLECTOR

        log_safety.set_raw_inspector(LEAK_COLLECTOR.inspect_raw)
    return seen


def test_login_for_unknown_account_does_not_log_the_identifier(db_session):
    from app.core.auth import auth_manager

    msgs = _raw_messages(lambda: auth_manager.authenticate_user("nobody-o2@example.com", None, "x", db_session))
    assert msgs and all("nobody-o2@example.com" not in m for m in msgs)


def test_search_failure_does_not_log_the_query():
    import asyncio

    import httpx

    from app.services import search_provider

    def boom(request):
        raise httpx.ConnectError("connect failed for " + str(request.url))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(boom)) as client:
            return await search_provider.search_wikipedia("山田花子の自宅 住所", client=client)

    msgs = _raw_messages(lambda: asyncio.run(run()))
    assert msgs and all("山田花子" not in m and "%E5%B1%B1" not in m for m in msgs)


_SENSITIVE_NAME = __import__("re").compile(r"(?i)(e?mail|passw|secret|token|recipient|phone|query|address)")
_ALLOWED_NAME = __import__("re").compile(r"(?i)(_type|_count|_id|_ids|_len|_at|_kind|_status)$")
_LOG_METHODS = {"debug", "info", "warning", "warn", "error", "exception", "critical", "log"}


def _sensitive_names(node):
    """ログ呼び出しの引数に現れる名前のうち、個人情報・秘密を表すもの(len()/type() の中は除く)。"""
    out = []
    stack = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, ast.Call) and isinstance(cur.func, ast.Name) and cur.func.id in ("len", "type", "bool"):
            continue
        name = None
        if isinstance(cur, ast.Name):
            name = cur.id
        elif isinstance(cur, ast.Attribute):
            name = cur.attr
        if name and _SENSITIVE_NAME.search(name) and not _ALLOWED_NAME.search(name):
            out.append(name)
        stack.extend(ast.iter_child_nodes(cur))
    return out


def test_no_logging_call_passes_sensitive_variables():
    """ログの引数(f-string の中を含む)に email・password・token・recipient・query などの変数を渡さない。"""
    problems = []
    for path in sorted((BACKEND_ROOT / "app").rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in _LOG_METHODS):
                continue
            target = node.func.value
            owner = target.attr if isinstance(target, ast.Attribute) else getattr(target, "id", "")
            if "log" not in owner.lower():
                continue
            for arg in list(node.args) + [k.value for k in node.keywords]:
                for name in _sensitive_names(arg):
                    problems.append("%s:%d %s" % (path.relative_to(BACKEND_ROOT), node.lineno, name))
    assert problems == [], "ログへ個人情報・秘密を表す変数を渡しています:\n" + "\n".join(problems)


# ---------------------------------------------------------------- 試験中の秘密の登録

def test_collector_registers_issued_tokens_and_passwords(request):
    import secrets

    from passlib.context import CryptContext

    collector = request.config._tc_leak_collector
    token = secrets.token_urlsafe(24)
    assert token in collector.secrets
    CryptContext(schemes=["bcrypt"]).verify("Pw-for-O2-check", "$2b$12$" + "a" * 53)
    assert "Pw-for-O2-check" in collector.secrets


# ---------------------------------------------------------------- 運用コマンド

def test_log_scan_command_on_file(tmp_path, monkeypatch):
    from app.ops import cli

    monkeypatch.setenv("OPS_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setattr(cli, "REPO", tmp_path)
    log = tmp_path / "backend.log"
    log.write_text("ok\nINFO: 1.2.3.4 - \"GET /api/v1/public/share/abcdefghijk/resolve HTTP/1.1\" 200\n"
                   "pw Gate-A1-TestPass-1 used\n", encoding="utf-8")
    secrets_file = tmp_path / "s.txt"
    secrets_file.write_text("Gate-A1-TestPass-1\n", encoding="utf-8")
    ex = object.__new__(cli.LocalExecutor)
    res = cli.cmd_log_scan(ex, since="25h", services=["backend"], secrets_file=str(secrets_file), log_file=str(log))
    assert res["findings"] == 2 and res["by_kind"] == {"known_secret": 1, "share_token": 1}
    state = json.loads((tmp_path / "state" / "log_scan.json").read_text())
    dumped = json.dumps(state)
    assert state["findings"] == 2 and "Gate-A1-TestPass-1" not in dumped and "abcdefghijk" not in dumped
    log.write_text("all fine\n", encoding="utf-8")
    assert cli.cmd_log_scan(ex, since="2026-10-17T03:00:00Z", services=["backend"], log_file=str(log))["findings"] == 0
    with pytest.raises(cli.OpsError):
        cli.cmd_log_scan(ex, since="yesterday; rm -rf /", services=["backend"], log_file=str(log))
    with pytest.raises(cli.OpsError):
        cli.cmd_log_scan(ex, since="25h", services=["backend"])  # local は --log-file が必要


def test_log_scan_main_with_file_needs_no_database(tmp_path, monkeypatch):
    from app.ops import cli

    monkeypatch.setenv("OPS_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(cli, "REPO", tmp_path)

    def no_backup_dir(_arg):
        # backend コンテナではリポジトリ直下が "/" になり、置き場所(/backups)を作れない
        raise AssertionError("ログの検査でバックアップの置き場所を作ってはいけない")

    monkeypatch.setattr(cli, "backup_dir", no_backup_dir)
    log = tmp_path / "b.log"
    log.write_text("INFO: GET /api/v1/plans/documents/download?token=*** 200\n", encoding="utf-8")
    assert cli.main(["--mode", "local", "log-scan", "--log-file", str(log)]) == cli.EXIT_OK
    log.write_text("login for someone@example.com\n", encoding="utf-8")
    assert cli.main(["--mode", "compose", "log-scan", "--log-file", str(log)]) == cli.EXIT_WARN


def test_log_scan_compose_command_arguments(monkeypatch, tmp_path):
    from app.ops import cli

    monkeypatch.setenv("OPS_STATE_DIR", str(tmp_path / "state"))
    ex = cli.ComposeExecutor()
    seen = []

    def fake_run(argv, **kw):
        seen.append(list(argv))
        return subprocess.CompletedProcess(argv, 0, b"line\n", b"")

    ex.run = fake_run  # type: ignore[assignment]
    res = cli.cmd_log_scan(ex, since="30m", services=["backend"])
    assert seen == [["docker", "compose", "logs", "--no-color", "--no-log-prefix", "--since", "30m", "backend"]]
    assert res["findings"] == 0
    with pytest.raises(cli.OpsError):
        cli.cmd_log_scan(ex, since="30m", services=["backend;id"])


def test_monitor_and_schedule_include_log_scan():
    from app.ops import opslib

    found = opslib.evaluate_monitor({"log_leaks": 3}, None)
    assert [f["code"] for f in found] == ["log_leak"]
    assert opslib.evaluate_monitor({"log_leaks": 0}, None) == []
    assert "log-scan --since 25h" in opslib.render_cron_block("/home/x/travelcanvas")


def test_log_safety_is_stdlib_only():
    """ホストの python3(追加パッケージなし)から運用コマンドが import できること。"""
    src = (BACKEND_ROOT / "app" / "core" / "log_safety.py").read_text(encoding="utf-8")
    imported = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert imported <= {"__future__", "logging", "numbers", "re", "traceback", "typing"}
    for name in log_safety.QUIET_LIBRARY_LOGGERS:
        assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING
    init_src = (BACKEND_ROOT / "app" / "__init__.py").read_text(encoding="utf-8")
    assert "log_safety" in init_src and "settings" not in init_src
