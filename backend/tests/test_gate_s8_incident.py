"""[Gate S8] SEC-19/20 侵害が疑われる時の封じ込め(警戒モード・セッションの一斉失効・遮断の解除)。"""
import importlib.util
import uuid
from pathlib import Path

import pytest

from app.core.config import settings
from app.models.models import UserSession
from app.services import challenge, incident, threat_guard as guard

PASSWORD = "Gate-S8-Incident-Pass1"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "security_incident.py"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(settings, "GUARD_ENABLED", True)
    monkeypatch.setattr(settings, "GUARD_TRUSTED_IPS", "")
    monkeypatch.setattr(settings, "CHALLENGE_ENABLED", True)
    monkeypatch.setattr(settings, "CHALLENGE_BASE_DIFFICULTY", 8)
    monkeypatch.setattr(settings, "CHALLENGE_ALWAYS", "")
    incident.clear_lockdown()
    guard.reset_all()
    challenge.reset_used()
    yield
    incident.clear_lockdown()
    guard.reset_all()
    challenge.reset_used()


def _register(client):
    suffix = uuid.uuid4().hex[:10]
    email = f"s8_{suffix}@example.com"
    res = client.post("/api/v1/auth/register", json={"username": f"s8_{suffix}", "email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return email, res.json()["access_token"]


def _me(client, token):
    return client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code


def _load_script():
    spec = importlib.util.spec_from_file_location("security_incident", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ===== 警戒モード =====

def test_lockdown_requires_challenge_from_everyone(client):
    assert client.post("/api/v1/auth/guest").status_code == 201
    incident.set_lockdown(30, reason="試験")
    res = client.post("/api/v1/auth/guest")
    assert res.status_code == 428
    token = res.headers["x-tc-challenge"]
    solved = {"X-TC-Challenge": token, "X-TC-Challenge-Solution": challenge.solve(token, 8)}
    assert client.post("/api/v1/auth/guest", headers=solved).status_code == 201
    incident.clear_lockdown()
    assert client.post("/api/v1/auth/guest").status_code == 201


def test_lockdown_can_close_signup_but_not_login(client):
    email, _ = _register(client)
    incident.set_lockdown(30, close_signup=True)

    def solve_and_send(method, path, **kw):
        first = getattr(client, method)(path, **kw)
        if first.status_code != 428:
            return first
        token = first.headers["x-tc-challenge"]
        headers = {**kw.pop("headers", {}), "X-TC-Challenge": token,
                   "X-TC-Challenge-Solution": challenge.solve(token, int(first.headers["x-tc-challenge-difficulty"]))}
        return getattr(client, method)(path, headers=headers, **kw)

    suffix = uuid.uuid4().hex[:8]
    reg = solve_and_send("post", "/api/v1/auth/register",
                         json={"username": f"s8c_{suffix}", "email": f"s8c_{suffix}@example.com", "password": PASSWORD})
    assert reg.status_code == 503
    assert solve_and_send("post", "/api/v1/auth/guest").status_code == 503
    login = solve_and_send("post", "/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200


def test_lockdown_lowers_the_block_threshold(monkeypatch):
    monkeypatch.setattr(settings, "GUARD_WARN_SCORE", 1000)
    monkeypatch.setattr(settings, "GUARD_BLOCK_SCORE", 100)
    monkeypatch.setattr(settings, "GUARD_LOCKDOWN_FACTOR", 0.5)
    for _ in range(5):
        guard.record_signal("203.0.113.40", "cross_site_blocked")  # 50 点
    assert guard.blocked_until("203.0.113.40") == 0.0
    incident.set_lockdown(30)
    guard.record_signal("203.0.113.40", "cross_site_blocked")  # 60 点 >= 100 * 0.5
    assert guard.blocked_until("203.0.113.40") > 0


def test_lockdown_expires_and_is_bounded(monkeypatch):
    state = incident.set_lockdown(10 ** 9)
    assert state["until"] - incident._now() <= incident.MAX_LOCKDOWN_MINUTES * 60 + 1
    now = incident._now()
    incident.set_lockdown(1)
    monkeypatch.setattr(incident, "_now", lambda: now + 120)
    assert incident.lockdown_state(fresh=True) is None


# ===== セッションの失効 =====

def test_revoke_one_users_sessions(client, db_session):
    email_a, token_a = _register(client)
    _email_b, token_b = _register(client)
    assert incident.revoke_sessions(db_session, email=email_a, reason="漏洩の疑い") >= 1
    assert _me(client, token_a) == 401
    assert _me(client, token_b) == 200


def test_revoke_everyone(client, db_session):
    _, token_a = _register(client)
    _, token_b = _register(client)
    count = incident.revoke_sessions(db_session, all_users=True)
    assert count >= 2
    assert _me(client, token_a) == 401 and _me(client, token_b) == 401
    assert db_session.query(UserSession).filter(UserSession.is_active.is_(True)).count() == 0


def test_revoke_requires_exactly_one_scope(db_session):
    with pytest.raises(ValueError):
        incident.revoke_sessions(db_session)
    with pytest.raises(ValueError):
        incident.revoke_sessions(db_session, email="a@example.com", all_users=True)
    with pytest.raises(LookupError):
        incident.revoke_sessions(db_session, email=f"nobody_{uuid.uuid4().hex}@example.com")


# ===== 運用のコマンド =====

def test_script_refuses_unsafe_or_ineffective_use(monkeypatch, capsys):
    script = _load_script()
    assert script.main(["revoke-sessions", "--all"]) == script.EXIT_USAGE
    assert script.main(["revoke-sessions"]) == script.EXIT_USAGE
    monkeypatch.setattr(script, "_shared", lambda: False)
    assert script.main(["lockdown", "on", "--minutes", "5"]) == script.EXIT_NO_EFFECT
    out = capsys.readouterr().out
    assert "Redis" in out
    assert script.main(["status"]) == script.EXIT_OK


def test_tcops_passes_security_commands_into_the_backend(monkeypatch):
    from app.ops import cli

    calls = []

    class FakeExecutor:
        def backend_python(self, module_args, **kw):
            calls.append(list(module_args))

            class Proc:
                returncode = 0
                stdout = b'{"ok": true}\n'
                stderr = b""

            return Proc()

    monkeypatch.setattr(cli, "make_executor", lambda mode: FakeExecutor())
    assert cli.main(["security", "lockdown", "on", "--minutes", "30", "--close-signup"]) == 0
    assert cli.main(["security", "revoke-sessions", "--all", "--yes"]) == 0
    assert calls == [
        ["scripts/security_incident.py", "lockdown", "on", "--minutes", "30", "--close-signup"],
        ["scripts/security_incident.py", "revoke-sessions", "--all", "--yes"],
    ]
