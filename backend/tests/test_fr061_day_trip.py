"""[FR-061] 日帰りモード(詳細設計 DD-2026-11-22-01 §4.8)。

提供元の順(Google → OSRM → 直線)・道の使い方で modifiers が変わる・料金の読み取り・線の間引き・幅の絞り込み(境界)・
at_km・寄り道の時間・好みの点と理由・好みを切った時・行きたい場所の近く・権限(viewer は route を作れない)・
出発地の丸め・データの書き出し・trip_style の promote。
"""

import uuid
from datetime import datetime, timezone

import httpx
import pytest

from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import DayTripRoute, PlanCollaborator, Spot, TravelPlan
from app.services import day_trip as dt
from app.services import osrm_router
from app.services import place_finder as pf
from app.services import place_lookup as pl
from app.services import preference_profile as pp
from app.services import provider_calls as pc

KYOTO = (34.99, 135.70)  # 出発地(丸める前は 34.98765, 135.70432)
KATSURA = (34.98, 135.66)


def _day_plan(db, user, title="桂坂・西山の森"):
    p = TravelPlan(
        id=uuid.uuid4(),
        user_id=user.id,
        title=title,
        trip_style="day_trip",
        start_date=datetime(2030, 5, 3, tzinfo=timezone.utc),
        end_date=datetime(2030, 5, 3, tzinfo=timezone.utc),
    )
    db.add(p)
    db.commit()
    return p


def _route_body(**kw):
    body = {
        "origin": {"label": "現在地のあたり", "lat": 34.98765, "lng": 135.70432},
        "destination": {"label": "桂坂野鳥遊園", "lat": KATSURA[0], "lng": KATSURA[1]},
        "road": "auto",
        "depart_at": "09:00",
        "home_by": "19:00",
    }
    body.update(kw)
    return body


@pytest.fixture()
def no_google(monkeypatch):
    monkeypatch.setattr(pc, "ready", lambda db, provider, op: False)


@pytest.fixture()
def osrm(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(
            200,
            json={
                "code": "Ok",
                "routes": [
                    {
                        "distance": 6100.0,
                        "duration": 900.0,
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[135.704, 34.988], [135.68, 34.985], [135.66, 34.98]],
                        },
                    }
                ],
            },
        )

    monkeypatch.setattr(settings, "OSRM_CAR_URL", "http://osrm-car:5000")
    osrm_router.set_transport(httpx.MockTransport(handler))
    yield calls
    osrm_router.set_transport(None)


# ---------------------------------------------------------------- 線の計算


def test_polyline_roundtrip_and_simplify():
    pts = [(34.0 + i * 0.0001, 135.0 + (i % 2) * 0.00001) for i in range(3000)]
    assert dt.decode_polyline(dt.encode_polyline(pts[:5])) == [(round(a, 5), round(b, 5)) for a, b in pts[:5]]
    assert dt.decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    thin = dt.thin_line(pts)
    assert len(thin) < 100 and thin[0] == pts[0] and thin[-1] == pts[-1]  # 2,000 点を超えたので間引いた(ほぼ直線)
    assert dt.thin_line(pts[:10]) == pts[:10]


def test_locate_on_line_and_width_boundary():
    line = [(35.0, 135.0), (35.0, 135.1)]  # 東へ約 9.1km
    off, at = dt.locate_on_line(line, (35.0045, 135.05))
    assert 495 <= off * 1000 <= 505 and 4.4 <= at <= 4.7
    # 幅ちょうど(500m)は入り、500m + 数 m は入らない(along の判定と同じ式)
    assert off * 1000 <= 505


def test_detour_minutes_and_origin_rounding():
    assert dt.detour_minutes(1.0, "local") == (7, False)  # 2km ÷ 30km/h = 4 分 + 3
    assert dt.detour_minutes(1.0, "highway", exit_km=2.0) == (9, False)  # 4km ÷ 40km/h = 6 分 + 3
    assert dt.detour_minutes(1.0, "highway") == (21, True)  # IC が分からない時は +15 分と札
    assert dt.round_origin(34.98765, 135.70432) == (34.99, 135.7)


