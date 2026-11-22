"""[FR-062] ♡ 今度行きたいに残す(どこからでも)・近くの候補・種類で絞る・取り消し。

詳細設計 DD-2026-11-22-01 §5。
"""

import logging
import uuid

from app.api.v1 import spots as spots_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import Spot
from app.services import search_provider as sp
from app.services import wishes


def _quick(client, **kw):
    body = {"name": "赤福 本店", "latitude": 34.4622, "longitude": 136.7253, "client_id": uuid.uuid4().hex}
    body.update(kw)
    return client.post("/api/v1/spots/quick", json=body)


def test_quick_creates_private_next_wish(auth_client, db_session):
    client, user = auth_client
    res = _quick(client, wish_note="時間がなくて行けず", wish_when="next_trip", genre="restaurant")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["created"] is True and body["merged_into"] is None
    s = body["spot"]
    assert s["wish_kind"] == "next" and s["wish_scope"] == "place" and s["source_kind"] == "quick"
    assert s["wish_note"] == "時間がなくて行けず" and s["wish_when"] == "next_trip"
    assert s["category"] == "restaurant" and s["is_public"] is False and s["again_count"] == 0


def test_same_client_id_twice_is_one_row(auth_client, db_session):
    client, user = auth_client
    cid = uuid.uuid4().hex
    a = _quick(client, client_id=cid)
    b = _quick(client, client_id=cid)
    assert a.status_code == 201 and b.status_code == 200
    assert b.json()["created"] is False and b.json()["spot"]["id"] == a.json()["spot"]["id"]
    assert db_session.query(Spot).filter(Spot.created_by == user.id).count() == 1


def test_same_place_within_100m_is_not_created_and_again_counts(auth_client, db_session):
    client, user = auth_client
    first = _quick(client).json()["spot"]
    # 名前の書き方の違い(全角・空白)と 50m のずれは同じ場所
    res = _quick(client, name="赤福　本店", latitude=34.4626, longitude=136.7253, wish_kind="again")
    assert res.status_code == 200
    body = res.json()
    assert body["created"] is False and body["merged_into"] == first["id"]
    assert body["spot"]["wish_kind"] == "again" and body["spot"]["again_count"] == 1
    assert body["previous"] == {
        "wish_kind": "next",
        "again_count": 0,
        "wish_note": None,
        "wish_when": None,
        "last_visited_at": None,
    }
    again = _quick(client, wish_kind="again").json()
    assert again["spot"]["again_count"] == 2
    # 1km 離れた同じ名前は別の場所
    far = _quick(client, latitude=34.4712, longitude=136.7253)
    assert far.status_code == 201
    assert db_session.query(Spot).filter(Spot.created_by == user.id).count() == 2


def test_name_only_matches_by_name(auth_client, db_session):
    client, user = auth_client
    a = _quick(client, name="おかげ横丁", latitude=None, longitude=None)
    b = _quick(client, name="おかげ横丁", latitude=None, longitude=None)
    assert a.status_code == 201 and b.status_code == 200


def test_undo_restores_previous_values_by_patch(auth_client, db_session):
    client, user = auth_client
    first = _quick(client).json()["spot"]
    merged = _quick(client, wish_kind="again").json()
    prev = merged["previous"]
    res = client.patch(
        f"/api/v1/spots/{first['id']}", json={"wish_kind": prev["wish_kind"], "again_count": prev["again_count"]}
    )
    assert res.status_code == 200, res.text
    assert res.json()["wish_kind"] == "next" and res.json()["again_count"] == 0
    # 作った時の取り消しは削除
    created = _quick(client, name="別の場所").json()["spot"]
    assert client.delete(f"/api/v1/spots/{created['id']}").status_code == 200


def test_source_plan_label_only_for_own_plans(auth_client, make_user, db_session):
    client, user = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢・おかげ横丁の旅"}).json()["id"]
    res = _quick(client, source_kind="today", source_plan_id=p)
    assert res.json()["spot"]["source_label"] == "伊勢・おかげ横丁の旅"
    assert res.json()["spot"]["source_plan_id"] == p
    # 見られない旅行は結び付けない(名前を写さない)
    other, _ = make_user()
    from app.models.models import TravelPlan

    tp = TravelPlan(id=uuid.uuid4(), title="他人の旅", user_id=other.id)
    db_session.add(tp)
    db_session.commit()
    res = _quick(client, name="別の店", source_plan_id=str(tp.id))
    assert res.status_code == 201
    assert res.json()["spot"]["source_label"] is None and res.json()["spot"]["source_plan_id"] is None


def test_validation(auth_client):
    client, _ = auth_client
    assert _quick(client, name="  ").status_code == 422
    assert _quick(client, name="x" * 201).status_code == 422
    assert _quick(client, latitude=34.0, longitude=None).status_code == 422
    assert _quick(client, wish_kind="maybe").status_code == 422
    assert _quick(client, client_id="bad id!").status_code == 422
    assert _quick(client, unknown="x").status_code == 422


