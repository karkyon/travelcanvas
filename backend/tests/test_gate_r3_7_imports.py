"""
[Gate R3-7] FR-011予約取込(import_jobs/extraction_candidates)のテスト。

- ジョブ作成(consent必須)、候補登録・暗号化保存
- accept/reject、confirmでReservation生成(未accept候補は反映されない)
- confirm後は候補追加・再confirm不可(409)
- type未accept時のconfirmは422
- 他ユーザー403
"""
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import ExtractionCandidate, ImportJob, Reservation


IMPORTS_ENDPOINT = "/api/v1/plans/{plan_id}/imports"


@pytest.fixture(autouse=True)
def _import_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="取込テスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "札幌",
            "start_date": "2027-01-10",
            "end_date": "2027-01-13",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_job(client, plan_id, consent=True):
    res = client.post(IMPORTS_ENDPOINT.format(plan_id=plan_id), json={"consent_given": consent})
    return res


def test_create_job_without_consent_returns_422(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = _create_job(client, plan_id, consent=False)
    assert res.status_code == 422


def test_create_job_starts_as_review_required(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = _create_job(client, plan_id)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "review_required"
    assert body["provider"] == "manual"
    assert body["consent_given"] is True

    row = db_session.query(ImportJob).filter(ImportJob.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.status == "review_required"


def test_candidate_value_encrypted_and_visible_in_response(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    job_id = _create_job(client, plan_id).json()["id"]
    endpoint = f"{IMPORTS_ENDPOINT.format(plan_id=plan_id)}/{job_id}/candidates"

    res = client.post(endpoint, json={"field_path": "confirmation_number", "value": "ABC123XYZ"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["value"] == "ABC123XYZ"
    assert body["review_status"] == "pending"

    row = db_session.query(ExtractionCandidate).filter(ExtractionCandidate.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.candidate_value_ciphertext != b"ABC123XYZ"


def test_invalid_field_path_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    job_id = _create_job(client, plan_id).json()["id"]
    endpoint = f"{IMPORTS_ENDPOINT.format(plan_id=plan_id)}/{job_id}/candidates"

    res = client.post(endpoint, json={"field_path": "not_a_real_field", "value": "x"})
    assert res.status_code == 422


def test_confirm_without_accepted_type_returns_422(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    job_id = _create_job(client, plan_id).json()["id"]
    endpoint = IMPORTS_ENDPOINT.format(plan_id=plan_id) + f"/{job_id}"

    # 候補が1件も無い状態でconfirm
    confirm_res = client.post(f"{endpoint}/confirm")
    assert confirm_res.status_code == 422


def test_full_review_flow_confirms_and_creates_reservation(auth_client, db_session, monkeypatch):
    client, _user = auth_client
    plan_id = _create_plan(client)
    job_id = _create_job(client, plan_id).json()["id"]
    base = IMPORTS_ENDPOINT.format(plan_id=plan_id) + f"/{job_id}"

    c1 = client.post(f"{base}/candidates", json={"field_path": "type", "value": "flight"}).json()
    c2 = client.post(f"{base}/candidates", json={
        "field_path": "confirmation_number", "value": "FLIGHT-999",
    }).json()
    c3 = client.post(f"{base}/candidates", json={"field_path": "provider_name", "value": "怪しい候補"}).json()

    # c1, c2のみacceptし、c3はrejectする(未accept候補が反映されないことを確認)
    assert client.post(f"{base}/candidates/{c1['id']}/accept").status_code == 200
    assert client.post(f"{base}/candidates/{c2['id']}/accept").status_code == 200
    assert client.post(f"{base}/candidates/{c3['id']}/reject").status_code == 200

    audit_calls = []
    import app.api.v1.imports as imports_module
    monkeypatch.setattr(
        imports_module, "record_audit_event", lambda **kwargs: audit_calls.append(kwargs),
    )

    confirm_res = client.post(f"{base}/confirm")
    assert confirm_res.status_code == 200, confirm_res.text
    body = confirm_res.json()
    assert body["status"] == "confirmed"
    assert body["result_reservation_id"] is not None

    reservation = (
        db_session.query(Reservation)
        .filter(Reservation.id == uuid.UUID(body["result_reservation_id"]))
        .first()
    )
    assert reservation is not None
    assert reservation.type == "flight"
    assert reservation.provider_name is None  # rejectされた候補は反映されない
    assert reservation.confirmation_number_ciphertext is not None

    assert any(c["action"] == "import_job_confirmed" for c in audit_calls)

    # confirm済みジョブへの追加操作は409
    stale_add_res = client.post(f"{base}/candidates", json={"field_path": "notes", "value": "後から追加"})
    assert stale_add_res.status_code == 409
    stale_confirm_res = client.post(f"{base}/confirm")
    assert stale_confirm_res.status_code == 409


def test_reject_job(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    job_id = _create_job(client, plan_id).json()["id"]
    base = IMPORTS_ENDPOINT.format(plan_id=plan_id) + f"/{job_id}"

    res = client.post(f"{base}/reject")
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"


def test_other_user_without_access_gets_403(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用旅行")
    _create_job(client, plan_id)

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(IMPORTS_ENDPOINT.format(plan_id=plan_id))
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner
