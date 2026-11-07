"""[Gate PlaceLookupJP] 場所の自動取得を複数の提供元から集める・住所から位置を探す(外へは送らない。応答は作り物)"""
import json

import httpx
import pytest

from app.services import dining
from app.services import place_info as pi
from app.services import place_lookup as pl

YAHOO_LOCAL = {"Feature": [{
    "Name": "都リゾート 奥志摩 アクアフォレスト", "Geometry": {"Type": "point", "Coordinates": "136.8701,34.2833"},
    "Property": {"Address": "三重県志摩市大王町船越3238-1", "Tel1": "0599-00-0000",
                 "Genre": [{"Code": "0301001", "Name": "ホテル"}],
                 "Detail": {"ZipCode": "5170604", "PcUrl1": "https://aqua.example/"},
                 "Station": [{"Name": "賢島", "Railway": "近鉄志摩線", "Time": "20"}]}}]}
RAKUTEN = {"hotels": [[
    {"hotelBasicInfo": {"hotelName": "都リゾート 奥志摩 アクアフォレスト", "postalCode": "517-0604", "address1": "三重県",
                        "address2": "志摩市大王町船越3238-1", "telephoneNo": "0599-00-0000", "latitude": 34.2832,
                        "longitude": 136.8702, "hotelInformationUrl": "https://travel.rakuten.example/HOTEL/1/1.html",
                        "parkingInformation": "無料 100台", "access": "賢島港から船で", "nearestStation": "賢島"}},
    {"hotelDetailInfo": {"checkinTime": "15:00", "checkoutTime": "11:00"}},
]]}
HOTPEPPER = {"results": {"shop": [{
    "name": "炭火焼 てしま", "address": "石川県金沢市片町1-1-1", "lat": 36.56, "lng": 136.65,
    "genre": {"name": "焼肉・ホルモン"}, "sub_genre": {"name": "居酒屋"}, "budget": {"name": "3001～4000円"},
    "open": "月～土: 17:00～23:00", "close": "日", "parking": "あり ：近隣にコインパーキング", "card": "利用可",
    "non_smoking": "全面禁煙", "private_room": "あり", "capacity": 40, "lunch": "なし", "wifi": "あり",
    "child": "お子様連れOK", "access": "片町バス停から徒歩2分", "urls": {"pc": "https://www.hotpepper.example/strJ1/"}}]}}
OSM_KENROKUEN = [{"lat": "36.5621", "lon": "136.6627", "name": "兼六園", "category": "leisure", "type": "park",
                  "osm_type": "way", "osm_id": 1, "display_name": "兼六園, 金沢市, 石川県, 920-0936, 日本",
                  "address": {"country_code": "jp"}, "extratags": {"wikidata": "Q1067542"}}]
WIKIDATA = {"entities": {"Q1067542": {"claims": {
    "P856": [{"mainsnak": {"datavalue": {"value": "https://www.pref.ishikawa.jp/siro-niwa/kenrokuen/"}}}]}}}}


@pytest.fixture()
def fake(monkeypatch):
    pl.reset()
    pi.reset()
    calls = []
    bodies = {"map.yahooapis.jp/search": YAHOO_LOCAL, "openapi.rakuten.co.jp": RAKUTEN,
              "webservice.recruit.co.jp": HOTPEPPER, "nominatim": [],
              "www.wikidata.org": WIKIDATA,
              "mreversegeocoder.gsi.go.jp": {"results": {"muniCd": "17201", "lv01Nm": "兼六町"}},
              "msearch.gsi.go.jp": [{"geometry": {"coordinates": [136.87, 34.28]},
                                     "properties": {"title": "三重県志摩市大王町船越"}}],
              "map.yahooapis.jp/geocode": {"Feature": []},
              "map.yahooapis.jp/geoapi": {"Feature": [{"Property": {"Address": "石川県金沢市兼六町1"}}]}}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        calls.append(request)
        for k, v in bodies.items():
            if k in url:
                return httpx.Response(200, content=json.dumps(v).encode())
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(pl, "transport", transport)
    real = httpx.AsyncClient
    monkeypatch.setattr(pi.httpx, "AsyncClient", lambda *a, **kw: real(transport=transport))
    monkeypatch.setattr(pi, "MIN_INTERVAL", 0.0)
    state = {"keys": {pl.SLOT_YAHOO: "y-client-id-1234", pl.SLOT_RAKUTEN_ID: "r-app-id-1234",
                      pl.SLOT_RAKUTEN_KEY: "r-access-key-1234", pl.SLOT_HOTPEPPER: "hp-key-1234"}}
    monkeypatch.setattr(pl, "keys", lambda db: dict(state["keys"]))
    yield calls, bodies, state
    pl.reset()
    pi.reset()


def test_hotel_merges_yahoo_and_rakuten(auth_client, fake):
    client, _ = auth_client
    calls, _bodies, _ = fake
    r = client.post("/api/v1/spots/place-info", json={"name": "都リゾート 奥志摩 アクアフォレスト"})
    assert r.status_code == 200, r.text
    body = r.json()
    c = body["candidates"][0]
    assert c["address"] == "〒517-0604 三重県志摩市大王町船越3238-1"
    assert c["phone"] == "0599-00-0000" and c["category"] == "accommodation"
    assert c["website"] == "https://aqua.example/"
    assert {"url": "https://travel.rakuten.example/HOTEL/1/1.html", "label": "楽天トラベル(予約)"} in c["links"]
    assert "チェックイン 15:00〜 / チェックアウト 〜11:00" in c["notes"]
    assert set(c["providers"]) >= {"yahoo_local", "rakuten_travel"}
    credits = {s["provider"]: s["credit"] for s in body["sources"]}
    assert credits["yahoo_local"] == "Webサービス by Yahoo! JAPAN" and "rakuten_travel" in credits
    rak = next(x for x in calls if "rakuten" in str(x.url))
    assert rak.headers["accesskey"] == "r-access-key-1234" and rak.url.params["searchField"] == "1"


