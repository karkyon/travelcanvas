"""
[Gate R3-6] FR-013文書ウォレット(documents/document_links)のテスト。

- 作成時のfilename暗号化(平文でDBに保存されないこと)、一覧・詳細で復号表示
- malware_status/ocr_statusはクライアント入力を無視し常に既定値になること
- If-Match必須/409/成功、soft delete
- document_links: 作成・一覧・削除、他planのreservationへのリンクは404
- 他ユーザー403
"""
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import Document


DOCS_ENDPOINT = "/api/v1/plans/{plan_id}/documents"


@pytest.fixture(autouse=True)
def _document_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="文書ウォレットテスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "福岡",
            "start_date": "2026-12-20",
            "end_date": "2026-12-23",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_reservation(client, plan_id):
    res = client.post(
        f"/api/v1/plans/{plan_id}/reservations",
        json={"type": "accommodation", "provider_name": "テストホテル"},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_document(client, plan_id, **overrides):
    body = {
        "classification": "confidential",
        "document_type": "receipt",
        "original_filename": "領収書_2026-12-20.pdf",
        "storage_key": "uploads/2026/12/receipt-abc123.pdf",
        "mime_type": "application/pdf",
        "size": 102400,
    }
    body.update(overrides)
    res = client.post(DOCS_ENDPOINT.format(plan_id=plan_id), json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_create_document_encrypts_filename(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)

    body = _create_document(client, plan_id)
    assert body["original_filename"] == "領収書_2026-12-20.pdf"
    assert body["classification"] == "confidential"
    assert body["malware_status"] == "not_scanned"
    assert body["ocr_status"] == "not_requested"
    assert body["storage_key"] == "uploads/2026/12/receipt-abc123.pdf"

    row = db_session.query(Document).filter(Document.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.original_filename_ciphertext is not None
    assert b"2026-12-20" not in row.original_filename_ciphertext  # 平文が残っていないこと


def test_client_cannot_override_malware_or_ocr_status(auth_client):
    """[スコープ限定] malware_status/ocr_statusはクライアント入力を受け付けず、
    常にnot_scanned/not_requestedで作成される(スキャナ・OCR未導入のため)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    body = _create_document(client, plan_id, malware_status="clean", ocr_status="completed")
    assert body["malware_status"] == "not_scanned"
    assert body["ocr_status"] == "not_requested"


def test_list_and_get_document(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    _create_document(client, plan_id, original_filename="A.pdf")
    _create_document(client, plan_id, original_filename="B.pdf")

    list_res = client.get(DOCS_ENDPOINT.format(plan_id=plan_id))
    assert list_res.status_code == 200
    filenames = {d["original_filename"] for d in list_res.json()}
    assert filenames == {"A.pdf", "B.pdf"}

    doc_id = list_res.json()[0]["id"]
    get_res = client.get(f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}")
    assert get_res.status_code == 200


def test_update_document_with_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _create_document(client, plan_id)
    doc_id = body["id"]
    revision = body["revision"]

    no_match_res = client.patch(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}", json={"classification": "restricted"}
    )
    assert no_match_res.status_code == 400

    stale_res = client.patch(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}",
        json={"classification": "restricted"},
        headers={"If-Match": "999"},
    )
    assert stale_res.status_code == 409

    ok_res = client.patch(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}",
        json={"classification": "restricted", "original_filename": "更新後.pdf"},
        headers={"If-Match": str(revision)},
    )
    assert ok_res.status_code == 200, ok_res.text
    assert ok_res.json()["classification"] == "restricted"
    assert ok_res.json()["original_filename"] == "更新後.pdf"
    assert ok_res.json()["revision"] == revision + 1


def test_delete_document_is_soft_delete(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _create_document(client, plan_id)
    doc_id = body["id"]

    del_res = client.delete(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}", headers={"If-Match": str(body["revision"])}
    )
    assert del_res.status_code == 204

    list_res = client.get(DOCS_ENDPOINT.format(plan_id=plan_id))
    assert list_res.json() == []

    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    assert row is not None
    assert row.deleted_at is not None


def test_create_and_list_document_link_to_reservation(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    body = _create_document(client, plan_id)
    doc_id = body["id"]

    links_endpoint = f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}/links"
    link_res = client.post(links_endpoint, json={
        "entity_type": "reservation", "entity_id": reservation_id, "relation_type": "receipt",
    })
    assert link_res.status_code == 201, link_res.text
    assert link_res.json()["entity_id"] == reservation_id
    assert link_res.json()["relation_type"] == "receipt"

    list_res = client.get(links_endpoint)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1


def test_link_to_reservation_in_other_plan_returns_404(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _create_document(client, plan_id)
    doc_id = body["id"]

    other_plan_id = _create_plan(client, title="別の旅行")
    other_reservation_id = _create_reservation(client, other_plan_id)

    links_endpoint = f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}/links"
    res = client.post(links_endpoint, json={"entity_type": "reservation", "entity_id": other_reservation_id})
    assert res.status_code == 404


def test_delete_document_link(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    body = _create_document(client, plan_id)
    doc_id = body["id"]

    links_endpoint = f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}/links"
    link_res = client.post(links_endpoint, json={"entity_type": "reservation", "entity_id": reservation_id})
    link_id = link_res.json()["id"]

    del_res = client.delete(f"{links_endpoint}/{link_id}")
    assert del_res.status_code == 204

    assert client.get(links_endpoint).json() == []


def test_other_user_without_access_gets_403(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用旅行")
    _create_document(client, plan_id)

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(DOCS_ENDPOINT.format(plan_id=plan_id))
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner
