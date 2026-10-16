"""
[Gate P15] FR-052 Personal Travel Atlas の統合テスト(実PostgreSQL)。

検証する主な性質:
- 区画(0.1度/1度)の計算と、状態の強さ(STAYED > VISITED > PASS_THROUGH > PLANNED)
- 材料: 行った実績(30分以上は滞在)・本人の位置付きの記録・本人の軌跡・これからの旅行の予定。他の人の記録・軌跡は使わない
- 複数の旅行を横断し、2つ以上の旅行で訪れた区画から再訪率を出す。年で絞り込める
- 旅行単位でAtlasから除ける(参加していない旅行は指定できない)。他の人のAtlasは見えない
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import atlas as atlas_api
from app.api.v1 import location_tracks as tracks_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator
from app.services import atlas as at

NOW = datetime(2026, 11, 1, 1, 0, tzinfo=timezone.utc)
KYOTO = (34.9948, 135.7850)
NARA = (34.6851, 135.8048)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    calls = []
    monkeypatch.setattr(atlas_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(atlas_api, "_now", lambda: NOW)
    monkeypatch.setattr(tracks_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(tracks_api, "_now", lambda: NOW)
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _plan(client, title, date, places):
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": date, "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
    ev = {}
    for name, loc in places:
        body = {"day_id": d["id"], "title": name}
        if loc:
            body.update(latitude=loc[0], longitude=loc[1])
        ev[name] = client.post(f"{base}/events", json=body, headers=_ik()).json()
    return p, base, ev


def _at(m):
    return (NOW + timedelta(minutes=m)).isoformat()


def test_cells_and_aggregate():
    assert at.cell_key(34.9948, 135.785, "region")["key"] == "0.1:34.9:135.7"
    assert at.cell_key(35.0, 135.7, "region")["key"] == "0.1:35.0:135.7"  # 境界の点
    assert at.cell_key(-33.86, 151.21, "area")["key"] == "1:-34:151"
    obs = [
        {"lat": 34.99, "lng": 135.78, "state": "PLANNED", "kind": "planned", "at": None,
         "plan_id": "b", "plan_title": "B"},
        {"lat": 34.95, "lng": 135.71, "state": "PASS_THROUGH", "kind": "track", "at": NOW,
         "plan_id": "a", "plan_title": "A"},
        {"lat": 34.99, "lng": 135.78, "state": "VISITED", "kind": "actual", "at": NOW + timedelta(days=1),
         "plan_id": "a", "plan_title": "A"},
        {"lat": None, "lng": 1, "state": "VISITED", "kind": "memory", "at": NOW, "plan_id": "a", "plan_title": "A"},
    ]
    cells = at.aggregate(obs, "region")
    assert len(cells) == 1
    c = cells[0]
    assert c["state"] == "VISITED" and c["first_at"] == NOW.isoformat() and c["evidence"] == {
        "actual": 1, "planned": 1, "track": 1}
    assert [t["plan_id"] for t in c["trips"]] == ["a", "b"]
    s = at.summarize(cells)
    assert s["visited_cells"] == 1 and s["revisit_rate"] == 1.0
    assert at.summarize([])["revisit_rate"] is None


def test_atlas_across_trips_with_privacy(auth_client, make_user, db_session):
    client, owner = auth_client
    p1, base1, ev1 = _plan(client, "京都2026", "2026-11-01", [("清水寺", KYOTO), ("奈良公園", NARA), ("駅", None)])
    p2, base2, ev2 = _plan(client, "京都2027", "2027-04-01", [("清水寺再訪", KYOTO)])
    client.put(f"{base1}/journey/events/{ev1['清水寺']['id']}", json={
        "status": "visited", "actual_start_at": _at(0), "actual_end_at": _at(45)})
    client.put(f"{base1}/journey/events/{ev1['奈良公園']['id']}", json={"status": "visited"})
    # 本人の位置付きの記録と軌跡
    client.post(f"{base1}/memories", json={"body": "嵐山", "latitude": 35.0094, "longitude": 135.6668,
                                           "occurred_at": _at(200)})
    client.put("/api/v1/privacy/consents", json={"consents": {"location": True}})
    t = client.post(f"{base1}/location-tracks", json={"mode": "synced", "precision": "low"}).json()
    client.post(f"{base1}/location-tracks/{t['id']}/points", json={"batch_id": str(uuid.uuid4()), "points": [
        {"recorded_at": _at(100), "latitude": 34.80, "longitude": 135.75}]})
    # 他の人の記録・軌跡は使わない
    member, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p1), user_id=member.id, email=member.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(member)
        client.post(f"{base1}/memories", json={"body": "他の人", "latitude": 43.06, "longitude": 141.35,
                                               "visibility": "members"})
        member_atlas = client.get("/api/v1/atlas").json()
        # 参加者も旅行の実績(共有データ)は見えるが、所有者の記録・軌跡は含まない
        keys = {c["key"]: c["state"] for c in member_atlas["cells"]}
        assert keys.get("0.1:34.9:135.7") == "STAYED" and "0.1:35.0:135.6" not in keys and "0.1:34.8:135.7" not in keys
        assert "0.1:43.0:141.3" in keys
    finally:
        _act_as(owner)

    a = client.get("/api/v1/atlas").json()
    states = {c["key"]: c["state"] for c in a["cells"]}
    assert states == {
        "0.1:34.9:135.7": "STAYED",  # 45分の滞在(2027年の予定もこの区画)
        "0.1:34.6:135.8": "VISITED",
        "0.1:35.0:135.6": "VISITED",  # 本人の記録
        "0.1:34.8:135.7": "PASS_THROUGH",  # 本人の軌跡
    }
    kyoto = next(c for c in a["cells"] if c["key"] == "0.1:34.9:135.7")
    assert [t["title"] for t in kyoto["trips"]] == ["京都2026", "京都2027"]
    assert kyoto["evidence"] == {"actual": 1, "planned": 1}
    assert a["summary"]["visited_cells"] == 3 and a["summary"]["revisit_rate"] == 0.3333
    assert a["years"] == [2026, 2027]
    assert {p["title"]: p["observations"] for p in a["plans"]} == {"京都2026": 4, "京都2027": 1}
    assert len(client.get("/api/v1/atlas", params={"year": 2027}).json()["cells"]) == 1
    area = client.get("/api/v1/atlas", params={"precision": "area"}).json()
    assert [c["key"] for c in area["cells"]] == ["1:34:135", "1:35:135"]
    assert client.get("/api/v1/atlas", params={"precision": "city"}).status_code == 422

    # 旅行単位で除く
    r = client.put("/api/v1/atlas/settings", json={"excluded_plan_ids": [p2]})
    assert r.status_code == 200 and r.json()["excluded_plan_ids"] == [p2]
    a2 = client.get("/api/v1/atlas").json()
    assert next(c for c in a2["cells"] if c["key"] == "0.1:34.9:135.7")["evidence"] == {"actual": 1}
    assert {p["title"]: p["excluded"] for p in a2["plans"]} == {"京都2026": False, "京都2027": True}
    stranger, _ = make_user()
    try:
        _act_as(stranger)
        assert client.get("/api/v1/atlas").json()["cells"] == []  # 他の人のAtlasは見えない
        r = client.put("/api/v1/atlas/settings", json={"excluded_plan_ids": [p1]})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "unknown_plan"
    finally:
        _act_as(owner)
    assert client.put("/api/v1/atlas/settings", json={"excluded_plan_ids": [], "x": 1}).status_code == 422
