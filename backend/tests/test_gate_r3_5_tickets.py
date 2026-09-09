"""
[Gate R3-5] FR-012 QR・チケット(tickets)のテスト。

- 作成時マスク表示(has_payload/barcode_format)、一覧・詳細
- reveal(payload完全開示)+ 監査呼び出し検証
- share_policy="all_collaborators"ならviewerでもreveal可、既定
  ("owner_editor")ならviewerは403
- If-Match必須/409/成功、soft delete
- valid_from >= valid_toはDB CHECK制約(統合テストでは正常系のみ確認)
- 他ユーザー403
"""
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import Ticket


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
TICKETS_ENDPOINT = RES_ENDPOINT + "/{reservation_id}/tickets"


@pytest.fixture(autouse=True)
def _reservation_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="チケットテスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "沖縄",
            "start_date": "2026-11-10",
            "end_date": "2026-11-13",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_reservation(client, plan_id):
    res = client.post(
        RES_ENDPOINT.format(plan_id=plan_id),
        json={"type": "flight", "provider_name": "テスト航空"},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_create_ticket_masks_payload(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    res = client.post(endpoint, json={
        "ticket_type": "boarding_pass",
        "payload": "QR-DATA-XYZ-12345",
        "barcode_format": "QR_CODE",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["has_payload"] is True
    assert body["barcode_format"] == "QR_CODE"
    assert "payload" not in body  # マスク表示APIには生データを一切含めない
    assert body["status"] == "active"
    assert body["share_policy"] == "owner_editor"

    row = db_session.query(Ticket).filter(Ticket.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.payload_ciphertext is not None
    assert row.payload_ciphertext != b"QR-DATA-XYZ-12345"  # 平文で保存されていないこと


def test_list_and_get_ticket(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={"ticket_type": "entry_ticket"})
    ticket_id = create_res.json()["id"]

    list_res = client.get(endpoint)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    get_res = client.get(f"{endpoint}/{ticket_id}")
    assert get_res.status_code == 200
    assert get_res.json()["ticket_type"] == "entry_ticket"


def test_reveal_ticket_owner_succeeds_and_audits(auth_client, monkeypatch):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={
        "ticket_type": "boarding_pass",
        "payload": "SECRET-PAYLOAD-789",
        "barcode_format": "PDF417",
    })
    ticket_id = create_res.json()["id"]

    audit_calls = []
    import app.api.v1.reservations as reservations_module
    monkeypatch.setattr(
        reservations_module, "record_audit_event",
        lambda **kwargs: audit_calls.append(kwargs),
    )

    reveal_res = client.post(f"{endpoint}/{ticket_id}/reveal")
    assert reveal_res.status_code == 200, reveal_res.text
    body = reveal_res.json()
    assert body["payload"] == "SECRET-PAYLOAD-789"
    assert body["barcode_format"] == "PDF417"

    assert any(c["action"] == "ticket_revealed" for c in audit_calls)


def test_update_ticket_bumps_revision_with_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={"ticket_type": "entry_ticket"})
    ticket_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    # If-Match無し -> 400
    no_match_res = client.patch(f"{endpoint}/{ticket_id}", json={"status": "used"})
    assert no_match_res.status_code == 400

    # 古いrevision -> 409
    stale_res = client.patch(
        f"{endpoint}/{ticket_id}", json={"status": "used"}, headers={"If-Match": "999"}
    )
    assert stale_res.status_code == 409

    ok_res = client.patch(
        f"{endpoint}/{ticket_id}", json={"status": "used"}, headers={"If-Match": str(revision)}
    )
    assert ok_res.status_code == 200, ok_res.text
    assert ok_res.json()["status"] == "used"
    assert ok_res.json()["revision"] == revision + 1


def test_delete_ticket_is_soft_delete(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={"ticket_type": "entry_ticket"})
    ticket_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    del_res = client.delete(f"{endpoint}/{ticket_id}", headers={"If-Match": str(revision)})
    assert del_res.status_code == 204

    list_res = client.get(endpoint)
    assert list_res.json() == []

    row = db_session.query(Ticket).filter(Ticket.id == uuid.UUID(ticket_id)).first()
    assert row is not None
    assert row.deleted_at is not None


def test_viewer_forbidden_from_reveal_with_default_share_policy(client, make_user):
    """share_policy既定(owner_editor)ではviewerはreveal不可(403)。"""
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="viewer制限テスト旅行")
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)
    create_res = client.post(endpoint, json={"ticket_type": "entry_ticket", "payload": "ABC"})
    ticket_id = create_res.json()["id"]

    # ownerがviewerを招待して承諾させる
    invite_res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "viewer_ticket_test@example.com", "role": "viewer"},
    )
    assert invite_res.status_code in (200, 201), invite_res.text
    collaborator_id = invite_res.json()["id"]

    viewer_user, _ = make_user(email="viewer_ticket_test@example.com")

    def _as_viewer():
        return AuthResult(user=viewer_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_viewer
    accept_res = client.post(f"/api/v1/travel-plans/invitations/{collaborator_id}/accept")
    assert accept_res.status_code == 200, accept_res.text

    forbidden_res = client.post(f"{endpoint}/{ticket_id}/reveal")
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner


def test_viewer_allowed_reveal_with_all_collaborators_share_policy(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="viewer許可テスト旅行")
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)
    create_res = client.post(endpoint, json={
        "ticket_type": "entry_ticket", "payload": "ABC", "share_policy": "all_collaborators",
    })
    ticket_id = create_res.json()["id"]

    invite_res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "viewer_ticket_allowed@example.com", "role": "viewer"},
    )
    assert invite_res.status_code in (200, 201), invite_res.text
    collaborator_id = invite_res.json()["id"]

    viewer_user, _ = make_user(email="viewer_ticket_allowed@example.com")

    def _as_viewer():
        return AuthResult(user=viewer_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_viewer
    accept_res = client.post(f"/api/v1/travel-plans/invitations/{collaborator_id}/accept")
    assert accept_res.status_code == 200, accept_res.text

    allowed_res = client.post(f"{endpoint}/{ticket_id}/reveal")
    assert allowed_res.status_code == 200, allowed_res.text
    assert allowed_res.json()["payload"] == "ABC"

    app.dependency_overrides[get_current_user] = _as_owner


def test_other_user_without_access_gets_403(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用旅行")
    reservation_id = _create_reservation(client, plan_id)
    endpoint = TICKETS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)
    client.post(endpoint, json={"ticket_type": "entry_ticket"})

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(endpoint)
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner
