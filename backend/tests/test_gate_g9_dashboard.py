"""
[Gate G9] UX-4 文脈型ダッシュボードの集約(GET /api/v1/dashboard)の試験(実PostgreSQL)。

- 段階(旅行中・旅行前・旅行後・日付なし)と焦点の旅行の選び方(純粋関数)
- 旅行が無い時は焦点が無い。旅行前は準備・遅延の要約、旅行中は NOW/NEXT、旅行後は焦点の要約を出さない
- 参加者は役割(閲覧者は編集できない)つきで見え、見せない設定の予約は準備の要約にも出ない
- 他人の旅行・削除した旅行は出ない(IDOR)
"""
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.api.v1 import dashboard as dash
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator

URL = "/api/v1/dashboard"
TOKYO = ZoneInfo("Asia/Tokyo")


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _today() -> date:
    return datetime.now(TOKYO).date()


def _trip(client, title, offsets, events=()):
    p = client.post("/api/v1/travel-plans/", json={"title": title, "destination": "京都"}).json()["id"]
    days = []
    for off in offsets:
        d = client.post(f"/api/v1/plans/{p}/days", json={
            "local_date": (_today() + timedelta(days=off)).isoformat(), "timezone_id": "Asia/Tokyo"}, headers=_ik())
        assert d.status_code == 201, d.text
        days.append(d.json())
    for title_, time_, event_type in events:
        r = client.post(f"/api/v1/plans/{p}/events", json={
            "day_id": days[0]["id"], "title": title_, "local_start_time": time_, "event_type": event_type},
            headers=_ik())
        assert r.status_code == 201, r.text
    return p


# ---------------------------------------------------------------- 純粋関数

def test_phase_and_focus_rules():
    t = date(2026, 11, 20)
    assert dash.phase_of(None, None, t) == "undated"
    assert dash.phase_of(date(2026, 11, 21), date(2026, 11, 22), t) == "upcoming"
    assert dash.phase_of(date(2026, 11, 19), date(2026, 11, 20), t) == "ongoing"
    assert dash.phase_of(date(2026, 11, 20), None, t) == "ongoing"
    assert dash.phase_of(date(2026, 11, 1), date(2026, 11, 2), t) == "past"

    def trip(i, phase, start=None, end=None, since=None, created=""):
        return {"id": i, "title": i, "phase": phase, "start_date": start, "end_date": end, "days_since_end": since,
                "created_at": created}
    trips = [trip("u2", "upcoming", "2026-12-10"), trip("u1", "upcoming", "2026-12-01"),
             trip("p", "past", "2026-11-01", "2026-11-02", 18), trip("n", "undated", created="2026-10-01")]
    assert dash.choose_focus(trips)["id"] == "u1"
    assert dash.choose_focus(trips + [trip("o", "ongoing", "2026-11-19")])["id"] == "o"
    assert dash.choose_focus([trips[2], trips[3]])["id"] == "p"
    assert dash.choose_focus([trip("old", "past", "2026-01-01", "2026-01-02", 300), trips[3]])["id"] == "n"
    assert dash.choose_focus([]) is None


# ---------------------------------------------------------------- API

