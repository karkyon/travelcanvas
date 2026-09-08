"""
[Gate R2-3] POST /quick-drafts/{id}/promote のテスト。
"""
import uuid
from datetime import date, timedelta

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import Device, QuickDraft, TravelPlan, TravelDay, TravelEvent


CREATE_ENDPOINT = "/api/v1/quick-drafts"


def _promote_endpoint(draft_id):
    return f"/api/v1/quick-drafts/{draft_id}/promote"


@pytest.fixture(autouse=True)
def _quickdraft_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_draft(client, **overrides):
    body = {
        "title": "Gate R2-3 テスト旅行",
        "start_date": str(date.today()),
        "end_date": str(date.today() + timedelta(days=1)),
        "events": [{"title": "浅草寺観光", "local_date": str(date.today())}],
    }
    body.update(overrides)
    resp = client.post(CREATE_ENDPOINT, json=body, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_promote_creates_new_plan_and_marks_draft_promoted(client, db_session, auth_client):
    ac, _user = auth_client
    draft = _create_draft(client)
    resp = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": draft["device_token"]},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["quick_draft_id"] == draft["id"]
    assert data["quick_draft_status"] == "PROMOTED"

    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(data["id"])).first()
    assert plan is not None
    assert plan.title == "Gate R2-3 テスト旅行"

    events = db_session.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    assert len(events) == 1
    assert events[0].title == "浅草寺観光"

    d = db_session.query(QuickDraft).filter(QuickDraft.id == uuid.UUID(draft["id"])).first()
    assert d.status == "PROMOTED"
    assert str(d.promoted_plan_id) == data["id"]


def test_promote_wrong_device_token_returns_403(client, auth_client):
    ac, _user = auth_client
    draft = _create_draft(client)
    resp = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": "not-the-real-token"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "PERMISSION_DENIED"


def test_promote_replay_same_request_returns_same_plan(client, auth_client):
    ac, _user = auth_client
    draft = _create_draft(client)
    key = str(uuid.uuid4())
    resp1 = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": draft["device_token"]},
        headers={"Idempotency-Key": key},
    )
    assert resp1.status_code == 201
    resp2 = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": draft["device_token"]},
        headers={"Idempotency-Key": key},
    )
    assert resp2.status_code == 201
    assert resp2.json()["id"] == resp1.json()["id"]


def test_promote_again_with_different_request_returns_409(client, auth_client):
    ac, _user = auth_client
    draft = _create_draft(client)
    resp1 = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": draft["device_token"]},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp1.status_code == 201

    resp2 = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": draft["device_token"]},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp2.status_code == 409
    assert resp2.json()["code"] == "ALREADY_PROMOTED"


def test_promote_missing_draft_returns_404(auth_client):
    ac, _user = auth_client
    resp = ac.post(
        _promote_endpoint(str(uuid.uuid4())),
        json={"device_token": "x"},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "RESOURCE_NOT_FOUND"


def test_promote_expired_draft_returns_410(client, db_session, auth_client):
    ac, _user = auth_client
    draft = _create_draft(client)
    d = db_session.query(QuickDraft).filter(QuickDraft.id == uuid.UUID(draft["id"])).first()
    d.status = "EXPIRED"
    db_session.commit()

    resp = ac.post(
        _promote_endpoint(draft["id"]),
        json={"device_token": draft["device_token"]},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp.status_code == 410
    assert resp.json()["code"] == "RESOURCE_GONE"


def test_promote_missing_idempotency_key_returns_400(auth_client):
    ac, _user = auth_client
    resp = ac.post(
        _promote_endpoint(str(uuid.uuid4())),
        json={"device_token": "x"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_REQUEST"
