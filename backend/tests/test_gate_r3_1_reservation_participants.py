"""
[Gate R3-1] FR-010予約参加者(reservation_participants)のテスト。

作成/一覧/更新/削除(soft delete)の正常系と、他ユーザーからの403を検証する。
"""
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import ReservationParticipant


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
PARTICIPANTS_ENDPOINT = RES_ENDPOINT + "/{reservation_id}/participants"


@pytest.fixture(autouse=True)
def _reservation_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="参加者テスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "大阪",
            "start_date": "2026-11-01",
            "end_date": "2026-11-03",
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


def test_create_and_list_participants(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={"name": "山田太郎", "seat": "12A"})
    assert create_res.status_code == 201, create_res.text
    body = create_res.json()
    assert body["name"] == "山田太郎"
    assert body["seat"] == "12A"
    assert body["revision"] == 1

    row = db_session.query(ReservationParticipant).filter(
        ReservationParticipant.id == uuid.UUID(body["id"])
    ).first()
    assert row is not None
    # [Gate R3-8] name/seatは暗号化列へ保存されるようになった(平文列は
    # 後方互換のため残るが、新規行では書き込まれずNoneのまま)。
    assert row.name is None
    assert row.name_ciphertext is not None

    client.post(endpoint, json={"name": "山田花子", "seat": "12B"})

    list_res = client.get(endpoint)
    assert list_res.status_code == 200
    names = {p["name"] for p in list_res.json()}
    assert names == {"山田太郎", "山田花子"}


def test_update_participant_bumps_revision(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={"name": "田中一郎"})
    participant_id = create_res.json()["id"]

    update_res = client.patch(f"{endpoint}/{participant_id}", json={"seat": "5C"})
    assert update_res.status_code == 200, update_res.text
    body = update_res.json()
    assert body["seat"] == "5C"
    assert body["name"] == "田中一郎"
    assert body["revision"] == 2


def test_delete_participant_is_soft_delete(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    create_res = client.post(endpoint, json={"name": "削除対象"})
    participant_id = create_res.json()["id"]

    del_res = client.delete(f"{endpoint}/{participant_id}")
    assert del_res.status_code == 204

    list_res = client.get(endpoint)
    assert list_res.json() == []

    row = db_session.query(ReservationParticipant).filter(
        ReservationParticipant.id == uuid.UUID(participant_id)
    ).first()
    assert row is not None
    assert row.deleted_at is not None


def test_other_user_without_access_gets_403(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用旅行")
    reservation_id = _create_reservation(client, plan_id)
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)
    client.post(endpoint, json={"name": "本人参加者"})

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(endpoint)
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner
