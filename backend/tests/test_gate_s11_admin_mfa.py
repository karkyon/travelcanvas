"""[Gate S11] SEC-06 多要素認証(TOTP)。管理者は必須、会員は任意。

- RFC 6238 の試験値と一致する(認証アプリと同じ値を作る)
- 設定(再認証)→ 登録の確認 → 回復コード → ログインの2段目(セッションは確認コードの後にだけ作る)
- 同じ確認コード・同じ合図(mfa_token)・同じ回復コードは2回使えない
- 管理者の API: 未設定・このセッションで未確認・確認が古い時は 403、確認すれば通る
- 秘密は暗号化して保存し、回復コードは平文で残さない。ログにも出ない
- 無効化はパスワード + 確認コードが要り、ほかの端末をログアウトさせる
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models.models import Notification, User, UserMfa, UserSession
from app.services import mfa, threat_guard

PASSWORD = "Gate-S11-Mfa-Pass1"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0.0.0 Safari/537.36")


def _register_secret(value: str) -> None:
    from tests.conftest import LEAK_COLLECTOR

    LEAK_COLLECTOR.add_secret(value)


def _register(client):
    suffix = uuid.uuid4().hex[:10]
    email = f"s11_{suffix}@example.com"
    res = client.post("/api/v1/auth/register", json={"username": f"s11_{suffix}", "email": email,
                                                     "password": PASSWORD}, headers={"User-Agent": UA})
    assert res.status_code == 200, res.text
    return email, res.json()["access_token"], uuid.UUID(res.json()["user"]["id"])


def _h(token):
    return {"Authorization": f"Bearer {token}", "User-Agent": UA}


class Clock:
    """確認コードの時間区切り(30秒)を試験の中で進める。"""

    def __init__(self, monkeypatch):
        self.step = mfa.current_step()
        monkeypatch.setattr(mfa, "current_step", lambda now=None: self.step)

    def code(self, secret, delta=0):
        return mfa.totp_at(secret, self.step + delta)

    def tick(self, n=1):
        self.step += n


def _enroll(client, token, clock):
    res = client.post("/api/v1/auth/mfa/setup", json={"current_password": PASSWORD}, headers=_h(token))
    assert res.status_code == 200, res.text
    assert res.headers.get("cache-control") == "no-store"
    secret = res.json()["secret"]
    _register_secret(secret)
    res = client.post("/api/v1/auth/mfa/enable", json={"code": clock.code(secret)}, headers=_h(token))
    assert res.status_code == 200, res.text
    codes = res.json()["recovery_codes"]
    for c in codes:
        _register_secret(c)
    clock.tick()
    return secret, codes


def _login_challenge(client, email):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}, headers={"User-Agent": UA})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mfa_required"] is True and "access_token" not in body
    assert "refresh_token" not in res.headers.get("set-cookie", "")
    _register_secret(body["mfa_token"])
    return body["mfa_token"]


@pytest.fixture(autouse=True)
def _rate_limits_roomy(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_AUTH", 50)


def test_totp_matches_rfc6238_vectors():
    # RFC 6238 付録B(SHA1、秘密 "12345678901234567890")の8桁の値の下6桁
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert mfa.totp_at(secret, 59 // 30) == "287082"
    assert mfa.totp_at(secret, 1111111109 // 30) == "081804"
    assert mfa.totp_at(secret, 1234567890 // 30) == "005924"
    assert mfa.totp_at(secret, 2000000000 // 30) == "279037"


def test_match_rejects_replay_and_far_clock(monkeypatch):
    secret = mfa.new_secret()
    assert len(secret) == 32
    base = mfa.current_step()
    monkeypatch.setattr(mfa, "current_step", lambda now=None: base)
    assert mfa.match_totp(secret, mfa.totp_at(secret, base), last_used_step=None) == base
    assert mfa.match_totp(secret, mfa.totp_at(secret, base - 1), last_used_step=None) == base - 1
    assert mfa.match_totp(secret, mfa.totp_at(secret, base + 2), last_used_step=None) is None
    assert mfa.match_totp(secret, mfa.totp_at(secret, base), last_used_step=base) is None
    assert mfa.match_totp(secret, "12345", last_used_step=None) is None
    assert mfa.match_totp(secret, "abcdef", last_used_step=None) is None
    assert mfa.otpauth_uri(secret, "a+b@example.com").startswith("otpauth://totp/TravelCanvas%3Aa%2Bb%40example.com?")


def test_enroll_login_with_code_and_session_marked(client, db_session, monkeypatch):
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    assert client.get("/api/v1/auth/mfa", headers=_h(token)).json()["enabled"] is False

    # 再認証が要る
    res = client.post("/api/v1/auth/mfa/setup", json={"current_password": "wrong-password"}, headers=_h(token))
    assert res.status_code == 400 and res.json()["detail"]["code"] == "wrong_password"
    res = client.post("/api/v1/auth/mfa/enable", json={"code": "123456"}, headers=_h(token))
    assert res.status_code == 409 and res.json()["detail"]["code"] == "mfa_setup_required"

    res = client.post("/api/v1/auth/mfa/setup", json={"current_password": PASSWORD}, headers=_h(token))
    assert res.status_code == 200, res.text
    secret = res.json()["secret"]
    _register_secret(secret)
    assert res.json()["otpauth_uri"].startswith("otpauth://totp/") and f"secret={secret}" in res.json()["otpauth_uri"]
    st = client.get("/api/v1/auth/mfa", headers=_h(token)).json()
    assert st["pending"] is True and st["enabled"] is False

    # 設定の途中はログインに確認コードを求めない
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}, headers={"User-Agent": UA})
    assert "access_token" in res.json()

    wrong = "000000" if clock.code(secret) != "000000" else "111111"
    res = client.post("/api/v1/auth/mfa/enable", json={"code": wrong}, headers=_h(token))
    assert res.status_code == 400 and res.json()["detail"]["code"] == "mfa_invalid_code"
    res = client.post("/api/v1/auth/mfa/enable", json={"code": clock.code(secret)}, headers=_h(token))
    assert res.status_code == 200, res.text
    codes = res.json()["recovery_codes"]
    assert len(codes) == 10 and len(set(codes)) == 10
    clock.tick()
    for c in codes:
        _register_secret(c)
    st = client.get("/api/v1/auth/mfa", headers=_h(token)).json()
    assert st["enabled"] is True and st["recovery_codes_remaining"] == 10 and st["session_verified"] is True
    assert client.post("/api/v1/auth/mfa/setup", json={"current_password": PASSWORD},
                       headers=_h(token)).status_code == 409

    # 保存の形: 秘密は暗号文、回復コードはハッシュだけ
    rec = db_session.query(UserMfa).filter(UserMfa.user_id == uid).one()
    assert secret.encode() not in bytes(rec.totp_secret_ciphertext)
    assert mfa.decrypt_secret(rec.totp_secret_ciphertext) == secret
    assert all(c not in str(rec.recovery_code_hashes) and c.replace("-", "") not in str(rec.recovery_code_hashes)
               for c in codes)

    # ログイン: パスワードだけではセッションを作らない
    sessions_before = db_session.query(UserSession).filter(UserSession.user_id == uid).count()
    mfa_token = _login_challenge(client, email)
    assert db_session.query(UserSession).filter(UserSession.user_id == uid).count() == sessions_before

    # 登録で使った確認コードは使い回せない
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": mfa_token, "code": clock.code(secret, -1)})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "mfa_invalid_code"
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": mfa_token, "code": clock.code(secret)},
                      headers={"User-Agent": UA})
    assert res.status_code == 200, res.text
    assert "refresh_token=" in res.headers.get("set-cookie", "")
    new_token = res.json()["access_token"]
    st = client.get("/api/v1/auth/mfa", headers=_h(new_token)).json()
    assert st["session_verified"] is True

    # 同じ合図では2つ目のセッションを作れない(次の区切りの正しい確認コードでも)
    clock.tick()
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": mfa_token, "code": clock.code(secret)})
    assert res.status_code == 401

    # セッション一覧に内部の値を出さない
    sessions = client.get("/api/v1/auth/sessions", headers=_h(new_token)).json()
    assert all(mfa.SESSION_MFA_KEY not in (s.get("device_info") or {}) for s in sessions)
    assert db_session.query(Notification).filter(Notification.user_id == uid,
                                                 Notification.type == "mfa_enabled").count() == 1


def test_recovery_code_works_once(client, db_session, monkeypatch):
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    secret, codes = _enroll(client, token, clock)
    t1 = _login_challenge(client, email)
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t1, "code": codes[3].upper()})
    assert res.status_code == 200, res.text
    st = client.get("/api/v1/auth/mfa", headers=_h(res.json()["access_token"])).json()
    assert st["recovery_codes_remaining"] == 9
    t2 = _login_challenge(client, email)
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t2, "code": codes[3]})
    assert res.status_code == 400
    assert db_session.query(Notification).filter(Notification.user_id == uid,
                                                 Notification.type == "mfa_recovery_code_used").count() == 1


def test_mfa_token_must_be_genuine(client, monkeypatch):
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    secret, _codes = _enroll(client, token, clock)
    # アクセストークン・でたらめ・期限切れは合図として使えない
    for bad in (token, "x" * 40):
        res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": bad, "code": clock.code(secret)})
        assert res.status_code == 401 and res.json()["detail"]["code"] == "mfa_token_invalid"
    expired, _ = mfa.issue_mfa_token(uid, now=datetime.now(timezone.utc) - timedelta(minutes=10))
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": expired, "code": clock.code(secret)})
    assert res.status_code == 401
    # 1つの合図で試せるのは5回まで
    t = _login_challenge(client, email)
    wrong = "000000" if clock.code(secret) != "000000" else "111111"
    for _ in range(5):
        assert client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": wrong}).status_code == 400
    assert client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": clock.code(secret)}).status_code == 429


def _make_admin(db_session, uid):
    user = db_session.query(User).filter(User.id == uid).one()
    user.is_superuser = True
    db_session.commit()


def test_admin_api_requires_enrolled_and_fresh_mfa(client, db_session, monkeypatch):
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    assert client.get("/api/v1/admin/stats/system", headers=_h(token)).status_code == 403
    _make_admin(db_session, uid)

    res = client.get("/api/v1/admin/stats/system", headers=_h(token))
    assert res.status_code == 403 and res.json()["detail"]["code"] == "mfa_enrollment_required"
    st = client.get("/api/v1/auth/mfa", headers=_h(token)).json()
    assert st["is_admin"] is True and st["required"] is True and st["session_verified"] is False

    secret, _codes = _enroll(client, token, clock)
    assert client.get("/api/v1/admin/stats/system", headers=_h(token)).status_code == 200

    # 確認が古くなったら、もう一度確認コードを求める
    session = db_session.query(UserSession).filter(UserSession.user_id == uid, UserSession.is_active.is_(True)).first()
    old = datetime.now(timezone.utc) - timedelta(hours=settings.ADMIN_MFA_MAX_AGE_HOURS + 1)
    mfa.mark_session_verified(db_session, session, now=old)
    res = client.get("/api/v1/admin/users", headers=_h(token))
    assert res.status_code == 403 and res.json()["detail"]["code"] == "mfa_step_up_required"
    wrong = "000000" if clock.code(secret) != "000000" else "111111"
    assert client.post("/api/v1/auth/mfa/step-up", json={"code": wrong}, headers=_h(token)).status_code == 400
    res = client.post("/api/v1/auth/mfa/step-up", json={"code": clock.code(secret)}, headers=_h(token))
    assert res.status_code == 200 and res.json()["session_verified"] is True
    assert client.get("/api/v1/admin/users", headers=_h(token)).status_code == 200

    # 管理者のログインは2段目を通ったセッションだけが管理者の API に届く
    t = _login_challenge(client, email)
    clock.tick()
    res = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": clock.code(secret)})
    assert client.get("/api/v1/admin/audit-logs", headers=_h(res.json()["access_token"])).status_code == 200


def test_disable_requires_password_and_code_and_logs_out_others(client, db_session, monkeypatch):
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    secret, _codes = _enroll(client, token, clock)
    t = _login_challenge(client, email)
    other = client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": clock.code(secret)}).json()
    clock.tick()

    res = client.post("/api/v1/auth/mfa/disable", json={"current_password": PASSWORD, "code": "999999"},
                      headers=_h(token))
    assert res.status_code == 400
    res = client.post("/api/v1/auth/mfa/disable", json={"current_password": "wrong", "code": clock.code(secret)},
                      headers=_h(token))
    assert res.status_code == 400
    res = client.post("/api/v1/auth/mfa/disable", json={"current_password": PASSWORD, "code": clock.code(secret)},
                      headers=_h(token))
    assert res.status_code == 200 and res.json() == {"enabled": False}
    assert db_session.query(UserMfa).filter(UserMfa.user_id == uid).count() == 0
    assert client.get("/api/v1/auth/me", headers=_h(other["access_token"])).status_code == 401
    assert client.get("/api/v1/auth/me", headers=_h(token)).status_code == 200
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert "access_token" in res.json()


def test_regenerate_recovery_codes(client, monkeypatch):
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    secret, codes = _enroll(client, token, clock)
    res = client.post("/api/v1/auth/mfa/recovery-codes", json={"current_password": PASSWORD,
                                                               "code": clock.code(secret)}, headers=_h(token))
    assert res.status_code == 200, res.text
    fresh = res.json()["recovery_codes"]
    for c in fresh:
        _register_secret(c)
    assert set(fresh).isdisjoint(codes)
    t = _login_challenge(client, email)
    assert client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": codes[0]}).status_code == 400
    assert client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": fresh[0]}).status_code == 200


def test_guest_and_anonymous_cannot_use_mfa(client):
    assert client.get("/api/v1/auth/mfa").status_code == 401
    guest = client.post("/api/v1/auth/guest").json()["access_token"]
    for method, path, body in (("get", "/api/v1/auth/mfa", None),
                               ("post", "/api/v1/auth/mfa/setup", {"current_password": "x"}),
                               ("post", "/api/v1/auth/mfa/step-up", {"code": "123456"})):
        res = getattr(client, method)(path, json=body, headers=_h(guest)) if body else \
            getattr(client, method)(path, headers=_h(guest))
        assert res.status_code in (401, 403), (path, res.text)


def test_failed_codes_are_counted_by_the_guard(client, monkeypatch):
    monkeypatch.setattr(settings, "GUARD_ENABLED", True)
    threat_guard.reset_all()
    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    secret, _codes = _enroll(client, token, clock)
    t = _login_challenge(client, email)
    wrong = "000000" if clock.code(secret) != "000000" else "111111"
    client.post("/api/v1/auth/mfa/verify", json={"mfa_token": t, "code": wrong})
    assert threat_guard.current_score("testclient") >= threat_guard.SIGNAL_WEIGHTS["mfa_failed"]
    threat_guard.reset_all()


def test_account_deletion_removes_mfa(client, db_session, monkeypatch):
    from app.services import account_deletion

    clock = Clock(monkeypatch)
    email, token, uid = _register(client)
    _enroll(client, token, clock)
    user = db_session.query(User).filter(User.id == uid).one()
    account_deletion.delete_account(db_session, user)
    db_session.commit()
    assert db_session.query(UserMfa).filter(UserMfa.user_id == uid).count() == 0


def test_production_refuses_admin_mfa_off():
    from app.core.config import production_problems

    class S:
        DEBUG = False
        SQL_ECHO = False
        JWT_SECRET_KEY = ENCRYPTION_KEY = LOOKUP_INDEX_KEY = DOCUMENT_DOWNLOAD_SIGNING_KEY = None
        OFFLINE_PACK_KEY_SECRET = None
        METRICS_TOKEN = None
        CORS_ORIGINS = ["https://app.example.jp"]
        ADMIN_MFA_REQUIRED = False

    assert any("ADMIN_MFA_REQUIRED" in p for p in production_problems(S()))


def test_operator_reset_requires_confirmation(capsys):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "security_incident.py"
    spec = importlib.util.spec_from_file_location("security_incident_s11", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.main(["mfa-reset", "--email", "nobody@example.com"]) == module.EXIT_USAGE
    assert "--yes" in capsys.readouterr().out
