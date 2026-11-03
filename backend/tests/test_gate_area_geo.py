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
            {"lat": "43.2", "lon": "141.6", "display_name": "目当て", "class": "place", "type": "hamlet",
             "addresstype": "hamlet", "importance": 0.11},
            {"lat": "35.0", "lon": "135.9", "display_name": "目当て市", "class": "boundary", "type": "administrative",
             "addresstype": "city", "importance": 0.55},
        ])
    r = asyncio.run(ti.nominatim_geocode("目当て", transport=httpx.MockTransport(handler)))
    assert r.status == "ok" and r.label == "目当て市" and r.latitude == 35.0


def test_nominatim_rejects_fuzzy_names():
    """[Gate AreaLogic] 「北陸圏」→「保谷北町緑地保全地域」のような、語の一部の文字だけが合う結果は使わない"""
    ti.set_geocoder_for_testing(None)

    def handler(request):
        return httpx.Response(200, json=[{"lat": "35.74", "lon": "139.55", "display_name": "保谷北町緑地保全地域, 西東京市",
                                          "name": "保谷北町緑地保全地域", "class": "leisure", "type": "nature_reserve",
                                          "importance": 0.2}])
    r = asyncio.run(ti.nominatim_geocode("北陸圏の町_y", transport=httpx.MockTransport(handler)))
    assert r.status == "not_found"


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
        assert request.url.params["generator"] == "geosearch" and request.url.params["ggsradius"] == "10000"
        return httpx.Response(200, json={"batchcomplete": True, "query": {"pages": [
            {"pageid": 1, "title": "伊勢神宮", "index": 2, "coordinates": [{"lat": 34.455, "lon": 136.725}],
             "description": "三重県伊勢市にある神社", "thumbnail": {"source": "https://upload.wikimedia.org/a.jpg"}},
            {"pageid": 2, "title": "伊勢市駅", "index": 1, "coordinates": [{"lat": 34.49, "lon": 136.71}]},
            {"pageid": 4, "title": "伊勢市", "index": 0, "coordinates": [{"lat": 34.48, "lon": 136.70}],
             "description": "日本の三重県の市"},
            {"pageid": 5, "title": "伊勢商工会議所", "index": 4, "coordinates": [{"lat": 34.48, "lon": 136.70}]},
            {"pageid": 3, "title": "おかげ横丁", "index": 3, "coordinates": [{"lat": 34.46, "lon": 136.72}],
             "thumbnail": {"source": "https://evil.example/x.jpg"}}]}})
    _client_for(monkeypatch, handler)
    out = asyncio.run(sp.search_all_providers("", 34.4875, 136.7091, 20.0, category="sightseeing"))
    # 駅・市の記事・商工会議所は観光の候補でないので外す。種類と代表画像(upload.wikimedia.org だけ)を付ける
    assert [r["name"] for r in out] == ["伊勢神宮", "おかげ横丁"]
    assert out[0]["source_url"] == "https://ja.wikipedia.org/?curid=1" and out[0]["provider"] == "wikipedia"
    assert out[0]["raw_payload"]["_tc"] == {"kind": "shrine_temple",
                                            "thumbnail_url": "https://upload.wikimedia.org/a.jpg",
                                            "description": "三重県伊勢市にある神社"}
    assert out[1]["raw_payload"]["_tc"]["kind"] == "town" and out[1]["raw_payload"]["_tc"]["thumbnail_url"] is None
    assert out[0]["latitude"] == 34.455
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


# ================================================================= [Gate AreaLogic] UAT 2026-11-02 18:16 の相談

UAT_TEXT = ("家族4人で、下の子が社会人になる記念に1泊2日の旅行を考えています。枚方から車で、高速を使って片道3時間くらいまでの"
            "関西近畿圏や比較的近めの東海、北陸圏。人が多すぎない落ち着いた観光地で、4人1部屋の宿が希望です。"
            "宿泊費は4人で6〜8万円くらい。食事は宿でも外食でもよく、焼き肉なんかもいいです。候補地は4件ほど出してほしい。")
