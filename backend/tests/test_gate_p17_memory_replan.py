"""
[Gate P17] FR-057 Memory Replan の統合テスト(実PostgreSQL)。

検証する主な性質:
- 過去の旅行の予定と実績から、根拠(件数・旅行・例)つきの傾向を出す。件数が足りなければ出さない
  (滞在が予定より長い/短い・到着の遅れ・行かないことが多い種類)
- 提案は旅程を変えない。適用は If-Match と input_fingerprint で確認し、1つの変更セットで「元に戻す」可能
- 確定(ロック)・予約付きの予定と、その後ろは動かさない。24時を超えるずらしは作らない
- 入力が変わったら409 replan_stale。権限(viewerは見るだけ)。他の人の旅行(参加していない)は材料にしない
"""
import uuid

import pytest

from app.api.v1 import memory_replan as api_mod
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator
from app.services import memory_replan as mr


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(api_mod, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _trip(client, title, date_str, items):
    """items: (名前, 種類, 時刻, 実績) 実績 = None | ('visited', 到着'HH:MM', 出発'HH:MM') | ('skipped',)"""
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": date_str, "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
    ev = {}
    for name, etype, t, actual in items:
        ev[name] = client.post(f"{base}/events", json={"day_id": d["id"], "title": name, "event_type": etype,
                                                       "local_start_time": t}, headers=_ik()).json()
        if actual and actual[0] == "visited":
            client.put(f"{base}/journey/events/{ev[name]['id']}", json={
                "status": "visited", "actual_start_at": f"{date_str}T{actual[1]}:00+09:00",
                "actual_end_at": f"{date_str}T{actual[2]}:00+09:00"})
        elif actual:
            client.put(f"{base}/journey/events/{ev[name]['id']}", json={"status": "skipped"})
    return p, base, d, ev


def _past(client):
    # 美術館は予定2時間(10:00→12:00)のところ、実際は2時間40分・2時間50分。到着は平均20分遅れ。買い物は行かないことが多い
    _trip(client, "金沢2025", "2025-05-01", [
        ("21世紀美術館", "museum", "10:00", ("visited", "10:20", "13:00")),
        ("昼食", "meal", "12:00", ("visited", "13:10", "14:00")),
        ("お土産", "shopping", "15:00", ("skipped",)),
    ])
    _trip(client, "上野2025", "2025-09-01", [
        ("国立博物館", "museum", "10:00", ("visited", "10:20", "13:10")),
        ("公園", "sightseeing", "12:00", ("visited", "13:20", "14:00")),
        ("アメ横", "shopping", "15:00", ("skipped",)),
    ])


# ---------------------------------------------------------------- 単体

def test_pure_functions():
    day = [{"id": "a", "local_start_time": "10:00"}, {"id": "b", "local_start_time": "12:30"},
           {"id": "c", "local_start_time": None}, {"id": "d", "local_start_time": "12:30"}]
    assert mr.planned_minutes(day) == {"a": 150}
    samples = [
        {"plan_id": "1", "plan_title": "A", "event_type": "museum", "title": "x", "status": "visited",
         "planned_minutes": 120, "actual_minutes": 160, "start_diff": 20},
        {"plan_id": "2", "plan_title": "B", "event_type": "museum", "title": "y", "status": "visited",
         "planned_minutes": 120, "actual_minutes": 170, "start_diff": 20},
        {"plan_id": "2", "plan_title": "B", "event_type": "meal", "title": "z", "status": "visited",
         "planned_minutes": 60, "actual_minutes": 50, "start_diff": 20},
    ]
    ins = mr.insights(samples)
    assert [(i["kind"], i["event_type"], i["minutes"], i["samples"]) for i in ins] == [
        ("stay_longer", "museum", 45, 2), ("late_arrival", None, 20, 3)]
    assert mr.insights(samples[:1]) == []  # 件数が足りない
    days = [{"id": "d1", "events": [
        {"id": "m", "title": "美術館", "event_type": "museum", "local_start_time": "10:00"},
        {"id": "l", "title": "昼食", "event_type": "meal", "local_start_time": "12:00"},
        {"id": "s", "title": "寺", "event_type": "sightseeing", "local_start_time": "14:00", "locked": True},
        {"id": "n", "title": "夜", "event_type": "meal", "local_start_time": "19:00"},
    ]}, {"id": "d2", "events": [
        {"id": "m2", "title": "美術館2", "event_type": "museum", "local_start_time": "22:00"},
        {"id": "x", "title": "深夜", "event_type": "other", "local_start_time": "23:30"},
    ]}]
    props = mr.proposals(ins, days, set())
    assert len(props) == 1
    p = props[0]
    assert [(c["title"], c["from"], c["to"]) for c in p["changes"]] == [("昼食", "12:00", "12:45")]
    assert {k["title"]: k["reason"] for k in p["kept"]} == {"寺": "locked", "深夜": "next_day"}
    # 予約付きの予定(昼食)の後ろは動かさない → 変える予定が無いので提案しない
    assert mr.proposals(ins, days, {"l"}) == []
    assert mr.fingerprint(days, set(), ins) != mr.fingerprint(days, {"l"}, ins)


# ---------------------------------------------------------------- API

def test_insights_and_apply_with_undo(auth_client, audit_calls):
    client, owner = auth_client
    _past(client)
    p, base, d, ev = _trip(client, "京都2026", "2026-11-01", [
        ("京都国立博物館", "museum", "10:00", None),
        ("湯豆腐", "meal", "12:00", None),
        ("清水寺", "sightseeing", "14:00", None),
    ])
    r = client.get(f"{base}/memory-replan")
    assert r.status_code == 200, r.text
    body = r.json()
    kinds = {(i["kind"], i["event_type"]): i for i in body["insights"]}
    museum = kinds[("stay_longer", "museum")]
    assert museum["minutes"] == 45 and museum["samples"] == 2 and museum["plans"] == ["上野2025", "金沢2025"]
    assert kinds[("often_skipped", "shopping")]["skipped"] == 2
    assert kinds[("late_arrival", None)]["minutes"] == 50  # (20+20+70+80)/4 を5分単位に
    assert body["can_apply"] is True and body["sample_count"] == 6
    prop = body["proposals"][0]
    expected = [("湯豆腐", "12:00", "12:45"), ("清水寺", "14:00", "14:45")]
    assert [(c["title"], c["from"], c["to"]) for c in prop["changes"]] == expected
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    assert body["plan_revision"] == rev  # 提案は旅程を変えない

    url = f"{base}/memory-replan/apply"
    payload = {"proposal_id": prop["id"], "input_fingerprint": body["input_fingerprint"]}
    assert client.post(url, json=payload).status_code == 400
    assert client.post(url, json=payload, headers={"If-Match": str(rev + 5)}).status_code == 409
    r = client.post(url, json=payload, headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == 2 and r.json()["plan_revision"] == rev + 1
    times = {e["title"]: e["local_start_time"] for dd in client.get(f"/api/v1/plans/{p}").json()["days"]
             for e in dd["events"]}
    assert times == {"京都国立博物館": "10:00", "湯豆腐": "12:45", "清水寺": "14:45"}
    assert all("湯豆腐" not in str(c) for c in audit_calls)
    # 同じ提案をもう一度は使えない(入力が変わった)
    r = client.post(url, json=payload, headers={"If-Match": str(rev + 1)})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "replan_stale"
    # 「元に戻す」で戻る
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    times = {e["title"]: e["local_start_time"] for dd in client.get(f"/api/v1/plans/{p}").json()["days"]
             for e in dd["events"]}
    assert times["湯豆腐"] == "12:00"


def test_locked_and_permissions(auth_client, make_user, db_session):
    client, owner = auth_client
    _past(client)
    p, base, d, ev = _trip(client, "京都2026", "2026-11-01", [
        ("京都国立博物館", "museum", "10:00", None),
        ("湯豆腐", "meal", "12:00", None),
        ("清水寺", "sightseeing", "14:00", None),
    ])
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    r = client.put(f"/api/v1/plans/{p}/events/{ev['湯豆腐']['id']}", json={"locked": True},
                   headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    body = client.get(f"{base}/memory-replan").json()
    assert body["proposals"] == []  # ロックした予定の後ろは動かさないため、変える予定が無い

    member, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(member)
        got = client.get(f"{base}/memory-replan").json()
        # 参加していない旅行(所有者の過去の旅行)は材料にしない
        assert got["insights"] == [] and got["sample_count"] == 0 and got["can_apply"] is False
        assert client.post(f"{base}/memory-replan/apply", json={"proposal_id": "x", "input_fingerprint": "y"},
                           headers={"If-Match": "1"}).status_code == 403
    finally:
        _act_as(owner)
    bad = {"proposal_id": "nope", "input_fingerprint": body["input_fingerprint"]}
    r = client.post(f"{base}/memory-replan/apply", json=bad, headers={"If-Match": str(rev + 1)})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "proposal_not_found"
