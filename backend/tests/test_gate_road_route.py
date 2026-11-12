"""[Gate RoadRoute] 地図の「道に沿った経路」(OSRM)。

- 車・歩きの区間は OSRM の道の線(kind=road)を返す。電車・飛行機・船は直線(道を引かない)
- 設定が空(既定)・届かない時は全部直線(provider=none / 架空の道を作らない)
- 送り先は設定の URL だけ。座標の順は OSRM の決まり(経度,緯度)
- 同じ区間は使い回す(2回目は送らない)
- 旅行のメンバーでない人には返さない
"""
import httpx
import pytest

from app.core.config import settings
from app.services import osrm_router


def _plan(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "道の経路"})
    assert res.status_code == 201
    return res.json()["id"]


LEGS = [
    {"from_lat": 34.4551, "from_lng": 136.7258, "to_lat": 34.4622, "to_lng": 136.7232, "mode": "walking"},
    {"from_lat": 34.4622, "from_lng": 136.7232, "to_lat": 34.4870, "to_lng": 136.8430, "mode": "driving"},
    {"from_lat": 34.4870, "from_lng": 136.8430, "to_lat": 35.0116, "to_lng": 135.7681, "mode": "train"},
]


@pytest.fixture
def osrm(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if "bad" in str(request.url.host):
            return httpx.Response(500)
        return httpx.Response(200, json={"code": "Ok", "routes": [{
            "distance": 1234.0, "duration": 600.0,
            "geometry": {"type": "LineString",
                         "coordinates": [[136.7258, 34.4551], [136.7250, 34.4590], [136.7232, 34.4622]]},
        }]})

    monkeypatch.setattr(settings, "OSRM_CAR_URL", "http://osrm-car:5000")
    monkeypatch.setattr(settings, "OSRM_FOOT_URL", "http://osrm-foot:5000/")
    osrm_router.set_transport(httpx.MockTransport(handler))
    yield calls
    osrm_router.set_transport(None)


def test_profile_for_modes():
    assert osrm_router.profile_for("walking") == "foot"
    assert osrm_router.profile_for("bicycle") == "foot"
    for m in ("driving", "taxi", "bus", "express_bus"):
        assert osrm_router.profile_for(m) == "car"
    for m in ("train", "shinkansen", "flight", "ferry", "helicopter", "unknown"):
        assert osrm_router.profile_for(m) is None


def test_road_legs_from_osrm_and_straight_for_train(auth_client, osrm):
    client, _user = auth_client
    plan_id = _plan(client)
    res = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": LEGS})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provider"] == "osrm" and body["available"] is True
    walk, car, train = body["legs"]
    assert walk["kind"] == "road" and walk["profile"] == "foot"
    assert walk["coordinates"][0] == [34.4551, 136.7258]  # [lat, lng] に直して返す
    assert walk["distance_km"] == 1.23 and walk["duration_minutes"] == 10.0
    assert car["kind"] == "road" and car["profile"] == "car"
    assert train["kind"] == "straight" and train["coordinates"] == [[34.487, 136.843], [35.0116, 135.7681]]
    # 送り先は設定の URL だけ。経度,緯度の順
    assert len(osrm) == 2
    assert osrm[0].startswith("http://osrm-foot:5000/route/v1/foot/136.725800,34.455100;136.723200,34.462200")
    assert osrm[1].startswith("http://osrm-car:5000/route/v1/driving/")
    # 2回目は使い回す(送らない)
    res2 = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": LEGS})
    assert res2.status_code == 200
    assert len(osrm) == 2


def test_failure_falls_back_to_straight(auth_client, osrm, monkeypatch):
    client, _user = auth_client
    plan_id = _plan(client)
    monkeypatch.setattr(settings, "OSRM_CAR_URL", "http://bad-osrm:5000")
    res = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": LEGS[1:2]})
    assert res.status_code == 200
    leg = res.json()["legs"][0]
    assert leg["kind"] == "straight" and len(leg["coordinates"]) == 2


def test_not_configured_returns_straight(auth_client, monkeypatch):
    client, _user = auth_client
    plan_id = _plan(client)
    monkeypatch.setattr(settings, "OSRM_CAR_URL", "")
    monkeypatch.setattr(settings, "OSRM_FOOT_URL", "")
    res = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": LEGS})
    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "none" and body["available"] is False
    assert all(leg["kind"] == "straight" for leg in body["legs"])


def test_rejects_too_many_legs_and_bad_coords(auth_client):
    client, _user = auth_client
    plan_id = _plan(client)
    res = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": [LEGS[0]] * 61})
    assert res.status_code == 422
    bad = dict(LEGS[0], from_lat=123)
    res = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": [bad]})
    assert res.status_code == 422


def test_other_user_cannot_use(auth_client, make_user):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app

    client, _owner = auth_client
    plan_id = _plan(client)
    stranger, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=stranger, is_authenticated=True, is_guest=False)
    res = client.post(f"/api/v1/plans/{plan_id}/route-geometry", json={"legs": LEGS})
    assert res.status_code in (403, 404)


def test_thin_limits_points():
    pts = [[float(i), float(i)] for i in range(1000)]
    out = osrm_router._thin(pts)
    assert len(out) == osrm_router.MAX_POINTS and out[0] == pts[0] and out[-1] == pts[-1]
