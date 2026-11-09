"""[Gate PlaceTripArea] 自動取得の精度: 旅行の目的地を手がかりにする・住所に道路の名前や推定の郵便番号を入れない・
町名は国土地理院で正す。外へは送らない(2026-11-09 に実際に取った返事を fixtures に保存して使う)"""
import json
import pathlib
import urllib.parse

import httpx
import pytest

from app.models.models import TravelPlan
from app.services import place_info as pi
from app.services import place_lookup as pl

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "place_trip_area_real.json"
REAL = json.loads(FIXTURE.read_text(encoding="utf-8"))
NO_KEYS = {pl.SLOT_YAHOO: None, pl.SLOT_RAKUTEN_ID: None, pl.SLOT_RAKUTEN_KEY: None, pl.SLOT_HOTPEPPER: None}


def _nominatim(q: str, bounded: str) -> list:
    for row in REAL["nominatim"]:
        if row["q"] == q and (row["bounded"] or "0") == (bounded or "0"):
            return row["body"]
    for row in REAL["nominatim"]:  # 範囲を限らない返事しか取っていない言葉
        if row["q"] == q:
            return row["body"]
    return []


def _gsi(lat: float, lng: float) -> dict:
    for key, town in REAL["gsi_reverse"].items():
        a, b = (float(x) for x in key.split(","))
        if abs(a - lat) < 0.01 and abs(b - lng) < 0.01:
            return {"results": {"muniCd": "00000", "lv01Nm": town}}
    return {"results": {"muniCd": "00000", "lv01Nm": "－"}}


@pytest.fixture()
def real(monkeypatch):
    pl.reset()
    pi.reset()
    calls: list = []
    state = {"gsi": "ok"}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        host = request.url.host
        params = dict(urllib.parse.parse_qsl(request.url.query.decode()))
        if host == "nominatim.openstreetmap.org":
            return httpx.Response(200, json=_nominatim(params.get("q", ""), params.get("bounded", "0")))
        if host == "mreversegeocoder.gsi.go.jp":
            if state["gsi"] == "down":
                raise httpx.ReadTimeout("gsi down", request=request)
            return httpx.Response(200, json=_gsi(float(params["lat"]), float(params["lon"])))
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient
    monkeypatch.setattr(pl, "transport", transport)
    monkeypatch.setattr(pi.httpx, "AsyncClient", lambda *a, **kw: real_client(transport=transport))
    monkeypatch.setattr(pi, "MIN_INTERVAL", 0.0)
    monkeypatch.setattr(pl, "keys", lambda db: dict(NO_KEYS))
    yield calls, state
    pl.reset()
    pi.reset()


def _plan(client, destination="三重県鳥羽市", title="鳥羽・1泊2日の旅程案"):
    return client.post("/api/v1/travel-plans/", json={"title": title, "destination": destination}).json()["id"]


def test_address_has_no_road_name_or_estimated_postcode():
    # 実際の返事: 近江町市場 は road=下堤町【百万石通り】・neighbourhood=彦三町二丁目(別の町)・postcode=920-0907
    item = _nominatim("近江町市場", "0")[0]
    assert pi.jp_address(item) == "石川県金沢市下堤町"
    # 番地らしい数字は町名がある時だけ(「鳥羽市6」にしない)
    assert pi.jp_address({"display_name": "鳥羽水族館, 6, 鳥羽市, 三重県, 517-8517, 日本", "name": "鳥羽水族館",
                          "address": {"tourism": "鳥羽水族館", "house_number": "6", "administrative": "鳥羽市",
                                      "province": "三重県", "postcode": "517-8517", "country_code": "jp"}}) == "三重県鳥羽市"
    # 項目ごとの住所に町名が無い時は表示名の町名を使う
    assert pi.jp_address({"display_name": "兼六園, 兼六町, 金沢市, 石川県, 920-0936, 日本", "name": "兼六園",
                          "address": {"park": "兼六園", "city": "金沢市", "province": "石川県", "postcode": "920-0936",
                                      "country_code": "jp"}}) == "石川県金沢市兼六町"


def test_station_name_gets_eki():
    rows = [pi._row(i) for i in _nominatim("鳥羽駅", "0")]
    assert rows[0]["name"] == "鳥羽駅" and rows[0]["category"] == "transportation"


def test_with_town_and_wikidata_head():
    assert pl.with_town("三重県伊勢市本町", "豊川町") == "三重県伊勢市豊川町"
    # 番地は元の町名が同じ時だけ残す
    assert pl.with_town("三重県伊勢市二見町江575", "二見町江") == "三重県伊勢市二見町江575"
    assert pl.with_town("三重県鳥羽市坂手町12", "鳥羽一丁目") == "三重県鳥羽市鳥羽一丁目"
    assert pl.with_town("〒920-0936 石川県金沢市", "兼六町") == "〒920-0936 石川県金沢市兼六町"
    assert pl.with_town("金沢市", "兼六町") is None
    # Wikidata の県・市の無い住所には今の住所の県・市を付ける。県の違う住所は使わない
    assert pl._with_area_head("北大河原殿田102", "京都府相楽郡南山城村今山") == "京都府相楽郡南山城村北大河原殿田102"
    assert pl._with_area_head("三重県伊勢市豊川町", "三重県伊勢市本町") == "三重県伊勢市豊川町"
    assert pl._with_area_head("東京都港区1-1", "三重県伊勢市本町") is None
    assert pl._with_area_head("北大河原殿田102", None) is None


def test_area_queries_from_destination_or_title():
    assert pl.area_queries("三重県鳥羽市", "x") == ["三重県鳥羽市"]
    assert pl.area_queries("鳥羽・伊勢", None) == ["鳥羽・伊勢", "鳥羽"]
    assert pl.area_queries(None, "鳥羽・1泊2日の旅程案") == ["鳥羽"]
    assert pl.area_queries("", "") == []