def test_restaurant_from_hotpepper_fills_dining(auth_client, fake):
    client, _ = auth_client
    _calls, bodies, state = fake
    bodies["map.yahooapis.jp/search"] = {"Feature": []}
    bodies["openapi.rakuten.co.jp"] = {}
    c = client.post("/api/v1/spots/place-info", json={"name": "炭火焼 てしま"}).json()["candidates"][0]
    assert c["category"] == "dining" and c["address"] == "石川県金沢市片町1-1-1"
    d = c["dining"]
    assert d["genres"] == ["yakiniku", "izakaya"] and d["budget_dinner"] == "3000_5000"
    assert d["parking"] == "yes" and d["parking_note"] == "近隣にコインパーキング" and d["payment"] == ["card"]
    assert d["smoking"] == "no" and d["private_room"] is True and d["seats"] == 40
    assert set(d["features"]) == {"wifi", "kids"} and d["closed"] == "日"


def test_without_keys_osm_address_is_completed_by_gsi_and_wikidata(auth_client, fake):
    client, _ = auth_client
    calls, bodies, state = fake
    state["keys"] = {k: None for k in state["keys"]}
    bodies["nominatim"] = OSM_KENROKUEN
    body = client.post("/api/v1/spots/place-info", json={"name": "兼六園"}).json()
    c = body["candidates"][0]
    assert c["address"] == "〒920-0936 石川県金沢市兼六町"
    assert c["website"] == "https://www.pref.ishikawa.jp/siro-niwa/kenrokuen/"
    assert body["keyed_providers"] == []
    assert not any("yahooapis" in str(x.url) or "rakuten" in str(x.url) for x in calls)  # 鍵が無ければ送らない


def test_with_yahoo_reverse_address_reaches_house_number(auth_client, fake):
    client, _ = auth_client
    _calls, bodies, state = fake
    state["keys"] = {k: None for k in state["keys"]} | {pl.SLOT_YAHOO: "y-client-id-1234"}
    bodies["map.yahooapis.jp/search"] = {"Feature": []}
    bodies["nominatim"] = OSM_KENROKUEN
    c = client.post("/api/v1/spots/place-info", json={"name": "兼六園"}).json()["candidates"][0]
    assert c["address"] == "〒920-0936 石川県金沢市兼六町1"


def test_geocode_uses_gsi_without_key_and_yahoo_first_with_key(auth_client, fake):
    client, _ = auth_client
    calls, bodies, state = fake
    state["keys"] = {k: None for k in state["keys"]}
    r = client.post("/api/v1/spots/geocode", json={"query": "〒517-0604 三重県志摩市大王町船越3238-1"}).json()
    c = r["candidates"][0]
    assert (c["latitude"], c["longitude"], c["provider"]) == (34.28, 136.87, "gsi")
    assert calls[-1].url.params["q"] == "三重県志摩市大王町船越3238-1"
    state["keys"][pl.SLOT_YAHOO] = "y-client-id-1234"
    bodies["map.yahooapis.jp/geocode"] = {"Feature": [{"Name": "x", "Geometry": {"Coordinates": "136.8702,34.2832"},
                                                       "Property": {"Address": "三重県志摩市大王町船越3238-1"}}]}
    pl.reset()
    c2 = client.post("/api/v1/spots/geocode", json={"query": "三重県志摩市大王町船越3238-1"}).json()["candidates"][0]
    assert c2["provider"] == "yahoo_local" and c2["latitude"] == 34.2832


def test_enrich_upgrades_city_only_address(auth_client, fake):
    client, _ = auth_client
    _calls, bodies, state = fake
    state["keys"] = {k: None for k in state["keys"]}
    bodies["nominatim"] = OSM_KENROKUEN
    s = client.post("/api/v1/spots/", json={"name": "兼六園", "address": "〒920-0936 石川県金沢市",
                                            "latitude": 36.5621, "longitude": 136.6627}).json()
    r = client.post(f"/api/v1/spots/{s['id']}/enrich").json()
    assert "address" in r["filled"] and r["spot"]["address"] == "〒920-0936 石川県金沢市兼六町"
    assert r["spot"]["urls"][0]["url"] == "https://www.pref.ishikawa.jp/siro-niwa/kenrokuen/"
    s2 = client.post("/api/v1/spots/", json={"name": "兼六園", "address": "自分の住所", "latitude": 36.5621,
                                             "longitude": 136.6627}).json()
    assert client.post(f"/api/v1/spots/{s2['id']}/enrich").json()["spot"]["address"] == "自分の住所"


def test_helpers():
    assert pl.address_detail("〒920-0936 石川県金沢市") == 1
    assert pl.address_detail("石川県金沢市兼六町") == 2
    assert pl.address_detail("石川県金沢市兼六町1") == 3
    assert pl.address_detail("三重県志摩郡大王町船越3238") == 3
    assert pl.name_score("都リゾート 奥志摩 アクアフォレスト", "都リゾート奥志摩アクアフォレスト") == 1.0
    assert pl.name_score("兼六園", "ひがし茶屋街") < 0.45
    assert pl.category_from_text("旅館") == "accommodation" and pl.category_from_text("ラーメン") == "dining"
    assert dining.genres_from_text("ハンバーガー") == ["burger"]
    assert dining.genres_from_text("ジャパニーズダイニング 和食") == ["washoku"]
    assert dining.budget_key("～1000円") == "u1000" and dining.budget_key("10001～15000円") == "10000_20000"
