"""
[Gate S2] 認証の強化(セキュリティ監査 F05・F06・F10・F14、整理 SEC-02・SEC-03・SEC-05・SEC-08・SEC-09)。

- パスワードの規則を登録・ゲストの昇格・変更の全経路で同じに強制する
- refresh token の検証・入れ替えを行ロックの中で行い、同じ token の並列要求が両方「入れ替え」にならない。
  同じブラウザの複数タブの同時 refresh(直前の token、短い猶予の内)は盗用扱いにしない
- メールアドレスの変更は現在のパスワードで再認証し、確認済みを外し、ほかの端末を失効させる
- 本番では危険な設定のまま起動しない
- 全ての応答にセキュリティヘッダーを付ける
"""
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import password_policy as pp
from app.core.config import Settings, production_problems, settings
from app.core.database import SessionLocal
from app.main import app
from app.models.models import AuditLog, User, UserSession

STRONG = "Kumo-Sora-Umi-2026"


def _register(client, password=STRONG, email=None, username=None):
    email = email or f"s2_{uuid.uuid4().hex[:10]}@example.com"
    username = username or f"s2_{uuid.uuid4().hex[:10]}"
    res = client.post("/api/v1/auth/register", json={"username": username, "email": email, "password": password})
    return res, email, username


# ---------------------------------------------------------------- パスワードの規則

@pytest.mark.parametrize("password,needle", [
    ("", "入力"),
    ("short1", "文字以上"),
    ("password123", "よく使われる"),
    ("aaaaaaaaaa", "繰り返し"),
    ("abababababab", "繰り返し"),
    ("12345678", "よく使われる"),
    ("abcdefghij", "連続"),
    (" Kumo-Sora-Umi ", "空白"),
    ("あ" * 25, "長すぎ"),  # 75 バイト
    ("Kumo\x00Sora-Umi", "制御文字"),
])
def test_password_problems(password, needle):
    problems = pp.password_problems(password)
    assert problems and needle in problems[0]


def test_password_must_not_contain_identifiers():
    assert pp.password_problems("taro.yamada-2026!", email="taro.yamada@example.com")
    assert pp.password_problems("Hanako-Travel-99", username="hanako")
    assert pp.password_problems(STRONG, email="other@example.com", username="someone") == []
    assert pp.password_problems("ゆっくり旅をする京都") == []  # 日本語(30バイト)は通る


def test_register_rejects_weak_password_with_reason(client):
    res, _, _ = _register(client, password="password123")
    assert res.status_code == 400
    assert "よく使われる" in res.json()["detail"]
    res, _, _ = _register(client, password="x")
    assert res.status_code == 400
    res, _, _ = _register(client, password=STRONG)
    assert res.status_code == 200


def test_guest_upgrade_enforces_the_same_policy(client):
    guest = client.post("/api/v1/auth/guest").json()
    headers = {"Authorization": f"Bearer {guest['access_token']}"}
    body = {"username": f"s2g{uuid.uuid4().hex[:8]}", "email": f"s2g_{uuid.uuid4().hex[:8]}@example.com"}
    weak = client.post("/api/v1/auth/guest/upgrade", json={**body, "password": "12345678"}, headers=headers)
    assert weak.status_code == 400
    ok = client.post("/api/v1/auth/guest/upgrade", json={**body, "password": STRONG}, headers=headers)
    assert ok.status_code == 200, ok.text


def test_change_password_enforces_policy_and_requires_a_new_value(client):
    res, _, _ = _register(client)
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    weak = client.post("/api/v1/auth/change-password", json={"current_password": STRONG, "new_password": "qwerty123"},
                       headers=headers)
    assert weak.status_code == 400 and "よく使われる" in weak.json()["detail"]
    same = client.post("/api/v1/auth/change-password", json={"current_password": STRONG, "new_password": STRONG},
                       headers=headers)
    assert same.status_code == 400 and "違うもの" in same.json()["detail"]
    ok = client.post("/api/v1/auth/change-password",
                     json={"current_password": STRONG, "new_password": "Yama-Kawa-Mori-77"}, headers=headers)
    assert ok.status_code == 200


# ---------------------------------------------------------------- refresh

