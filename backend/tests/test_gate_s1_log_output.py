"""
[Gate S1] ログ保護の仕上げ(セキュリティ監査 F02/F03/F04)。

Gate O2 の記録の工場(record factory)は本文・引数・例外を伏せるが、次の経路が残っていた。
- F02: extra=… の extra_data・security_details は工場の「後」に付くため伏せられず、構造化ログの
       フォーマッターがそのまま JSON に出していた。
- F03: 構造化ログのフォーマッターが生の exc_info から例外の本文・トレースバックを作り直していた。
- F04: "password=%s" の %s まで先に伏せて引数と合わなくなり、getMessage() が TypeError になり、
       標準の handleError が生の引数を stderr に出していた。
ここでは実際に使うフォーマッター(StructuredFormatter の JSON・人間向け、SecurityFormatter)を通した最終出力と、
stderr を検査する。値は合成した偽物だけを使う。
"""
import io
import json
import logging

import pytest

from app.core import log_safety
from app.core.log_safety import find_leaks, is_secret_key, redact_value
from app.core.logging import SecurityEvents, SecurityFormatter, StructuredFormatter, log_security_event

SELFTEST = log_safety.SELFTEST_LOGGER_PREFIX
EMAIL = "s1-leak.person@example.org"
PASSWORD = "S1-Synthetic-Password-9x7"
TOKEN = "s1tok_ABCDEFGHIJKLMNOPQRSTUV"


class _Capture(logging.Handler):
    def __init__(self, formatter):
        super().__init__(logging.DEBUG)
        self.setFormatter(formatter)
        self.lines = []

    def emit(self, record):
        self.lines.append(self.format(record))


@pytest.fixture()
def capture():
    loggers = []

    # わざと秘密を出す試験なので、全ログ検査(出どころ)から外す自己試験用のロガー名にする
    def _make(formatter, name=SELFTEST + ".s1"):
        logger = logging.getLogger(name)
        handler = _Capture(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        loggers.append((logger, handler))
        return logger, handler

    yield _make
    for logger, handler in loggers:
        logger.removeHandler(handler)


def _assert_clean(text):
    for value in (EMAIL, PASSWORD, TOKEN):
        assert value not in text, f"出力に秘密が残っています: {text[:300]}"


def test_redaction_is_installed_on_factory_and_make_record():
    assert log_safety.installed()


@pytest.mark.parametrize("json_format", [True, False])
def test_structured_formatter_hides_nested_extra_data(capture, json_format):
    logger, handler = capture(StructuredFormatter(json_format=json_format))
    logger.info("user action", extra={"extra_data": {
        "contact": EMAIL, "nested": {"password": PASSWORD, "list": [{"api_key": TOKEN}, f"mail {EMAIL}"]},
        "count": 3, "ok": True}})
    out = handler.lines[-1]
    _assert_clean(out)
    if json_format:
        data = json.loads(out)
        assert data["count"] == 3 and data["ok"] is True  # 秘密でない値は残る
        assert data["contact"] == "<email>"
        assert data["nested"]["password"] == "***"
        assert data["nested"]["list"][0]["api_key"] == "***"


def test_extra_data_cannot_overwrite_base_fields(capture):
    logger, handler = capture(StructuredFormatter(json_format=True))
    logger.warning("real message", extra={"extra_data": {"level": "DEBUG", "message": "forged", "timestamp": "x"}})
    data = json.loads(handler.lines[-1])
    assert data["level"] == "WARNING" and data["message"] == "real message" and data["timestamp"] != "x"


@pytest.mark.parametrize("json_format", [True, False])
def test_structured_formatter_hides_exception_text(capture, json_format):
    logger, handler = capture(StructuredFormatter(json_format=json_format))
    try:
        raise RuntimeError(f"cannot notify {EMAIL} with password={PASSWORD}")
    except RuntimeError:
        logger.exception("delivery failed")
    out = handler.lines[-1]
    _assert_clean(out)
    assert "RuntimeError" in out  # 何が起きたかは読める
    if json_format:
        exc = json.loads(out)["exception"]
        assert exc["type"] == "RuntimeError" and "<email>" in exc["message"]
        assert any("RuntimeError" in line for line in exc["traceback"])


def test_security_formatter_hides_details(capture):
    logger, handler = capture(SecurityFormatter(), name="security")
    log_security_event(SecurityEvents.LOGIN_FAILED,
                       details={"email": EMAIL, "attempt": {"password": PASSWORD}, "reason": "bad"})
    out = handler.lines[-1]
    _assert_clean(out)
    data = json.loads(out)
    assert data["details"]["reason"] == "bad" and data["details"]["attempt"]["password"] == "***"


@pytest.mark.parametrize("call", [
    lambda lg: lg.info("password=%s user=%s", PASSWORD, EMAIL),
    lambda lg: lg.info("token=%r", TOKEN),
    lambda lg: lg.info("login %(who)s with secret: %(pw)s", {"who": EMAIL, "pw": PASSWORD}),
    lambda lg: lg.info("count=%d password=%s", 3, PASSWORD),
])
def test_placeholders_next_to_secret_names_format_and_hide(capture, call):
    logger, handler = capture(logging.Formatter("%(levelname)s %(message)s"))
    call(logger)
    out = handler.lines[-1]
    _assert_clean(out)
    assert out.startswith("INFO ")


def test_unformattable_record_does_not_print_raw_args_to_stderr(capture, monkeypatch):
    logger, handler = capture(logging.Formatter("%(message)s"))
    stderr = io.StringIO()
    monkeypatch.setattr("sys.stderr", stderr)
    monkeypatch.setattr(logging, "raiseExceptions", True)
    logger.info("only one placeholder %s", PASSWORD, EMAIL)  # 引数が多すぎる
    out = handler.lines[-1]
    _assert_clean(out)
    _assert_clean(stderr.getvalue())
    assert "整形できませんでした" in out


def test_uvicorn_access_log_keeps_args_and_hides_tokens(capture):
    from uvicorn.logging import AccessFormatter

    logger, handler = capture(AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False),
                              name=SELFTEST + ".uvicorn.access")
    logger.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5000", "GET",
                f"/api/v1/plans/documents/download?token={TOKEN}", "1.1", 200)
    out = handler.lines[-1]
    _assert_clean(out)
    assert "token=***" in out and "200" in out and "GET" in out


