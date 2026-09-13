"""
[Gate R3-6 / Gate M7改訂] FR-013文書ウォレット(documents/document_links)の
基本CRUDテスト。

[Gate M7 2026-09-13] 旧`POST /{plan_id}/documents`(クライアント指定
storage_key)はP0-01是正により410 Goneへ閉鎖したため、文書作成は
すべて`POST /{plan_id}/documents/upload`(multipart)経由へ更新した。
また`DocumentResponse`から`storage_key`を除外した(P0-02)ため、関連の
アサーションを削除した。

- アップロード時のfilename暗号化(平文でDBに保存されないこと)、一覧・詳細で復号表示
- malware_status/ocr_statusはクライアント入力を無視し常に既定値になること
- If-Match必須/409/成功、soft delete
- document_links: 作成・一覧・削除、他planのreservationへのリンクは404
- 他ユーザー403
- 旧metadata登録APIは410 Gone(P0-01)
"""
import io
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import Document


DOCS_ENDPOINT = "/api/v1/plans/{plan_id}/documents"
_PDF_BYTES = b"%PDF-1.4\n%mock pdf content for gate r3-6/m7 tests\n"


@pytest.fixture(autouse=True)
def _document_encryption_key(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
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


def _create_document(client, plan_id, *, original_filename="領収書_2026-12-20.pdf", classification="confidential",
                      document_type="receipt", content=_PDF_BYTES):
    """[Gate M7] 文書作成は実アップロード経由(multipart)へ統一する。"""
    files = {"file": (original_filename, io.BytesIO(content), "application/pdf")}
    data = {"classification": classification, "document_type": document_type}
    res = client.post(f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/upload", files=files, data=data)
    assert res.status_code == 201, res.text
    return res.json()


def test_old_metadata_create_endpoint_is_gone(auth_client):
    """[Gate M7 P0-01] 旧クライアント指定storage_key方式の登録APIは410。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(
        DOCS_ENDPOINT.format(plan_id=plan_id),
        json={
            "classification": "confidential",
            "original_filename": "偽装.pdf",
            "storage_key": "other-plan/attacker-controlled-key.pdf",
        },
    )
    assert res.status_code == 410


def test_create_document_encrypts_filename(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)

    body = _create_document(client, plan_id)
    assert body["original_filename"] == "領収書_2026-12-20.pdf"
    assert body["classification"] == "confidential"
    assert body["malware_status"] == "not_scanned"
    assert body["ocr_status"] == "not_requested"
    assert "storage_key" not in body  # [Gate M7 P0-02] 内部参照は公開しない

    row = db_session.query(Document).filter(Document.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.original_filename_ciphertext is not None
    assert b"2026-12-20" not in row.original_filename_ciphertext  # 平文が残っていないこと
    assert row.storage_key  # サーバー側で生成される


def test_client_cannot_override_malware_or_ocr_status(auth_client):
    """[スコープ限定] malware_status/ocr_statusはクライアント入力を受け付けず、
    常にnot_scanned/not_requestedで作成される(スキャナ・OCR未導入のため)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    body = _create_document(client, plan_id)
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
    assert all("storage_key" not in d for d in list_res.json())

    doc_id = list_res.json()[0]["id"]
    get_res = client.get(f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}")
    assert get_res.status_code == 200
    assert "storage_key" not in get_res.json()


def test_update_document_with_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _create_document(client, plan_id)
    doc_id = body["id"]
    revision = body["revision"]

    no_match_res = client.patch(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}", json={"classification": "confidential"}
    )
    assert no_match_res.status_code == 400

    stale_res = client.patch(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}",
        json={"classification": "confidential"},
        headers={"If-Match": "999"},
    )
    assert stale_res.status_code == 409

    ok_res = client.patch(
        f"{DOCS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}",
        json={"document_type": "insurance", "original_filename": "更新後.pdf"},
        headers={"If-Match": str(revision)},
    )
    assert ok_res.status_code == 200, ok_res.text
    assert ok_res.json()["document_type"] == "insurance"
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