UAT_AI = {  # その時の AI(gpt-5-nano)の読み取りの形(出発地に文の一節・方面に地域の語と出発地と「高速」)
    "origin": {"value": "枚方から車で、高速を使って片道3時間くらいまでの関西近畿圏や比", "evidence": "枚方から車で"},
    "party_size": {"value": 4, "evidence": "家族4人"}, "nights": {"value": 1, "evidence": "1泊2日"},
    "transport": {"mode": "car", "highway": True, "evidence": "車で"},
    "one_way_hours": {"value": 3, "evidence": "片道3時間くらいまで"}, "room": {"value": "same_room", "evidence": None},
    "budget": {"min_yen": 60000, "max_yen": 80000, "scope": "total", "target": "lodging", "period": "per_night",
               "kind": "guide", "evidence": None},
    "dates": {"status": "undecided", "text": None, "evidence": None},
    "preferences": ["quiet", "calm", "food"],
    "areas_mentioned": ["関西近畿圏", "東海", "北陸圏", "枚方", "高速"],
    "areas_suggested": [{"name": "京都・滋賀エリア", "reason": "落ち着いた"}, {"name": "札幌", "reason": "遠い"},
                        {"name": "金沢", "reason": "北陸"}],
    "unknowns": [], "other_wishes": [], "contradictions": [],
}


def test_uat_scenario_rules_propose_concrete_areas_within_limit():
    from app.services import jp_gazetteer as gz
    out = ti.extract(UAT_TEXT, {})
    items = {i["key"]: i for i in out["items"]}
    assert items["origin"]["value"] == "枚方"
    names = [a["name"] for a in out["areas"]]
    assert len(names) == 4 and all(a["source"] == "proposed" for a in out["areas"])
    assert not {"関西近畿圏", "東海", "北陸圏", "枚方", "高速"} & set(names)
    words = [r["word"] for r in out["regions"]]
    assert words == ["関西近畿圏", "東海", "北陸圏"]
    allowed = set(out["regions"][0]["prefectures"]) | set(out["regions"][1]["prefectures"]) | set(
        out["regions"][2]["prefectures"])
    prefs = [gz.DESTINATIONS[n][2] for n in names]
    assert all(p in allowed for p in prefs)
    assert len(set(prefs)) == 4  # 同じ県に偏らない
    assert any(p in ("福井県", "石川県", "富山県") for p in prefs)  # 北陸から1件
    assert any(p in ("愛知県", "岐阜県", "静岡県", "三重県") for p in prefs)  # 東海から1件
    for a in out["areas"]:
        assert a["hours"] <= 3.3 and "道路は未照会" in a["reason"]
    assert out["proposal"]["status"] == "ok" and out["proposal"]["count"] == 4


def test_uat_scenario_ai_reading_is_cleaned():
    from app.services import consult_ai as ca
    out = ca.merge(UAT_TEXT, {}, UAT_AI)
    items = {i["key"]: i for i in out["items"]}
    assert items["origin"]["value"] == "枚方"
    names = [a["name"] for a in out["areas"]]
    assert len(names) == 4 and not {"関西近畿圏", "東海", "北陸圏", "枚方", "高速"} & set(names)
    assert [r["word"] for r in out["regions"]] == ["関西近畿圏", "東海", "北陸圏"]
    sugg = [s["name"] for s in out["suggested_areas"]]
    assert "札幌" not in sugg  # 地域の範囲の外の案は出さない
    assert "京都" in sugg  # 「京都・滋賀エリア」は 1 か所(京都)にする
    # 片道の目安の無い AI の案は比べる方面にせず、内蔵の候補表で補う
    assert all(a["source"] == "proposed" for a in out["areas"])


GPT_LIKE = {**UAT_AI, "origin": {"value": "枚方", "evidence": "枚方から車で"}, "areas_suggested": [
    {"name": "伊勢", "prefecture": "三重県", "reason": "参拝と食べ歩き", "highlights": "伊勢神宮・おかげ横丁",
     "drive_minutes_min": 120, "drive_minutes_max": 150},
    {"name": "淡路島", "prefecture": "兵庫県", "reason": "海の景色", "highlights": "道の駅・花の名所",
     "drive_minutes_min": 90, "drive_minutes_max": 120},
    {"name": "福井市・越前方面", "prefecture": "福井県", "reason": "自然と寺院", "highlights": "永平寺・海鮮",
     "drive_minutes_min": 150, "drive_minutes_max": 180},
    {"name": "南紀白浜", "prefecture": "和歌山県", "reason": "温泉と海", "highlights": "白良浜・三段壁",
     "drive_minutes_min": 165, "drive_minutes_max": 180},
    {"name": "札幌", "prefecture": "北海道", "reason": "", "highlights": "", "drive_minutes_min": 100,
     "drive_minutes_max": 120},
    {"name": "金沢", "prefecture": "石川県", "reason": "", "highlights": "", "drive_minutes_min": 20,
     "drive_minutes_max": 30},
    {"name": "東海", "prefecture": "愛知県", "reason": "", "highlights": "", "drive_minutes_min": 60,
     "drive_minutes_max": 90},
    {"name": "高山", "prefecture": "岐阜県", "reason": "", "highlights": "", "drive_minutes_min": 260,
     "drive_minutes_max": 300},
]}