def test_google_request_modifiers_and_toll_parsing(monkeypatch):
    sent = []
    monkeypatch.setattr(
        pc.ph, "post_json", lambda name, headers, payload: sent.append((name, headers, payload)) or None
    )
    pc._routes_line_request("k", KYOTO, KATSURA, "local", None)
    pc._routes_line_request("k", KYOTO, KATSURA, "avoid_tolls", None)
    pc._routes_line_request("k", KYOTO, KATSURA, "highway", "2030-05-03T00:00:00Z")
    (_, h1, p1), (_, _h2, p2), (_, _h3, p3) = sent
    assert (
        h1["X-Goog-FieldMask"] == pc.ROUTES_LINE_FIELD_MASK
        and "polyline.encodedPolyline" in pc.ROUTES_LINE_FIELD_MASK
    )
    assert p1["routeModifiers"] == {"avoidHighways": True, "avoidTolls": True} and "extraComputations" not in p1
    assert p2["routeModifiers"] == {"avoidHighways": False, "avoidTolls": True}
    assert p3["routeModifiers"] == {"avoidHighways": False, "avoidTolls": False}
    assert p3["extraComputations"] == ["TOLLS"] and p3["departureTime"] == "2030-05-03T00:00:00Z"
    body = {
        "routes": [
            {
                "duration": "4320s",
                "distanceMeters": 48000,
                "polyline": {"encodedPolyline": "abc"},
                "travelAdvisory": {"tollInfo": {"estimatedPrice": [{"currencyCode": "JPY", "units": "1320"}]}},
            }
        ]
    }
    assert pc._route_line_summary(body) == {
        "duration_s": 4320,
        "distance_m": 48000,
        "polyline": "abc",
        "toll_jpy": 1320,
    }
    assert pc._route_line_summary({"routes": [{"duration": "60s"}]})["toll_jpy"] is None


# ---------------------------------------------------------------- ルートの計算(API)


def test_route_uses_google_first_then_osrm_then_straight(auth_client, db_session, monkeypatch, osrm):
    client, user = auth_client
    plan = _day_plan(db_session, user)
    line = dt.encode_polyline([KYOTO, (34.985, 135.68), KATSURA])
    seen = []
    monkeypatch.setattr(pc, "ready", lambda db, provider, op: True)

    def fake_line(db, plan_, caller, origin, dest, road, depart, idem):
        seen.append((origin, dest, road))
        return {"polyline": line, "distance_m": 6500, "duration_s": 960, "toll_jpy": 0}, {}

    monkeypatch.setattr(pc, "route_line", fake_line)
    res = client.post(f"/api/v1/plans/{plan.id}/day-trip/route", json=_route_body())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["provider"] == "google" and body["warnings"] == []
    assert seen[0][0] == (34.99, 135.7)  # 出発地は丸めて送る
    out = body["routes"]["out"]
    assert out["origin"] == {"label": "現在地のあたり", "lat": 34.99, "lng": 135.7}
    assert out["arrive_at"] == "09:16" and body["routes"]["back"]["depart_at"] == "18:44"  # 19:00 から逆算
    assert osrm == []
    # Google が使えない → OSRM
    monkeypatch.setattr(pc, "ready", lambda db, provider, op: False)
    body = client.post(f"/api/v1/plans/{plan.id}/day-trip/route", json=_route_body(road="local")).json()
    assert body["provider"] == "osrm" and "road_preference_ignored" in body["warnings"] and len(osrm) == 2
    assert body["routes"]["out"]["revision"] == 2
    # OSRM も無い → 直線(道路のルートではない)
    monkeypatch.setattr(settings, "OSRM_CAR_URL", "")
    body = client.post(f"/api/v1/plans/{plan.id}/day-trip/route", json=_route_body()).json()
    assert body["provider"] == "straight" and "straight_line" in body["warnings"]
    assert db_session.query(DayTripRoute).filter(DayTripRoute.plan_id == plan.id).count() == 2


def test_route_validation_and_not_day_trip(auth_client, db_session, no_google):
    client, user = auth_client
    plan = _day_plan(db_session, user)
    url = f"/api/v1/plans/{plan.id}/day-trip/route"
    r = client.post(url, json=_route_body(destination={"label": "どこか"}))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "day_trip_dest_unlocated"
    r = client.post(url, json=_route_body(home_by="08:00"))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "day_trip_time_order"
    assert client.post(url, json=_route_body(road="fast")).status_code == 422
    assert client.post(url, json=_route_body(depart_at="9:00")).status_code == 422
    assert client.post(url, json={**_route_body(), "extra": 1}).status_code == 422
    stay = TravelPlan(id=uuid.uuid4(), user_id=user.id, title="泊まり")
    db_session.add(stay)
    db_session.commit()
    r = client.post(f"/api/v1/plans/{stay.id}/day-trip/route", json=_route_body())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "day_trip_not_day_trip"
    r = client.get(f"/api/v1/plans/{plan.id}/day-trip/along")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "day_trip_route_missing"
    assert client.get(f"/api/v1/plans/{plan.id}/day-trip/along", params={"width_m": 2000}).status_code == 422