def test_trip_destination_finds_near_place_instead_of_far_namesake(auth_client, real):
    """「夫婦岩」は日本全体だと福井県・高知県・長野県だけが返る(実際の返事)。旅行先(鳥羽市)の周りで探し直す"""
    client, _ = auth_client
    calls, _ = real
    plan_id = _plan(client)
    without = client.post("/api/v1/spots/place-info", json={"name": "夫婦岩"}).json()
    assert without["candidates"][0]["address"].startswith("福井県") and without["area"] is None

    pl.reset()
    pi.reset()
    r = client.post("/api/v1/spots/place-info", json={"name": "夫婦岩", "plan_id": plan_id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["area"] == {"label": "鳥羽市", "prefecture": "三重県"}
    names = [c["name"] for c in body["candidates"]]
    assert names and all(c["address"].startswith("三重県") for c in body["candidates"])
    assert any("夫婦岩" in n for n in names)
    # 候補を選ぶ手がかり: 旅行先からの距離・名前の合い方・住所の細かさ
    top = body["candidates"][0]
    assert top["distance_km"] is not None and top["distance_km"] < 40
    assert 0 < top["name_match"] <= 1 and top["address_level"] >= 2
    sent = [(c.url.host, dict(urllib.parse.parse_qsl(c.url.query.decode())).get("bounded")) for c in calls]
    assert ("nominatim.openstreetmap.org", "1") in sent  # 旅行先の周りだけで探し直した
    assert all("countrycodes=jp" in str(c.url) for c in calls if c.url.host == "nominatim.openstreetmap.org")


def test_far_place_is_kept_when_nothing_near(auth_client, real):
    """行き道の道の駅(京都府)は旅行先(鳥羽市)の外でも消さない。Wikidata の住所が無い時は OSM の県・市のまま"""
    client, _ = auth_client
    plan_id = _plan(client)
    body = client.post("/api/v1/spots/place-info",
                       json={"name": "道の駅 お茶の京都 みなみやましろ村", "plan_id": plan_id}).json()
    c = body["candidates"][0]
    assert c["name"] == "道の駅 お茶の京都 みなみやましろ村" and c["address"].startswith("京都府相楽郡南山城村")
    assert c["distance_km"] > 50


def test_partial_name_near_trip_is_found(auth_client, real):
    """「ミキモト真珠島」は OSM では「真珠島」。旅行先が分かる時は、名前の一部だけでも旅行先の近くなら出す"""
    client, _ = auth_client
    plan_id = _plan(client)
    assert client.post("/api/v1/spots/place-info", json={"name": "ミキモト真珠島"}).json()["candidates"] == []
    pl.reset()
    pi.reset()
    body = client.post("/api/v1/spots/place-info", json={"name": "ミキモト真珠島", "plan_id": plan_id}).json()
    assert body["candidates"][0]["name"] == "真珠島" and body["candidates"][0]["address"].startswith("三重県鳥羽市")


def test_town_is_corrected_by_gsi_and_gsi_outage_is_short(auth_client, real):
    client, _ = auth_client
    calls, state = real
    body = client.post("/api/v1/spots/place-info", json={"name": "伊勢神宮 外宮"}).json()
    c = body["candidates"][0]
    # OSM の点は「本町」の区域だが、国土地理院の町名は 豊川町(外宮の本当の住所 伊勢市豊川町)
    assert c["address"] == "三重県伊勢市豊川町" and "gsi" in c["providers"]
    # 国土地理院が答えない時は OSM の町名のまま。続けて呼ばない(しばらく休む)
    pl.reset()
    pi.reset()
    state["gsi"] = "down"
    first = client.post("/api/v1/spots/place-info", json={"name": "伊勢神宮 外宮"}).json()
    assert first["candidates"][0]["address"] == "三重県伊勢市本町"
    pi.reset()
    gsi_before = sum(1 for c in calls if c.url.host == "mreversegeocoder.gsi.go.jp")
    second = client.post("/api/v1/spots/place-info", json={"name": "伊勢神宮 外宮"}).json()
    assert second["candidates"][0]["address"] == "三重県伊勢市本町"
    assert sum(1 for c in calls if c.url.host == "mreversegeocoder.gsi.go.jp") == gsi_before


def test_point_or_address_prefecture_wins_over_trip(auth_client, real):
    """予定の位置・住所の都道府県がある時は、旅行先を探しに行かない(今まで通り)"""
    client, _ = auth_client
    calls, _ = real
    plan_id = _plan(client)
    client.post("/api/v1/spots/place-info", json={"name": "兼六園", "plan_id": plan_id, "address": "石川県金沢市"})
    client.post("/api/v1/spots/place-info", json={"name": "兼六園", "plan_id": plan_id,
                                                  "latitude": 36.56, "longitude": 136.66})
    qs = [dict(urllib.parse.parse_qsl(c.url.query.decode())).get("q") for c in calls]
    assert "三重県鳥羽市" not in qs


def test_plan_of_other_user_is_refused(auth_client, real, make_user, db_session):
    client, _ = auth_client
    other, _pw = make_user()
    plan = TravelPlan(user_id=other.id, title="他人の旅行", destination="三重県鳥羽市")
    db_session.add(plan)
    db_session.flush()
    r = client.post("/api/v1/spots/place-info", json={"name": "夫婦岩", "plan_id": str(plan.id)})
    assert r.status_code in (403, 404)
    g = client.post("/api/v1/spots/geocode", json={"query": "鳥羽1-1", "plan_id": str(plan.id)})
    assert g.status_code in (403, 404)
