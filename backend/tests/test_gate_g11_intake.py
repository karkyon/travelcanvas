"""[Gate G11] 段階5 行き先が未定の旅行相談(docs/ux/G11_UIUX全範囲_実装仕様.md §2.5・§3.5、UIX-M15〜M19)。

外部(Nominatim)にはつながない(地名の照会は set_geocoder_for_testing / httpx.MockTransport で差し替える)。
"""
import asyncio
import uuid
from datetime import datetime, timezone

import httpx
import pytest

from app.core.auth import get_current_user
from app.core.auth import AuthResult
from app.main import app
from app.models.models import PlanCandidate, SearchCandidate, SourceRecord, TravelDay, TravelEvent, TravelPlan
from app.services import trip_intent as ti

SAMPLE = ("家族4人で、下の子が社会人になる記念に1泊2日の旅行を考えています。枚方から車で、高速を使って片道3時間くらいまで。"
          "人が多すぎない落ち着いた観光地で、4人1部屋の宿が希望です。宿泊費は4人で6〜8万円くらい。伊勢、福井、滋賀などが候補。"
          "食事は宿でも外食でもよく、焼き肉もいいです。")

COORDS = {"大阪府枚方市": (34.8146, 135.6507), "枚方": (34.8146, 135.6507), "伊勢": (34.4875, 136.7091),
          "福井": (36.0641, 136.2196), "滋賀": (35.0045, 135.8686), "四国": (33.7, 133.5)}


async def fake_geocode(name):
    q = ti.area_query(name)
    if name == "落ちる":
        return ti.GeocodeResult(status="unavailable", provider="nominatim")
    if q not in COORDS:
        return ti.GeocodeResult(status="not_found", provider="nominatim", retrieved_at=ti.now())
    lat, lng = COORDS[q]
    return ti.GeocodeResult(status="ok", latitude=lat, longitude=lng, label=q, provider="nominatim",
                            source_url="https://www.openstreetmap.org/relation/1", retrieved_at=ti.now())


@pytest.fixture(autouse=True)
def _geocoder():
    ti.set_geocoder_for_testing(fake_geocode)
    yield
    ti.set_geocoder_for_testing(None)


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


@pytest.fixture
def users(make_user):
    owner, _ = make_user()
    other, _ = make_user()
    yield owner, other
    app.dependency_overrides.pop(get_current_user, None)


def _items(res):
    return {i["key"]: i for i in res["items"]}


# ============================================================ 文章からの読み取り

def test_extract_main_scenario_marks_sources_and_questions(client, users):
    owner, _ = users
    _as(owner)
    res = client.post("/api/v1/trip-intents/extract", json={"text": SAMPLE})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["extractor"] == "text_rules" and body["ai_connected"] is False
    items = _items(body)
    assert items["origin"]["value"] == "枚方" and items["origin"]["source"] == "text"
    assert items["party_size"]["value"] == 4
    assert items["nights"]["value"] == 1 and items["nights"]["display"] == "1泊2日"
    assert items["transport"]["value"] == {"mode": "car", "highway": True}
    # 片道3時間: 希望か絶対条件かを確かめる(確かめるまで決めない。提案は「希望」)
    assert items["one_way"]["value"] == 3.0 and items["one_way"]["needs_answer"]
    assert items["one_way"]["strength"] == "undecided" and items["one_way"]["question"]["suggested"] == "preferred"
    assert items["room"]["value"] == "same_room"
    # 6〜8万円: 全員の合計か1人あたりかを確かめる(「4人で」から合計を提案するが決めない)
    assert items["budget"]["value"] == {"min": 60000, "max": 80000, "scope": None}
    assert items["budget"]["question"]["suggested"] == "total"
    assert items["dates"]["source"] == "unspecified" and "日付が決まってから" in items["dates"]["note"]
    assert {"quiet", "calm", "food", "flexible_meals"} <= set(items["preferences"]["value"])
    # 旅の理由は文字を返さない(個人的な理由とだけ示す)
    assert items["purpose"]["sensitive"] and "社会人" not in str(items["purpose"]) and "記念" not in str(items["purpose"])
    assert [a["name"] for a in body["areas"]] == ["伊勢", "福井", "滋賀"]
    assert all(a["source"] == "user_input" for a in body["areas"])


