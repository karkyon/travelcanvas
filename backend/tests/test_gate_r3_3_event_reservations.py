"""
[Gate R3-3] FR-010予約管理: event_reservations中間表(複数イベント紐付け)のテスト。

- 予約作成時にevent_idを指定すると自動的にprimaryリンクが同期作成されること
- 追加のイベントリンク(required/related)の作成・一覧・更新・解除
- 重複リンク(409)、他planのイベントへの紐付け拒否(404)
- is_locked=Trueのリンクは解除不可(409)
- 他ユーザー(アクセス権無し)からの403
"""
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import EventReservation


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
EVENTS_ENDPOINT = RES_ENDPOINT + "/{reservation_id}/events"


@pytest.fixture(autouse=True)
def _reservation_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="イベント紐付けテスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "北海道",
            "start_date": "2026-12-01",
            "end_date": "2026-12-05",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_day(client, plan_id, local_date="2026-12-01"):
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_event(client, plan_id, day_id, title="宿泊"):
    res = client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_reservation(client, plan_id, event_id=None):
    body = {"type": "accommodation", "provider_name": "テストホテル"}
    if event_id:
        body["event_id"] = event_id
    res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_create_reservation_with_event_id_autocreates_primary_link(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    event_id = _create_event(client, plan_id, day_id)

    reservation_id = _create_reservation(client, plan_id, event_id=event_id)

    links = (
        db_session.query(EventReservation)
        .filter(EventReservation.reservation_id == uuid.UUID(reservation_id))
        .all()
    )
    assert len(links) == 1
    assert str(links[0].event_id) == event_id
    assert links[0].relation_type == "primary"
    assert links[0].is_locked is False


def test_create_additional_event_link_for_multi_night_stay(auth_client):
    """連泊: 1件の宿泊予約を複数日のイベントへrequiredとして追加紐付けする。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    day1_id = _create_day(client, plan_id, "2026-12-01")
    day2_id = _create_day(client, plan_id, "2026-12-02")
    event1_id = _create_event(client, plan_id, day1_id, title="1泊目")
    event2_id = _create_event(client, plan_id, day2_id, title="2泊目")

    reservation_id = _create_reservation(client, plan_id, event_id=event1_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    add_res = client.post(endpoint, json={"event_id": event2_id, "relation_type": "required"})
    assert add_res.status_code == 201, add_res.text
    body = add_res.json()
    assert body["event_id"] == event2_id
    assert body["relation_type"] == "required"

    list_res = client.get(endpoint)
    assert list_res.status_code == 200
    relation_types = {link["relation_type"] for link in list_res.json()}
    assert relation_types == {"primary", "required"}


def test_duplicate_link_returns_409(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    event_id = _create_event(client, plan_id, day_id)
    reservation_id = _create_reservation(client, plan_id, event_id=event_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    # event_idは既にprimaryとして自動リンク済み -> 同じevent_idを再度指定すると409
    dup_res = client.post(endpoint, json={"event_id": event_id, "relation_type": "related"})
    assert dup_res.status_code == 409


def test_link_to_event_from_other_plan_returns_404(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    other_plan_id = _create_plan(client, title="別の旅行")
    other_day_id = _create_day(client, other_plan_id)
    other_event_id = _create_event(client, other_plan_id, other_day_id)

    res = client.post(endpoint, json={"event_id": other_event_id})
    assert res.status_code == 404


def test_update_link_relation_type(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    event_id = _create_event(client, plan_id, day_id)
    reservation_id = _create_reservation(client, plan_id, event_id=event_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    link_id = client.get(endpoint).json()[0]["id"]

    update_res = client.patch(f"{endpoint}/{link_id}", json={"relation_type": "related", "is_locked": True})
    assert update_res.status_code == 200, update_res.text
    body = update_res.json()
    assert body["relation_type"] == "related"
    assert body["is_locked"] is True


def test_delete_link(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    event1_id = _create_event(client, plan_id, day_id, title="A")
    event2_id = _create_event(client, plan_id, day_id, title="B")
    reservation_id = _create_reservation(client, plan_id, event_id=event1_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    add_res = client.post(endpoint, json={"event_id": event2_id, "relation_type": "related"})
    link_id = add_res.json()["id"]

    del_res = client.delete(f"{endpoint}/{link_id}")
    assert del_res.status_code == 204

    remaining = {link["event_id"] for link in client.get(endpoint).json()}
    assert remaining == {event1_id}


def test_locked_link_cannot_be_deleted(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    event_id = _create_event(client, plan_id, day_id)
    reservation_id = _create_reservation(client, plan_id, event_id=event_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    link_id = client.get(endpoint).json()[0]["id"]
    client.patch(f"{endpoint}/{link_id}", json={"is_locked": True})

    del_res = client.delete(f"{endpoint}/{link_id}")
    assert del_res.status_code == 409


def test_other_user_without_access_gets_403(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用旅行")
    day_id = _create_day(client, plan_id)
    event_id = _create_event(client, plan_id, day_id)
    reservation_id = _create_reservation(client, plan_id, event_id=event_id)
    endpoint = EVENTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(endpoint)
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner
