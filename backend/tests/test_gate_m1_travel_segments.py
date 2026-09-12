"""
[Gate M1] FR-014移動区間(TravelSegment)のテスト。

migration自体のrename/data-preservation/pre-flight中断はサンドボックスで
実データを用いて別途検証済み(docs/adr/ADR-travel-segment.md参照)。本
ファイルはAPI/domainレベルの契約(CRUD、ACL、revision、Idempotency-Key、
If-Match、Event削除との整合、推奨出発時刻、Haversine fallback)を検証する。
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.auth import get_current_user, AuthResult
from app.main import app
from app.models.models import Place, PlanCollaborator


PLAN_ENDPOINT = "/api/v1/plans/{plan_id}"
SEGMENTS_ENDPOINT = PLAN_ENDPOINT + "/segments"


def _create_plan(client, title="Gate M1テスト旅行"):
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


def _create_place(db_session, lat=35.0, lon=139.0, name="テスト地点"):
    place = Place(name=name, latitude=lat, longitude=lon)
    db_session.add(place)
    db_session.commit()
    db_session.refresh(place)
    return str(place.id)


def _plan_revision(client, plan_id):
    return client.get(PLAN_ENDPOINT.format(plan_id=plan_id)).json()["revision"]


def _minimal_segment_body(from_event_id, to_event_id, **extra):
    body = {"from_event_id": from_event_id, "to_event_id": to_event_id, "mode": "walking"}
    body.update(extra)
    return body


def _post_segment(client, plan_id, body, key=None):
    headers = {"Idempotency-Key": key or uuid.uuid4().hex}
    return client.post(SEGMENTS_ENDPOINT.format(plan_id=plan_id), json=body, headers=headers)


# ===== 基本CRUD =====

def test_create_and_get_and_list_segment(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "浅草寺")
    e2 = _create_event(client, plan_id, day_id, "東京スカイツリー")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["from_event_id"] == e1
    assert body["to_event_id"] == e2
    assert body["mode"] == "walking"
    assert body["status"] == "planned"
    assert body["revision"] == 1

    get_res = client.get(f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == body["id"]

    list_res = client.get(SEGMENTS_ENDPOINT.format(plan_id=plan_id))
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1


def test_get_unknown_segment_returns_404(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    res = client.get(f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{uuid.uuid4()}")
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
    read_res = client.get(SEGMENTS_ENDPOINT.format(plan_id=plan_id))
    assert read_res.status_code == 200

    write_res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert write_res.status_code == 403


def test_editor_can_write(auth_client, make_user, db_session):
    client, _owner = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    editor, _ = make_user()
    db_session.add(PlanCollaborator(
        plan_id=uuid.UUID(plan_id), user_id=editor.id, email=editor.email,
        role="editor", status="accepted",
    ))
    db_session.commit()

    def _as_editor():
        return AuthResult(user=editor, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_editor
    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert res.status_code == 201, res.text


def test_other_user_without_access_gets_403(client, make_user):
    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client)

    other, _ = make_user()

    def _as_other():
        return AuthResult(user=other, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    res = client.get(SEGMENTS_ENDPOINT.format(plan_id=plan_id))
    assert res.status_code == 403

    # [Gate M1] dependency_overridesはapp全体で共有されるグローバル状態であり、
    # テスト終了後に残すと後続テスト(特にclientフィクスチャを直接使う
    # ゲスト認証テスト)がこの古いoverrideを引き継いでしまい、
    # 該当テストのdb_sessionが既にrollback済みのUserオブジェクトを参照して
    # DetachedInstanceErrorになる。必ずpopしてクリーンな状態に戻す。
    app.dependency_overrides.pop(get_current_user, None)


def test_guest_owner_can_crud_segments(client):
    """[Gate M1] guest-owned normalized plan契約を壊さないことの回帰確認。"""
    guest_res = client.post("/api/v1/auth/guest")
    assert guest_res.status_code == 201
    headers = {"Authorization": f"Bearer {guest_res.json()['access_token']}"}

    plan_res = client.post("/api/v1/travel-plans/", json={"title": "ゲスト旅行"}, headers=headers)
    assert plan_res.status_code == 201
    plan_id = plan_res.json()["id"]

    day_res = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"}, headers=headers
    )
    assert day_res.status_code == 201
    day_id = day_res.json()["id"]
    e1 = client.post(
        f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": "A"}, headers=headers
    ).json()["id"]
    e2 = client.post(
        f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": "B"}, headers=headers
    ).json()["id"]

    res = client.post(
        SEGMENTS_ENDPOINT.format(plan_id=plan_id),
        json=_minimal_segment_body(e1, e2),
        headers={**headers, "Idempotency-Key": uuid.uuid4().hex},
    )
    assert res.status_code == 201, res.text


# ===== mode/status語彙 =====

@pytest.mark.parametrize("mode", [
    "walking", "driving", "train", "bus", "ferry", "flight", "bicycle", "taxi", "mixed",
])
def test_all_modes_accepted(auth_client, mode):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, mode=mode))
    assert res.status_code == 201, res.text
    assert res.json()["mode"] == mode


def test_unknown_mode_returns_422(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, mode="rocket"))
    assert res.status_code == 422


def test_unknown_status_returns_422(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, status="in_transit"))
    assert res.status_code == 422


# ===== endpoint XOR / 参照整合性 =====

def test_endpoint_requires_exactly_one_of_event_or_place(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    place_id = _create_place(db_session)

    # from側が両方未指定
    res_missing = _post_segment(client, plan_id, {"to_event_id": e1, "mode": "walking"})
    assert res_missing.status_code == 422

    # from側が両方指定
    res_both = _post_segment(
        client, plan_id,
        {"from_event_id": e1, "from_place_id": place_id, "to_event_id": e1, "mode": "walking"},
    )
    assert res_both.status_code == 422


def test_from_and_to_cannot_be_same_event(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e1))
    assert res.status_code == 422


def test_place_endpoint_accepted(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    place_id = _create_place(db_session)

    res = _post_segment(
        client, plan_id, {"from_event_id": e1, "to_place_id": place_id, "mode": "driving"}
    )
    assert res.status_code == 201, res.text
    assert res.json()["to_place_id"] == place_id


def test_cross_plan_event_reference_rejected(auth_client):
    client, _user = auth_client
    plan_a = _create_plan(client, "プランA")
    plan_b = _create_plan(client, "プランB")
    day_a = _create_day(client, plan_a)
    day_b = _create_day(client, plan_b)
    e_a = _create_event(client, plan_a, day_a, "A")
    e_b = _create_event(client, plan_b, day_b, "B")

    res = _post_segment(client, plan_a, _minimal_segment_body(e_a, e_b))
    assert res.status_code == 422


def test_cross_plan_reservation_reference_rejected(auth_client):
    client, _user = auth_client
    plan_a = _create_plan(client, "プランA")
    plan_b = _create_plan(client, "プランB")
    day_a = _create_day(client, plan_a)
    e1 = _create_event(client, plan_a, day_a, "A")
    e2 = _create_event(client, plan_a, day_a, "B")

    reservation_res = client.post(
        f"/api/v1/plans/{plan_b}/reservations", json={"type": "flight", "provider_name": "X"}
    )
    assert reservation_res.status_code == 201
    reservation_id = reservation_res.json()["id"]

    res = _post_segment(
        client, plan_a, _minimal_segment_body(e1, e2, reservation_id=reservation_id)
    )
    assert res.status_code == 422


def test_same_plan_reservation_reference_accepted(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    reservation_res = client.post(
        f"/api/v1/plans/{plan_id}/reservations", json={"type": "flight", "provider_name": "X"}
    )
    reservation_id = reservation_res.json()["id"]

    res = _post_segment(
        client, plan_id,
        _minimal_segment_body(e1, e2, reservation_id=reservation_id, transport_number="NH123", platform="42"),
    )
    assert res.status_code == 201, res.text
    assert res.json()["reservation_id"] == reservation_id
    assert res.json()["transport_number"] == "NH123"


# ===== 時刻・費用検証 =====

def test_arrival_before_departure_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    dep = datetime(2026, 12, 1, 10, 0, tzinfo=timezone.utc)
    arr = dep - timedelta(minutes=10)
    res = _post_segment(
        client, plan_id,
        _minimal_segment_body(
            e1, e2,
            planned_departure_at=dep.isoformat(), planned_arrival_at=arr.isoformat(),
        ),
    )
    assert res.status_code == 422


def test_naive_datetime_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(
        client, plan_id,
        _minimal_segment_body(e1, e2, planned_departure_at="2026-12-01T10:00:00"),
    )
    assert res.status_code == 422


def test_cost_without_currency_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, cost="12.50"))
    assert res.status_code == 422


def test_cost_with_currency_accepted_as_decimal(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(
        client, plan_id, _minimal_segment_body(e1, e2, cost="1234.56", currency="JPY")
    )
    assert res.status_code == 201, res.text
    assert res.json()["cost"] == "1234.56"
    assert res.json()["currency"] == "JPY"


def test_lowercase_currency_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, cost="10.00", currency="jpy"))
    assert res.status_code == 422


# ===== Idempotency-Key =====

def test_post_without_idempotency_key_returns_400(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = client.post(SEGMENTS_ENDPOINT.format(plan_id=plan_id), json=_minimal_segment_body(e1, e2))
    assert res.status_code == 400


def test_idempotency_replay_returns_same_resource(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    key = uuid.uuid4().hex
    body = _minimal_segment_body(e1, e2)
    first = _post_segment(client, plan_id, body, key=key)
    assert first.status_code == 201
    second = _post_segment(client, plan_id, body, key=key)
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]

    list_res = client.get(SEGMENTS_ENDPOINT.format(plan_id=plan_id))
    assert len(list_res.json()) == 1  # replayで重複作成されない


def test_idempotency_key_reused_with_different_payload_returns_409(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    key = uuid.uuid4().hex
    first = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, mode="walking"), key=key)
    assert first.status_code == 201
    second = _post_segment(client, plan_id, _minimal_segment_body(e1, e2, mode="driving"), key=key)
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


# ===== If-Match / revision / ChangeSet =====

def test_patch_requires_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    seg = _post_segment(client, plan_id, _minimal_segment_body(e1, e2)).json()

    res = client.patch(f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}", json={"mode": "driving"})
    assert res.status_code == 400


def test_patch_and_delete_bump_plan_revision_and_record_changeset(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    rev_before_create = _plan_revision(client, plan_id)
    seg = _post_segment(client, plan_id, _minimal_segment_body(e1, e2)).json()

    rev_after_create = _plan_revision(client, plan_id)
    assert rev_after_create == rev_before_create + 1

    patch_res = client.patch(
        f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}",
        json={"mode": "driving"},
        headers={"If-Match": str(rev_after_create)},
    )
    assert patch_res.status_code == 200, patch_res.text
    assert patch_res.json()["mode"] == "driving"
    rev_after_patch = _plan_revision(client, plan_id)
    assert rev_after_patch == rev_after_create + 1

    delete_res = client.delete(
        f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}",
        headers={"If-Match": str(rev_after_patch)},
    )
    assert delete_res.status_code == 200
    rev_after_delete = _plan_revision(client, plan_id)
    assert rev_after_delete == rev_after_patch + 1

    assert client.get(f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}").status_code == 404


def test_stale_if_match_returns_409(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    seg = _post_segment(client, plan_id, _minimal_segment_body(e1, e2)).json()

    res = client.patch(
        f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}",
        json={"mode": "driving"}, headers={"If-Match": "1"},
    )
    # 直前のPOSTでplan revisionは既に2へ進んでいるため、"1"は古い
    assert res.status_code == 409


# ===== Event削除との整合・Undo =====

def test_deleting_event_cascades_segment_deletion(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    seg = _post_segment(client, plan_id, _minimal_segment_body(e1, e2)).json()

    rev = _plan_revision(client, plan_id)
    del_res = client.delete(
        f"/api/v1/plans/{plan_id}/events/{e1}", headers={"If-Match": str(rev)}
    )
    assert del_res.status_code == 200, del_res.text

    # Event削除がFK違反(500)を起こさず、関連Segmentも整合的に消えていること。
    assert client.get(f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}").status_code == 404


def test_undo_after_event_delete_restores_event_and_segment(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")
    seg = _post_segment(client, plan_id, _minimal_segment_body(e1, e2)).json()

    rev = _plan_revision(client, plan_id)
    del_res = client.delete(f"/api/v1/plans/{plan_id}/events/{e1}", headers={"If-Match": str(rev)})
    assert del_res.status_code == 200

    rev_after_delete = _plan_revision(client, plan_id)
    undo_res = client.post(
        f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(rev_after_delete)}
    )
    assert undo_res.status_code == 200, undo_res.text

    # Eventが復元されていること
    event_after_undo = client.get(f"/api/v1/plans/{plan_id}").json()
    restored_event_ids = [e["id"] for d in event_after_undo["days"] for e in d["events"]]
    assert e1 in restored_event_ids

    # Segmentも復元されていること(同じidで)
    seg_after_undo = client.get(f"{SEGMENTS_ENDPOINT.format(plan_id=plan_id)}/{seg['id']}")
    assert seg_after_undo.status_code == 200
    assert seg_after_undo.json()["from_event_id"] == e1
    assert seg_after_undo.json()["to_event_id"] == e2


# ===== 推奨出発時刻 =====

def test_recommended_departure_uses_planned_arrival_when_present(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    arrival = datetime(2026, 12, 1, 10, 0, tzinfo=timezone.utc)
    res = _post_segment(
        client, plan_id,
        _minimal_segment_body(
            e1, e2,
            planned_arrival_at=arrival.isoformat(),
            duration_minutes=30, preparation_minutes=10, buffer_before_minutes=5,
        ),
    )
    assert res.status_code == 201, res.text
    recommended = datetime.fromisoformat(res.json()["recommended_departure_at"])
    assert recommended == arrival - timedelta(minutes=45)


def test_recommended_departure_falls_back_to_event_start_at(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    start_at = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B", start_at=start_at.isoformat())

    res = _post_segment(
        client, plan_id,
        _minimal_segment_body(e1, e2, duration_minutes=20, preparation_minutes=0, buffer_before_minutes=0),
    )
    assert res.status_code == 201, res.text
    recommended = datetime.fromisoformat(res.json()["recommended_departure_at"])
    assert recommended == start_at - timedelta(minutes=20)


def test_recommended_departure_is_null_without_basis_or_duration(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")  # start_at未指定

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert res.status_code == 201, res.text
    # duration_minutes未指定・to_eventにstart_atも無いためnull
    assert res.json()["recommended_departure_at"] is None


# ===== Haversine fallback / provenance =====

def test_manual_distance_marks_provider_manual(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(
        client, plan_id, _minimal_segment_body(e1, e2, distance_km=5.0, duration_minutes=60)
    )
    assert res.status_code == 201, res.text
    assert res.json()["is_estimate"] is False
    assert res.json()["provider"] == "manual"


def test_haversine_fallback_applied_when_coordinates_available(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A", latitude=35.6812, longitude=139.7671)
    e2 = _create_event(client, plan_id, day_id, "B", latitude=35.7101, longitude=139.8107)

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["is_estimate"] is True
    assert body["provider"] == "haversine_estimate"
    assert body["distance_km"] is not None
    assert body["duration_minutes"] is not None


def test_missing_coordinates_leaves_distance_null_not_fabricated(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")  # 座標なし
    e2 = _create_event(client, plan_id, day_id, "B")  # 座標なし

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["distance_km"] is None
    assert body["duration_minutes"] is None
    assert body["is_estimate"] is True
    assert body["provider"] == "unknown"


# ===== レスポンスの非露出確認 =====

def test_response_does_not_leak_internal_fields(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A")
    e2 = _create_event(client, plan_id, day_id, "B")

    res = _post_segment(client, plan_id, _minimal_segment_body(e1, e2))
    assert res.status_code == 201
    # SegmentResponseで定義されたフィールドのみが返ること(想定外の内部列が
    # 漏れていないこと)を軽く確認する。
    body = res.json()
    assert set(body.keys()) <= {
        "id", "plan_id", "from_event_id", "from_place_id", "to_event_id", "to_place_id",
        "mode", "status", "planned_departure_at", "planned_arrival_at", "distance_km",
        "duration_minutes", "cost", "currency", "preparation_minutes", "buffer_before_minutes",
        "buffer_after_minutes", "transport_number", "platform", "transfer_count",
        "luggage_note", "reservation_id", "is_estimate", "provider", "algorithm_version",
        "computed_at", "recommended_departure_at", "revision", "created_at", "updated_at",
    }