def test_extra_attributes_with_secret_names_are_hidden(capture):
    logger, handler = capture(logging.Formatter("%(message)s %(password)s %(details)s"))
    logger.info("hello", extra={"password": PASSWORD, "details": {"mail": EMAIL}})
    _assert_clean(handler.lines[-1])


def test_redact_value_limits_and_keeps_types():
    deep = {"a": {"b": {"c": {"d": {"e": {"f": {"g": EMAIL}}}}}}}
    out = redact_value(deep)
    assert EMAIL not in json.dumps(out)
    big = list(range(500))
    assert len(redact_value(big)) == 201
    assert redact_value({"n": 1.5, "b": False, "none": None}) == {"n": 1.5, "b": False, "none": None}
    original = {"password": PASSWORD}
    redact_value(original)
    assert original == {"password": PASSWORD}  # 元の値は変えない


@pytest.mark.parametrize("name,expected", [
    ("password", True), ("new_password", True), ("hashedPassword", True), ("access_token", True),
    ("X-API-Key", True), ("client_secret", True), ("session_id", True), ("pin", True),
    ("mapping", False), ("shipping", False), ("session_count", False), ("refresh_at", False), ("user_id", False),
])
def test_secret_key_names(name, expected):
    assert is_secret_key(name) is expected


def test_leak_collector_inspects_extras():
    collector = log_safety.LeakCollector()
    collector.add_secret(PASSWORD)
    record = logging.LogRecord(SELFTEST + ".s1", logging.INFO, __file__, 1, "msg", None, None)
    record.custom_attr = {"pw": PASSWORD}  # 伏せられていない属性(工場・makeRecord を通らない記録)
    collector.emit(record)
    assert any(f["kind"] == "known_secret" for f in collector.findings)
    assert not find_leaks(json.dumps(redact_value({"password": PASSWORD})), [PASSWORD])
