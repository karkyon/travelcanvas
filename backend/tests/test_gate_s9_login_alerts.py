"""[Gate S9] 新しい端末からのログインの通知と、ログイン中の端末の一覧(乗っ取りに早く気付く)。"""
import uuid

from app.models.models import Notification
from app.services import login_alerts

PASSWORD = "Gate-S9-Device-Pass1"
CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/130.0.0.0 Safari/537.36")
FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
EDGE_WIN = CHROME_WIN + " Edg/130.0.0.0"
SAFARI_IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
                 "Version/18.0 Mobile/15E148 Safari/604.1")
CHROME_ANDROID = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/130.0.0.0 Mobile Safari/537.36")


def _register(client, ua=CHROME_WIN):
    suffix = uuid.uuid4().hex[:10]
    email = f"s9_{suffix}@example.com"
    res = client.post("/api/v1/auth/register", json={"username": f"s9_{suffix}", "email": email, "password": PASSWORD},
                      headers={"User-Agent": ua})
    assert res.status_code == 200, res.text
    return email, res.json()["access_token"], res.json()["user"]["id"]


def _login(client, email, ua):
    res = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}, headers={"User-Agent": ua})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _alerts(db_session, user_id):
    return db_session.query(Notification).filter(
        Notification.user_id == uuid.UUID(user_id), Notification.type == "new_device_login").all()


def test_device_and_network_labels():
    assert login_alerts.device_label(CHROME_WIN) == "Chrome / Windows"
    assert login_alerts.device_label(EDGE_WIN) == "Edge / Windows"
    assert login_alerts.device_label(FIREFOX_LINUX) == "Firefox / Linux"
    assert login_alerts.device_label(SAFARI_IPHONE) == "Safari / iPhone"
    assert login_alerts.device_label(CHROME_ANDROID) == "Chrome / Android"
    assert login_alerts.device_label("") == "不明な端末"
    assert login_alerts.device_label("curl/8.0") == "不明な端末"
    assert login_alerts.network_label("203.0.113.57") == "203.0.113.x"
    assert login_alerts.network_label("2001:db8:1234:5678::1") == "2001:db8:1234::/48"
    assert login_alerts.network_label("testclient") is None
    assert login_alerts.network_label(None) is None


def test_first_login_and_same_device_do_not_alert(client, db_session):
    email, _, user_id = _register(client)
    _login(client, email, CHROME_WIN)
    _login(client, email, CHROME_WIN)
    assert _alerts(db_session, user_id) == []


def test_new_device_login_alerts_the_owner_once(client, db_session):
    email, _, user_id = _register(client)
    _login(client, email, FIREFOX_LINUX)
    alerts = _alerts(db_session, user_id)
    assert len(alerts) == 1
    assert alerts[0].title == "新しい端末からログインがありました"
    assert "Firefox / Linux" in alerts[0].message
    assert PASSWORD not in alerts[0].message and email not in alerts[0].message
    _login(client, email, FIREFOX_LINUX)  # もう知っている端末
    assert len(_alerts(db_session, user_id)) == 1


def test_alert_is_visible_through_the_notifications_api(client):
    email, token, _ = _register(client)
    _login(client, email, SAFARI_IPHONE)
    res = client.get("/api/v1/notifications/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    assert any(n["type"] == "new_device_login" and "Safari / iPhone" in n["message"] for n in res.json())


def test_failed_login_from_new_device_does_not_alert(client, db_session):
    email, _, user_id = _register(client)
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "Wrong-Pass-123"},
                      headers={"User-Agent": FIREFOX_LINUX})
    assert res.status_code == 401
    assert _alerts(db_session, user_id) == []


def test_session_list_shows_device_and_rounded_network(client):
    email, token, _ = _register(client, CHROME_WIN)
    other = _login(client, email, FIREFOX_LINUX)
    res = client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {other}"})
    assert res.status_code == 200
    rows = res.json()
    assert {r["device_label"] for r in rows} == {"Chrome / Windows", "Firefox / Linux"}
    current = [r for r in rows if r["is_current"]]
    assert len(current) == 1 and current[0]["device_label"] == "Firefox / Linux"
    for row in rows:
        assert row["last_active_at"]
        assert "network_label" in row
        assert "_refresh_prev_hash" not in (row.get("device_info") or {})
    # 一覧から他の端末をログアウトさせると、その端末のトークンは使えない
    chrome = next(r for r in rows if r["device_label"] == "Chrome / Windows")
    assert client.delete(f"/api/v1/auth/sessions/{chrome['id']}",
                         headers={"Authorization": f"Bearer {other}"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 200


def test_old_sessions_without_device_field_still_get_a_label(client, db_session):
    from app.models.models import UserSession

    email, token, user_id = _register(client, CHROME_WIN)
    for s in db_session.query(UserSession).filter(UserSession.user_id == uuid.UUID(user_id)).all():
        s.device_info = {"user_agent": CHROME_WIN}  # 以前の版で作ったセッション
    db_session.commit()
    rows = client.get("/api/v1/auth/sessions", headers={"Authorization": f"Bearer {token}"}).json()
    assert rows[0]["device_label"] == "Chrome / Windows"
    _login(client, email, CHROME_WIN)
    assert _alerts(db_session, user_id) == []