def test_extract_party_conflict_between_field_and_text_is_asked_not_guessed(client, users):
    """[Gate G11] 入力欄は1人・文章は「家族4人」の時、どちらかを黙って使わない(利用者に選んでもらう)"""
    owner, _ = users
    _as(owner)
    items = _items(client.post("/api/v1/trip-intents/extract", json={"text": SAMPLE, "party_size": 1}).json())
    party = items["party_size"]
    assert party["value"] is None and party["needs_answer"]
    assert party["question"]["id"] == "party_size"
    assert [o["value"] for o in party["question"]["options"]] == ["4", "1"]
    assert "入力欄は1人" in party["display"] and "文章は4人" in party["display"]
    # 同じ人数なら問わない(あなたの入力として使う)
    same = _items(client.post("/api/v1/trip-intents/extract", json={"text": SAMPLE, "party_size": 4}).json())
    assert same["party_size"]["value"] == 4 and same["party_size"]["source"] == "user_input"


def test_extract_fixed_date_from_screen_stays_fixed(client, users):
    """[Gate G11] 画面で「日付が決まっている」+「11/28」は、決まっている日付として返す(以前は未確定扱い)"""
    owner, _ = users
    _as(owner)
    items = _items(client.post("/api/v1/trip-intents/extract", json={
        "text": SAMPLE, "travel_window": "11/28", "date_status": "fixed"}).json())
    assert items["dates"]["value"] == {"status": "fixed", "text": "11/28"}
    assert items["dates"]["display"] == "11/28 · 決まっている日付" and items["dates"]["source"] == "user_input"
    window = _items(client.post("/api/v1/trip-intents/extract", json={
        "text": SAMPLE, "travel_window": "約1か月後の週末", "date_status": "window"}).json())
    assert window["dates"]["value"]["status"] == "window"
    assert client.post("/api/v1/trip-intents/extract", json={"text": SAMPLE, "date_status": "soon"}).status_code == 422


def test_extract_fields_override_text_and_answers_close_questions(client, users):
    owner, _ = users
    _as(owner)
    res = client.post("/api/v1/trip-intents/extract", json={
        "text": SAMPLE, "origin": "大阪府枚方市", "party_size": 4, "nights": 1, "one_way_strength": "required",
        "budget_scope": "per_person", "areas": ["四国"], "preferences": ["onsen"],
        "travel_window": "約1か月後の週末"})
    items = _items(res.json())
    assert items["origin"]["value"] == "大阪府枚方市" and items["origin"]["source"] == "user_input"
    assert items["one_way"]["strength"] == "required" and not items["one_way"]["needs_answer"]
    assert items["budget"]["value"]["scope"] == "per_person" and not items["budget"]["needs_answer"]
    assert items["dates"]["source"] == "user_input" and "日付は未確定" in items["dates"]["display"]
    assert "onsen" in items["preferences"]["value"]
    assert [a["name"] for a in res.json()["areas"]][:1] == ["四国"]


def test_extract_areas_variants_and_validation(client, users):
    owner, _ = users
    _as(owner)
    names = [a["name"] for a in ti.extract("候補は伊勢、和歌山、福井、滋賀(湖東/湖西)、岐阜、兵庫、淡路島、四国。", {})["areas"]]
    assert names == ["伊勢", "和歌山", "福井", "滋賀・湖東", "滋賀・湖西", "岐阜", "兵庫", "淡路島", "四国"]
    assert ti.extract("のんびりしたい", {})["areas"] == []
    assert _items(ti.extract("日帰りで", {}))["nights"]["display"] == "日帰り"
    assert _items(ti.extract("片道2時間半以内", {}))["one_way"]["value"] == 2.5
    assert client.post("/api/v1/trip-intents/extract", json={"text": " "}).status_code == 422
    assert client.post("/api/v1/trip-intents/extract", json={"text": "x" * 4001}).status_code == 422
    assert client.post("/api/v1/trip-intents/extract", json={"text": "a", "secret": 1}).status_code == 422


# ============================================================ 方面の比較