def test_guest_cannot_quick_save(client, make_user):
    user, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=True)
    try:
        res = _quick(client)
        assert res.status_code in (401, 403)
        assert client.get("/api/v1/spots/nearby-candidates", params={"lat": 34.46, "lng": 136.72}).status_code in (
            401,
            403,
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_quick_rate_limit(auth_client, monkeypatch):
    client, _ = auth_client
    monkeypatch.setattr(spots_api, "check_rate_limit", lambda key, limit, window: not key.startswith("spots_quick"))
    res = _quick(client)
    assert res.status_code == 429


def test_kind_filter_counts_legacy_rows_as_next(auth_client, db_session):
    client, user = auth_client
    db_session.add(Spot(name="今までの場所", created_by=user.id, category="other"))
    db_session.add(
        Spot(name="エリア", created_by=user.id, category="other", wish_scope="area", radius_m=400, wish_kind="again")
    )
    db_session.commit()
    _quick(client, name="今度の店")
    _quick(client, name="また行く店", wish_kind="again")

    def names(kind):
        return sorted(
            s["name"]
            for s in client.get("/api/v1/spots/", params={"mine": "true", "kind": kind, "limit": 100}).json()
        )

    assert names("next") == ["今までの場所", "今度の店"]
    assert names("again") == ["また行く店"]
    assert names("area") == ["エリア"]
    assert client.get("/api/v1/spots/", params={"kind": "bad"}).status_code == 422


def test_patch_wish_fields_and_owner_only(auth_client, make_user, db_session):
    client, user = auth_client
    s = _quick(client).json()["spot"]
    res = client.patch(
        f"/api/v1/spots/{s['id']}", json={"remind_nearby": True, "wish_when": "someday", "wish_note": "朝に行く"}
    )
    assert res.status_code == 200 and res.json()["remind_nearby"] is True and res.json()["wish_when"] == "someday"
    assert client.patch(f"/api/v1/spots/{s['id']}", json={"wish_when": "tomorrow"}).status_code == 422
    other, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    try:
        assert client.patch(f"/api/v1/spots/{s['id']}", json={"remind_nearby": False}).status_code == 403
        assert client.get(f"/api/v1/spots/{s['id']}").status_code == 403  # 本人だけのもの
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _fake_search(calls):
    async def fake(query, latitude, longitude, radius_km=5.0, category="all"):
        calls.append((query, latitude, longitude, radius_km, category))
        if category == "sightseeing":
            rows = [
                {
                    "name": "おかげ横丁",
                    "category": "sightseeing",
                    "latitude": latitude + 0.001,
                    "longitude": longitude,
                    "address": "伊勢市",
                },
                {"name": "遠い寺", "category": "temple", "latitude": latitude + 0.01, "longitude": longitude},
            ]
        else:
            rows = [
                {
                    "name": "赤福 本店",
                    "category": "restaurant",
                    "latitude": latitude,
                    "longitude": longitude + 0.0005,
                },
                {"name": "赤福本店", "category": "restaurant", "latitude": latitude, "longitude": longitude + 0.002},
                {"name": "名前なし", "category": "restaurant", "latitude": None, "longitude": None},
            ]
            rows += [
                {"name": f"店{i}", "category": "cafe", "latitude": latitude + 0.0001 * i, "longitude": longitude}
                for i in range(1, 10)
            ]
        return sp.ProviderResults(rows, [], ["overpass"])

    return fake


def test_nearby_candidates_rounds_position_and_returns_8_within_300m(auth_client, db_session, monkeypatch, caplog):
    client, user = auth_client
    calls = []
    monkeypatch.setattr(sp, "search_all_providers", _fake_search(calls))
    before = db_session.query(Spot).count()
    caplog.set_level(logging.DEBUG)
    res = client.get("/api/v1/spots/nearby-candidates", params={"lat": 34.462271987, "lng": 136.725388123})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [c[1:] for c in calls] == [(34.4623, 136.7254, 0.3, "sightseeing"), (34.4623, 136.7254, 0.3, "food")]
    assert len(body["results"]) == 8
    names = [r["name"] for r in body["results"]]
    assert "遠い寺" not in names and "名前なし" not in names
    assert names.count("赤福 本店") + names.count("赤福本店") == 1  # 同じ名前は近い方だけ
    dists = [r["distance_m"] for r in body["results"]]
    assert dists == sorted(dists) and max(dists) <= 300
    assert body["source"] == ["overpass"]
    assert db_session.query(Spot).count() == before  # 保存しない
    text = "\n".join(r.getMessage() for r in caplog.records)
    for v in ("34.4622", "136.7253", "34.4623", "136.7254"):
        assert v not in text  # 位置がログに残らない


def test_nearby_rate_limit_and_bad_position(auth_client, monkeypatch):
    client, _ = auth_client
    assert client.get("/api/v1/spots/nearby-candidates", params={"lat": 91, "lng": 0}).status_code == 422
    assert client.get("/api/v1/spots/nearby-candidates", params={"lat": 34}).status_code == 422
    monkeypatch.setattr(spots_api, "check_rate_limit", lambda key, limit, window: not key.startswith("spots_nearby"))
    assert client.get("/api/v1/spots/nearby-candidates", params={"lat": 34, "lng": 136}).status_code == 429


def test_normalize_and_category_helpers():
    assert (
        wishes.normalize_name("赤福　本店")
        == wishes.normalize_name("赤福本店")
        == wishes.normalize_name("赤福・本店")
    )
    assert wishes.normalize_name("ＡＢＣ Cafe") == "abccafe"
    assert wishes.category_of("cafe") == "restaurant" and wishes.category_of(None) == "other"
    assert wishes.category_of("temple") == "sightseeing"
    assert wishes.round_position(34.462271987, 136.725388123) == (34.4623, 136.7254)
