"""
[Gate M5] FR-013文書ウォレットのObject Storage実連携(実アップロード・
署名付きダウンロードURL)のテスト。
"""
import io
import time

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.services import storage_backend as storage_module


PLAN_ENDPOINT = "/api/v1/travel-plans/"
DOCUMENTS_ENDPOINT = "/api/v1/plans/{plan_id}/documents"


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_DOWNLOAD_SIGNING_KEY", "test-only-download-signing-key")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(settings, "DOCUMENT_MAX_UPLOAD_SIZE_BYTES", 1024)
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="Gate M5テスト旅行"):
    res = client.post(PLAN_ENDPOINT, json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


_PDF_BYTES = b"%PDF-1.4\n%mock pdf content for gate m5 tests\n"


def _upload(client, plan_id, filename="receipt.pdf", content=_PDF_BYTES, classification=None):
    files = {"file": (filename, io.BytesIO(content), "application/pdf")}
    data = {}
    if classification:
        data["classification"] = classification
    return client.post(
        f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/upload", files=files, data=data
    )


# ===== アップロード =====

def test_upload_computes_real_metadata(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = _upload(client, plan_id)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["size"] == len(_PDF_BYTES)
    assert body["sha256"] == storage_module.compute_sha256(_PDF_BYTES)
    assert body["mime_type"] == "application/pdf"
    assert body["original_filename"] == "receipt.pdf"
    assert body["malware_status"] == "not_scanned"
    assert body["storage_key"]  # サーバー側で生成される


def test_upload_rejects_oversized_file(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    big_content = b"%PDF-1.4\n" + b"x" * 2000  # settings上限(1024)超え
    res = _upload(client, plan_id, content=big_content)
    assert res.status_code == 413


def test_upload_rejects_disallowed_extension(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = _upload(client, plan_id, filename="malware.exe", content=b"MZ\x90\x00")
    assert res.status_code == 422


def test_upload_rejects_content_extension_mismatch(auth_client):
    """[Gate M5] 拡張子はpdfだが中身がPDFのマジックナンバーではない
    (単純な偽装)場合に拒否されること。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = _upload(client, plan_id, filename="fake.pdf", content=b"not a real pdf file at all")
    assert res.status_code == 422


def test_upload_requires_editor_role(auth_client, make_user, db_session):
    import uuid
    from app.models.models import PlanCollaborator
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    client, _owner = auth_client
    plan_id = _create_plan(client)

    viewer, _ = make_user()
    db_session.add(PlanCollaborator(
        plan_id=uuid.UUID(plan_id), user_id=viewer.id, email=viewer.email,
        role="viewer", status="accepted",
    ))
    db_session.commit()

    def _as_viewer():
        return AuthResult(user=viewer, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_viewer
    res = _upload(client, plan_id)
    assert res.status_code == 403
    app.dependency_overrides.pop(get_current_user, None)


# ===== 暗号化保存 =====

def test_uploaded_file_is_encrypted_at_rest(auth_client):
    """[Gate M5] ディスク上のファイルが平文のまま保存されていないこと
    (Fernet暗号化されていること)を確認する。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = _upload(client, plan_id)
    storage_key = res.json()["storage_key"]

    backend = storage_module.get_storage_backend()
    raw_on_disk = backend.load(storage_key)
    assert raw_on_disk != _PDF_BYTES  # 平文のままではない
    assert not raw_on_disk.startswith(b"%PDF-")

    decrypted = storage_module.load_decrypted_file(backend, storage_key)
    assert decrypted == _PDF_BYTES


# ===== 期限付きダウンロードURL =====

def test_download_url_roundtrip(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    upload_res = _upload(client, plan_id)
    document_id = upload_res.json()["id"]

    url_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{document_id}/download-url")
    assert url_res.status_code == 200, url_res.text
    body = url_res.json()
    assert "expires_at" in body

    download_path = body["url"]
    download_res = client.get(download_path)
    assert download_res.status_code == 200
    assert download_res.content == _PDF_BYTES
    assert download_res.headers["content-type"] == "application/pdf"
    assert "receipt.pdf" in download_res.headers["content-disposition"]


def test_download_with_tampered_token_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    upload_res = _upload(client, plan_id)
    document_id = upload_res.json()["id"]

    url_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{document_id}/download-url")
    token = url_res.json()["url"].split("token=")[1]
    tampered = token[:-4] + "0000"

    res = client.get(f"/api/v1/plans/documents/download?token={tampered}")
    assert res.status_code == 403


def test_download_with_expired_token_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    upload_res = _upload(client, plan_id)
    document_id = upload_res.json()["id"]

    token, _expires_at = storage_module.issue_download_token(document_id, ttl_seconds=-1)
    res = client.get(f"/api/v1/plans/documents/download?token={token}")
    assert res.status_code == 403


def test_download_url_requires_viewer_access(client, make_user):
    import uuid
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用プラン")
    upload_res = _upload(client, plan_id)
    document_id = upload_res.json()["id"]

    other, _ = make_user()

    def _as_other():
        return AuthResult(user=other, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{document_id}/download-url")
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


def test_download_url_without_signing_key_returns_503(auth_client, monkeypatch):
    client, _user = auth_client
    plan_id = _create_plan(client)
    upload_res = _upload(client, plan_id)
    document_id = upload_res.json()["id"]

    monkeypatch.setattr(settings, "DOCUMENT_DOWNLOAD_SIGNING_KEY", None)

    res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{document_id}/download-url")
    assert res.status_code == 503
