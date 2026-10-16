"""
[Gate P14] FR-054 Plan-to-Memory・FR-053 旅の達成指標の統合テスト(実PostgreSQL)。

検証する主な性質:
- 予定と実績を別の行で持ち、実績を記録しても予定(時刻・名前・本案のrevision)は変わらない
- 行った/行かなかった・到着と出発の検証(タイムゾーン必須・順序・行かなかった予定に時刻なし)、変更はIf-Match
- 実績の提案: 本人の軌跡(予定の場所から150m以内)→無ければ記録の日時。他の人の軌跡は使わない
- 予定と実績の差(分)、達成指標(分母0はNone)。他の人の非公開の記録は数えない
- 行かなかった予定を別の旅行へ戻す(戻し先の変更セットで「元に戻す」可能)。行った予定・同じ旅行・権限の無い旅行は拒否
- 権限: viewerは閲覧だけ。書き出しに含まれる。監査に予定名・メモを残さない
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.api.v1 import journey as journey_api
from app.api.v1 import location_tracks as tracks_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator
from app.services import journey as jr

NOW = datetime(2026, 11, 1, 1, 0, tzinfo=timezone.utc)
TEMPLE = (34.9948, 135.7850)
LUNCH = (35.0037, 135.7788)


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(journey_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(tracks_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(tracks_api, "_now", lambda: NOW)
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _setup(client, title="振り返りテスト"):
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    ev = {}
    for name, t, loc in (("清水寺", "10:00", TEMPLE), ("昼食", "12:00", LUNCH), ("美術館", "15:00", None)):
        body = {"day_id": d1["id"], "title": name, "local_start_time": t}
        if loc:
            body.update(latitude=loc[0], longitude=loc[1])
        ev[name] = client.post(f"{base}/events", json=body, headers=_ik()).json()
    return p, base, d1, ev


def _at(minutes):
    return (NOW + timedelta(minutes=minutes)).isoformat()


def _rows(client, base):
    return {e["title"]: e for d in client.get(f"{base}/journey").json()["days"] for e in d["events"]}


# ---------------------------------------------------------------- 単体

def test_pure_functions():
    planned = jr.planned_start(date(2026, 11, 1), "10:00", "Asia/Tokyo")
    assert planned == NOW
    assert jr.planned_start(date(2026, 11, 1), None, "Asia/Tokyo") is None
    assert jr.start_diff_minutes(planned, NOW + timedelta(minutes=25)) == 25
    pts = [{"t": NOW + timedelta(minutes=m), "lat": TEMPLE[0] + d, "lng": TEMPLE[1]}
           for m, d in ((0, 0.01), (5, 0.0005), (40, 0.0), (90, 0.02))]
    s = jr.suggest_actual({"latitude": TEMPLE[0], "longitude": TEMPLE[1]}, pts, [NOW])
    assert (s["basis"], s["actual_start_at"], s["actual_end_at"], s["points"]) == (
        "track", NOW + timedelta(minutes=5), NOW + timedelta(minutes=40), 2)
    s = jr.suggest_actual({"latitude": None, "longitude": None}, pts, [NOW + timedelta(minutes=30), NOW])
    assert (s["basis"], s["actual_start_at"]) == ("memory", NOW)
    assert jr.suggest_actual({"latitude": 0, "longitude": 0}, pts, []) is None
    m = jr.metrics(["a", "b", "c", "d"], {
        "a": {"status": "visited", "actual_start_at": NOW, "actual_end_at": NOW + timedelta(minutes=50)},
        "b": {"status": "visited", "actual_start_at": None, "actual_end_at": None},
        "c": {"status": "skipped"},
    }, ["a", "zz"], ["a", "c"], 1234.5)
    assert m["plan_achievement_rate"] == 0.5 and m["visit_rate"] == 0.6667 and m["photo_visit_rate"] == 0.5
    assert m["record_completion_rate"] == 0.75 and m["unrecorded"] == 1 and m["stay_minutes"] == 50
    assert m["memory_events"] == 2 and m["track_distance_m"] == 1234.5
    empty = jr.metrics([], {}, [], [], None)
    assert empty["plan_achievement_rate"] is None and empty["visit_rate"] is None and empty["stay_minutes"] is None


# ---------------------------------------------------------------- API

def test_record_actuals_without_touching_plan(auth_client, audit_calls):
    client, owner = auth_client
    p, base, d1, ev = _setup(client)
    rev_before = client.get(f"/api/v1/plans/{p}").json()["revision"]
    url = f"{base}/journey/events/{ev['清水寺']['id']}"
    r = client.put(url, json={"status": "visited", "actual_start_at": _at(25), "actual_end_at": _at(90),
                              "note": "混んでいた"})
    assert r.status_code == 200, r.text
    assert r.json()["actual"]["revision"] == 1
    client.put(f"{base}/journey/events/{ev['昼食']['id']}", json={"status": "skipped"})
    rows = _rows(client, base)
    assert rows["清水寺"]["actual"]["status"] == "visited" and rows["清水寺"]["start_diff_minutes"] == 25
    assert rows["清水寺"]["planned_time"] == "10:00"  # 予定は変えない
    assert rows["昼食"]["actual"]["status"] == "skipped" and rows["美術館"]["actual"] is None
    assert client.get(f"/api/v1/plans/{p}").json()["revision"] == rev_before  # 本案のrevisionは進まない
    m = client.get(f"{base}/journey").json()["metrics"]
    assert (m["visited"], m["skipped"], m["unrecorded"], m["plan_achievement_rate"], m["stay_minutes"]) == (
        1, 1, 1, 0.3333, 65)

    # 変更はIf-Match
    assert client.put(url, json={"status": "skipped"}).status_code == 400
    assert client.put(url, json={"status": "skipped"}, headers={"If-Match": "9"}).status_code == 409
    for payload, code in (
        ({"status": "gone"}, "invalid_field"),
        ({"status": "skipped", "actual_start_at": _at(0)}, "invalid_field"),
        ({"status": "visited", "actual_start_at": _at(10), "actual_end_at": _at(0)}, "invalid_field"),
        ({"status": "visited", "actual_start_at": "2026-11-01T10:00:00"}, "invalid_field"),
        ({"status": "visited", "source": "ai"}, "invalid_field"),
    ):
        res = client.put(url, json=payload, headers={"If-Match": "1"})
        assert res.status_code == 422 and res.json()["detail"]["code"] == code, (payload, res.text)
    assert client.put(url, json={"status": "visited", "extra": 1}, headers={"If-Match": "1"}).status_code == 422
    assert client.put(f"{base}/journey/events/{uuid.uuid4()}", json={"status": "visited"}).status_code == 404
    assert client.delete(url).status_code == 204
    assert _rows(client, base)["清水寺"]["actual"] is None
    assert client.delete(url).status_code == 404
    assert all("混んでいた" not in str(c) and "清水寺" not in str(c) for c in audit_calls)


def test_suggestions_use_only_own_track_and_visible_memories(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base, d1, ev = _setup(client)
    client.put("/api/v1/privacy/consents", json={"consents": {"location": True}})
    t = client.post(f"{base}/location-tracks", json={"mode": "synced", "precision": "high"}).json()
    pts = [{"recorded_at": _at(m), "latitude": TEMPLE[0] + d, "longitude": TEMPLE[1]}
           for m, d in ((20, 0.0), (70, 0.0005), (120, 0.05))]
    client.post(f"{base}/location-tracks/{t['id']}/points", json={"batch_id": str(uuid.uuid4()), "points": pts})
    member = _member(db_session, make_user, p)
    try:
        _act_as(member)
        client.post(f"{base}/memories", json={"body": "非公開", "event_id": ev["美術館"]["id"],
                                              "occurred_at": _at(300)})
        member_rows = _rows(client, base)
        assert member_rows["清水寺"]["suggestion"] is None  # 他の人の軌跡は使わない
        assert member_rows["美術館"]["suggestion"]["basis"] == "memory"
    finally:
        _act_as(owner)
    rows = _rows(client, base)
    s = rows["清水寺"]["suggestion"]
    assert (s["basis"], s["actual_start_at"], s["actual_end_at"]) == ("track", _at(20), _at(70))
    assert rows["美術館"]["suggestion"] is None and rows["美術館"]["memory_count"] == 0  # 他人の非公開の記録は数えない
    assert client.get(f"{base}/journey").json()["metrics"]["track_distance_m"] > 5000
    r = client.put(f"{base}/journey/events/{ev['清水寺']['id']}",
                   json={"status": "visited", "actual_start_at": s["actual_start_at"],
                         "actual_end_at": s["actual_end_at"], "source": "suggested"})
    assert r.json()["actual"]["source"] == "suggested"
    assert _rows(client, base)["清水寺"]["suggestion"] is None  # 時刻を記録したら提案しない


def _member(db_session, make_user, p, role="editor"):
    u, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=u.id, email=u.email, role=role, status="accepted"))
    db_session.commit()
    return u


def test_carry_over_and_permissions(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base, d1, ev = _setup(client)
    p2, base2, d2, _ev2 = _setup(client, title="次の旅行")
    client.put(f"{base}/journey/events/{ev['清水寺']['id']}", json={"status": "visited"})
    client.put(f"{base}/journey/events/{ev['昼食']['id']}", json={"status": "skipped"})
    rev = client.get(f"/api/v1/plans/{p2}").json()["revision"]
    body = {"target_plan_id": p2, "target_day_id": d2["id"]}
    r = client.post(f"{base}/journey/events/{ev['昼食']['id']}/carry-over", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["target_revision"] == rev + 1
    target = client.get(f"/api/v1/plans/{p2}").json()
    carried = [e for d in target["days"] for e in d["events"] if e["id"] == r.json()["event_id"]][0]
    assert carried["title"] == "昼食" and carried["latitude"] == LUNCH[0] and carried["local_start_time"] is None
    # 戻し先の「元に戻す」で取り消せる
    assert client.post(f"/api/v1/plans/{p2}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    assert all(e["id"] != carried["id"] for d in client.get(f"/api/v1/plans/{p2}").json()["days"] for e in d["events"])
    # 未記録の予定も戻せる。行った予定・同じ旅行・別の旅行の日は拒否
    assert client.post(f"{base}/journey/events/{ev['美術館']['id']}/carry-over", json=body).status_code == 201
    r = client.post(f"{base}/journey/events/{ev['清水寺']['id']}/carry-over", json=body)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_visited"
    r = client.post(f"{base}/journey/events/{ev['昼食']['id']}/carry-over",
                    json={"target_plan_id": p, "target_day_id": d1["id"]})
    assert r.json()["detail"]["code"] == "same_plan"
    r = client.post(f"{base}/journey/events/{ev['昼食']['id']}/carry-over",
                    json={"target_plan_id": p2, "target_day_id": d1["id"]})
    assert r.json()["detail"]["code"] == "day_not_found"

    viewer = _member(db_session, make_user, p, "viewer")
    try:
        _act_as(viewer)
        got = client.get(f"{base}/journey").json()
        assert got["can_edit"] is False and got["metrics"]["visited"] == 1
        assert client.put(f"{base}/journey/events/{ev['美術館']['id']}", json={"status": "visited"}).status_code == 403
        # 編集できない旅行へは戻せない
        assert client.post(f"{base}/journey/events/{ev['昼食']['id']}/carry-over", json=body).status_code == 403
    finally:
        _act_as(owner)

    exp = client.get(f"{base}/data-export").json()["plans"][0]["tables"]["event_actuals"]
    assert sorted(x["status"] for x in exp) == ["skipped", "visited"]
