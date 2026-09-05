"""
[Gate #32] PLAN MAP基礎のAPI統合テスト。
- 検索候補(Place)を「旅程に追加」した際にevent.place_idが紐づくこと
- 日程のroute-previewが座標既知/不明を正しく区別すること
- insertion-previewが何も確定させずに差分を試算すること
"""
import uuid

from app.models.models import Place, TravelEvent


def _create_plan(client, title="MAPテストプラン"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201
    return res.json()["id"]


def _create_day(client, plan_id, local_date="2026-12-01"):
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date})
    assert res.status_code == 201
    return res.json()["id"]


def _make_place(db_session, name="大阪城", lat=34.687315, lon=135.526201, address="大阪市中央区"):
    place = Place(id=uuid.uuid4(), name=name, category="landmark", latitude=lat, longitude=lon, address=address)
    db_session.add(place)
    db_session.commit()
    db_session.refresh(place)
    return place


def test_create_event_with_place_id_inherits_place_fields(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    place = _make_place(db_session)

    res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "", "place_id": str(place.id)},
    )
    # titleが空文字の場合はPlaceの名前で補完される
    assert res.status_code == 201
    body = res.json()
    assert body["title"] == "大阪城"
    assert body["latitude"] == place.latitude
    assert body["longitude"] == place.longitude
    assert body["place_id"] == str(place.id)


def test_create_event_with_place_id_and_explicit_title_keeps_explicit_title(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    place = _make_place(db_session)

    res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "カスタムタイトル", "place_id": str(place.id)},
    )
    assert res.status_code == 201
    assert res.json()["title"] == "カスタムタイトル"


def test_create_event_with_unknown_place_id_returns_404(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)

    res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "x", "place_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 404


def test_route_preview_computes_legs_between_known_coordinates(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    place_a = _make_place(db_session, name="大阪城", lat=34.687315, lon=135.526201)
    place_b = _make_place(db_session, name="通天閣", lat=34.652432, lon=135.506156)

    for place in (place_a, place_b):
        res = client.post(
            f"/api/v1/plans/{plan_id}/events",
            json={"day_id": day_id, "title": "", "place_id": str(place.id)},
        )
        assert res.status_code == 201

    res = client.get(f"/api/v1/plans/{plan_id}/days/{day_id}/route-preview")
    assert res.status_code == 200
    body = res.json()
    assert len(body["legs"]) == 1
    leg = body["legs"][0]
    assert leg["unknown"] is False
    assert leg["is_estimate"] is True
    assert leg["distance_km"] > 0
    assert body["total_distance_km"] == leg["distance_km"]
    assert body["provider"] == "haversine_estimate"


def test_route_preview_marks_leg_unknown_when_coordinates_missing(auth_client):
    """[Gate #32 監査是正] 座標不明の地点(例: Wikipedia由来でlat/lngが
    無い候補)を挟む区間は、架空の距離を作らずunknown=Trueで返す。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)

    # 座標無しのイベントを2件作成(place_idなし、緯度経度も指定しない)
    client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": "予定A"})
    client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": "予定B"})

    res = client.get(f"/api/v1/plans/{plan_id}/days/{day_id}/route-preview")
    assert res.status_code == 200
    body = res.json()
    assert len(body["legs"]) == 1
    assert body["legs"][0]["unknown"] is True
    assert body["legs"][0]["distance_km"] is None
    assert body["total_distance_km"] is None


def test_insertion_preview_does_not_persist_anything(auth_client, db_session):
    """[Gate #32] insertion-previewはDBへ一切書き込まない(確定前の試算のみ)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    place = _make_place(db_session, name="通天閣", lat=34.652432, lon=135.506156)

    before_count = db_session.query(TravelEvent).filter(TravelEvent.day_id == day_id).count()

    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/insertion-preview",
        json={"place_id": str(place.id)},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["unknown"] is False

    after_count = db_session.query(TravelEvent).filter(TravelEvent.day_id == day_id).count()
    assert after_count == before_count  # 何も作成されていない

    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    assert detail["revision"] == 2  # day作成分のみ、insertion-previewでは進まない


def test_insertion_preview_shows_added_distance_when_inserting_between_events(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)
    place_a = _make_place(db_session, name="大阪城", lat=34.687315, lon=135.526201)
    place_far = _make_place(db_session, name="遠い場所", lat=35.681236, lon=139.767125)

    res_a = client.post(
        f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": "", "place_id": str(place_a.id)}
    )
    event_a_id = res_a.json()["id"]

    res = client.post(
        f"/api/v1/plans/{plan_id}/days/{day_id}/insertion-preview",
        json={"place_id": str(place_far.id), "after_event_id": event_a_id},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["unknown"] is False
    assert body["before"]["legs"] == []
    assert len(body["after"]["legs"]) == 1
    assert body["added_distance_km"] > 0


def test_insertion_preview_unknown_when_no_coordinates_given(auth_client):
    """place_idも座標も指定しない場合はunknownとして返す(架空値を作らない)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/insertion-preview", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["unknown"] is True
    assert body["added_distance_km"] is None


def test_viewer_can_call_preview_endpoints_but_not_write(auth_client, db_session, make_user):
    """[Gate #32] previewは閲覧系のためviewerでも呼べる(書き込みではない)。"""
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    client, owner = auth_client
    plan_id = _create_plan(client)
    day_id = _create_day(client, plan_id)

    viewer, _ = make_user(email="viewer_map@example.com")
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "viewer_map@example.com", "role": "viewer"},
    )
    collab_id = res.json()["id"]

    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    accept = client.post(f"/api/v1/travel-plans/invitations/{collab_id}/accept")
    assert accept.status_code == 200

    res = client.get(f"/api/v1/plans/{plan_id}/days/{day_id}/route-preview")
    assert res.status_code == 200

    res = client.post(f"/api/v1/plans/{plan_id}/days/{day_id}/insertion-preview", json={})
    assert res.status_code == 200

    app.dependency_overrides.pop(get_current_user, None)
