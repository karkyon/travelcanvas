"""
[Gate R2-2] POST /quick-drafts のテスト。

conftest.pyのTestClient/db_session fixtureを使う(既存Gateのテストと同じ
方式)。ENCRYPTION_KEYはこのテストファイル内でのみ設定し、他テストへ影響
しないようmonkeypatchで管理する。
"""
import uuid
from datetime import date, timedelta

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import Device, IdempotencyRecord, QuickDraft


ENDPOINT = "/api/v1/quick-drafts"


@pytest.fixture(autouse=True)
def _quickdraft_encryption_key(monkeypatch):
    """このテストファイル内でのみENCRYPTION_KEYを設定する。"""
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _body(**overrides):
    payload = {
        "title": "Gate R2-2 テスト旅行",
        "start_date": str(date.today()),
        "end_date": str(date.today() + timedelta(days=2)),
        "events": [{"title": "浅草寺観光", "local_date": str(date.today())}],
    }
    payload.update(overrides)
    return payload


def test_create_without_authorization_bootstraps_new_device(client, db_session):
    resp = client.post(
        ENDPOINT,
        json=_body(),
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "device_token" in data and data["device_token"]
    assert data["status"] == "ACTIVE"
    assert data["revision"] == 1

    draft = db_session.query(QuickDraft).filter(QuickDraft.id == uuid.UUID(data["id"])).first()
    assert draft is not None
    # payloadは暗号化されて保存され、平文のtitleがそのままDBへ入っていないこと
    assert b"Gate R2-2" not in draft.payload_ciphertext


def test_missing_idempotency_key_returns_400_problem_json(client):
    resp = client.post(ENDPOINT, json=_body())
    assert resp.status_code == 400
    assert resp.headers["content-type"].startswith("application/problem+json")
    body = resp.json()
    assert body["code"] == "INVALID_REQUEST"


def test_reusing_key_with_same_payload_returns_cached_response(client, db_session):
    key = str(uuid.uuid4())
    body = _body()
    resp1 = client.post(ENDPOINT, json=body, headers={"Idempotency-Key": key})
    assert resp1.status_code == 201
    token = resp1.json()["device_token"]

    resp2 = client.post(
        ENDPOINT, json=body,
        headers={"Idempotency-Key": key, "Authorization": f"Bearer {token}"},
    )
    assert resp2.status_code == 201
    assert resp2.json()["id"] == resp1.json()["id"]
    # replay応答にはdevice_tokenを再露出しない
    assert "device_token" not in resp2.json()

    count = (
        db_session.query(QuickDraft)
        .filter(QuickDraft.id == uuid.UUID(resp1.json()["id"]))
        .count()
    )
    assert count == 1  # 二重作成されていない


def test_reusing_key_with_different_payload_returns_409(client):
    key = str(uuid.uuid4())
    resp1 = client.post(ENDPOINT, json=_body(), headers={"Idempotency-Key": key})
    assert resp1.status_code == 201
    token = resp1.json()["device_token"]

    resp2 = client.post(
        ENDPOINT, json=_body(title="別のタイトル"),
        headers={"Idempotency-Key": key, "Authorization": f"Bearer {token}"},
    )
    assert resp2.status_code == 409
    assert resp2.headers["content-type"].startswith("application/problem+json")
    assert resp2.json()["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_in_progress_record_returns_409_operation_in_progress(client, db_session):
    """Phase Aで既にIN_PROGRESSのrecordが存在する状況を直接再現し、
    後続requestが即座に409 OPERATION_IN_PROGRESSを返すことを確認する
    (単一transaction設計だとblockしてしまう問題をADRで是正した点)。"""
    from datetime import datetime, timezone
    import secrets
    import hashlib
    from fastapi.encoders import jsonable_encoder
    from app.api.v1.quickdrafts import QuickDraftCreateRequest
    from app.services.quickdraft_idempotency import compute_payload_hash

    token = secrets.token_urlsafe(32)
    device = Device(
        token_digest=hashlib.sha256(token.encode()).digest(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.add(device)
    db_session.commit()

    key = str(uuid.uuid4())
    body = _body()
    payload_hash = compute_payload_hash(jsonable_encoder(QuickDraftCreateRequest(**body)))
    record = IdempotencyRecord(
        key=key,
        endpoint="POST /v1/quick-drafts",
        payload_hash=payload_hash,
        status="IN_PROGRESS",
        device_id=device.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db_session.add(record)
    db_session.commit()

    resp = client.post(
        ENDPOINT, json=body,
        headers={"Idempotency-Key": key, "Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "OPERATION_IN_PROGRESS"


def test_invalid_device_token_returns_401(client):
    resp = client.post(
        ENDPOINT, json=_body(),
        headers={"Idempotency-Key": str(uuid.uuid4()), "Authorization": "Bearer not-a-real-token"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "AUTH_REQUIRED"


def test_encryption_not_configured_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", None)
    crypto_module.reset_cache_for_tests()
    resp = client.post(ENDPOINT, json=_body(), headers={"Idempotency-Key": str(uuid.uuid4())})
    assert resp.status_code == 503
    assert resp.json()["code"] == "TEMPORARILY_UNAVAILABLE"


def test_fault_injection_failure_leaves_no_orphan_draft_and_marks_idempotency_failed(
    client, db_session, monkeypatch
):
    """作成処理の途中(暗号化成功後、DB commit前)で強制的に例外を発生させ、
    quick_draftsに中間状態の行が残らないこと、idempotency_recordsが
    FAILEDへ収束することを確認する(ADR要求のfault injection試験)。"""
    from app.api.v1 import quickdrafts as qd_module

    original_encrypt = qd_module.encrypt_payload

    def _boom(plaintext):
        raise RuntimeError("injected failure for fault-injection test")

    monkeypatch.setattr(qd_module, "encrypt_payload", _boom)

    key = str(uuid.uuid4())
    with pytest.raises(Exception):
        # TestClientはデフォルトでraise_server_exceptions=Trueのため例外がそのまま伝播する
        client.post(ENDPOINT, json=_body(), headers={"Idempotency-Key": key})

    monkeypatch.setattr(qd_module, "encrypt_payload", original_encrypt)

    assert db_session.query(QuickDraft).count() == 0

    record = (
        db_session.query(IdempotencyRecord)
        .filter(IdempotencyRecord.key == key, IdempotencyRecord.endpoint == "POST /v1/quick-drafts")
        .first()
    )
    assert record is not None
    assert record.status == "FAILED"

    # FAILED状態からの再試行は成功すること
    resp = client.post(ENDPOINT, json=_body(), headers={"Idempotency-Key": key})
    assert resp.status_code == 201, resp.text
    assert db_session.query(QuickDraft).count() == 1


def test_undecided_values_are_saved_and_boundaries_are_checked(client):
    """[Gate② FC-101] 場所・時刻・日が未定の予定も保存でき、境界(名前 200・予定 100 件・時刻の形・日の順)は 422"""
    def post(body):
        return client.post(ENDPOINT, json=body, headers={"Idempotency-Key": str(uuid.uuid4())})

    undecided = post(_body(title=None, events=[{"title": "どこかで昼食"}]))
    assert undecided.status_code == 201, undecided.text
    ev = undecided.json()["events"][0]
    assert ev["local_date"] is None and ev["start_time"] is None
    assert post(_body(title="あ" * 200, events=[{"title": "x", "start_time": "23:59"}])).status_code == 201
    assert post(_body(title="あ" * 201)).status_code == 422
    assert post(_body(events=[{"title": "x"}] * 101)).status_code == 422
    for bad in ("24:00", "99:99", "9:00", "ab:cd"):
        assert post(_body(events=[{"title": "x", "start_time": bad}])).status_code == 422, bad
    assert post(_body(start_date=str(date.today()), end_date=str(date.today() - timedelta(days=1)))).status_code == 422
