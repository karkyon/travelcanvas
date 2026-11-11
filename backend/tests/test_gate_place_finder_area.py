"""[Gate PlaceFinderArea] 予定の追加の「名前で検索」: 言葉とジャンルで、この旅行の範囲・経路の近く・全国から探す。
外へは送らない(Yahoo!ローカルサーチ・ホットペッパーの返事を差し替える)"""
import urllib.parse
import uuid

import httpx
import pytest

from app.services import place_finder as pf
from app.services import place_info as pi
from app.services import place_lookup as pl

KOMONO = (35.0186, 136.5137)   # 菰野町
YUNOYAMA = (35.0157, 136.4524)  # 湯の山温泉
TOBA = (34.4815, 136.8431)     # 鳥羽


def _feature(name, lat, lng, genre, address):
    return {"Name": name, "Geometry": {"Coordinates": f"{lng},{lat}"},
            "Property": {"Address": address, "Genre": [{"Name": genre}]}}


YAHOO = [
    _feature("湯の山カフェ", 35.0150, 136.4600, "カフェ", "三重県三重郡菰野町菰野8500"),
    _feature("菰野ベーカリーカフェ", 35.0200, 136.5100, "カフェ", "三重県三重郡菰野町菰野1"),
    _feature("鳥羽の海カフェ", 34.4820, 136.8400, "カフェ", "三重県鳥羽市鳥羽1"),
    _feature("東京のカフェ", 35.68, 139.76, "カフェ", "東京都千代田区丸の内1"),
]


def _latlng(f):
    lng, lat = (float(x) for x in f["Geometry"]["Coordinates"].split(","))
    return (lat, lng)


HOTPEPPER = {"results": {"shop": [
    {"name": "菰野ベーカリーカフェ", "lat": "35.0201", "lng": "136.5101", "address": "三重県三重郡菰野町菰野1",
     "genre": {"name": "カフェ・スイーツ"}},
]}}


@pytest.fixture()
def fake(monkeypatch):
    pl.reset()
    pi.reset()
    calls: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        params = dict(urllib.parse.parse_qsl(request.url.query.decode()))
        if request.url.host == "map.yahooapis.jp":
            feats = YAHOO
            if "lat" in params:
                at = (float(params["lat"]), float(params["lon"]))
                feats = [f for f in YAHOO if pf.km(at, _latlng(f)) <= float(params["dist"])]
            return httpx.Response(200, json={"Feature": feats})
        if request.url.host == "webservice.recruit.co.jp":
            return httpx.Response(200, json=HOTPEPPER)
        return httpx.Response(404)

    monkeypatch.setattr(pl, "transport", httpx.MockTransport(handler))
    keys = {pl.SLOT_YAHOO: "y", pl.SLOT_RAKUTEN_ID: None, pl.SLOT_RAKUTEN_KEY: None, pl.SLOT_HOTPEPPER: "h"}
    monkeypatch.setattr(pl, "keys", lambda db: dict(keys))
    yield calls
    pl.reset()


def test_region_area_and_route():
    r = pf.region_of([KOMONO, YUNOYAMA], "area")
    assert r["scope"] == "area" and 5 <= r["radius_km"] <= 10
    route = pf.region_of([KOMONO, TOBA], "route")
    assert route["scope"] == "route" and len(route["query_points"]) <= pf.MAX_POINTS
    # 経路の線から 5km 以内か
    mid = ((KOMONO[0] + TOBA[0]) / 2, (KOMONO[1] + TOBA[1]) / 2)
    assert pf.distance_in(route, *mid) < 0.5
    assert pf.distance_in(route, 35.68, 139.76) > 200
    assert pf.region_of([], "area") is None and pf.region_of([KOMONO], "all") is None


def _plan(client, points):
    p = client.post("/api/v1/travel-plans/", json={"title": "菰野・鳥羽", "destination": "三重県"}).json()["id"]
    day = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"},
                      headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    for i, (lat, lng) in enumerate(points):
        client.post(f"/api/v1/plans/{p}/events",
                    json={"day_id": day["id"], "title": f"予定{i}", "latitude": lat, "longitude": lng},
                    headers={"Idempotency-Key": str(uuid.uuid4())})
    return p


def test_find_places_in_trip_area_with_genre(auth_client, fake):
    client, _owner = auth_client
    p = _plan(client, [KOMONO, YUNOYAMA])
    r = client.post("/api/v1/spots/find-places", json={"plan_id": p, "query": "菰野", "genre": "cafe", "scope": "area"})
    assert r.status_code == 200, r.text
    body = r.json()
    names = [c["name"] for c in body["candidates"]]
    assert names == ["湯の山カフェ", "菰野ベーカリーカフェ"]  # 範囲の外(鳥羽・東京)は出さない。真ん中から近い順
    assert body["candidates"][1]["providers"] == ["yahoo_local", "hotpepper"]  # 同じ店はまとめる
    assert body["candidates"][0]["genre_label"] == "カフェ" and body["region"]["label"].startswith("この旅行の範囲")
    sent = [dict(urllib.parse.parse_qsl(c.url.query.decode())) for c in fake]
    assert any(s.get("query") == "菰野 カフェ" for s in sent)  # 言葉とジャンルで探す
    # 経路の近く: 菰野 → 鳥羽 の線の近く(鳥羽のカフェも入る)
    p2 = _plan(client, [KOMONO, TOBA])
    names = [c["name"] for c in client.post("/api/v1/spots/find-places", json={
        "plan_id": p2, "query": "", "genre": "cafe", "scope": "route"}).json()["candidates"]]
    assert "鳥羽の海カフェ" in names and "東京のカフェ" not in names
    # 全国
    names = [c["name"] for c in client.post("/api/v1/spots/find-places", json={
        "plan_id": p, "query": "カフェ", "genre": "all", "scope": "all"}).json()["candidates"]]
    assert "東京のカフェ" in names


def test_find_places_validation(auth_client, fake):
    client, _owner = auth_client
    p = _plan(client, [KOMONO])
    url = "/api/v1/spots/find-places"
    assert client.post(url, json={"plan_id": p, "query": "", "genre": "all"}).status_code == 422
    assert client.post(url, json={"plan_id": p, "query": "x", "genre": "nope"}).status_code == 422
