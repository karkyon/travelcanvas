"""
[Gate M7] FR-013文書ウォレット安全化(2026-09-13監査 P0-01〜P0-04, P1-01/02)の
回帰テスト。

- P0-01: 旧metadata登録APIの410 Gone化はtest_gate_r3_6_documents.py側で検証済み
- P0-02: storage_key非露出はtest_gate_r3_6_documents.py/test_gate_m5_object_storage.py側で検証済み
- P0-03: RESTRICTED文書のowner限定アクセス(本ファイル)
- P0-04: soft delete後のstorage file purgeと再試行(本ファイル)
- P1-01: Content-Dispositionのfilenameサニタイズ(本ファイル)
- P1-02: ダウンロード監査ログに機微値が含まれないこと(本ファイル)
- 共有経路がRESTRICTED文書を一切出力しないことの契約テスト(本ファイル)
"""
import io
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import AuditLog, Document, DocumentPurgeStatus
from app.services import storage_backend as storage_module
from app.services.document_purge_service import (
    purge_deleted_documents,
    soft_delete_expired_retention_documents,
)


DOCUMENTS_ENDPOINT = "/api/v1/plans/{plan_id}/documents"
_PDF_BYTES = b"%PDF-1.4\n%mock pdf content for gate m7 tests\n"


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "DOCUMENT_DOWNLOAD_SIGNING_KEY", "test-only-download-signing-key")
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="Gate M7テスト旅行"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _upload(client, plan_id, filename="receipt.pdf", content=_PDF_BYTES, classification="internal"):
    files = {"file": (filename, io.BytesIO(content), "application/pdf")}
    data = {"classification": classification}
    res = client.post(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/upload", files=files, data=data)
    assert res.status_code == 201, res.text
    return res.json()


# ===== P0-03: RESTRICTED文書のowner限定アクセス =====

def test_restricted_document_hidden_from_non_owner_editor(auth_client, make_user, db_session):
    """[Gate M7 P0-03] plan editor(collaborator)であってもdocument owner
    本人でなければRESTRICTED文書は一覧・詳細・ダウンロードURLいずれにも
    現れない(存在しないIDと同じ404)。"""
    import uuid as uuid_module
    from app.core.auth import get_current_user, AuthResult
    from app.main import app
    from app.models.models import PlanCollaborator

    client, owner = auth_client
    plan_id = _create_plan(client)
    restricted = _upload(client, plan_id, filename="passport.pdf", classification="restricted")
    normal = _upload(client, plan_id, filename="map.pdf", classification="internal")

    editor, _ = make_user()
    db_session.add(PlanCollaborator(
        plan_id=uuid_module.UUID(plan_id), user_id=editor.id, email=editor.email,
        role="editor", status="accepted",
    ))
    db_session.commit()

    def _as_editor():
        return AuthResult(user=editor, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_editor
    try:
        list_res = client.get(DOCUMENTS_ENDPOINT.format(plan_id=plan_id))
        assert list_res.status_code == 200
        listed_ids = {d["id"] for d in list_res.json()}
        assert restricted["id"] not in listed_ids
        assert normal["id"] in listed_ids

        get_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{restricted['id']}")
        assert get_res.status_code == 404

        url_res = client.get(
            f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{restricted['id']}/download-url"
        )
        assert url_res.status_code == 404

        # 通常文書には引き続きeditorとしてアクセスできる(RESTRICTED以外は無影響)
        normal_get_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{normal['id']}")
        assert normal_get_res.status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_restricted_document_visible_to_owner(auth_client):
    """[Gate M7 P0-03] document owner本人はRESTRICTED文書へ通常通り
    アクセスできる(過剰な制限にしない)。"""
    client, _owner = auth_client
    plan_id = _create_plan(client)
    restricted = _upload(client, plan_id, filename="passport.pdf", classification="restricted")

    list_res = client.get(DOCUMENTS_ENDPOINT.format(plan_id=plan_id))
    assert restricted["id"] in {d["id"] for d in list_res.json()}

    get_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{restricted['id']}")
    assert get_res.status_code == 200

    url_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{restricted['id']}/download-url")
    assert url_res.status_code == 200


def test_restricted_document_link_operations_hidden_from_non_owner(auth_client, make_user, db_session):
    """[Gate M7 P0-03] document_links(作成・一覧)も同じ可視性ルールに従う。"""
    import uuid as uuid_module
    from app.core.auth import get_current_user, AuthResult
    from app.main import app
    from app.models.models import PlanCollaborator

    client, _owner = auth_client
    plan_id = _create_plan(client)
    restricted = _upload(client, plan_id, filename="visa.pdf", classification="restricted")

    editor, _ = make_user()
    db_session.add(PlanCollaborator(
        plan_id=uuid_module.UUID(plan_id), user_id=editor.id, email=editor.email,
        role="editor", status="accepted",
    ))
    db_session.commit()

    def _as_editor():
        return AuthResult(user=editor, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_editor
    try:
        links_endpoint = f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{restricted['id']}/links"
        list_res = client.get(links_endpoint)
        assert list_res.status_code == 404

        create_res = client.post(links_endpoint, json={"entity_type": "attachment", "entity_id": str(uuid.uuid4())})
        assert create_res.status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_share_public_view_never_exposes_document_fields(auth_client, db_session):
    """[Gate M7 是正10] 共有リンク(public_share)のレスポンスに、RESTRICTED
    文書はおろかdocument関連のキーが一切含まれないことを構造的に確認する
    (public_share.pyはホワイトリスト方式でTravelDay/TravelEventのみを
    投影しており、Documentへは一切触れないため、契約として固定する)。"""
    import hashlib
    from app.models.models import PlanShareLink

    client, _owner = auth_client
    plan_id = _create_plan(client)
    _upload(client, plan_id, filename="secret.pdf", classification="restricted")

    raw_token = "gate-m7-test-token-" + uuid.uuid4().hex
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    share = PlanShareLink(
        plan_id=uuid.UUID(plan_id), token_hash=token_hash, token_prefix=raw_token[:8], permission="view",
    )
    db_session.add(share)
    db_session.commit()

    res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert res.status_code == 200, res.text
    body = res.json()
    serialized = str(body).lower()
    assert "storage_key" not in serialized
    assert "document" not in serialized
    assert "restricted" not in serialized


# ===== P0-04: soft delete後のstorage file purge =====

def test_delete_document_purges_storage_file_immediately(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _upload(client, plan_id)
    doc_id = body["id"]

    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    storage_key = row.storage_key
    backend = storage_module.get_storage_backend()
    assert backend.exists(storage_key)

    del_res = client.delete(
        f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}", headers={"If-Match": str(body["revision"])}
    )
    assert del_res.status_code == 204

    db_session.expire_all()
    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    assert row.purge_status == DocumentPurgeStatus.PURGED.value
    assert not backend.exists(storage_key)


def test_purge_service_retries_failed_purge_idempotently(auth_client, db_session, monkeypatch):
    """[Gate M7 P0-04] 即時purgeが失敗しても(例: ストレージ一時障害)、
    再試行可能なバッチ処理(document_purge_service)が後から成功させられる
    ことを検証する。ファイルが既に存在しない再試行はidempotentに成功する。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _upload(client, plan_id)
    doc_id = body["id"]

    # 即時purgeを強制失敗させる(ストレージ障害を模擬)。
    original_delete = storage_module.LocalFilesystemBackend.delete

    def _boom(self, storage_key):
        raise OSError("simulated storage failure")

    monkeypatch.setattr(storage_module.LocalFilesystemBackend, "delete", _boom)

    del_res = client.delete(
        f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{doc_id}", headers={"If-Match": str(body["revision"])}
    )
    assert del_res.status_code == 204

    db_session.expire_all()
    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    assert row.purge_status == DocumentPurgeStatus.FAILED.value

    # ストレージ障害が復旧した後、再試行バッチが成功させる。
    monkeypatch.setattr(storage_module.LocalFilesystemBackend, "delete", original_delete)
    counts = purge_deleted_documents(db_session)
    assert counts["purged"] == 1
    assert counts["failed"] == 0

    db_session.expire_all()
    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    assert row.purge_status == DocumentPurgeStatus.PURGED.value

    # 既にファイルが無い状態での再実行もidempotentに成功する(0件処理)。
    counts_again = purge_deleted_documents(db_session)
    assert counts_again["purged"] == 0
    assert counts_again["failed"] == 0


def test_retention_service_soft_deletes_expired_documents(auth_client, db_session):
    """[Gate M7 是正8] retention_untilを過ぎた未削除文書がsoft delete
    対象へ遷移すること。"""
    from datetime import datetime, timedelta, timezone

    client, _user = auth_client
    plan_id = _create_plan(client)
    body = _upload(client, plan_id)
    doc_id = body["id"]

    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    row.retention_until = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    counts = soft_delete_expired_retention_documents(db_session)
    assert counts["marked_deleted"] == 1

    db_session.expire_all()
    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
    assert row.deleted_at is not None


# ===== P1-01: Content-Disposition安全化 =====

def test_download_filename_header_injection_is_sanitized(auth_client):
    """[Gate M7 P1-01] CR/LF・二重引用符を含むファイル名でも
    Content-Dispositionヘッダを分割/注入できないこと。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    dangerous_name = 'evil\r\nSet-Cookie: hijack=1".pdf'
    upload_res = _upload(client, plan_id, filename=dangerous_name)
    document_id = upload_res["id"]

    url_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{document_id}/download-url")
    assert url_res.status_code == 200
    download_res = client.get(url_res.json()["url"])
    assert download_res.status_code == 200

    header_value = download_res.headers["content-disposition"]
    assert "\r" not in header_value
    assert "\n" not in header_value
    assert header_value.startswith("attachment;")
    # [Gate M7 P1-01] 危険な内容はエンコード済みの安全な値としてのみ残り、
    # 実際のheader injection(別ヘッダーとしての混入)は発生しない
    # (レスポンスに"set-cookie"ヘッダー自体が実在しないことを確認する)。
    assert "set-cookie" not in {k.lower() for k in download_res.headers.keys()}


# ===== P1-02: ダウンロード監査ログに機微値が含まれないこと =====

def test_download_audit_log_excludes_sensitive_values(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    upload_res = _upload(client, plan_id, filename="機密書類.pdf")
    document_id = upload_res["id"]

    url_res = client.get(f"{DOCUMENTS_ENDPOINT.format(plan_id=plan_id)}/{document_id}/download-url")
    download_path = url_res.json()["url"]
    token = download_path.split("token=")[1]
    download_res = client.get(download_path)
    assert download_res.status_code == 200

    entries = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "document_downloaded", AuditLog.resource_id == uuid.UUID(document_id))
        .all()
    )
    assert len(entries) == 1
    details_str = str(entries[0].details)
    assert token not in details_str
    assert "機密書類" not in details_str
    assert "storage_key" not in details_str.lower()
