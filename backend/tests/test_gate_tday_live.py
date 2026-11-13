"""[Gate TDay] 旅の当日「旅帖ライブ」の試験(実PostgreSQL)。

- 出発の合図: 移動区間が無い時は一つ前の(位置のある)予定からの概算で「出る時刻」を出し、出所を estimate とする
- すきま時間: 終わりの分かる予定(end_at・既定の滞在の見積もり)と次に出る時刻の間の 30 分以上
- 旅帖の印: 実績の「行った」と記録の数。旅の何日目か・最終日・旅の前の日数
- 寄り道: 前後の予定を結ぶ道の近く(2km 以内)だけ。旅程にある場所は出さない。場所が無ければ探さない
- 到着予定の共有: 位置は持たない・期限つき・本人が止められる・旅行から外れた人は出ない・期限の検査
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator
from app.services import eta_share, today_guide, today_mode
from app.services import place_finder as pf


@pytest.fixture(autouse=True)
def _reset():
    eta_share.reset_for_testing()
    yield
    eta_share.reset_for_testing()


def _utc(*a) -> datetime:
    return datetime(*a, tzinfo=timezone.utc)


@pytest.fixture
def freeze_now(monkeypatch):
    def _f(dt: datetime):
        monkeypatch.setattr(today_mode, "utcnow", lambda: dt)
    return _f


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client, title="TDay 大津") -> str:
    r = client.post("/api/v1/travel-plans/", json={"title": title})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _day(client, plan_id, d, tz="Asia/Tokyo", title=None) -> str:
    body = {"local_date": d, "timezone_id": tz}
    if title:
        body["title"] = title
    r = client.post(f"/api/v1/plans/{plan_id}/days", json=body, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _event(client, plan_id, day_id, title, **f) -> str:
    r = client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": title, **f}, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _guide(client, plan_id) -> dict:
    r = client.get(f"/api/v1/plans/{plan_id}/today/guide")
    assert r.status_code == 200, r.text
    return r.json()


def _as(user) -> None:
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# ---- 純粋関数 ----------------------------------------------------------------------------------------------------

def test_stage_thresholds_match_the_screen():
    assert [today_guide.stage(m) for m in (None, 38, 21, 20, 1, 0, -4, -5)] == [
        None, "relaxed", "relaxed", "soon", "soon", "now", "now", "late"]


def test_leave_by_prefers_segment_departure():
    start = _utc(2026, 11, 13, 3, 30)
    dep = _utc(2026, 11, 13, 3, 5)
    assert today_guide.leave_by(start, dep, 12) == dep
    assert today_guide.leave_by(start, None, 12) == _utc(2026, 11, 13, 3, 18)
    assert today_guide.leave_by(start, None, None) is None


def test_gaps_skip_unknown_end_and_past_and_short():
    S = today_guide.Slot
    now = _utc(2026, 11, 13, 4, 0)
    slots = [
        S("a", _utc(2026, 11, 13, 1, 0), _utc(2026, 11, 13, 2, 0), None, None),  # 過ぎた
        S("b", _utc(2026, 11, 13, 2, 30), None, 10, None),                       # 終わりが分からない
        S("c", _utc(2026, 11, 13, 5, 0), _utc(2026, 11, 13, 5, 55), 10, _utc(2026, 11, 13, 4, 50)),
        S("d", _utc(2026, 11, 13, 6, 45), _utc(2026, 11, 13, 7, 0), 5, _utc(2026, 11, 13, 6, 40)),
        S("e", _utc(2026, 11, 13, 7, 20), None, 5, _utc(2026, 11, 13, 7, 15)),   # 15 分しかない
    ]
    got = today_guide.gaps(slots, now)
    assert [(g["after_event_id"], g["before_event_id"], g["minutes"]) for g in got] == [("c", "d", 45)]


# ---- GET /today/guide ------------------------------------------------------------------------------------------

def test_guide_before_trip_returns_days_until(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13", title="湖のまち")
    _day(client, plan_id, "2026-11-14")
    _event(client, plan_id, d1, "自宅を出発", local_start_time="08:00")
    freeze_now(_utc(2026, 11, 12, 3, 0))  # 11/12 12:00 JST
    g = _guide(client, plan_id)
    assert g["day_id"] is None and g["events"] == {} and g["day_count"] == 2
    assert g["upcoming"] == {"date": "2026-11-13", "days_until": 1, "day_title": "湖のまち", "is_trip_start": True,
                             "first_event_title": "自宅を出発", "first_event_time": "08:00"}


def test_guide_estimates_leave_by_from_previous_place(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13", title="湖のまち")
    _day(client, plan_id, "2026-11-14")
    a = _event(client, plan_id, d1, "浜大津の湖岸", local_start_time="11:00", event_type="sightseeing",
               latitude=35.0128, longitude=135.8652)
    b = _event(client, plan_id, d1, "テラスでランチ", local_start_time="12:30", event_type="dining",
               latitude=35.0035, longitude=135.8770)
    no_place = _event(client, plan_id, d1, "おみやげ", local_start_time="14:00")
    d2 = client.get(f"/api/v1/plans/{plan_id}").json()["days"][1]["id"]
    _event(client, plan_id, d2, "三尾神社", local_start_time="09:30")
    freeze_now(_utc(2026, 11, 13, 3, 0))  # 12:00 JST
    g = _guide(client, plan_id)
    assert g["day_index"] == 1 and g["day_count"] == 2 and g["is_last_day"] is False
    assert g["local_date"] == "2026-11-13" and g["day_title"] == "湖のまち"
    assert g["next_day"] == {"date": "2026-11-14", "day_title": None, "event_count": 1,
                             "first_event_title": "三尾神社", "first_event_time": "09:30"}
    eb = g["events"][b]
    assert eb["travel_source"] == "estimate" and eb["travel_mode"] == "walking"
    assert eb["travel_minutes"] >= 1 and eb["distance_km"] > 0
    assert _parse(eb["leave_by"]) == _utc(2026, 11, 13, 3, 30) - timedelta(minutes=eb["travel_minutes"])
    # 一つ前に位置の無い予定は、さらに前の位置のある予定から(位置の無い予定自身は概算しない)
    assert g["events"][a]["travel_source"] is None and g["events"][a]["leave_by"] is None
    assert g["events"][no_place]["travel_minutes"] is None
    assert g["events"][b]["fit"] in ("indoor", "partly", "outdoor", "unknown")
    assert set(g["stamps"]) == {a, b, no_place} and g["metrics"]["total"] == 3


def test_guide_gaps_use_estimated_stay(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    x = _event(client, plan_id, d1, "本要寺", local_start_time="14:15", event_type="sightseeing",
               latitude=35.0100, longitude=135.8600)
    y = _event(client, plan_id, d1, "三尾神社", local_start_time="17:45", event_type="sightseeing",
               latitude=35.0110, longitude=135.8610)
    freeze_now(_utc(2026, 11, 13, 3, 0))
    g = _guide(client, plan_id)
    ex = g["events"][x]
    assert ex["end_estimated"] is True and ex["end_at"] is not None
    assert len(g["gaps"]) == 1
    gap = g["gaps"][0]
    assert gap["after_event_id"] == x and gap["before_event_id"] == y
    assert _parse(gap["start_at"]) == _parse(ex["end_at"]) and gap["minutes"] >= today_guide.MIN_GAP_MINUTES
    assert _parse(gap["end_at"]) == _parse(g["events"][y]["leave_by"])


def test_guide_stamps_follow_actuals_and_last_day(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    e = _event(client, plan_id, d1, "大津駅", local_start_time="10:30")
    freeze_now(_utc(2026, 11, 13, 2, 0))
    put = client.put(f"/api/v1/plans/{plan_id}/journey/events/{e}",
                     json={"status": "visited", "actual_start_at": "2026-11-13T01:31:00+00:00"})
    assert put.status_code == 200, put.text
    mem = client.post(f"/api/v1/plans/{plan_id}/memories", json={"kind": "note", "body": "湖が近い", "event_id": e})
    assert mem.status_code == 201, mem.text
    g = _guide(client, plan_id)
    assert g["is_last_day"] is True
    st = g["stamps"][e]
    assert st["status"] == "visited" and st["revision"] == 1 and st["memory_count"] == 1 and st["photo_count"] == 0
    assert _parse(st["actual_start_at"]) == _utc(2026, 11, 13, 1, 31)
    assert g["metrics"] == {"visited": 1, "total": 1, "photos": 0, "notes": 1}


def test_guide_requires_access(auth_client, make_user):
    client, _ = auth_client
    plan_id = _plan(client)
    stranger, _ = make_user()
    _as(stranger)
    r = client.get(f"/api/v1/plans/{plan_id}/today/guide")
    assert r.status_code in (403, 404)


# ---- POST /today/detours ---------------------------------------------------------------------------------------

def test_detours_between_two_events(auth_client, monkeypatch):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    a = _event(client, plan_id, d1, "本要寺", local_start_time="14:15", latitude=35.01, longitude=135.86)
    b = _event(client, plan_id, d1, "三尾神社", local_start_time="15:45", latitude=35.02, longitude=135.87)
    seen = {}

    async def fake_find(db, plan, query, genre, scope, record, points=None):
        seen.update(query=query, genre=genre, scope=scope, points=points)
        return {"candidates": [
            {"name": "湖のカフェ", "address": "大津市", "latitude": 35.015, "longitude": 135.865, "distance_km": 0.3,
             "genre_label": "カフェ", "category": "dining", "providers": ["openstreetmap"]},
            {"name": "遠い店", "latitude": 35.1, "longitude": 135.9, "distance_km": 4.2, "providers": ["openstreetmap"]},
            {"name": "本要寺", "latitude": 35.01, "longitude": 135.86, "distance_km": 0.0, "providers": ["openstreetmap"]},
        ], "region": {"label": "経路の近く", "radius_km": 5.0}, "sources": [], "failed_providers": []}

    monkeypatch.setattr(pf, "find", fake_find)
    r = client.post(f"/api/v1/plans/{plan_id}/today/detours",
                    json={"after_event_id": a, "before_event_id": b, "kind": "cafe"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert seen["scope"] == "route" and seen["genre"] == "cafe" and len(seen["points"]) == 2
    assert [c["name"] for c in body["candidates"]] == ["湖のカフェ"]
    assert body["candidates"][0]["provider"] == "openstreetmap"


def test_detours_without_places_does_not_search(auth_client, monkeypatch):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    a = _event(client, plan_id, d1, "どこか", local_start_time="14:15")

    async def boom(*a, **k):
        raise AssertionError("探さない")

    monkeypatch.setattr(pf, "find", boom)
    r = client.post(f"/api/v1/plans/{plan_id}/today/detours", json={"after_event_id": a})
    assert r.status_code == 200 and r.json()["candidates"] == [] and r.json()["message"]
    other = client.post(f"/api/v1/plans/{plan_id}/today/detours", json={"after_event_id": str(uuid.uuid4())})
    assert other.status_code == 404
    bad = client.post(f"/api/v1/plans/{plan_id}/today/detours", json={"after_event_id": a, "kind": "x"})
    assert bad.status_code == 422


# ---- 到着予定の共有 --------------------------------------------------------------------------------------------

def test_eta_share_lifecycle(auth_client, make_user, db_session, freeze_now):
    client, owner = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    e = _event(client, plan_id, d1, "テラス", local_start_time="12:30")
    friend, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=friend.id, email=friend.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    now = datetime.now(timezone.utc)
    freeze_now(now)
    base = f"/api/v1/plans/{plan_id}/today/eta"
    arrive = (now + timedelta(minutes=30)).replace(microsecond=0)
    r = client.put(base, json={"event_id": e, "arrive_at": arrive.isoformat(),
                               "until": (now + timedelta(hours=8)).isoformat()})
    assert r.status_code == 200, r.text
    mine = r.json()["shares"]
    assert len(mine) == 1 and mine[0]["is_self"] and mine[0]["label"] == "あなた"
    assert mine[0]["event_title"] == "テラス" and _parse(mine[0]["arrive_at"]) == arrive
    assert "latitude" not in mine[0] and "longitude" not in mine[0]

    _as(friend)
    seen = client.get(base).json()["shares"]
    assert len(seen) == 1 and seen[0]["is_self"] is False and seen[0]["label"] == owner.username
    assert client.delete(base).status_code == 204  # 友だちの止める操作は自分の分だけ(持ち主の共有は残る)
    assert len(client.get(base).json()["shares"]) == 1

    _as(owner)
    assert client.delete(base).status_code == 204
    assert client.get(base).json()["shares"] == []


def test_eta_validation(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    e = _event(client, plan_id, d1, "テラス", local_start_time="12:30")
    now = datetime.now(timezone.utc)
    freeze_now(now)
    base = f"/api/v1/plans/{plan_id}/today/eta"
    arrive = (now + timedelta(minutes=30)).isoformat()
    too_long = client.put(base, json={"event_id": e, "arrive_at": arrive,
                                      "until": (now + timedelta(hours=30)).isoformat()})
    past = client.put(base, json={"event_id": e, "arrive_at": arrive,
                                  "until": (now - timedelta(minutes=1)).isoformat()})
    naive = client.put(base, json={"event_id": e, "arrive_at": "2026-11-13T12:00:00",
                                   "until": (now + timedelta(hours=1)).isoformat()})
    other = client.put(base, json={"event_id": str(uuid.uuid4()), "arrive_at": arrive,
                                   "until": (now + timedelta(hours=1)).isoformat()})
    assert (too_long.status_code, past.status_code, naive.status_code, other.status_code) == (422, 422, 422, 404)


def test_eta_expires(auth_client):
    client, owner = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-11-13")
    e = _event(client, plan_id, d1, "テラス", local_start_time="12:30")
    eta_share.put(plan_id, str(owner.id), {"event_id": e, "arrive_at": "2026-11-13T03:30:00+00:00",
                                           "until": datetime.now(timezone.utc).timestamp() - 1})
    assert client.get(f"/api/v1/plans/{plan_id}/today/eta").json()["shares"] == []