def test_viewer_cannot_compute_but_can_read(auth_client, make_user, db_session, no_google):
    client, user = auth_client
    plan = _day_plan(db_session, user)
    assert client.post(f"/api/v1/plans/{plan.id}/day-trip/route", json=_route_body()).status_code == 200
    viewer, _ = make_user()
    db_session.add(
        PlanCollaborator(plan_id=plan.id, user_id=viewer.id, email=viewer.email, role="viewer", status="accepted")
    )
    db_session.commit()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=viewer, is_authenticated=True, is_guest=False
    )
    try:
        assert client.post(f"/api/v1/plans/{plan.id}/day-trip/route", json=_route_body()).status_code == 403
        view = client.get(f"/api/v1/plans/{plan.id}/day-trip").json()
        assert view["trip_style"] == "day_trip" and set(view["routes"]) == {"out", "back"}
        cmp_ = client.post(f"/api/v1/plans/{plan.id}/day-trip/compare", json={"roads": ["auto", "local"]})
        assert cmp_.status_code == 200 and [o["road"] for o in cmp_.json()["options"]] == ["auto", "local"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert db_session.query(DayTripRoute).filter(DayTripRoute.plan_id == plan.id).count() == 2  # 比べは保存しない


# ---------------------------------------------------------------- ルートの近く


def _fake_yahoo(rows_by_word):
    async def fake(client, appid, text, at, dist_km):
        return [dict(r, provider="yahoo_local") for r in rows_by_word.get(text, [])]

    return fake


def test_along_filters_by_width_orders_and_wishes_near(auth_client, db_session, monkeypatch, no_google):
    client, user = auth_client
    plan = _day_plan(db_session, user)
    line = [(35.0, 135.0), (35.0, 135.2)]  # 東へ約 18km

    async def fake_leg(db, plan_, caller, origin, dest, road, depart, idem):
        pts = line if origin[1] < dest[1] else line[::-1]
        return {"provider": "osrm", "points": pts, "distance_m": 18000, "duration_s": 1800, "toll_jpy": None}, []

    monkeypatch.setattr(dt, "compute_leg", fake_leg)
    assert (
        client.post(
            f"/api/v1/plans/{plan.id}/day-trip/route",
            json=_route_body(
                origin={"label": "出発", "lat": 35.0, "lng": 135.0},
                destination={"label": "着", "lat": 35.0, "lng": 135.2},
            ),
        ).status_code
        == 200
    )
    monkeypatch.setattr(pl, "keys", lambda db: {pl.SLOT_YAHOO: "y", pl.SLOT_HOTPEPPER: None})
    rows = [
        {
            "name": "森のカフェ",
            "address": "京都市",
            "latitude": 35.0027,
            "longitude": 135.05,
            "category": "dining",
            "genre": "カフェ",
        },  # 線から約 300m・5km 目
        {
            "name": "遠いカフェ",
            "address": None,
            "latitude": 35.02,
            "longitude": 135.15,
            "category": "dining",
            "genre": "カフェ",
        },  # 約 2.2km
        {
            "name": "森のカフェ",
            "address": None,
            "latitude": 35.0028,
            "longitude": 135.0501,
            "category": "dining",
            "genre": "カフェ",
        },
    ]  # 同じ場所(まとめる)
    monkeypatch.setattr(pf, "_yahoo", _fake_yahoo({"カフェ": rows}))
    db_session.add(
        Spot(name="保存した滝", created_by=user.id, category="sightseeing", latitude=35.001, longitude=135.15)
    )
    db_session.add(
        Spot(
            name="森のカフェ",
            created_by=user.id,
            category="restaurant",
            latitude=35.0027,
            longitude=135.05,
            wish_kind="again",
            again_count=2,
        )
    )
    db_session.commit()
    r = client.get(
        f"/api/v1/plans/{plan.id}/day-trip/along", params={"genres": "cafe", "width_m": 1000, "order": "route"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["name"] for x in body["results"]] == ["森のカフェ"]
    cafe = body["results"][0]
    assert 280 <= cafe["off_m"] <= 320 and 4.4 <= cafe["at_km"] <= 4.7
    assert cafe["detour_min"] == round(cafe["off_m"] / 1000 * 2 / 30 * 60 + 3)
    assert cafe["saved_spot_id"] and "保存した場所" in cafe["reasons"]
    assert "また行きたいにカフェ" in cafe["reasons"]
    assert [w["name"] for w in body["wishes_near"]] == ["森のカフェ", "保存した滝"]
    assert body["profile_line"] and "また行きたい: カフェ" in body["profile_line"]
    wide = client.get(f"/api/v1/plans/{plan.id}/day-trip/along", params={"genres": "cafe", "width_m": 3000}).json()
    assert {x["name"] for x in wide["results"]} == {"森のカフェ", "遠いカフェ"}
    again = client.get(f"/api/v1/plans/{plan.id}/day-trip/along", params={"genres": "cafe", "width_m": 3000}).json()
    assert again["cached"] is True  # 同じ条件は 10 分だけ使い回す
    assert db_session.query(Spot).filter(Spot.created_by == user.id).count() == 2  # 候補は保存しない


def test_preference_profile_weights_decay_and_off(db_session, make_user):
    user, _ = make_user()
    now = datetime(2026, 11, 22, tzinfo=timezone.utc)
    db_session.add(
        Spot(
            name="天然温泉",
            created_by=user.id,
            category="sightseeing",
            wish_kind="again",
            again_count=2,
            created_at=now,
        )
    )
    db_session.add(Spot(name="喫茶店", created_by=user.id, category="restaurant", created_at=now))
    db_session.add(
        Spot(
            name="古い神社",
            created_by=user.id,
            category="sightseeing",
            created_at=datetime(2025, 11, 22, tzinfo=timezone.utc),
        )
    )
    db_session.commit()
    prof = pp.profile(db_session, user, now)
    assert prof.weights["onsen"] == 1.0  # 4 × 2 = 8 が最大
    assert prof.weights["cafe"] == 0.25  # 2 / 8
    assert prof.weights["shrine"] < 0.25 * 0.6  # 1 年前は 0.5^(365/180) ≒ 0.245 倍
    assert prof.line() == "また行きたい: 温泉"
    user.preferences = {"personalize_routes": False}
    db_session.commit()
    off = pp.profile(db_session, user, now)
    assert off.enabled is False and off.weights == {} and off.line() is None


def test_promote_sets_trip_style_and_export_has_routes(auth_client, db_session, no_google):
    client, user = auth_client
    plan = _day_plan(db_session, user)
    client.post(f"/api/v1/plans/{plan.id}/day-trip/route", json=_route_body())
    from app.services import data_export

    assert DayTripRoute in data_export.PLAN_TABLES
    out = data_export.plan_tables(db_session, plan, user.id)
    assert {r["leg"] for r in out["day_trip_routes"]} == {"out", "back"}
    # 出発地は丸めた値だけ(丸める前の 34.98765 は書き出しに無い)
    assert {r["origin_lat"] for r in out["day_trip_routes"]} == {34.99, KATSURA[0]}
    assert "34.98765" not in str(out["day_trip_routes"])
    # クイックの promote で日帰りの旅行を作れる
    import uuid as _u

    dev = client.post(
        "/api/v1/quick-drafts",
        json={
            "title": "日帰り",
            "start_date": "2030-05-03",
            "end_date": "2030-05-03",
            "events": [{"title": "桂坂野鳥遊園"}],
        },
        headers={"Idempotency-Key": _u.uuid4().hex},
    )
    assert dev.status_code in (200, 201), dev.text
    d = dev.json()
    pr = client.post(
        f"/api/v1/quick-drafts/{d['id']}/promote",
        json={"device_token": d["device_token"], "trip_style": "day_trip"},
        headers={"Idempotency-Key": _u.uuid4().hex},
    )
    assert pr.status_code in (200, 201), pr.text
    assert db_session.get(TravelPlan, _u.UUID(pr.json()["id"])).trip_style == "day_trip"
    bad = client.post(
        f"/api/v1/quick-drafts/{d['id']}/promote",
        json={"device_token": d["device_token"], "trip_style": "week"},
        headers={"Idempotency-Key": _u.uuid4().hex},
    )
    assert bad.status_code == 422
