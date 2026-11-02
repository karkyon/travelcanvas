"""[Gate AreaGeo] 方面の比較の位置の是正(UAT 2026-11-02: 枚方から車で片道約3時間の相談の「滋賀」が北海道に、
「伊勢」が岐阜の山中に置かれ、出発地「枚方」は照会できず、地図が日本全体まで縮んだ)。

- よく使う方面・出発地は内蔵の地名表で決める(外へ送らない)。県の短い名前(滋賀・福井・奈良)は県として扱う
- 表に無い地名の Nominatim の照会は 5 件から、行政の区域・市町村・観光地を優先して重要度の高いものを選ぶ(1 件目だけを使わない)
- 照会した位置が出発地から遠すぎる(直線で片道の上限の2倍を越える)時は suspect にし、地名を確かめるよう示す
"""
import asyncio

import httpx

from app.services import jp_gazetteer as gz
from app.services import trip_intent as ti


def test_uat_scenario_hirakata_ise_fukui_shiga_nara_are_in_kansai():
    hokkaido_called = []

    async def fake(name):
        hokkaido_called.append(name)  # 表にある地名は照会しない
        return ti.GeocodeResult(status="ok", latitude=43.0, longitude=141.0, label=name, provider="nominatim")
    ti.set_geocoder_for_testing(fake)
    try:
        out = asyncio.run(ti.compare_areas("枚方", ["伊勢", "福井", "滋賀", "奈良"], 3, "preferred"))
    finally:
        ti.set_geocoder_for_testing(None)
    assert hokkaido_called == []
    assert out["origin"]["provider"] == "gazetteer" and out["origin"]["label"] == "枚方市(大阪府)"
    by = {a["name"]: a for a in out["areas"]}
    for name in ("伊勢", "福井", "滋賀", "奈良"):
        g = by[name]["geocode"]
        assert g["status"] == "ok" and g["provider"] == "gazetteer" and not g.get("suspect")
        assert 33.5 < g["latitude"] < 36.5 and 135.0 < g["longitude"] < 137.0, name
        assert by[name]["straight_km"] < 200 and by[name]["limit_check"]["status"] == "unknown"
    assert by["滋賀"]["geocode"]["label"] == "滋賀県" and by["伊勢"]["geocode"]["label"] == "伊勢市(三重県)"


def test_far_nominatim_result_is_suspect():
    async def fake(name):
        return ti.GeocodeResult(status="ok", latitude=43.2, longitude=141.5, label="同じ名前の小さな地名",
                                provider="nominatim")
    ti.set_geocoder_for_testing(fake)
    try:
        out = asyncio.run(ti.compare_areas("枚方", ["架空の温泉"], 3, "preferred"))
    finally:
        ti.set_geocoder_for_testing(None)
    g = out["areas"][0]["geocode"]
    assert g["suspect"] is True and "県名" in g["suspect_note"]


def test_lookup_variants():
    assert gz.lookup("滋賀")["label"] == "滋賀県" and gz.lookup("滋賀県")["kind"] == "prefecture"
    assert gz.lookup("大阪府枚方市")["label"] == "枚方市(大阪府)"
    assert gz.lookup("京都")["label"] == "京都府" and gz.lookup("東京")["label"] == "東京都"
    assert gz.lookup("架空の町") is None and gz.lookup("") is None
    assert gz.prefecture_of("大阪府枚方市") == "大阪府"


def test_nominatim_picks_the_important_place_not_the_first():
    ti.set_geocoder_for_testing(None)

    def handler(request):
        assert request.url.params["limit"] == "5"
        return httpx.Response(200, json=[
            {"lat": "43.2", "lon": "141.6", "display_name": "小さな字", "class": "place", "type": "hamlet",
             "addresstype": "hamlet", "importance": 0.11},
            {"lat": "35.0", "lon": "135.9", "display_name": "目当ての市", "class": "boundary", "type": "administrative",
             "addresstype": "city", "importance": 0.55},
        ])
    r = asyncio.run(ti.nominatim_geocode("表に無い市_x", transport=httpx.MockTransport(handler)))
    assert r.status == "ok" and r.label == "目当ての市" and r.latitude == 35.0


def _client_for(monkeypatch, handler):
    from app.services import search_provider as sp
    real = httpx.AsyncClient
    monkeypatch.setattr(sp.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_sightseeing_uses_wikipedia_geosearch_when_overpass_times_out(monkeypatch):
    """観光は Overpass と Wikipedia の位置つきの記事を並べて探す。Overpass が時間切れでも候補が残り、失敗は分けて示す"""
    from app.services import search_provider as sp

    def handler(request):
        if request.url.host == "overpass-api.de":
            raise httpx.ReadTimeout("slow", request=request)
        assert request.url.params["list"] == "geosearch" and request.url.params["gsradius"] == "10000"
        return httpx.Response(200, json={"query": {"geosearch": [
            {"pageid": 1, "title": "伊勢神宮", "lat": 34.455, "lon": 136.725, "dist": 3000},
            {"pageid": 2, "title": "伊勢市駅", "lat": 34.49, "lon": 136.71, "dist": 300},
            {"pageid": 3, "title": "おかげ横丁", "lat": 34.46, "lon": 136.72, "dist": 2800}]}})
    _client_for(monkeypatch, handler)
    out = asyncio.run(sp.search_all_providers("", 34.4875, 136.7091, 20.0, category="sightseeing"))
    assert [r["name"] for r in out] == ["伊勢神宮", "おかげ横丁"]  # 駅は観光でないので外す
    assert out[0]["source_url"] == "https://ja.wikipedia.org/?curid=1" and out[0]["provider"] == "wikipedia"
    assert out.errors == {"overpass": "timeout"} and out.unavailable == ["overpass"]
    assert set(out.called) == {"overpass", "wikipedia"}


def test_food_does_not_use_wikipedia(monkeypatch):
    from app.services import search_provider as sp
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        return httpx.Response(200, json={"elements": []})
    _client_for(monkeypatch, handler)
    asyncio.run(sp.search_all_providers("", 34.4875, 136.7091, 10.0, category="food"))
    assert hosts == ["overpass-api.de"]