def test_areas_compare_positions_and_honest_statuses(client, users):
    owner, _ = users
    _as(owner)
    res = client.post("/api/v1/trip-intents/areas", json={
        "origin": "大阪府枚方市", "areas": ["伊勢", "四国", "どこか", "落ちる"], "one_way_hours": 3,
        "one_way_strength": "required"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["origin"]["status"] == "ok"
    assert body["providers"] == {"geocode": "nominatim", "route": None, "lodging": None, "crowd": None,
                                 "destination_suggestions": None}
    ise, shikoku, unknown, down = body["areas"]
    assert ise["geocode"]["status"] == "ok" and 80 < ise["straight_km"] < 110
    assert ise["drive"]["status"] == "not_connected" and ise["lodging"]["status"] == "not_connected"
    assert ise["quietness"]["status"] == "unverified" and ise["hours"]["status"] == "date_pending"
    assert ise["limit_check"]["status"] == "unknown"  # 直線距離では超えない。運転時間は未照会
    assert unknown["geocode"]["status"] == "not_found" and unknown["straight_km"] is None
    assert down["geocode"]["status"] == "unavailable" and down["limit_check"]["status"] == "unknown"
    # 値を作らない: 料金・運転時間・混雑の数値の項目が無い
    assert "minutes" not in str(ise["drive"]) and "price" not in str(ise)
    assert shikoku["straight_km"] and shikoku["limit_check"]["status"] in ("unknown", "exceeds")


def test_limit_check_lower_bound_only():
    assert ti.limit_check(None, 3, "required")["status"] == "unknown"
    assert ti.limit_check(350, 3, "required")["status"] == "exceeds"
    assert ti.limit_check(350, 3, "preferred")["status"] == "likely_exceeds"
    assert ti.limit_check(120, 3, "required")["status"] == "unknown"
    assert ti.limit_check(120, None, None)["status"] == "no_limit"


def test_areas_validation_and_disabled(client, users, monkeypatch):
    owner, _ = users
    _as(owner)
    assert client.post("/api/v1/trip-intents/areas", json={"origin": "x", "areas": []}).status_code == 422
    assert client.post("/api/v1/trip-intents/areas", json={"origin": "x", "areas": ["a"] * 11}).status_code == 422
    from app.core.config import settings
    monkeypatch.setattr(settings, "TRIP_INTENT_GEOCODER", "")
    body = client.post("/api/v1/trip-intents/areas", json={"origin": "枚方", "areas": ["伊勢"]}).json()
    assert body["areas"][0]["geocode"]["status"] == "disabled" and body["providers"]["geocode"] is None
    assert client.get("/api/v1/trip-intents/status").json()["providers"]["geocode"] is None


def test_nominatim_geocode_maps_statuses():
    ti.set_geocoder_for_testing(None)

    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params["q"]
        assert request.url.host == "nominatim.openstreetmap.org"
        assert request.url.params["countrycodes"] == "jp"  # [Gate GeocodeJP] 日本の地名として照会する
        if q == "国外":
            return httpx.Response(200, json=[{"lat": "31.23", "lon": "121.47", "display_name": "国外の同じ名前"}])
        if q == "伊勢":
            return httpx.Response(200, json=[{"lat": "34.48", "lon": "136.70", "display_name": "伊勢市, 三重県",
                                              "osm_type": "relation", "osm_id": 1}])
        if q == "無い":
            return httpx.Response(200, json=[])
        return httpx.Response(429)

    t = httpx.MockTransport(handler)
    ok = asyncio.run(ti.nominatim_geocode("伊勢", transport=t))
    assert ok.status == "ok" and ok.label == "伊勢市" and ok.source_url.endswith("/relation/1")
    assert asyncio.run(ti.nominatim_geocode("無い", transport=t)).status == "not_found"
    assert asyncio.run(ti.nominatim_geocode("混む", transport=t)).status == "unavailable"
    assert asyncio.run(ti.nominatim_geocode("国外", transport=t)).status == "not_found"  # 日本の範囲の外は使わない


def test_hirakata_to_ise_fukui_shiga_is_within_three_hours_lower_bound():
    """[Gate GeocodeJP] 枚方から伊勢・福井・滋賀は直線で 100〜150km 程度。直線距離の下限で「3時間を超える」とは言わない。"""
    pts = {"枚方": (34.8146, 135.6510), "伊勢": (34.4875, 136.7093), "福井": (36.0641, 136.2196),
           "滋賀": (35.0045, 135.8686)}
    for name in ("伊勢", "福井", "滋賀"):
        km = ti.haversine_km(*pts["枚方"], *pts[name])
        assert km < 300, (name, km)
        assert ti.limit_check(km, 3.0, "required")["status"] == "unknown", name


# ============================================================ 下書き → 並び → 旅程

def _search(db_session, user, name, category, lat=34.45, lng=136.72):
    sc = SearchCandidate(id=uuid.uuid4(), query="q", provider="overpass", external_id=str(uuid.uuid4()), name=name,
                         category=category, latitude=lat, longitude=lng, address=None, searched_by_user_id=user.id,
                         retrieved_at=datetime.now(timezone.utc))
    db_session.add(sc)
    db_session.flush()
    db_session.add(SourceRecord(candidate_id=sc.id, provider="overpass",
                                source_url="https://www.openstreetmap.org/node/1",
                                retrieved_at=sc.retrieved_at, freshness_state="fresh"))
    db_session.commit()
    return sc


INTENT = {"origin": "大阪府枚方市", "party_size": 4, "nights": 1, "transport": "car", "highway": True,
          "one_way_hours": 3, "one_way_strength": "preferred", "room": "same_room", "budget_min": 60000,
          "budget_max": 80000, "budget_scope": "total", "date_status": "window", "travel_window": "約1か月後の週末",
          "preferences": ["quiet", "food"]}


def test_draft_commit_flow(client, users, db_session):
    owner, other = users
    _as(owner)
    a = _search(db_session, owner, "伊勢神宮 内宮", "attraction")
    b = _search(db_session, owner, "鳥羽の食堂", "restaurant")
    c = _search(db_session, owner, "二見浦", "viewpoint")
    res = client.post("/api/v1/trip-intents/draft", json={
        "area": {"name": "伊勢", "latitude": 34.48, "longitude": 136.7, "provider": "nominatim",
                 "retrieved_at": datetime.now(timezone.utc).isoformat()},
        "intent": INTENT, "search_candidate_ids": [str(a.id), str(b.id), str(c.id)],
        "source_urls": ["https://example.com/ise-trip?utm_source=x"]})
    assert res.status_code == 201, res.text
    plan_id = res.json()["plan_id"]
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(plan_id)).one()
    assert plan.title == "伊勢・1泊2日の旅程案" and plan.destination == "伊勢" and plan.status == "draft"
    stored = plan.preferences["trip_intent"]
    assert stored["intent"]["budget_scope"] == "total" and "text" not in stored and "purpose" not in str(stored)
    assert db_session.query(TravelDay).filter(TravelDay.plan_id == plan.id).count() == 0  # 日程はまだ作らない

    draft = client.get(f"/api/v1/plans/{plan_id}/trip-intent").json()
    assert [d["label"] for d in draft["days"]] == ["1日目", "2日目"]
    assert [p["id"] for p in draft["days"][-1]["parts"]] == ["morning", "lunch", "afternoon", "evening"]  # 最後の日に宿は無い
    assert len(draft["candidates"]) == 4 and draft["committed_at"] is None
    assert draft["checklist"] == {"places": {"status": "selected", "count": 3}, "lodging": {"status": "not_connected"},
                                  "route": {"status": "not_connected"}, "hours": {"status": "date_pending"}}
    food_id = next(x["id"] for x in draft["candidates"] if x["title"] == "鳥羽の食堂")
    food = [s for s in draft["slots"] if s["candidate_id"] == food_id]
    assert food[0]["part"] in ("lunch", "evening")
    url_cand = next(x for x in draft["candidates"] if x["source_kind"] == "url")
    assert url_cand["source_url"] == "https://example.com/ise-trip"  # 追跡の query を除く

    # 並び替え: If-Match が要る・形を確かめる・前の並びへ戻せる
    rev = draft["revision"]
    slots = [{"day": 2, "part": "morning", "candidate_id": draft["slots"][0]["candidate_id"]}]
    assert client.put(f"/api/v1/plans/{plan_id}/trip-intent/slots", json={"slots": slots}).status_code == 400
    bad = [{"day": 2, "part": "stay", "candidate_id": slots[0]["candidate_id"]}]
    r = client.put(f"/api/v1/plans/{plan_id}/trip-intent/slots", json={"slots": bad}, headers={"If-Match": str(rev)})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_slots"
    r = client.put(f"/api/v1/plans/{plan_id}/trip-intent/slots",
                   json={"slots": [{"day": 1, "part": "morning", "candidate_id": str(uuid.uuid4())}]},
                   headers={"If-Match": str(rev)})
    assert r.status_code == 422
    r = client.put(f"/api/v1/plans/{plan_id}/trip-intent/slots", json={"slots": slots}, headers={"If-Match": str(rev)})
    assert r.status_code == 200 and r.json()["slots"] == slots and r.json()["revision"] == rev + 1
    assert client.put(f"/api/v1/plans/{plan_id}/trip-intent/slots", json={"slots": slots},
                      headers={"If-Match": str(rev)}).status_code == 409
    r = client.put(f"/api/v1/plans/{plan_id}/trip-intent/slots", json={"slots": draft["slots"]},
                   headers={"If-Match": str(rev + 1)})
    assert r.status_code == 200 and len(r.json()["slots"]) == 3

    # 他の人には見えない
    _as(other)
    assert client.get(f"/api/v1/plans/{plan_id}/trip-intent").status_code in (403, 404)
    _as(owner)

    # 旅程にする: 時刻帯の検査・日と予定・候補は「予定に配置済み」・二度はできない
    rev = client.get(f"/api/v1/plans/{plan_id}/trip-intent").json()["revision"]
    r = client.post(f"/api/v1/plans/{plan_id}/trip-intent/commit", json={"start_date": "2026-11-28",
                    "timezone_id": "Mars/Base"}, headers={"If-Match": str(rev)})
    assert r.status_code == 422
    r = client.post(f"/api/v1/plans/{plan_id}/trip-intent/commit", json={"start_date": "2026-11-28",
                    "timezone_id": "Asia/Tokyo"}, headers={"If-Match": str(rev)})
    assert r.status_code == 201, r.text
    assert [d["local_date"] for d in r.json()["days"]] == ["2026-11-28", "2026-11-29"] and r.json()["events"] == 3
    db_session.expire_all()
    events = db_session.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    assert len(events) == 3 and all(e.local_start_time is None and e.place_id for e in events)
    assert {e.event_type for e in events} >= {"dining"}
    assert db_session.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id,
                                                  PlanCandidate.status == "scheduled").count() == 3
    view = client.get(f"/api/v1/plans/{plan_id}/trip-intent").json()
    assert view["committed_at"] and view["checklist"]["hours"]["status"] == "check_in_planner"
    # 旅行の画面(旅行の情報・旅程)がそのまま読める(開始・終了の日)
    meta = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert meta.status_code == 200, meta.text
    assert str(meta.json()["start_date"]).startswith("2026-11-28")
    assert str(meta.json()["end_date"]).startswith("2026-11-29")
    days = client.get(f"/api/v1/plans/{plan_id}").json()["days"]
    assert [d["local_date"] for d in days] == ["2026-11-28", "2026-11-29"]
    r = client.post(f"/api/v1/plans/{plan_id}/trip-intent/commit", json={"start_date": "2026-11-28"},
                    headers={"If-Match": str(view["revision"])})
    assert r.status_code == 409

    # 旅程の画面の「元に戻す」1回で日・予定が消え、下書きに戻る
    r = client.post(f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(view["revision"])})
    assert r.status_code == 200, r.text
    db_session.expire_all()
    assert db_session.query(TravelDay).filter(TravelDay.plan_id == plan.id).count() == 0
    assert client.get(f"/api/v1/plans/{plan_id}/trip-intent").json()["committed_at"] is None


