"""[Gate② FC-045] 文書の差し替え: 新しい版として保存し、前の版を残す(読み取りの由来は前の版を指したまま)。

DOC-02 FC-045「文書差替: 版と抽出値の由来」。
"""
import io
import uuid

import pytest

from app.core import crypto as crypto_module
from app.core.config import settings
from app.models.models import Document, DocumentLink

PDF1 = b"%PDF-1.4\n%version one\n"
PDF2 = b"%PDF-1.4\n%version two\n"


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "docs"))
    crypto_module.reset_cache_for_tests()
    import app.api.v1.documents as docs
    monkeypatch.setattr(docs, "record_audit_event", lambda **kw: None)
    yield
    crypto_module.reset_cache_for_tests()


def _plan(client):
    return client.post("/api/v1/travel-plans/", json={"title": "版の旅"}).json()["id"]


def _upload(client, p, content=PDF1, name="ticket.pdf"):
    res = client.post(f"/api/v1/plans/{p}/documents/upload",
                      files={"file": (name, io.BytesIO(content), "application/pdf")},
                      data={"classification": "confidential", "document_type": "ticket"})
    assert res.status_code == 201, res.text
    return res.json()


def test_replace_creates_a_new_version_and_keeps_the_old_one(auth_client, db_session):
    client, _ = auth_client
    p = _plan(client)
    v1 = _upload(client, p)
    ev_day = client.post(f"/api/v1/plans/{p}/days",
                         json={"local_date": "2026-12-05", "timezone_id": "Asia/Tokyo"}).json()
    ev = client.post(f"/api/v1/plans/{p}/events", json={"day_id": ev_day["id"], "title": "電車"},
                     headers={"Idempotency-Key": uuid.uuid4().hex}).json()
    db_session.add(DocumentLink(document_id=uuid.UUID(v1["id"]), entity_type="event", entity_id=uuid.UUID(ev["id"]),
                                relation_type="attachment"))
    db_session.flush()

    res = client.post(f"/api/v1/plans/{p}/documents/{v1['id']}/replace",
                      files={"file": ("ticket-new.pdf", io.BytesIO(PDF2), "application/pdf")})
    assert res.status_code == 201, res.text
    v2 = res.json()
    assert v2["version"] == 2 and v2["replaces_document_id"] == v1["id"] and v2["classification"] == "confidential"
    # 一覧は最新の版だけ。前の版は版の履歴で見る
    listed = [d["id"] for d in client.get(f"/api/v1/plans/{p}/documents").json()]
    assert listed == [v2["id"]]
    versions = client.get(f"/api/v1/plans/{p}/documents/{v2['id']}/versions").json()
    assert [v["version"] for v in versions] == [2, 1] and versions[1]["superseded_at"] is not None
    # 前の版は消えていない(中身も別)。紐付けは新しい版へ移る
    old = db_session.get(Document, uuid.UUID(v1["id"]))
    assert old.deleted_at is None and old.sha256 != v2["sha256"]
    db_session.expire_all()
    assert db_session.query(DocumentLink).filter(DocumentLink.document_id == uuid.UUID(v2["id"])).count() == 1


def test_replacing_an_old_version_is_refused_and_viewers_cannot_replace(auth_client, make_user, db_session):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app
    from app.models.models import PlanCollaborator

    client, owner = auth_client
    p = _plan(client)
    v1 = _upload(client, p)
    v2 = client.post(f"/api/v1/plans/{p}/documents/{v1['id']}/replace",
                     files={"file": ("b.pdf", io.BytesIO(PDF2), "application/pdf")}).json()
    again = client.post(f"/api/v1/plans/{p}/documents/{v1['id']}/replace",
                        files={"file": ("c.pdf", io.BytesIO(PDF1), "application/pdf")})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_replaced"
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    app.dependency_overrides[get_current_user] = (
        lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False))
    try:
        r = client.post(f"/api/v1/plans/{p}/documents/{v2['id']}/replace",
                        files={"file": ("d.pdf", io.BytesIO(PDF1), "application/pdf")})
        assert r.status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = (
            lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False))