def test_empty_and_phases_with_focus_details(auth_client):
    client, _owner = auth_client
    r = client.get(URL)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["trips"] == [] and body["focus"] is None and body["counts"]["ongoing"] == 0

    _trip(client, "先月の旅", [-10, -9])
    up = _trip(client, "来週の旅", [7, 8], events=[("ホテル", "15:00", "accommodation")])
    body = client.get(URL).json()
    assert [t["title"] for t in body["trips"]] == ["来週の旅", "先月の旅"]
    up_trip = body["trips"][0]
    assert up_trip["phase"] == "upcoming" and up_trip["days_until_start"] == 7 and up_trip["role"] == "owner"
    assert up_trip["can_edit"] is True and up_trip["total_days"] == 2 and up_trip["day_count"] == 2
    focus = body["focus"]
    assert focus["plan_id"] == up and focus["phase"] == "upcoming" and focus["today"] is None
    # 準備の要約は準備の画面(GET readiness)と同じ値
    ready = client.get(f"/api/v1/plans/{up}/readiness").json()
    assert focus["readiness"]["total"] == ready["counts"]["total"]
    assert [i["title"] for i in focus["readiness"]["top"]] == [i["title"] for i in ready["items"][:3]]
    assert any("ホテル" in (i["title"] or "") for i in focus["readiness"]["top"])  # 予約の無い宿泊
    assert focus["alerts"] == {"active": 0, "detected": 0, "top": []}
    past_trip = body["trips"][1]
    assert past_trip["phase"] == "past" and past_trip["days_since_end"] == 9

    # 旅行中は NOW/NEXT(当日の画面と同じ)
    now_local = datetime.now(TOKYO)
    later = (now_local + timedelta(hours=2)).strftime("%H:%M") if now_local.hour < 21 else "23:58"
    on = _trip(client, "今日の旅", [0], events=[("美術館", later, "museum")])
    body = client.get(URL).json()
    assert body["trips"][0]["id"] == on and body["trips"][0]["phase"] == "ongoing"
    assert body["trips"][0]["day_number"] == 1
    focus = body["focus"]
    assert focus["plan_id"] == on and focus["phase"] == "ongoing"
    today = client.get(f"/api/v1/plans/{on}/today").json()
    assert focus["today"]["today_date"] == today["today_date"] == _today().isoformat()
    assert (focus["today"]["next_event"] or {}).get("title") == (today["next_event"] or {}).get("title")
    assert body["counts"] == {"ongoing": 1, "upcoming": 1, "past": 1, "undated": 0}


def test_past_focus_has_no_details_and_undated(auth_client):
    client, _owner = auth_client
    _trip(client, "日付なし", [])
    body = client.get(URL).json()
    assert body["focus"]["phase"] == "undated" and body["focus"]["readiness"] is not None
    p = _trip(client, "終わった旅", [-3])
    body = client.get(URL).json()
    assert body["focus"] == {"plan_id": p, "phase": "past", "today": None, "readiness": None, "alerts": None}


def test_member_roles_policy_and_idor(auth_client, make_user, db_session):
    client, owner = auth_client
    p = _trip(client, "共同の旅", [5], events=[("ホテル", "15:00", "accommodation")])
    viewer, _ = make_user()
    stranger, _ = make_user()
    db_session.add(PlanCollaborator(id=uuid.uuid4(), plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email,
                                    role="viewer", status="accepted"))
    db_session.commit()
    # 閲覧者に予約を見せない設定(準備の「予約が無い」項目も隠れる)
    r = client.put(f"/api/v1/plans/{p}/member-policy", json={"roles": {"viewer": ["reservations"]}})
    assert r.status_code == 200, r.text
    owner_total = client.get(URL).json()["focus"]["readiness"]["total"]
    try:
        _act_as(viewer)
        body = client.get(URL).json()
        t = body["trips"][0]
        assert t["id"] == p and t["role"] == "viewer" and t["can_edit"] is False and t["member_count"] == 2
        ready = client.get(f"/api/v1/plans/{p}/readiness").json()
        assert body["focus"]["readiness"]["total"] == ready["counts"]["total"] < owner_total
        assert not any("ホテル" in (i["title"] or "") for i in body["focus"]["readiness"]["top"])
        _act_as(stranger)
        body = client.get(URL).json()
        assert body["trips"] == [] and body["focus"] is None
    finally:
        _act_as(owner)
    # 削除した旅行は出ない
    assert client.delete(f"/api/v1/travel-plans/{p}").status_code == 200
    assert client.get(URL).json()["trips"] == []


def test_requires_login(client):
    assert client.get(URL).status_code in (401, 403)