def test_draft_validation_and_ownership(client, users, db_session):
    owner, other = users
    others = _search(db_session, other, "他の人の検索", "attraction")
    _as(owner)
    base = {"area": {"name": "伊勢"}, "intent": INTENT}

    def post(**kw):
        return client.post("/api/v1/trip-intents/draft", json={**base, **kw}).status_code

    assert post(search_candidate_ids=[str(others.id)]) == 404
    assert post(intent={**INTENT, "purpose": "記念"}) == 422
    assert post(intent={**INTENT, "preferences": ["x"]}) == 422
    assert post(intent={**INTENT, "budget_min": 9, "budget_max": 1}) == 422
    assert post(area={"name": "伊勢", "latitude": 1}) == 422
    assert post(source_urls=["javascript:alert(1)"]) == 422
    r = client.post("/api/v1/trip-intents/draft", json={**base, "intent": {**INTENT, "nights": 0}})
    assert r.status_code == 201
    view = client.get(f"/api/v1/plans/{r.json()['plan_id']}/trip-intent").json()
    assert [d["label"] for d in view["days"]] == ["1日目"] and view["slots"] == []
    assert view["checklist"]["places"] == {"status": "none", "count": 0}


def test_get_trip_intent_on_normal_plan_is_404(client, users):
    owner, _ = users
    _as(owner)
    plan = client.post("/api/v1/travel-plans/", json={"title": "普通の旅行"}).json()
    r = client.get(f"/api/v1/plans/{plan['id']}/trip-intent")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "not_intent_draft"


def test_initial_slots_and_checks():
    cands = [{"id": "a", "category": "attraction"}, {"id": "b", "category": "restaurant"},
             {"id": "c", "category": "viewpoint"}, {"id": "d", "category": "cafe"}]
    slots = ti.initial_slots(cands, 1)
    assert {s["candidate_id"] for s in slots} == {"a", "b", "c", "d"}
    assert all(s["part"] in ("lunch", "evening") for s in slots if s["candidate_id"] in ("b", "d"))
    assert all(s["part"] != "stay" for s in slots)
    assert ti.check_slots(slots, 1, {"a", "b", "c", "d"}) is None
    assert ti.check_slots([{"day": 3, "part": "morning", "candidate_id": "a"}], 1, {"a"})
    assert ti.check_slots([{"day": 1, "part": "morning", "candidate_id": "a"},
                           {"day": 1, "part": "lunch", "candidate_id": "a"}], 1, {"a"})
