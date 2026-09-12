"""
[Gate M3] FR-015複数経路比較(RouteOption/RouteLeg)のテスト。
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.auth import get_current_user, AuthResult
from app.main import app
from app.models.models import Place, PlanCollaborator


PLAN_ENDPOINT = "/api/v1/plans/{plan_id}"
OPTIONS_ENDPOINT = PLAN_ENDPOINT + "/route-options"


def _create_plan(client, title="Gate M3テスト旅行"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_day(client, plan_id, local_date="2026-12-01"):
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_event(client, plan_id, day_id, title="イベント", **extra):
    body = {"day_id": day_id, "title": title}
    body.update(extra)
    res = client.post(f"/api/v1/plans/{plan_id}/events", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _plan_revision(client, plan_id):
    return client.get(PLAN_ENDPOINT.format(plan_id=plan_id)).json()["revision"]


def _minimal_option_body(from_event_id, to_event_id, **extra):
    body = {"from_event_id": from_event_id, "to_event_id": to_event_id}
    body.update(extra)
    return body


def _post_option(client, plan_id, body, key=None):
    headers = {"Idempotency-Key": key or uuid.uuid4().hex}
    return client.post(OPTIONS_ENDPOINT.format(plan_id=plan_id), json=body, headers=headers)


# ===== 基本CRUD =====

def test_create_and_get_and_list_option(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(
        e1, e2, total_duration_minutes=30, total_distance_km=2.0,
    ))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "candidate"
    assert body["provider"] == "manual"
    assert body["legs"] == []

    get_res = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == body["id"]

    list_res = client.get(OPTIONS_ENDPOINT.format(plan_id=plan_id))
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1


def test_create_with_legs(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(e1, e2, legs=[
        {"mode": "walking", "from_label": "A駅", "to_label": "改札"},
        {"mode": "train", "line": "山手線", "operator": "JR東日本", "from_label": "改札", "to_label": "B駅"},
    ]))
    assert res.status_code == 201, res.text
    body = res.json()
    assert len(body["legs"]) == 2
    assert body["legs"][0]["leg_order"] == 0
    assert body["legs"][1]["leg_order"] == 1
    assert body["legs"][1]["line"] == "山手線"
    assert body["legs"][0]["realtime_status"] == "unknown"


def test_get_unknown_option_returns_404(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{uuid.uuid4()}")
    assert res.status_code == 404


# ===== ACL =====

def test_viewer_can_read_but_not_write(auth_client, make_user, db_session):
    client, _owner = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    viewer, _ = make_user()
    db_session.add(PlanCollaborator(
        plan_id=uuid.UUID(plan_id), user_id=viewer.id, email=viewer.email,
        role="viewer", status="accepted",
    ))
    db_session.commit()

    def _as_viewer():
        return AuthResult(user=viewer, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_viewer
    read_res = client.get(OPTIONS_ENDPOINT.format(plan_id=plan_id))
    assert read_res.status_code == 200

    write_res = _post_option(client, plan_id, _minimal_option_body(e1, e2))
    assert write_res.status_code == 403


def test_other_user_without_access_gets_403(client, make_user):
    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用プラン")

    other, _ = make_user()

    def _as_other():
        return AuthResult(user=other, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    res = client.get(OPTIONS_ENDPOINT.format(plan_id=plan_id))
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


# ===== endpoint XOR / 参照整合性 =====

def test_endpoint_requires_exactly_one_of_event_or_place(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")

    res = _post_option(client, plan_id, {"to_event_id": e1})
    assert res.status_code == 422


def test_cross_plan_event_reference_rejected(auth_client):
    client, _user = auth_client
    plan_a = _create_plan(client, "プランA")
    plan_b = _create_plan(client, "プランB")
    day_a = _create_day(client, plan_a)
    day_b = _create_day(client, plan_b)
    e_a = _create_event(client, plan_a, day_a, "A")
    e_b = _create_event(client, plan_b, day_b, "B")

    res = _post_option(client, plan_a, _minimal_option_body(e_a, e_b))
    assert res.status_code == 422


# ===== 費用検証 =====

def test_cost_without_currency_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(e1, e2, total_cost="1200"))
    assert res.status_code == 422


def test_cost_with_currency_accepted_as_decimal(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(e1, e2, total_cost="1234.50", currency="JPY"))
    assert res.status_code == 201, res.text
    assert res.json()["total_cost"] == "1234.50"


def test_accessibility_score_out_of_range_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(e1, e2, accessibility_score=1.5))
    assert res.status_code == 422


def test_duration_estimate_range_high_below_low_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(
        e1, e2, duration_estimate_low_minutes=30, duration_estimate_high_minutes=10,
    ))
    assert res.status_code == 422


# ===== Idempotency-Key =====

def test_post_without_idempotency_key_returns_400(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = client.post(OPTIONS_ENDPOINT.format(plan_id=plan_id), json=_minimal_option_body(e1, e2))
    assert res.status_code == 400


def test_idempotency_replay_returns_same_resource(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    key = uuid.uuid4().hex
    body = _minimal_option_body(e1, e2)
    first = _post_option(client, plan_id, body, key=key)
    second = _post_option(client, plan_id, body, key=key)
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert len(client.get(OPTIONS_ENDPOINT.format(plan_id=plan_id)).json()) == 1


def test_idempotency_key_reused_with_different_payload_returns_409(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    key = uuid.uuid4().hex
    _post_option(client, plan_id, _minimal_option_body(e1, e2, total_duration_minutes=10), key=key)
    second = _post_option(client, plan_id, _minimal_option_body(e1, e2, total_duration_minutes=20), key=key)
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


# ===== If-Match / revision =====

def test_patch_requires_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    option = _post_option(client, plan_id, _minimal_option_body(e1, e2)).json()

    res = client.patch(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}", json={"status": "discarded"})
    assert res.status_code == 400


def test_patch_and_delete_bump_plan_revision(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    rev0 = _plan_revision(client, plan_id)
    option = _post_option(client, plan_id, _minimal_option_body(e1, e2)).json()

    rev1 = _plan_revision(client, plan_id)
    assert rev1 == rev0 + 1

    patch_res = client.patch(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}",
        json={"status": "discarded"}, headers={"If-Match": str(rev1)},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "discarded"
    rev2 = _plan_revision(client, plan_id)
    assert rev2 == rev1 + 1

    delete_res = client.delete(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}", headers={"If-Match": str(rev2)},
    )
    assert delete_res.status_code == 200
    assert client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").status_code == 404


# ===== leg CRUD =====

def test_add_update_delete_leg(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    option = _post_option(client, plan_id, _minimal_option_body(e1, e2)).json()

    rev = _plan_revision(client, plan_id)
    add_res = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs",
        json={"mode": "walking", "from_label": "X", "to_label": "Y"},
        headers={"If-Match": str(rev)},
    )
    assert add_res.status_code == 201, add_res.text
    leg = add_res.json()
    assert leg["leg_order"] == 0

    rev2 = _plan_revision(client, plan_id)
    update_res = client.patch(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs/{leg['id']}",
        json={"realtime_status": "delayed"}, headers={"If-Match": str(rev2)},
    )
    assert update_res.status_code == 200
    assert update_res.json()["realtime_status"] == "delayed"

    rev3 = _plan_revision(client, plan_id)
    delete_res = client.delete(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs/{leg['id']}",
        headers={"If-Match": str(rev3)},
    )
    assert delete_res.status_code == 200

    get_option = client.get(f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}").json()
    assert get_option["legs"] == []


def test_unknown_leg_mode_returns_422(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    option = _post_option(client, plan_id, _minimal_option_body(e1, e2)).json()

    rev = _plan_revision(client, plan_id)
    res = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/legs",
        json={"mode": "teleport"}, headers={"If-Match": str(rev)},
    )
    assert res.status_code == 422


# ===== adopt(FR-014との橋渡し) =====

def test_adopt_creates_travel_segment(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    option = _post_option(client, plan_id, _minimal_option_body(
        e1, e2, total_duration_minutes=25, total_distance_km=3.0,
        total_cost="500", currency="JPY", transfer_count=1,
    )).json()

    rev = _plan_revision(client, plan_id)
    adopt_res = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/adopt",
        headers={"If-Match": str(rev)},
    )
    assert adopt_res.status_code == 200, adopt_res.text
    body = adopt_res.json()
    assert body["route_option"]["status"] == "adopted"
    segment_id = body["segment_id"]

    segment_res = client.get(f"/api/v1/plans/{plan_id}/segments/{segment_id}")
    assert segment_res.status_code == 200
    segment = segment_res.json()
    assert segment["from_event_id"] == e1
    assert segment["to_event_id"] == e2
    assert segment["cost"] == "500.00"
    assert segment["currency"] == "JPY"
    assert segment["route_option_id"] == option["id"]


def test_adopt_twice_updates_same_segment_not_duplicate(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    option = _post_option(client, plan_id, _minimal_option_body(e1, e2)).json()

    rev1 = _plan_revision(client, plan_id)
    first = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/adopt", headers={"If-Match": str(rev1)},
    )
    assert first.status_code == 200
    segment_id_1 = first.json()["segment_id"]

    rev2 = _plan_revision(client, plan_id)
    second = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/adopt", headers={"If-Match": str(rev2)},
    )
    assert second.status_code == 200
    assert second.json()["segment_id"] == segment_id_1

    all_segments = client.get(f"/api/v1/plans/{plan_id}/segments").json()
    assert len(all_segments) == 1


def test_adopt_discarded_option_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    option = _post_option(client, plan_id, _minimal_option_body(e1, e2)).json()

    rev = _plan_revision(client, plan_id)
    client.patch(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}",
        json={"status": "discarded"}, headers={"If-Match": str(rev)},
    )

    rev2 = _plan_revision(client, plan_id)
    res = client.post(
        f"{OPTIONS_ENDPOINT.format(plan_id=plan_id)}/{option['id']}/adopt", headers={"If-Match": str(rev2)},
    )
    assert res.status_code == 422


# ===== レスポンスの非露出確認 =====

def test_response_does_not_leak_internal_fields(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_option(client, plan_id, _minimal_option_body(e1, e2))
    body = res.json()
    assert set(body.keys()) <= {
        "id", "plan_id", "from_event_id", "from_place_id", "to_event_id", "to_place_id",
        "status", "total_duration_minutes", "total_cost", "currency", "total_distance_km",
        "walking_minutes", "transfer_count", "accessibility_score", "scenic_score",
        "co2_estimate_kg", "duration_estimate_low_minutes", "duration_estimate_high_minutes",
        "provider", "retrieved_at", "expires_at", "is_estimate", "algorithm_version",
        "revision", "created_at", "updated_at", "legs",
    }