def test_refresh_within_grace_does_not_revoke_and_does_not_set_cookie(client):
    _register(client)
    old_cookie = client.cookies.get("refresh_token")
    first = client.post("/api/v1/auth/refresh")
    assert first.status_code == 200
    new_cookie = client.cookies.get("refresh_token")
    # 別のタブが同時に送った(直前の)token
    client.cookies.set("refresh_token", old_cookie)
    second = client.post("/api/v1/auth/refresh")
    assert second.status_code == 200 and second.json()["access_token"]
    assert "refresh_token" not in second.headers.get("set-cookie", "")
    # セッションは生きていて、新しい token で続けられる
    client.cookies.set("refresh_token", new_cookie)
    assert client.post("/api/v1/auth/refresh").status_code == 200


def test_refresh_grace_expires(client, db_session):
    _register(client)
    old_cookie = client.cookies.get("refresh_token")
    assert client.post("/api/v1/auth/refresh").status_code == 200
    session_id = old_cookie.split(".", 1)[0]
    s = db_session.query(UserSession).filter(UserSession.id == uuid.UUID(session_id)).one()
    info = dict(s.device_info or {})
    info["_refresh_rotated_at"] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    s.device_info = info
    db_session.commit()
    client.cookies.set("refresh_token", old_cookie)
    assert client.post("/api/v1/auth/refresh").status_code == 401
    db_session.expire_all()
    assert db_session.query(UserSession).filter(UserSession.id == uuid.UUID(session_id)).one().is_active is False


def test_session_list_hides_internal_refresh_state(client):
    res, _, _ = _register(client)
    assert client.post("/api/v1/auth/refresh").status_code == 200
    token = client.post("/api/v1/auth/refresh").json()["access_token"]
    sessions = client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {token}"}).json()
    assert sessions
    for s in sessions:
        assert not any(k.startswith("_refresh") for k in (s.get("device_info") or {}))


def test_malformed_refresh_cookie_is_rejected(client):
    client.cookies.set("refresh_token", "not-a-uuid.secret")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_parallel_refresh_with_the_same_token_rotates_once():
    """行ロックの確認: 実際に commit される DB で、同じ cookie の refresh を同時に2つ送る。
    1つだけが入れ替え(新しい cookie)になり、もう1つは猶予内の同時要求として扱われる。"""
    email = f"s2race_{uuid.uuid4().hex[:10]}@example.com"
    with TestClient(app) as c0:
        res = c0.post("/api/v1/auth/register", json={"username": f"s2r{uuid.uuid4().hex[:8]}", "email": email,
                                                     "password": STRONG})
        assert res.status_code == 200, res.text
        cookie = c0.cookies.get("refresh_token")
    results = []
    barrier = threading.Barrier(2)

    def worker():
        with TestClient(app) as c:
            c.cookies.set("refresh_token", cookie)
            barrier.wait()
            r = c.post("/api/v1/auth/refresh")
            results.append((r.status_code, "refresh_token=" in r.headers.get("set-cookie", "")))

    try:
        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        assert sorted(code for code, _ in results) == [200, 200], results
        assert sum(1 for _, rotated in results if rotated) == 1, results  # 入れ替えは1回だけ
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == email).one()
            sessions = db.query(UserSession).filter(UserSession.user_id == user.id).all()
            assert len(sessions) == 1 and sessions[0].is_active
        finally:
            db.close()
    finally:
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            if user:
                db.query(UserSession).filter(UserSession.user_id == user.id).delete()
                db.query(AuditLog).filter(AuditLog.user_id == user.id).delete()
                db.delete(user)
                db.commit()
        finally:
            db.close()


# ---------------------------------------------------------------- メールアドレスの変更(再認証)

def test_email_change_requires_current_password_and_revokes_other_sessions(client, db_session):
    res, email, _ = _register(client)
    token = res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    other = client.post("/api/v1/auth/login", json={"email": email, "password": STRONG})  # 別の端末
    assert other.status_code == 200
    new_email = f"s2new_{uuid.uuid4().hex[:8]}@example.com"

    missing = client.put("/api/v1/auth/me", json={"email": new_email}, headers=headers)
    assert missing.status_code == 400 and "現在のパスワード" in missing.json()["detail"]
    wrong = client.put("/api/v1/auth/me", json={"email": new_email, "current_password": "Wrong-Pass-123"},
                       headers=headers)
    assert wrong.status_code == 400 and "正しくありません" in wrong.json()["detail"]

    user = db_session.query(User).filter(User.email == email).one()
    user.is_verified = True
    db_session.commit()
    ok = client.put("/api/v1/auth/me", json={"email": new_email, "current_password": STRONG}, headers=headers)
    assert ok.status_code == 200, ok.text
    assert ok.json()["email"] == new_email and ok.json()["is_verified"] is False
    db_session.expire_all()
    active = db_session.query(UserSession).filter(UserSession.user_id == user.id, UserSession.is_active.is_(True)).all()
    assert len(active) == 1  # 変更した端末だけが残る


