"""[Gate S4] 文書の配信条件(F08)・アップロードの上限とウイルス検査(F09)・トークンの種類と
ゲストの確認・cookie 操作の CSRF 対策・ログアウト・防御の計数(F18)の試験。"""
import io
import socket
import threading
import uuid
from datetime import timedelta

import jwt
import pytest

from app.core import crypto as crypto_module
from app.core.auth import auth_manager
from app.core.config import Settings, production_problems, settings
from app.models.models import Document, User, UserSession
from app.ops import metrics as ops_metrics
from app.services import malware_scan
from app.services import storage_backend as storage_module

PASSWORD = "Gate-S4-Secure-Pass1"
_PDF = b"%PDF-1.4\n%gate s4 test document\n"
# EICAR 試験文字列(本物のウイルスではない。全てのウイルス対策が検出する決まった文字列)
EICAR = malware_scan.EICAR_SIGNATURE


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_DOWNLOAD_SIGNING_KEY", "test-only-download-signing-key")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(settings, "MALWARE_SCAN_BACKEND", "none")
    monkeypatch.setattr(settings, "DOCUMENT_REQUIRE_CLEAN_SCAN", False)
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _register(client, email=None):
    suffix = uuid.uuid4().hex[:10]
    email = email or f"s4_{suffix}@example.com"
    res = client.post("/api/v1/auth/register", json={
        "username": f"s4_{suffix}", "email": email, "password": PASSWORD,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    return body["access_token"], email, body["user"]["id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _plan(client, token):
    res = client.post("/api/v1/travel-plans/", json={"title": "S4 文書"}, headers=_h(token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _upload(client, token, plan_id, content=_PDF, filename="ticket.pdf", classification=None):
    data = {"classification": classification} if classification else {}
    return client.post(f"/api/v1/plans/{plan_id}/documents/upload", headers=_h(token), data=data,
                       files={"file": (filename, io.BytesIO(content), "application/pdf")})


def _download_url(client, token, plan_id, document_id):
    res = client.get(f"/api/v1/plans/{plan_id}/documents/{document_id}/download-url", headers=_h(token))
    assert res.status_code == 200, res.text
    return res.json()["url"]


# ===== トークンの種類・ゲスト =====

def test_refresh_type_jwt_is_not_accepted_as_access_token(client, db_session):
    token, _email, user_id = _register(client)
    session = db_session.query(UserSession).filter(UserSession.user_id == uuid.UUID(user_id)).first()
    refresh_jwt = auth_manager.create_refresh_token(user_id, str(session.id))
    assert client.get("/api/v1/auth/me", headers=_h(refresh_jwt)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=_h(token)).status_code == 200


def test_member_token_without_session_is_rejected(client):
    _token, _email, user_id = _register(client)
    sessionless = auth_manager.create_access_token({"sub": user_id})
    assert client.get("/api/v1/auth/me", headers=_h(sessionless)).status_code == 401


def test_member_token_bound_to_other_users_session_is_rejected(client, db_session):
    _t1, _e1, user1 = _register(client)
    _t2, _e2, user2 = _register(client)
    other_session = db_session.query(UserSession).filter(UserSession.user_id == uuid.UUID(user2)).first()
    forged = auth_manager.create_access_token({"sub": user1, "session_id": str(other_session.id)})
    assert client.get("/api/v1/auth/me", headers=_h(forged)).status_code == 401


def test_token_without_expiry_is_rejected(client, db_session):
    _token, _email, user_id = _register(client)
    session = db_session.query(UserSession).filter(UserSession.user_id == uuid.UUID(user_id)).first()
    no_exp = jwt.encode({"sub": user_id, "session_id": str(session.id), "type": "access"},
                        settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    assert client.get("/api/v1/auth/me", headers=_h(no_exp)).status_code == 401


def test_guest_token_without_user_row_is_rejected(client):
    ghost = auth_manager.create_guest_token(str(uuid.uuid4()))
    assert client.get("/api/v1/travel-plans/", headers=_h(ghost)).status_code == 401


def test_old_guest_token_stops_working_after_upgrade(client):
    res = client.post("/api/v1/auth/guest")
    guest_token = res.json()["access_token"]
    assert client.get("/api/v1/travel-plans/", headers=_h(guest_token)).status_code == 200
    suffix = uuid.uuid4().hex[:10]
    up = client.post("/api/v1/auth/guest/upgrade", headers=_h(guest_token), json={
        "username": f"s4g_{suffix}", "email": f"s4g_{suffix}@example.com", "password": PASSWORD,
    })
    assert up.status_code == 200, up.text
    assert client.get("/api/v1/travel-plans/", headers=_h(guest_token)).status_code == 401
    assert client.get("/api/v1/travel-plans/", headers=_h(up.json()["access_token"])).status_code == 200


# ===== cookie の操作(CSRF)・ログアウト・Secure =====

def test_refresh_from_foreign_origin_is_blocked(client):
    _register(client)
    res = client.post("/api/v1/auth/refresh", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    res = client.post("/api/v1/auth/refresh", headers={"Sec-Fetch-Site": "cross-site"})
    assert res.status_code == 403
    allowed = settings.CORS_ORIGINS[0] if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS
    res = client.post("/api/v1/auth/refresh", headers={"Origin": allowed})
    assert res.status_code == 200, res.text


def test_logout_with_expired_access_token_still_revokes_cookie_session(client, db_session):
    _token, _email, user_id = _register(client)
    session = db_session.query(UserSession).filter(UserSession.user_id == uuid.UUID(user_id)).first()
    expired = auth_manager.create_access_token({"sub": user_id, "session_id": str(session.id)},
                                               expires_delta=timedelta(seconds=-10))
    res = client.post("/api/v1/auth/logout", headers=_h(expired))
    assert res.status_code == 200, res.text
    db_session.refresh(session)
    assert session.is_active is False
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_logout_with_forged_cookie_does_not_revoke(client, db_session):
    _token, _email, user_id = _register(client)
    session = db_session.query(UserSession).filter(UserSession.user_id == uuid.UUID(user_id)).first()
    client.cookies.set("refresh_token", f"{session.id}.not-the-secret", path="/api/v1/auth")
    assert client.post("/api/v1/auth/logout").status_code == 200
    db_session.refresh(session)
    assert session.is_active is True


def test_refresh_cookie_is_secure_in_every_strict_environment(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "staging")
    suffix = uuid.uuid4().hex[:10]
    res = client.post("/api/v1/auth/register", json={
        "username": f"s4s_{suffix}", "email": f"s4s_{suffix}@example.com", "password": PASSWORD,
    })
    assert res.status_code == 200
    cookie = res.headers.get("set-cookie", "")
    assert "refresh_token=" in cookie and "Secure" in cookie and "HttpOnly" in cookie


# ===== F08 文書の配信条件 =====

def test_download_url_carries_user_and_revision_and_short_ttl(client):
    token, _email, user_id = _register(client)
    plan_id = _plan(client, token)
    doc = _upload(client, token, plan_id).json()
    url = _download_url(client, token, plan_id, doc["id"])
    grant = storage_module.read_download_grant(url.split("token=")[1])
    assert grant.user_id == user_id and grant.revision == doc["revision"] and grant.session_id
    assert Settings.model_fields["DOCUMENT_DOWNLOAD_URL_TTL_SECONDS"].default <= 300
    res = client.get(url)
    assert res.status_code == 200 and res.content == _PDF
    assert "no-store" in res.headers["cache-control"]
    assert "sandbox" in res.headers["content-security-policy"]
    assert res.headers["x-content-type-options"] == "nosniff"


def test_download_url_stops_working_when_collaborator_is_removed(client):
    owner_token, _owner_email, _ = _register(client)
    viewer_token, viewer_email, _ = _register(client)
    plan_id = _plan(client, owner_token)
    doc = _upload(client, owner_token, plan_id).json()
    collab = client.post(f"/api/v1/travel-plans/{plan_id}/collaborators", headers=_h(owner_token),
                         json={"email": viewer_email, "role": "viewer"}).json()
    assert client.post(f"/api/v1/travel-plans/invitations/{collab['id']}/accept",
                       headers=_h(viewer_token)).status_code == 200
    url = _download_url(client, viewer_token, plan_id, doc["id"])
    removed = client.delete(f"/api/v1/travel-plans/{plan_id}/collaborators/{collab['id']}", headers=_h(owner_token))
    assert removed.status_code == 200, removed.text
    assert client.get(url).status_code == 403


def test_download_url_stops_working_when_document_changes(client):
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    doc = _upload(client, token, plan_id).json()
    url = _download_url(client, token, plan_id, doc["id"])
    res = client.patch(f"/api/v1/plans/{plan_id}/documents/{doc['id']}", headers={**_h(token), "If-Match": "1"},
                       json={"classification": "restricted"})
    assert res.status_code == 200, res.text
    assert client.get(url).status_code == 403
    assert client.get(_download_url(client, token, plan_id, doc["id"])).status_code == 200


def test_download_url_stops_working_after_logout(client):
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    doc = _upload(client, token, plan_id).json()
    url = _download_url(client, token, plan_id, doc["id"])
    assert client.post("/api/v1/auth/logout", headers=_h(token)).status_code == 200
    assert client.get(url).status_code == 403


def test_unbound_or_garbage_download_tokens_are_rejected(client):
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    doc = _upload(client, token, plan_id).json()
    unbound, _ = storage_module.issue_download_token(doc["id"])
    assert client.get(f"/api/v1/plans/documents/download?token={unbound}").status_code == 403
    for bad in ("x", "v2.a.b.c.d.e.f", "." * 600):
        assert client.get(f"/api/v1/plans/documents/download?token={bad}").status_code == 403


def test_guest_download_url_works_and_is_bound(client):
    guest = client.post("/api/v1/auth/guest").json()["access_token"]
    plan_id = _plan(client, guest)
    doc = _upload(client, guest, plan_id).json()
    url = _download_url(client, guest, plan_id, doc["id"])
    assert client.get(url).status_code == 200


# ===== F09 ウイルス検査・上限 =====

def test_eicar_document_is_rejected_and_not_stored(client, db_session):
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    before = ops_metrics.registry.security_event_count("malware_rejected")
    res = _upload(client, token, plan_id, content=b"%PDF-1.4\n" + EICAR + b"\n")
    assert res.status_code == 422
    assert db_session.query(Document).filter(Document.plan_id == uuid.UUID(plan_id)).count() == 0
    assert ops_metrics.registry.security_event_count("malware_rejected") == before + 1


def test_eicar_memory_photo_is_rejected(client):
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    res = client.post(f"/api/v1/plans/{plan_id}/memories/upload", headers=_h(token),
                      data={"kind": "photo"},
                      files={"file": ("p.jpg", io.BytesIO(b"\xff\xd8\xff\xe0" + EICAR), "image/jpeg")})
    assert res.status_code == 422, res.text
    assert "有害" in res.text


def test_require_clean_scan_without_scanner_refuses_upload_and_download(client, monkeypatch):
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    doc = _upload(client, token, plan_id).json()
    assert doc["malware_status"] == "not_scanned"
    monkeypatch.setattr(settings, "DOCUMENT_REQUIRE_CLEAN_SCAN", True)
    assert _upload(client, token, plan_id).status_code == 503
    res = client.get(f"/api/v1/plans/{plan_id}/documents/{doc['id']}/download-url", headers=_h(token))
    assert res.status_code == 409


class _FakeClamd:
    def __init__(self, reply: bytes):
        self.reply = reply
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(4)
        self.port = self.sock.getsockname()[1]
        self.received = b""
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        try:
            conn, _ = self.sock.accept()
        except OSError:
            return
        with conn:
            data = b""
            while not data.endswith(b"\0\0\0\0"):
                chunk = conn.recv(65536)
                if not chunk:
                    break
                data += chunk
            self.received = data
            conn.sendall(self.reply)

    def close(self):
        self.sock.close()


@pytest.mark.parametrize("reply,expected", [
    (b"stream: OK\0", "clean"), (b"stream: Win.Test.EICAR_HDB-1 FOUND\0", "infected"),
])
def test_clamav_instream_protocol(monkeypatch, reply, expected):
    server = _FakeClamd(reply)
    try:
        monkeypatch.setattr(settings, "MALWARE_SCAN_BACKEND", "clamav")
        monkeypatch.setattr(settings, "CLAMAV_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "CLAMAV_PORT", server.port)
        result = malware_scan.scan_bytes(b"hello world")
        assert result.status == expected and result.engine == "clamav"
        assert server.received.startswith(b"zINSTREAM\0")
    finally:
        server.close()


def test_clamav_clean_result_is_stored(client, monkeypatch):
    server = _FakeClamd(b"stream: OK\0")
    try:
        monkeypatch.setattr(settings, "MALWARE_SCAN_BACKEND", "clamav")
        monkeypatch.setattr(settings, "CLAMAV_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "CLAMAV_PORT", server.port)
        monkeypatch.setattr(settings, "DOCUMENT_REQUIRE_CLEAN_SCAN", True)
        token, _email, _ = _register(client)
        plan_id = _plan(client, token)
        res = _upload(client, token, plan_id)
        assert res.status_code == 201, res.text
        assert res.json()["malware_status"] == "clean"
        url = _download_url(client, token, plan_id, res.json()["id"])
        assert client.get(url).status_code == 200
    finally:
        server.close()


def test_unreachable_scanner(monkeypatch):
    closed = socket.socket()
    closed.bind(("127.0.0.1", 0))
    port = closed.getsockname()[1]
    closed.close()
    monkeypatch.setattr(settings, "MALWARE_SCAN_BACKEND", "clamav")
    monkeypatch.setattr(settings, "CLAMAV_HOST", "127.0.0.1")
    monkeypatch.setattr(settings, "CLAMAV_PORT", port)
    monkeypatch.setattr(settings, "MALWARE_SCAN_TIMEOUT_SECONDS", 2.0)
    assert malware_scan.scan_upload(b"data").status == "not_scanned"
    monkeypatch.setattr(settings, "DOCUMENT_REQUIRE_CLEAN_SCAN", True)
    with pytest.raises(malware_scan.MalwareScanUnavailable):
        malware_scan.scan_upload(b"data")


def test_read_upload_limited_stops_early():
    class _Upload:
        def __init__(self):
            self.reads = 0

        async def read(self, n):
            self.reads += 1
            return b"x" * n

    import asyncio

    upload = _Upload()
    with pytest.raises(storage_module.FileTooLargeError):
        asyncio.run(storage_module.read_upload_limited(upload, 3 * 1024 * 1024))
    assert upload.reads == 4


def test_oversized_json_body_is_rejected_before_reading(client, monkeypatch):
    monkeypatch.setattr(settings, "API_MAX_BODY_BYTES", 2048)
    token, _email, _ = _register(client)
    allowed = settings.CORS_ORIGINS[0] if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS
    before = ops_metrics.registry.security_event_count("body_too_large")
    res = client.post("/api/v1/travel-plans/", headers={**_h(token), "Origin": allowed},
                      json={"title": "x", "description": "y" * 5000})
    assert res.status_code == 413
    assert res.headers.get("access-control-allow-origin") == allowed
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert ops_metrics.registry.security_event_count("body_too_large") == before + 1


def test_chunked_body_over_limit_is_cut_off(client, monkeypatch):
    monkeypatch.setattr(settings, "API_MAX_BODY_BYTES", 2048)
    token, _email, _ = _register(client)

    def _chunks():
        for _ in range(10):
            yield b"y" * 1024

    res = client.post("/api/v1/travel-plans/", headers={**_h(token), "Content-Type": "application/json"},
                      content=_chunks())
    assert res.status_code == 413


def test_upload_paths_get_the_document_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "API_MAX_BODY_BYTES", 2048)
    token, _email, _ = _register(client)
    plan_id = _plan(client, token)
    res = _upload(client, token, plan_id, content=b"%PDF-1.4\n" + b"z" * 8000)
    assert res.status_code == 201, res.text


# ===== F18 計数・設定 =====

def test_security_events_are_exposed_in_metrics(client, monkeypatch):
    monkeypatch.setattr(settings, "METRICS_TOKEN", None)
    ops_metrics.registry.count_security_event("download_denied")
    res = client.get("/metrics")
    assert res.status_code == 200
    assert 'travelcanvas_security_events_total{kind="download_denied"}' in res.text


def test_audit_write_failure_is_counted(monkeypatch):
    from app.services import audit_service

    class _Broken:
        def add(self, _):
            raise RuntimeError("db down")

        def rollback(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(audit_service, "SessionLocal", lambda: _Broken())
    before = ops_metrics.registry.security_event_count("audit_write_failed")
    audit_service.record_audit_event(action="x", resource_type="y")
    assert ops_metrics.registry.security_event_count("audit_write_failed") == before + 1


def test_scan_settings_are_validated():
    with pytest.raises(ValueError):
        Settings(MALWARE_SCAN_BACKEND="clamv")
    s = Settings(MALWARE_SCAN_BACKEND="none", DOCUMENT_REQUIRE_CLEAN_SCAN=True)
    assert any("MALWARE_SCAN_BACKEND=none" in p for p in production_problems(s))


def test_inactive_holder_cannot_use_old_url(client, db_session):
    token, _email, user_id = _register(client)
    plan_id = _plan(client, token)
    doc = _upload(client, token, plan_id).json()
    url = _download_url(client, token, plan_id, doc["id"])
    user = db_session.query(User).filter(User.id == uuid.UUID(user_id)).first()
    user.is_active = False
    db_session.commit()
    assert client.get(url).status_code == 403
