"""
[Gate #33] 説明可能な経路最適化(提案->適用->Undo)のAPI統合テスト。
- 提案はDBへ一切書き込まない
- lockedなイベントは並べ替え対象外
- 座標の無いイベントは並べ替え対象外(架空の順序を作らない)
- 適用時にIf-Matchのrevisionが古いと409
- 適用は単一のChangeSetとして記録され、1回のUndoで全体を戻せる
"""
import uuid

from app.models.models import Place, TravelEvent


def _create_plan(client, title="最適化テストプラン"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201
    return res.json()["id"]


def _create_day(client, plan_id, local_date="2026-12-01"):
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date})
    assert res.status_code == 201
    return res.json()["id"]


def _create_event(client, plan_id, day_id, title, lat=None, lon=None, locked=False):
    res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": title, "latitude": lat, "longitude": lon},
    )
    assert res.status_code == 201
    event = res.json()
    if locked:
        detail = client.get(f"/api/v1/plans/{plan_id}").json()
        revision = detail["revision"]
        lock_res = client.put(
            f"/api/v1/plans/{plan_id}/events/{event['id']}",
            json={"locked": True},
            headers={"If-Match": str(revision)},
        )
        assert lock_res.status_code == 200
    return event["id"]


def _current_revision(client, plan_id):
    return client.get(f"/api/v1/plans/{plan_id}").json()["revision"]


def test_proposal_computes_reordering_without_writing_to_db(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)

    # 東京駅から見て遠い順にあえて登録する(A: 近い, B: 遠い, C: 中間)
    _create_event(client, plan_id, day_id, "A", lat=35.6812, lon=139.7671)
    _create_event(client, plan_id, day_id, "B", lat=35.4437, lon=139.6380)  # 横浜方面
    _create_event(client, plan_id, day_id, "C", lat=35.6586, lon=139.7454)  # 東京タワー付近

    revision_before = _current_revision(client, plan_id)

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal")
    assert res.status_code == 200
    body = res.json()
    assert body["algorithm"] == "nearest_neighbor_haversine"
    assert len(body["proposed_order"]) == 3
    assert body["locked_event_ids"] == []

    # 何も書き込まれていないこと
    assert _current_revision(client, plan_id) == revision_before

    events = db_session.query(TravelEvent).filter(TravelEvent.day_id == day_id).all()
    orders_before = sorted(e.sort_order for e in events)
    assert orders_before == [0, 1, 2]  # 元の順序のまま


def test_proposal_excludes_locked_events_from_reordering(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)

    locked_id = _create_event(client, plan_id, day_id, "固定イベント", lat=35.0, lon=139.0, locked=True)
    _create_event(client, plan_id, day_id, "自由イベントA", lat=35.6812, lon=139.7671)
    _create_event(client, plan_id, day_id, "自由イベントB", lat=35.4437, lon=139.6380)

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal")
    assert res.status_code == 200
    body = res.json()
    assert locked_id in body["locked_event_ids"]
    # 固定イベントの位置(元のindex 0)は変わらない
    assert body["proposed_order"][0] == locked_id


def test_proposal_warns_when_fewer_than_two_events(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    _create_event(client, plan_id, day_id, "唯一のイベント")

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal")
    assert res.status_code == 200
    body = res.json()
    assert body["has_improvement"] is False
    assert len(body["warnings"]) > 0


def test_proposal_warns_for_events_without_coordinates(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    _create_event(client, plan_id, day_id, "座標なしA")
    _create_event(client, plan_id, day_id, "座標なしB")

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal")
    assert res.status_code == 200
    body = res.json()
    assert any("位置情報" in w for w in body["warnings"])


def test_apply_optimization_requires_correct_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A", lat=35.6812, lon=139.7671)
    e2 = _create_event(client, plan_id, day_id, "B", lat=35.4437, lon=139.6380)

    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal/apply",
        json={"proposed_order": [e2, e1]},
        headers={"If-Match": "999"},
    )
    assert res.status_code == 409


def test_apply_optimization_updates_sort_order_and_is_undoable_as_one_unit(auth_client, db_session):
    """[Gate #33] 複数イベントの並べ替えが単一のChangeSetとして記録され、
    1回のUndoで全体を元に戻せることを検証する。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A", lat=35.6812, lon=139.7671)
    e2 = _create_event(client, plan_id, day_id, "B", lat=35.4437, lon=139.6380)
    e3 = _create_event(client, plan_id, day_id, "C", lat=35.6586, lon=139.7454)

    revision = _current_revision(client, plan_id)
    new_order = [e3, e1, e2]  # 元の [e1, e2, e3] から並べ替える

    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal/apply",
        json={"proposed_order": new_order},
        headers={"If-Match": str(revision)},
    )
    assert res.status_code == 200
    body = res.json()
    assert [e["id"] for e in body["events"]] == new_order

    revision_after_apply = _current_revision(client, plan_id)
    assert revision_after_apply == revision + 1  # 複数イベント変更でも+1のみ

    # 1回のUndoで全体が元に戻ること
    undo_res = client.post(f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(revision_after_apply)})
    assert undo_res.status_code == 200

    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    restored_order = [e["id"] for e in detail["days"][0]["events"]]
    assert restored_order == [e1, e2, e3]


def test_apply_optimization_never_moves_locked_events(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    locked_id = _create_event(client, plan_id, day_id, "固定", lat=35.0, lon=139.0, locked=True)
    e2 = _create_event(client, plan_id, day_id, "自由A", lat=35.6812, lon=139.7671)

    revision = _current_revision(client, plan_id)
    # 悪意or誤りのあるクライアントがlockedイベントの位置を変えようとしても
    # サーバー側で無視される(locked=Trueの間は動かさない)。
    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal/apply",
        json={"proposed_order": [e2, locked_id]},
        headers={"If-Match": str(revision)},
    )
    assert res.status_code == 200

    locked_event = db_session.query(TravelEvent).filter(TravelEvent.id == locked_id).first()
    assert locked_event.sort_order == 0  # 元の位置のまま


def test_apply_optimization_rejects_mismatched_event_set(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    e1 = _create_event(client, plan_id, day_id, "A", lat=35.6812, lon=139.7671)
    revision = _current_revision(client, plan_id)

    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal/apply",
        json={"proposed_order": [e1, "00000000-0000-0000-0000-000000000000"]},
        headers={"If-Match": str(revision)},
    )
    assert res.status_code == 400


def test_viewer_can_get_proposal_but_not_apply(auth_client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    client, _owner = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    _create_event(client, plan_id, day_id, "A", lat=35.6812, lon=139.7671)
    _create_event(client, plan_id, day_id, "B", lat=35.4437, lon=139.6380)

    viewer, _ = make_user(email="viewer_opt@example.com")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "viewer_opt@example.com", "role": "viewer"},
    )
    collab_id = res.json()["id"]

    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    accept = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert accept.status_code == 200

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal")
    assert res.status_code == 200

    revision = _current_revision(client, plan_id)
    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/optimization-proposal/apply",
        json={"proposed_order": []},
        headers={"If-Match": str(revision)},
    )
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)
