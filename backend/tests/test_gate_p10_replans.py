"""
[Gate P10] FR-030 外部状況(アラート)・FR-031 安全な再計画の統合テスト(実PostgreSQL)。

検証する主な性質:
- 案の生成(純粋関数): 遅延は「後ろをずらす(A)」「後ろの時刻を守る(B)」、休業・天候は「外す(A)」「翌日へ移す(B)」。
  守る予定(確定・予約付き)は時刻・日を変えず外さない。紐付きのある予定は外さず注意を付ける。日付越えは外す
- アラート: 情報源・取得時刻・確度を持つ。未来の取得時刻・時刻のない予定の遅延・遅れの範囲外は422。古い情報はis_stale
- 再計画案を作っても本案(予定・revision)は変わらない(承認前に共有旅程を変えない)
- 適用: 1つの変更セット(source=replan)、アラートは解決、他のメンバーへ通知(本文に予定名なし)、「元に戻す」で全て戻る
- 案を作った後に本案が変わった → 409 replan_stale。紐付けが増えた → 409 replan_conflict。いずれも本案は変わらない
- 登録済み経路の遅延・運休の検出(アラート登録済みの予定は出さない)
- 権限: viewerは閲覧のみ、部外者403。監査に予定名・メモを残さない
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1 import replans as replans_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet, Notification, PlanCollaborator, TravelEvent
from app.services import replan as rp


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(replans_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _setup(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "再計画テスト旅行"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()

    def ev(day, title, t=None, **kw):
        body = {"day_id": day["id"], "title": title, "event_type": kw.pop("event_type", "sightseeing"), **kw}
        if t:
            body["local_start_time"] = t
        res = client.post(f"{base}/events", json=body, headers=_ik())
        assert res.status_code == 201, res.text
        return res.json()

    events = {
        "train": ev(d1, "新幹線で京都へ", "09:00", event_type="transport"),
        "temple": ev(d1, "清水寺", "10:00"),
        "lunch": ev(d1, "料亭で昼食", "12:00", event_type="meal"),
        "garden": ev(d1, "庭園散策", "14:00"),
        "late": ev(d1, "夜景", "22:30"),
        "arashiyama": ev(d2, "嵐山", "10:00"),
    }
    # 昼食は予約付き(守る予定)
    assert client.post(f"{base}/reservations", json={
        "type": "restaurant", "provider_name": "料亭", "event_id": events["lunch"]["id"]}).status_code == 201
    return client, owner, p, base, {"d1": d1, "d2": d2}, events


def _alert(client, base, **body):
    return client.post(f"{base}/alerts", json=body)


# ---------------------------------------------------------------- 単体(純粋関数)

def _base(events, days=("d1", "d2")):
    return {
        "days": [{"id": d, "local_date": f"2026-11-0{i + 1}", "timezone_id": "Asia/Tokyo", "title": None}
                 for i, d in enumerate(days)],
        "events": [
            {"key": k, "source_event_id": k, "day_id": day, "title": k, "event_type": etype,
             "local_start_time": t, "is_all_day": False, "sort_order": i, "locked": False, "removed": False,
             "note": None, "fixed": fixed, "related": related or fixed, "has_reservation": fixed}
            for i, (k, day, t, etype, fixed, related) in enumerate(events)
        ],
    }


def test_delay_candidates_protect_fixed_events():
    base = _base([
        ("a", "d1", "09:00", "transport", False, False),
        ("b", "d1", "10:00", "sightseeing", False, False),
        ("r", "d1", "12:00", "meal", True, True),
        ("c", "d1", "14:00", "sightseeing", False, False),
    ])
    alert = {"kind": "delay", "event_id": "a", "day_id": "d1", "delay_minutes": 120}
    a, b = rp.generate_candidates(alert, base)
    times_a = {e["key"]: (e["local_start_time"], e["removed"]) for e in a["content"]}
    # A: aは11:00、bは12:00で守る予定rに重なるため外す。r・cは動かさない
    assert times_a == {"a": ("11:00", False), "b": ("10:00", True), "r": ("12:00", False), "c": ("14:00", False)}
    times_b = {e["key"]: (e["local_start_time"], e["removed"]) for e in b["content"]}
    # B: aだけ遅らせ(予定時間60分→12:00まで)、重なるbを外し、後ろは元の時刻
    assert times_b == {"a": ("11:00", False), "b": ("10:00", True), "r": ("12:00", False), "c": ("14:00", False)}
    ev = rp.evaluate(base, a, ["d1"])
    assert ev["metrics"]["max_delay_minutes"] == 120 and ev["metrics"]["lost_count"] == 1
    assert [p["event_id"] for p in ev["protected"]] == ["r"]

    # 30分の遅れなら、Aはbも30分ずらして残す。Bはaの予定時間(60分)が10:30まで延びbと重なるためbを外す
    small = {**alert, "delay_minutes": 30}
    a, b = rp.generate_candidates(small, base)
    assert {e["key"]: e["local_start_time"] for e in a["content"]}["b"] == "10:30"
    assert not any(e["removed"] for e in a["content"])
    assert [e["key"] for e in b["content"] if e["removed"]] == ["b"]
    assert {e["key"]: e["local_start_time"] for e in b["content"]} == {"a": "09:30", "b": "10:00", "r": "12:00",
                                                                       "c": "14:00"}


def test_delay_fixed_target_overflow_and_related():
    base = _base([
        ("a", "d1", "21:00", "meal", True, True),
        ("b", "d1", "22:00", "sightseeing", False, True),  # 紐付きあり(外せない)
        ("c", "d1", "23:00", "sightseeing", False, False),
    ])
    a, _b = rp.generate_candidates({"kind": "cancellation", "event_id": "a", "day_id": "d1", "delay_minutes": 90},
                                   base)
    items = {e["key"]: e for e in a["content"]}
    assert items["a"]["local_start_time"] == "21:00" and "予約先へ連絡" in a["warnings"][0]
    assert items["b"]["local_start_time"] == "23:30" and not items["b"]["removed"]
    # cは日付を越えるため外す
    assert items["c"]["removed"] is True and "日付を越える" in items["c"]["note"]
    base2 = _base([("x", "d1", "23:00", "sightseeing", False, True)])
    a2, _ = rp.generate_candidates({"kind": "delay", "event_id": "x", "day_id": "d1", "delay_minutes": 120}, base2)
    # 紐付きのある予定は外さず注意を付けて残す
    assert a2["content"][0]["removed"] is False and "紐付けがある" in a2["warnings"][0]


def test_closure_and_weather_candidates():
    base = _base([
        ("museum", "d1", "10:00", "museum", False, False),
        ("park", "d1", "13:00", "sightseeing", False, False),
        ("tour", "d1", "15:00", "activity", True, True),
        ("next", "d2", "10:00", "sightseeing", False, False),
    ])
    a, b = rp.generate_candidates({"kind": "closure", "event_id": "museum", "day_id": "d1", "delay_minutes": None},
                                  base)
    assert [e["key"] for e in a["content"] if e["removed"]] == ["museum"]
    moved = {e["key"]: e["day_id"] for e in b["content"]}
    assert moved["museum"] == "d2" and b["available"] is True
    w_a, w_b = rp.generate_candidates({"kind": "weather", "event_id": None, "day_id": "d1", "delay_minutes": None},
                                      base)
    assert [e["key"] for e in w_a["content"] if e["removed"]] == ["park"]  # 予約付きのツアーは外さない
    assert any("tour" in w or "確定済み" in w for w in w_a["warnings"])
    assert {e["key"]: e["day_id"] for e in w_b["content"]}["park"] == "d2"
    # 最終日には翌日が無い → Bは使えない
    last = rp.generate_candidates({"kind": "closure", "event_id": "next", "day_id": "d2", "delay_minutes": None},
                                  base)[1]
    assert last["available"] is False and "翌日の日程がない" in last["unavailable_reason"]


def test_validate_alert_and_staleness():
    base = _base([("a", "d1", "09:00", "sightseeing", False, False), ("n", "d1", None, "sightseeing", False, False)])
    assert rp.validate_alert("delay", "a", None, 60, base) == ("a", "d1")
    for args in [("delay", None, None, 60), ("delay", "a", None, 5), ("delay", "n", None, 60),
                 ("closure", "a", None, 30), ("weather", None, "zz", None), ("rain", "a", None, None)]:
        with pytest.raises(rp.ReplanError):
            rp.validate_alert(*args, base)
    now = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
    assert rp.is_stale(now - timedelta(hours=4), now) is True
    assert rp.is_stale(now - timedelta(minutes=30), now) is False and rp.is_stale(None, now) is True


# ---------------------------------------------------------------- API: アラート

def test_create_and_list_alerts_validation(auth_client, audit_calls):
    client, owner, p, base, days, ev = _setup(auth_client)
    res = _alert(client, base, kind="delay", event_id=ev["train"]["id"], delay_minutes=90,
                 source_label="駅の掲示", confidence="confirmed")
    assert res.status_code == 201, res.text
    a = res.json()
    assert a["kind_label"] == "遅延" and a["event_title"] == "新幹線で京都へ" and a["local_date"] == "2026-11-01"
    assert a["source"] == "user_report" and a["confidence"] == "confirmed" and a["is_stale"] is False
    assert a["status"] == "active" and a["latest_replan_id"] is None
    old = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    stale = _alert(client, base, kind="weather", day_id=days["d1"]["id"], observed_at=old).json()
    assert stale["is_stale"] is True and stale["event_id"] is None
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    assert _alert(client, base, kind="weather", day_id=days["d1"]["id"], observed_at=future).status_code == 422
    assert _alert(client, base, kind="delay", event_id=ev["train"]["id"], delay_minutes=5).status_code == 422
    assert _alert(client, base, kind="delay", event_id=str(uuid.uuid4()), delay_minutes=30).status_code == 422
    assert _alert(client, base, kind="closure", event_id=ev["temple"]["id"], delay_minutes=30).status_code == 422
    assert _alert(client, base, kind="flood", day_id=days["d1"]["id"]).status_code == 422
    listed = client.get(f"{base}/alerts").json()
    assert [x["kind"] for x in listed["alerts"]] == ["delay", "weather"] and listed["can_edit"] is True
    assert listed["detected"] == []
    assert "駅の掲示" not in str(audit_calls) and "新幹線" not in str(audit_calls)

    # 解決・取り下げ(If-Match)
    url = f"{base}/alerts/{a['id']}"
    assert client.patch(url, json={"status": "dismissed"}).status_code == 400
    assert client.patch(url, json={"status": "dismissed"}, headers={"If-Match": "99"}).status_code == 409
    done = client.patch(url, json={"status": "dismissed", "note": "運転再開"}, headers={"If-Match": "1"}).json()
    assert done["status"] == "dismissed" and done["resolved_at"] and done["note"] == "運転再開"
    assert client.post(f"{url}/replans").status_code == 409
    again = client.patch(url, json={"status": "active"}, headers={"If-Match": str(done["revision"])}).json()
    assert again["status"] == "active" and again["resolved_at"] is None


# ---------------------------------------------------------------- API: 再計画→適用→Undo

def test_replan_apply_notify_and_undo(auth_client, make_user, db_session, audit_calls):
    client, owner, p, base, days, ev = _setup(auth_client)
    editor, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=editor.id, email=editor.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    a = _alert(client, base, kind="delay", event_id=ev["train"]["id"], delay_minutes=120).json()
    rev = _rev(client, p)
    res = client.post(f"{base}/alerts/{a['id']}/replans")
    assert res.status_code == 201, res.text
    r = res.json()
    assert _rev(client, p) == rev  # 再計画案を作っても本案は変わらない
    assert r["status"] == "proposed" and r["is_stale"] is False and r["can_apply"] is True
    ca, cb = r["candidates"]
    assert (ca["id"], ca["strategy"], cb["strategy"]) == ("A", "shift_later", "keep_times")
    assert [x["title"] for x in ca["lost"]] == ["清水寺"]  # 11:00→12:00で予約付きの昼食に重なる
    assert [x["title"] for x in ca["protected"]] == ["料亭で昼食"] and ca["protected"][0]["has_reservation"]
    assert ca["metrics"]["max_delay_minutes"] == 120 and ca["notify_member_names"] == [editor.username]
    assert ca["cost_impact"]["currency"] == "JPY" and ca["cost_impact"]["lost_paid_count"] == 0
    changed = {c["title"]: (c["before_time"], c["after_time"]) for c in ca["changes"]}
    assert changed == {"新幹線で京都へ": ("09:00", "11:00")}

    url = f"{base}/replans/{r['id']}"
    assert client.post(f"{url}/apply", json={"candidate": "A"}).status_code == 400
    assert client.post(f"{url}/apply", json={"candidate": "A"}, headers={"If-Match": "999"}).status_code == 409
    assert client.post(f"{url}/apply", json={"candidate": "C"}, headers={"If-Match": str(rev)}).status_code == 422
    done = client.post(f"{url}/apply", json={"candidate": "A"}, headers={"If-Match": str(rev)})
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["plan_revision"] == rev + 1 and body["replan"]["state"] == "applied"
    assert body["replan"]["applied_candidate"] == "A"
    detail = client.get(f"/api/v1/plans/{p}").json()
    titles = {e["title"]: e["local_start_time"] for d in detail["days"] for e in d["events"]}
    assert titles["新幹線で京都へ"] == "11:00" and "清水寺" not in titles and titles["料亭で昼食"] == "12:00"
    cs = db_session.query(ChangeSet).filter(ChangeSet.resulting_revision == rev + 1,
                                            ChangeSet.plan_id == uuid.UUID(p)).one()
    assert cs.source == "replan"
    alerts = client.get(f"{base}/alerts").json()["alerts"]
    assert alerts[0]["status"] == "resolved" and alerts[0]["latest_replan_status"] == "applied"
    notes = db_session.query(Notification).filter(Notification.related_plan_id == uuid.UUID(p),
                                                  Notification.type == "replan_applied").all()
    assert [n.user_id for n in notes] == [editor.id]
    assert "清水寺" not in notes[0].message and "新幹線" not in notes[0].message
    assert audit_calls[-1]["action"] == "replan_applied" and "清水寺" not in str(audit_calls)
    assert client.post(f"{url}/apply", json={"candidate": "A"},
                       headers={"If-Match": str(rev + 1)}).json()["detail"]["code"] == "replan_closed"

    undo = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)})
    assert undo.status_code == 200, undo.text
    restored = {e["title"]: e["local_start_time"] for d in client.get(f"/api/v1/plans/{p}").json()["days"]
                for e in d["events"]}
    assert restored["新幹線で京都へ"] == "09:00" and restored["清水寺"] == "10:00"
    assert client.get(url).json()["state"] == "applied_undone"


def test_closure_move_next_day_and_reject(auth_client):
    client, owner, p, base, days, ev = _setup(auth_client)
    a = _alert(client, base, kind="closure", event_id=ev["garden"]["id"], source_label="公式サイト").json()
    r = client.post(f"{base}/alerts/{a['id']}/replans").json()
    cb = r["candidates"][1]
    assert cb["strategy"] == "move_next_day" and cb["available"] is True
    assert cb["changes"][0]["after_date"] == "2026-11-02" and cb["changes"][0]["before_date"] == "2026-11-01"
    rej = client.post(f"{base}/replans/{r['id']}/reject", headers={"If-Match": str(r["revision"])})
    assert rej.status_code == 200 and rej.json()["status"] == "rejected" and rej.json()["can_apply"] is False
    rev = _rev(client, p)
    assert client.post(f"{base}/replans/{r['id']}/apply", json={"candidate": "B"},
                       headers={"If-Match": str(rev)}).json()["detail"]["code"] == "replan_closed"
    # 新しく作り直して翌日へ移す
    r2 = client.post(f"{base}/alerts/{a['id']}/replans").json()
    ok = client.post(f"{base}/replans/{r2['id']}/apply", json={"candidate": "B"}, headers={"If-Match": str(rev)})
    assert ok.status_code == 200, ok.text
    days_after = {e["title"]: d["local_date"] for d in client.get(f"/api/v1/plans/{p}").json()["days"]
                  for e in d["events"]}
    assert days_after["庭園散策"] == "2026-11-02"


def test_stale_and_conflict_do_not_touch_plan(auth_client):
    client, owner, p, base, days, ev = _setup(auth_client)
    a = _alert(client, base, kind="delay", event_id=ev["train"]["id"], delay_minutes=120).json()
    r = client.post(f"{base}/alerts/{a['id']}/replans").json()
    # 案を作った後に本案を変える → 古い案
    rev = _rev(client, p)
    assert client.put(f"/api/v1/plans/{p}/events/{ev['arashiyama']['id']}", json={"title": "嵯峨野"},
                      headers={"If-Match": str(rev)}).status_code == 200
    rev2 = _rev(client, p)
    assert client.get(f"{base}/replans/{r['id']}").json()["is_stale"] is True
    res = client.post(f"{base}/replans/{r['id']}/apply", json={"candidate": "A"}, headers={"If-Match": str(rev2)})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "replan_stale"
    assert _rev(client, p) == rev2

    # 作り直した後、外す予定(清水寺)へ予約を紐付ける(本案のrevisionは変わらない) → 紐付けを失わせない
    r2 = client.post(f"{base}/alerts/{a['id']}/replans").json()
    assert client.post(f"{base}/reservations", json={
        "type": "activity", "provider_name": "拝観", "event_id": ev["temple"]["id"]}).status_code == 201
    res = client.post(f"{base}/replans/{r2['id']}/apply", json={"candidate": "A"}, headers={"If-Match": str(rev2)})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "replan_conflict"
    reasons = {c["reason"] for c in res.json()["detail"]["conflicts"]}
    assert "has_relations" in reasons
    assert _rev(client, p) == rev2


def test_deleted_target_and_detected_route_status(auth_client):
    client, owner, p, base, days, ev = _setup(auth_client)
    a = _alert(client, base, kind="closure", event_id=ev["garden"]["id"]).json()
    rev = _rev(client, p)
    assert client.delete(f"/api/v1/plans/{p}/events/{ev['garden']['id']}",
                         headers={"If-Match": str(rev)}).status_code == 200
    listed = client.get(f"{base}/alerts").json()["alerts"][0]
    assert listed["event_missing"] is True and listed["event_title"] is None
    res = client.post(f"{base}/alerts/{a['id']}/replans")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "alert_target_changed"

    # 登録済み経路(採用した経路候補)の区間が運休 → 検出に出る
    opt = client.post(f"{base}/route-options", json={
        "from_event_id": ev["train"]["id"], "to_event_id": ev["temple"]["id"],
        "legs": [{"mode": "train", "departure_at": "2026-11-01T00:10:00Z"}]}, headers=_ik())
    assert opt.status_code == 201, opt.text
    option = opt.json()
    leg = option["legs"][0]
    assert client.patch(f"{base}/route-options/{option['id']}/legs/{leg['id']}", json={"realtime_status": "cancelled"},
                        headers={"If-Match": str(_rev(client, p))}).status_code == 200
    assert client.post(f"{base}/route-options/{option['id']}/adopt",
                       headers={"If-Match": str(_rev(client, p))}).status_code == 200
    detected = client.get(f"{base}/alerts").json()["detected"]
    assert len(detected) == 1 and detected[0]["event_title"] == "清水寺"
    assert detected[0]["transport_status"] == "cancelled" and detected[0]["suggested_kind"] == "cancellation"
    _alert(client, base, kind="cancellation", event_id=ev["temple"]["id"], delay_minutes=60, source="route_status")
    assert client.get(f"{base}/alerts").json()["detected"] == []


def test_permissions(auth_client, make_user, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    a = _alert(client, base, kind="weather", day_id=days["d1"]["id"]).json()
    r = client.post(f"{base}/alerts/{a['id']}/replans").json()
    viewer, _ = make_user()
    outsider, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(viewer)
    listed = client.get(f"{base}/alerts").json()
    assert listed["can_edit"] is False and len(listed["alerts"]) == 1
    detail = client.get(f"{base}/replans/{r['id']}").json()
    assert detail["can_apply"] is False
    assert _alert(client, base, kind="weather", day_id=days["d1"]["id"]).status_code == 403
    assert client.post(f"{base}/alerts/{a['id']}/replans").status_code == 403
    assert client.post(f"{base}/replans/{r['id']}/apply", json={"candidate": "A"},
                       headers={"If-Match": "1"}).status_code == 403
    _act_as(outsider)
    assert client.get(f"{base}/alerts").status_code == 403
    assert client.get(f"{base}/replans/{r['id']}").status_code == 403
    _act_as(owner)
    assert client.get(f"{base}/replans/{uuid.uuid4()}").status_code == 404
    assert client.get(f"{base}/replans/not-a-uuid").status_code == 404
    # 削除された予定は検出・再計画の対象外(他のプランの予定は使えない)
    assert db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(ev["temple"]["id"])).count() == 1