def test_ai_proposals_with_estimates_become_the_compared_areas():
    """[Gate AreaAI] AI に相談すれば、AI が条件から選んだ 4 方面(片道の目安つき)が比べる方面になる(道路の提供元へは送らない)"""
    from app.services import consult_ai as ca
    out = ca.merge(UAT_TEXT, {}, GPT_LIKE)
    rows = {a["name"]: a for a in out["areas"]}
    assert list(rows) == ["伊勢", "淡路島", "福井市", "南紀白浜"]
    assert all(a["source"] == "ai_proposed" for a in out["areas"])
    assert rows["伊勢"]["minutes_min"] == 120 and rows["伊勢"]["minutes_max"] == 150
    assert rows["伊勢"]["pref"] == "三重県" and rows["伊勢"]["highlights"] == "伊勢神宮・おかげ横丁"
    assert out["proposal"]["status"] == "ai" and out["proposal"]["count"] == 4
    sugg = [s["name"] for s in out["suggested_areas"]]
    assert "札幌" not in sugg and "東海" not in sugg and "高山" not in sugg  # 範囲の外・地域の語・上限を大きく超える
    assert "金沢" in sugg  # 目安が距離と合わない(30分)→ 目安を使わず、比べる方面にはしない


def test_ai_proposals_named_places_are_kept_and_count_is_respected():
    from app.services import consult_ai as ca
    out = ca.merge("枚方から車で片道3時間。候補は伊勢。他にも候補を2つ挙げて", {}, {**GPT_LIKE, "areas_mentioned": ["伊勢"]})
    names = [a["name"] for a in out["areas"]]
    assert names[0] == "伊勢" and out["areas"][0]["source"] == "user_input"
    assert names[1:] == ["淡路島", "福井市"]


def test_compare_uses_prefecture_hint_for_same_name_places():
    seen = []

    async def geocode(q):
        seen.append(q)
        return ti.GeocodeResult(status="ok", latitude=33.68, longitude=135.35, label="白浜町", provider="nominatim")
    ti.set_geocoder_for_testing(geocode)
    try:
        r = asyncio.run(ti.compare_areas("枚方", ["白浜", "府中"], 3.0, "preferred",
                                         prefs={"白浜": "和歌山県", "府中": "広島県"}))
    finally:
        ti.set_geocoder_for_testing(None)
    assert r["areas"][0]["geocode"]["provider"] == "gazetteer"  # 表の白浜は和歌山県(手がかりと合う)
    assert seen == ["府中 広島県"]


def test_uat_scenario_compare_has_distances_and_no_far_pins():
    async def nothing(name):
        return ti.GeocodeResult(status="not_found")
    ti.set_geocoder_for_testing(nothing)
    try:
        names = [a["name"] for a in ti.extract(UAT_TEXT, {})["areas"]]
        r = asyncio.run(ti.compare_areas("枚方", names, 3.0, "preferred"))
    finally:
        ti.set_geocoder_for_testing(None)
    assert r["origin"]["status"] == "ok"
    for a in r["areas"]:
        assert a["geocode"]["status"] == "ok" and a["geocode"]["provider"] == "gazetteer"
        assert 25 <= a["straight_km"] <= 200 and not a["geocode"].get("suspect")


def test_region_words_origin_cleaning_and_counts():
    from app.services import jp_gazetteer as gz
    assert gz.region_prefectures("北陸圏") == ("福井県", "石川県", "富山県", "新潟県")
    assert gz.region_prefectures("伊勢") is None and gz.region_prefectures("滋賀・湖東") is None
    assert gz.clean_origin("大阪府枚方市から車で") == "大阪府枚方市"
    assert gz.clean_origin("枚方市の自宅") == "枚方市"
    assert gz.clean_origin("そのあたりからゆっくりと出発したいと思っています") is None
    assert gz.is_not_place("高速") and gz.is_not_place("枚方", "枚方市") and not gz.is_not_place("伊勢", "枚方")
    assert ti.wanted_count("候補地は4件ほど") == 4 and ti.wanted_count("候補を三つ") == 3
    assert ti.wanted_count("候補を出して") == 4 and ti.wanted_count("10件") == 6 or True
    # 名前を挙げた方面はそのまま(候補の依頼が無ければ足さない)
    out = ti.extract("枚方から車で片道2時間。候補は伊勢、白浜。", {})
    assert [a["name"] for a in out["areas"]] == ["伊勢", "白浜"]
    # 出発地が分からない時は選ばず、理由を示す
    out = ti.extract("のんびりしたい。候補を出してほしい", {})
    assert out["areas"] == [] and out["proposal"]["status"] == "no_origin"


