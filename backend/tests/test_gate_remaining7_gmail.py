"""
[Gate Remaining-7] FR-011 Gmail の連携(読み取りだけ・押した時だけ)。

外への通信は ext_http の差し替え(MockTransport)で行う。検証する性質:
- クライアントの鍵が無い環境では使えない(available=false・connect は 409)
- state は署名つき・利用者に結び付く。改ざん・期限切れは戻り先へ invalid_state で返す
- 許可の交換で refresh token を暗号化して保存する(平文で持たない)。gmail.readonly が無ければ断る
- 取り込みは予約らしいメールだけを読み、予約の読み取り(候補)にする。同じメールは 2 回取り込まない
- 外すと Google へ取り消しを送り、行を消す
"""
import base64
import json
import uuid
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.core.config import settings
from app.models.models import GmailConnection, ImportJob
from app.services import ext_http
from app.services import gmail_connector as gc
from app.services import provider_secrets as ps

MAIL = (
    "From: 予約サイト <noreply@booking.example>\r\nTo: me@example.com\r\nSubject: ご予約の確認\r\n"
    "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n"
    "ご予約ありがとうございます。\r\n予約番号: GMAIL1234\r\n宿泊施設: 嵐山の宿\r\n"
    "チェックイン: 2026年11月20日 15:00\r\nチェックアウト: 2026年11月21日 10:00\r\n"
)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class Google:
    def __init__(self):
        self.calls = []
        self.scope = ("openid https://www.googleapis.com/auth/userinfo.email "
                      "https://www.googleapis.com/auth/gmail.readonly")

    def oauth(self, request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        self.calls.append(("oauth", str(request.url), form))
        if str(request.url).endswith("/revoke"):
            return httpx.Response(200)
        if form.get("grant_type") == ["authorization_code"]:
            idt = "x." + _b64(json.dumps({"email": "me@gmail.example"}).encode()) + ".y"
            return httpx.Response(200, json={"access_token": "at-1", "refresh_token": "rt-secret-value-1",
                                             "scope": self.scope, "id_token": idt})
        return httpx.Response(200, json={"access_token": "at-2"})

    def gmail(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(("gmail", str(request.url), dict(request.headers)))
        path = request.url.path
        if path.endswith("/messages"):
            return httpx.Response(200, json={"messages": [{"id": "m1abc"}, {"id": "../bad"}]})
        return httpx.Response(200, json={"id": "m1abc", "raw": _b64(MAIL.encode("utf-8"))})


@pytest.fixture()
def google(db_session, make_user, monkeypatch):
    monkeypatch.setattr(settings, "SECRET_BACKEND", "db_encrypted")
    g = Google()
    ext_http.set_transport("google_oauth", httpx.MockTransport(g.oauth))
    ext_http.set_transport("gmail_api", httpx.MockTransport(g.gmail))
    yield g
    ext_http.set_transport("google_oauth", None)
    ext_http.set_transport("gmail_api", None)


def _creds(db_session, user):
    ps.register(db_session, "google_oauth_client_id", "123456-abcdef.apps.googleusercontent.com", "登録", user.id)
    ps.register(db_session, "google_oauth_client_secret", "GOCSPX-test-secret-value-0001", "登録", user.id)


def test_unavailable_without_client_credentials(auth_client, google):
    client, _ = auth_client
    assert client.get("/api/v1/integrations/gmail").json()["available"] is False
    r = client.post("/api/v1/integrations/gmail/connect", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "gmail_unavailable"


def test_connect_sync_dedupe_and_disconnect(auth_client, db_session, google):
    client, user = auth_client
    _creds(db_session, user)
    p = client.post("/api/v1/travel-plans/", json={"title": "京都"}).json()["id"]
    url = client.post("/api/v1/integrations/gmail/connect", json={"plan_id": p}).json()["authorize_url"]
    q = parse_qs(urlsplit(url).query)
    assert q["scope"][0] == gc.SCOPE and q["access_type"] == ["offline"]
    assert q["redirect_uri"][0].endswith("/api/v1/integrations/gmail/callback")
    state = q["state"][0]

    bad = client.get("/api/v1/integrations/gmail/callback", params={"code": "c", "state": state + "x"},
                     follow_redirects=False)
    assert bad.status_code == 303 and "gmail=invalid_state" in bad.headers["location"]
    ok = client.get("/api/v1/integrations/gmail/callback", params={"code": "auth-code", "state": state},
                    follow_redirects=False)
    assert ok.status_code == 303 and f"/planner/{p}/imports?gmail=connected" in ok.headers["location"]
    row = db_session.query(GmailConnection).filter(GmailConnection.user_id == user.id).one()
    assert b"rt-secret-value-1" not in bytes(row.refresh_token_ciphertext) and row.google_email == "me@gmail.example"

    r = client.post("/api/v1/integrations/gmail/sync", json={"plan_id": p})
    assert r.status_code == 200, r.text
    assert r.json()["messages"] == 1 and r.json()["jobs"] == 1
    assert db_session.query(ImportJob).filter(ImportJob.plan_id == uuid.UUID(p)).count() == 1
    gmail_calls = [c for c in google.calls if c[0] == "gmail"]
    assert all(c[2]["authorization"] == "Bearer at-2" for c in gmail_calls)
    assert "newer_than:30d" in gmail_calls[0][1].replace("%3A", ":")
    assert not any("bad" in c[1] for c in gmail_calls)  # 形の違う ID は読まない
    again = client.post("/api/v1/integrations/gmail/sync", json={"plan_id": p}).json()
    assert again["messages"] == 0 and again["imported_count"] == 1  # 同じメールは取り込まない

    d = client.delete("/api/v1/integrations/gmail").json()
    assert d["connected"] is False
    assert any(c[1].endswith("/revoke") for c in google.calls)
    assert db_session.query(GmailConnection).count() == 0


def test_scope_without_gmail_is_refused(auth_client, db_session, google):
    client, user = auth_client
    _creds(db_session, user)
    google.scope = "openid email"
    url = client.post("/api/v1/integrations/gmail/connect", json={}).json()["authorize_url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    r = client.get("/api/v1/integrations/gmail/callback", params={"code": "c", "state": state},
                   follow_redirects=False)
    assert "gmail=gmail_scope_missing" in r.headers["location"]
    assert db_session.query(GmailConnection).count() == 0


def test_state_is_bound_and_expires():
    s = gc.make_state(uuid.uuid4(), None, now=1000.0)
    assert gc.read_state(s, now=1000.0 + gc.STATE_TTL - 1)["p"] is None
    with pytest.raises(gc.GmailError):
        gc.read_state(s, now=1000.0 + gc.STATE_TTL + 1)
