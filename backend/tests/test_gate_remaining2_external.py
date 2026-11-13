"""
[Gate Remaining-2] 無料の外部サービス(為替・気象警報・逆ジオコーディング・祝日)と、鍵が要る提供元の接続口。

検証する主な性質(外へは送らない。httpx.MockTransport で差し替える):
- 為替: ECB の参考値を出典・基準日つきで記録する。対応外の通貨は 422、取れない時は 503 で何も記録しない
- 逆ジオコーディング: 日本は国土地理院 → 市区町村コード → 気象庁の名前。外は Nominatim。座標は 0.01 度に丸めて送る
- 警報: 今日・明日の予定の場所の市区町村の発表中の警報・注意報だけ(解除は出さない)。取れない時は unavailable
- 運行情報・時刻表: 鍵が無い時は送らない(configured=false)。鍵がある時だけ旅程の路線の平常でない情報を返す
- 祝日: 日本は計算(振替休日・国民の休日)、外は Nager.Date
- Atlas: 区画を国・都道府県・市区町村にまとめる。1 回に調べる区画の数を抑える(残りは pending)
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app.api.v1 import finance as fin_api
from app.services import ext_http, holidays, jp_areas, reverse_geocode
from app.services import provider_secrets as ps

AREA = {
    "offices": {"130000": {"name": "東京都"}, "016000": {"name": "石狩・空知・後志地方"}},
    "class10s": {"130010": {"name": "東京地方", "parent": "130000"}},
    "class15s": {"130011": {"name": "23区西部", "parent": "130010"}},
    "class20s": {"1310100": {"name": "千代田区", "parent": "130011"}},
}


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    monkeypatch.setattr(fin_api, "_audit", lambda *a, **k: None)
    ext_http.clear_cache()
    yield
    for name in ("fx_ecb", "jma_area", "jma_warning", "gsi_revgeo", "nominatim_rev", "odpt", "ekispert",
                 "nager_date"):
        ext_http.set_transport(name, None)
    ext_http.clear_cache()


def _mock(name, handler):
    ext_http.set_transport(name, httpx.MockTransport(handler))


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client, local_date=None, lat=35.6812, lng=139.7671, title="東京駅"):
    p = client.post("/api/v1/travel-plans/", json={"title": "外の情報"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": (local_date or datetime.now(timezone.utc).date()).isoformat(),
                                          "timezone_id": "UTC"}, headers=_ik()).json()
    e = client.post(f"{base}/events", json={"day_id": d["id"], "title": title, "local_start_time": "10:00",
                                            "latitude": lat, "longitude": lng}, headers=_ik()).json()
    return p, base, d, e


# ===== 為替

def test_fx_fetch_records_ecb_rate(auth_client):
    client, _ = auth_client
    _p, base, _d, _e = _plan(client)
    seen = []

    def handler(request):
        seen.append(request.url)
        return httpx.Response(200, json={"amount": 1.0, "base": "USD", "date": "2026-11-12",
                                         "rates": {"JPY": 152.123456789}})

    _mock("fx_ecb", handler)
    sup = client.get(f"{base}/fx-rates/supported").json()
    assert sup["base_currency"] == "JPY" and "USD" in sup["currencies"] and "JPY" not in sup["currencies"]
    r = client.post(f"{base}/fx-rates/fetch", json={"currency": "USD"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["rate"] == "152.12345679" and body["rate_date"] == "2026-11-12"
    assert "ECB" in body["source"]
    assert seen[0].params["base"] == "USD" and seen[0].params["symbols"] == "JPY"
    # 記録の一覧にも出る
    assert [x["currency"] for x in client.get(f"{base}/fx-rates").json()] == ["USD"]


def test_fx_fetch_unsupported_and_failure_records_nothing(auth_client):
    client, _ = auth_client
    _p, base, _d, _e = _plan(client)
    assert client.post(f"{base}/fx-rates/fetch", json={"currency": "VND"}).status_code == 422
    _mock("fx_ecb", lambda request: httpx.Response(500))
    r = client.post(f"{base}/fx-rates/fetch", json={"currency": "EUR"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "fx_unavailable"
    assert client.get(f"{base}/fx-rates").json() == []
    assert client.post(f"{base}/fx-rates/fetch", json={"currency": "JPY"}).status_code == 422


def test_fx_stub_mode_does_not_send(monkeypatch):
    from app.core.config import settings
    from app.services import fx_provider

    monkeypatch.setattr(settings, "PROVIDER_HTTP_STUB", True)
    assert fx_provider.enabled() is False
    with pytest.raises(ext_http.Unavailable):
        fx_provider.fetch("USD", "JPY")


# ===== 逆ジオコーディング

def _gsi_and_area():
    _mock("gsi_revgeo", lambda request: httpx.Response(200, json={"results": {"muniCd": "13101", "lv01Nm": "丸の内"}}))
    _mock("jma_area", lambda request: httpx.Response(200, json=AREA))


def test_reverse_geocode_japan_and_abroad():
    _gsi_and_area()
    hit = reverse_geocode.reverse(35.68123, 139.76712)
    assert hit == {"country_code": "JP", "country": "日本", "prefecture": "東京都", "municipality": "千代田区",
                   "muni_code": "13101", "source": "国土地理院"}
    sent = []

    def osm(request):
        sent.append(request.url)
        return httpx.Response(200, json={"address": {"country_code": "fr", "country": "フランス",
                                                     "state": "イル＝ド＝フランス", "city": "パリ"}})

    _mock("nominatim_rev", osm)
    abroad = reverse_geocode.reverse(48.85661, 2.35222)
    assert abroad["country_code"] == "FR" and abroad["municipality"] == "パリ"
    assert sent[0].params["lat"] == "48.86" and sent[0].params["lon"] == "2.35"  # 丸めた座標だけ
    assert reverse_geocode.cached_only(48.86, 2.35)


def test_jp_areas_without_area_json_falls_back():
    _mock("jma_area", lambda request: httpx.Response(500))
    assert jp_areas.prefecture_name("13101") == "東京都"
    assert jp_areas.office_of("13101") == "130000"
    assert jp_areas.office_of("01100") is None  # 北海道は予報区が分かれている
    assert jp_areas.municipality_name("13101") is None


# ===== 警報・注意報

def test_external_status_returns_active_warnings(auth_client):
    client, _ = auth_client
    _p, base, d, _e = _plan(client)
    _gsi_and_area()
    _mock("jma_warning", lambda request: httpx.Response(200, json={
        "reportDatetime": "2026-11-13T05:00:00+09:00", "headlineText": "",
        "areaTypes": [{"areas": [{"code": "130011", "warnings": [{"code": "14", "status": "発表"}]}]},
                      {"areas": [{"code": "1310100", "warnings": [
                          {"code": "14", "status": "発表"}, {"code": "03", "status": "継続"},
                          {"code": "15", "status": "解除"}]}]}]}))
    body = client.get(f"{base}/alerts/external").json()
    assert body["unavailable"] == [] and body["providers"]["odpt"]["configured"] is False
    assert len(body["weather"]) == 1
    w = body["weather"][0]
    assert w["day_id"] == d["id"] and w["area_name"] == "千代田区" and w["office_name"] == "東京都"
    assert [x["name"] for x in w["warnings"]] == ["大雨警報", "雷注意報"]
    assert w["warnings"][0]["level"] == "warning" and w["report_at"].startswith("2026-11-13")
    assert body["transit"] == []


def test_external_status_skips_far_days_and_reports_failures(auth_client):
    client, _ = auth_client
    _p, base, _d, _e = _plan(client, local_date=date.today() + timedelta(days=10))
    assert client.get(f"{base}/alerts/external").json()["days"] == []
    _p2, base2, _d2, _e2 = _plan(client)
    _gsi_and_area()
    _mock("jma_warning", lambda request: httpx.Response(503))
    assert client.get(f"{base2}/alerts/external").json()["unavailable"] == ["jma"]


def test_odpt_connector_with_key(auth_client, monkeypatch):
    client, _ = auth_client
    _p, base, _d, e = _plan(client, lat=None, lng=None, title="山手線で上野へ")
    monkeypatch.setattr(ps, "resolve", lambda db, slot: "odpt-test-key-123" if slot == "odpt_consumer_key"
                        else (_ for _ in ()).throw(ps.SecretUnavailable("secret_missing")))

    def handler(request):
        assert request.url.params["acl:consumerKey"] == "odpt-test-key-123"
        if request.url.path.endswith("odpt:Railway"):
            return httpx.Response(200, json=[{"owl:sameAs": "odpt.Railway:JR-East.Yamanote", "dc:title": "山手線"},
                                             {"owl:sameAs": "odpt.Railway:JR-East.Chuo", "dc:title": "中央線"}])
        return httpx.Response(200, json=[
            {"odpt:railway": "odpt.Railway:JR-East.Yamanote", "dc:date": "2026-11-13T08:00:00+09:00",
             "odpt:trainInformationStatus": {"ja": "運転見合わせ"},
             "odpt:trainInformationText": {"ja": "人身事故の影響で運転を見合わせています。"}},
            {"odpt:railway": "odpt.Railway:JR-East.Chuo", "odpt:trainInformationStatus": {"ja": "遅延"},
             "odpt:trainInformationText": {"ja": "遅れています"}}])

    _mock("odpt", handler)
    body = client.get(f"{base}/alerts/external").json()
    assert body["providers"]["odpt"]["configured"] is True
    assert [t["railway"] for t in body["transit"]] == ["山手線"]  # 旅程に出てこない中央線は出さない
    assert body["transit"][0]["suggested_kind"] == "cancellation" and body["transit"][0]["event_ids"] == [e["id"]]


# ===== 時刻表(有料の接続口)

def test_timetable_not_configured_returns_manual(auth_client):
    client, _ = auth_client
    _p, base, _d, _e = _plan(client)
    r = client.post(f"{base}/route-options/timetable-search",
                    json={"origin": "東京", "destination": "新大阪", "date": "2026-11-20", "time": "09:00"})
    assert r.status_code == 200 and r.json()["configured"] is False and r.json()["candidates"] == []


def test_timetable_with_key_parses_courses(auth_client, monkeypatch):
    client, _ = auth_client
    _p, base, _d, _e = _plan(client)
    monkeypatch.setattr(ps, "resolve", lambda db, slot: "eki-test-key-123")
    sent = []

    def handler(request):
        sent.append(request.url)
        return httpx.Response(200, json={"ResultSet": {"Course": {
            "Price": [{"kind": "FareSummary", "Oneway": "14720"}, {"kind": "Fare", "Oneway": "8910"}],
            "Route": {"timeOnBoard": "150", "timeWalk": "5", "timeOther": "0", "transferCount": "0",
                      "Point": [{"Station": {"Name": "東京"}}, {"Station": {"Name": "新大阪"}}],
                      "Line": {"Name": "JR新幹線のぞみ1号", "Type": "train",
                               "DepartureState": {"Datetime": {"text": "2026-11-20T09:00:00+09:00"}},
                               "ArrivalState": {"Datetime": {"text": "2026-11-20T11:30:00+09:00"}},
                               "timeOnBoard": "150"}}}}})

    _mock("ekispert", handler)
    r = client.post(f"{base}/route-options/timetable-search",
                    json={"origin": "東京", "destination": "新大阪", "date": "2026-11-20", "time": "09:00"}).json()
    assert r["available"] is True and len(r["candidates"]) == 1
    c = r["candidates"][0]
    assert c["total_duration_minutes"] == 155 and c["total_cost"] == 14720 and c["transfer_count"] == 0
    assert c["legs"][0]["line"] == "JR新幹線のぞみ1号" and c["legs"][0]["from_label"] == "東京"
    assert c["legs"][0]["mode"] == "shinkansen"
    assert c["legs"][0]["departure_at"].startswith("2026-11-20T09:00")
    assert sent[0].params["viaList"] == "東京:新大阪" and sent[0].params["time"] == "0900"


# ===== 祝日

def test_japan_holidays_2026():
    h = holidays.japan(2026)
    assert h[date(2026, 5, 6)] == "振替休日"
    assert h[date(2026, 9, 22)] == "国民の休日"
    assert h[date(2026, 3, 20)] == "春分の日" and h[date(2026, 9, 23)] == "秋分の日"
    assert h[date(2026, 1, 12)] == "成人の日" and h[date(2026, 10, 12)] == "スポーツの日"
    assert len(h) == 18
    assert holidays.japan(2019) == {}


def test_holiday_api_and_plan_days(auth_client):
    client, _ = auth_client
    r = client.get("/api/v1/holidays", params={"country": "jp", "year": 2026}).json()
    assert r["country"] == "JP" and {"date": "2026-11-03", "name": "文化の日"} in r["holidays"]
    _mock("nager_date", lambda request: httpx.Response(200, json=[
        {"date": "2026-07-14", "localName": "Fête nationale", "name": "Bastille Day", "global": True},
        {"date": "2026-05-08", "localName": "地方の休日", "global": False}]))
    fr = client.get("/api/v1/holidays", params={"country": "FR", "year": 2026}).json()
    assert fr["holidays"] == [{"date": "2026-07-14", "name": "Fête nationale"}]
    _gsi_and_area()
    _p, base, d, _e = _plan(client, local_date=date(2026, 11, 3))
    days = client.get(f"{base}/holidays").json()["days"]
    assert days == [{"day_id": d["id"], "local_date": "2026-11-03", "country_code": "JP", "holiday": "文化の日"}]


# ===== Atlas の地名

def test_atlas_places_groups_and_limits(auth_client, monkeypatch):
    from app.api.v1 import atlas as atlas_api

    client, _ = auth_client
    _gsi_and_area()
    _plan(client, local_date=date.today() + timedelta(days=30))
    monkeypatch.setattr(atlas_api, "ATLAS_LOOKUPS_PER_CALL", 0)
    first = client.get("/api/v1/atlas/places").json()
    assert first["pending"] == 1 and first["countries"] == []
    monkeypatch.setattr(atlas_api, "ATLAS_LOOKUPS_PER_CALL", 8)
    body = client.get("/api/v1/atlas/places").json()
    assert body["pending"] == 0
    assert body["countries"][0]["country"] == "日本"
    region = body["countries"][0]["regions"][0]
    assert region["name"] == "東京都" and region["state"] == "PLANNED"
    assert region["municipalities"][0]["name"] == "千代田区"
    assert body["visited"] == {"countries": 0, "regions": 0, "municipalities": 0}  # 予定だけは訪問に数えない