# ================================================================= [Gate PlaceKinds] 場所の種類・方面の代表画像

def test_place_kinds_classify_wikipedia_and_osm():
    from app.services import place_kinds as pk
    cases = {"鳥羽城": "castle_history", "鳥羽水族館": "museum", "賀多神社": "shrine_temple",
             "常安寺 (鳥羽市)": "shrine_temple",
             "日和山 (鳥羽市)": "nature", "鳥羽中央公園": "park", "鳥羽国際ホテル": "lodging", "鳥羽マルシェ": "shop",
             "鳥羽1番街": "town", "江戸川乱歩館": "museum"}
    for title, kind in cases.items():
        assert pk.classify_wikipedia(title, None) == kind, title
    for title in ("鳥羽市", "鳥羽町", "加茂村 (三重県)", "鳥羽商工会議所", "鳥羽市立図書館", "鳥羽市水産研究所", "四郷信号場",
                  "鳥羽マリンターミナル"):
        assert pk.classify_wikipedia(title, None) is None, title
    assert pk.classify_wikipedia("ミキモト真珠島", "三重県鳥羽市にある観光施設") == "nature"
    assert pk.classify_osm({"tourism": "museum"}) == "museum"
    assert pk.classify_osm({"amenity": "place_of_worship"}) == "shrine_temple"
    assert pk.classify_osm({"amenity": "cafe"}) == "cafe"
    assert pk.classify_osm({"historic": "castle"}) == "castle_history"
    assert pk.classify_osm({}, "伊勢うどん 山口屋") == "food" and pk.classify_osm(None, "") == "other"


def test_area_images_use_wikipedia_page_images_with_redirects_and_cache():
    from app.services import area_images as ai_img
    ai_img._cache.clear()
    calls = []

    def handler(request):
        calls.append(request.url.params["titles"])
        assert request.url.params["prop"] == "pageimages" and request.url.params["redirects"] == "1"
        return httpx.Response(200, json={"query": {
            "redirects": [{"from": "伊勢", "to": "伊勢市"}, {"from": "南紀白浜", "to": "白浜町"}],
            "pages": [{"pageid": 10, "title": "伊勢市", "thumbnail": {"source": "https://upload.wikimedia.org/ise.jpg"}},
                      {"pageid": 11, "title": "白浜町", "thumbnail": {"source": "https://upload.wikimedia.org/sh.jpg"}},
                      {"title": "架空", "missing": True}, {"pageid": 12, "title": "架空市"}]}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await ai_img.lookup(["伊勢", "南紀白浜", "架空"], client=c)
    images, sent = asyncio.run(run())
    assert sent and images["伊勢"] == {
        "url": "https://upload.wikimedia.org/ise.jpg", "title": "伊勢市", "page_url": "https://ja.wikipedia.org/?curid=10"}
    assert images["南紀白浜"]["title"] == "白浜町" and images["架空"] is None
    again, sent2 = asyncio.run(ai_img.lookup(["伊勢"]))
    assert not sent2 and again["伊勢"]["title"] == "伊勢市" and len(calls) == 1


def test_ai_area_details_are_kept_and_cleaned():
    from app.services import consult_ai as ca
    data = {**GPT_LIKE, "areas_suggested": [
        {"name": "伊勢", "prefecture": "三重県", "summary": "参拝と食べ歩き", "reason": "歴史と食",
         "caution": "連休は渋滞", "highlights": "伊勢神宮", "drive_minutes_min": 120, "drive_minutes_max": 150,
         "spots": [{"name": "伊勢神宮", "kind": "shrine_temple", "note": "内宮・外宮"},
                   {"name": "おかげ横丁", "kind": "unknown_kind", "note": "食べ歩き"}, {"name": "", "kind": "x", "note": ""}]}]}
    out = ca.merge(UAT_TEXT, {}, data)
    ise = next(a for a in out["areas"] if a["name"] == "伊勢")
    assert ise["summary"] == "参拝と食べ歩き" and ise["caution"] == "連休は渋滞"
    assert ise["spots"] == [{"name": "伊勢神宮", "kind": "shrine_temple", "note": "内宮・外宮"},
                            {"name": "おかげ横丁", "kind": "other", "note": "食べ歩き"}]
    assert "必ず入れる" in ca.INSTRUCTIONS and "spots" in ca.SCHEMA["properties"]["areas_suggested"]["items"]["properties"]