def test_profile_update_without_email_change_needs_no_password(client):
    res, email, _ = _register(client)
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    same = client.put("/api/v1/auth/me", json={"email": email, "preferences": {"theme": "dark"}}, headers=headers)
    assert same.status_code == 200


# ---------------------------------------------------------------- 本番の設定

GOOD = {
    "DATABASE_URL": "postgresql://u@db/x",
    "JWT_SECRET_KEY": "Jq7v2Lk9Rm4Tx8Wn3Bd6Hp1Sz5Cf0Gy-a",
    "ENCRYPTION_KEY": "Ek3Nw8Qs1Vb6Yr2Ju9Mx4Lc7Tg0Hd5Pa-b",
    "LOOKUP_INDEX_KEY": "Lk8Hq3Vx6Nb1Wt9Rm4Cs7Jy2Gd5Pf0Za-c",
    "DOCUMENT_DOWNLOAD_SIGNING_KEY": "Ds4Mk9Qw2Vr7Bn1Xj6Lt3Hc8Yg5Pf0Ea-d",
    "METRICS_TOKEN": "Mt5Kx8Rq2Wn7Vb3Lj9Hs4Cd1Gy6",
    "DEBUG": False,
    "CORS_ORIGINS": "https://app.travelcanvas.jp",
}


def _settings(**overrides):
    values = {**GOOD, **overrides}
    return Settings(_env_file=None, **values)


def test_production_settings_pass_when_safe():
    s = _settings(APP_ENV="production")
    assert s.is_production and production_problems(s) == []


@pytest.mark.parametrize("override,needle", [
    ({"DEBUG": True}, "DEBUG"),
    ({"JWT_SECRET_KEY": "short"}, "JWT_SECRET_KEY"),
    ({"JWT_SECRET_KEY": "ci-only-dummy-jwt-secret-not-used-anywhere-else"}, "JWT_SECRET_KEY"),
    ({"ENCRYPTION_KEY": None}, "ENCRYPTION_KEY"),
    ({"LOOKUP_INDEX_KEY": GOOD["ENCRYPTION_KEY"]}, "同じ値"),
    ({"METRICS_TOKEN": None}, "METRICS_TOKEN"),
    ({"CORS_ORIGINS": "http://localhost:4173"}, "CORS_ORIGINS"),
    ({"CORS_ORIGINS": "*"}, "CORS_ORIGINS"),
])
def test_production_refuses_unsafe_settings(override, needle):
    with pytest.raises(Exception) as exc:
        _settings(APP_ENV="production", **override)
    assert needle in str(exc.value)
    assert GOOD["ENCRYPTION_KEY"] not in str(exc.value)  # 値そのものはエラーに出さない


def test_development_is_not_blocked():
    s = _settings(APP_ENV="development", DEBUG=True, JWT_SECRET_KEY="dev")
    assert not s.is_production


# ---------------------------------------------------------------- セキュリティヘッダー

def test_security_headers_on_api_responses(client):
    for path in ("/health", "/api/v1/auth/me", "/api/v1/does-not-exist"):
        res = client.get(path)
        assert res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["x-frame-options"] == "DENY"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert "default-src 'none'" in res.headers["content-security-policy"]
        assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
    assert client.get("/api/v1/auth/me").headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in client.get("/health").headers  # 開発では付けない


def test_hsts_in_production_and_no_csp_on_docs(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    res = client.get("/health")
    assert res.headers["strict-transport-security"].startswith("max-age=31536000")
    monkeypatch.setattr(settings, "APP_ENV", "development")
    docs = client.get("/docs")
    assert docs.status_code == 200 and "content-security-policy" not in docs.headers
