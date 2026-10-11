"""
[Gate P7] FR-019 What-if・旅程ブランチの統合テスト(実PostgreSQL)。

検証する主な性質:
- 分岐案を作っても本案(予定・revision)は変わらない
- 想定ごとの自動変更: 遅延(指定日・指定時刻以降をN分遅らせる、日付越えは23:59で注意)、雨天(注意のみ)、
  体力(1日の上限を超える予定を外す候補に)。確定(ロック)した予定は動かさない
- 分岐案の編集(If-Match)・検証、本案との差分(追加・外す・変更)、日ごとの件数
- 採用: 1つの変更セットとして本案へ適用し、本案の「元に戻す」で全て戻る。開始日時を持つ予定は時刻に合わせて動く
- 競合: 分岐後に本案で同じ項目が変わった・削除された・確定された・紐付きのある予定を外す → 409、本案は変わらない
- 権限: viewerは閲覧のみ。部外者403。監査に予定名を残さない
"""
import uuid

import pytest

from app.api.v1 import branches as branches_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator, TravelEvent
from app.services import branches as br


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(branches_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _setup(auth_client):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "分岐テスト旅行"}).json()["id"]
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
        "kiyomizu": ev(d1, "清水寺", "09:00"),
        "lunch": ev(d1, "昼食", "12:00", event_type="meal"),
        "museum": ev(d1, "博物館", "14:00", event_type="museum", start_at="2026-11-01T05:00:00Z",
                     end_at="2026-11-01T07:00:00Z"),
        "dinner": ev(d1, "夕食", "22:30", event_type="meal"),
        "arashiyama": ev(d2, "嵐山", "10:00"),
    }
    return client, owner, p, base, {"d1": d1, "d2": d2}, events


def _plan_rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _create(client, base, **body):
    payload = {"title": "案", "scenario_type": "custom"}
    payload.update(body)
    return client.post(f"{base}/branches", json=payload)


# ---------------------------------------------------------------- 単体

def test_time_helpers_and_assumptions():
    assert br.to_minutes("09:30") == 570 and br.from_minutes(570) == "09:30"
    assert br.valid_time("23:59") and not br.valid_time("24:00") and br.valid_time(None)
    assert br.assumptions_ok("budget", {"budget_cut_percent": 30}) == (True, None)
    assert br.assumptions_ok("budget", {"budget_cut_percent": 95})[0] is False
    assert br.assumptions_ok("custom", {"unknown": 1})[0] is False


# ---------------------------------------------------------------- 作成・想定

def test_create_delay_branch_does_not_touch_plan(auth_client, audit_calls):
    client, owner, p, base, days, ev = _setup(auth_client)
    rev = _plan_rev(client, p)
    res = _create(client, base, title="電車が2時間遅延", scenario_type="delay",
                  assumptions={"day_id": days["d1"]["id"], "after": "11:00", "minutes": 120})
    assert res.status_code == 201, res.text
    b = res.json()
    assert _plan_rev(client, p) == rev  # 本案は変わらない
    times = {i["title"]: (i["local_start_time"], i["note"]) for i in b["content"]}
    assert times["清水寺"] == ("09:00", None)
    assert times["昼食"] == ("14:00", "12:00から120分遅らせました")
    assert times["博物館"][0] == "16:00"
    assert times["夕食"] == ("23:59", "120分遅らせると日付を越えるため23:59にしました(要調整)")
    assert times["嵐山"] == ("10:00", None)
    assert b["summary"] == {"added": 0, "removed": 0, "updated": 3, "time_changed": 3}
    assert b["conflicts"] == [] and b["state"] == "draft" and b["plan_changed_since_base"] is False
    assert [d["plan"] for d in b["day_counts"]] == [4, 1]
    assert audit_calls[-1]["action"] == "branch_created" and "清水寺" not in str(audit_calls)
    assert _create(client, base, scenario_type="delay", assumptions={"day_id": "x", "minutes": 60}).status_code == 422
    assert _create(client, base, scenario_type="delay",
                   assumptions={"day_id": days["d1"]["id"], "minutes": 5}).status_code == 422


def test_rain_and_fatigue_and_locked(auth_client, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(ev["dinner"]["id"])).update({"locked": True})
    db_session.commit()
    rain = _create(client, base, scenario_type="rain").json()
    notes = {i["title"]: i["note"] for i in rain["content"]}
    assert notes["清水寺"].startswith("屋外の可能性") and notes["嵐山"].startswith("屋外") and notes["昼食"] is None
    assert rain["summary"]["updated"] == 0 and all(not i["removed"] for i in rain["content"])

    fatigue = _create(client, base, scenario_type="fatigue", assumptions={"max_events_per_day": 2}).json()
    removed = [i["title"] for i in fatigue["content"] if i["removed"]]
    assert removed == ["昼食", "博物館"]  # 確定済みの夕食は外さず、その前の予定から外す
    assert fatigue["summary"]["removed"] == 2
    assert [d["branch"] for d in fatigue["day_counts"]] == [2, 1]
    delay = _create(client, base, scenario_type="delay",
                    assumptions={"day_id": days["d1"]["id"], "after": "20:00", "minutes": 30}).json()
    dinner = next(i for i in delay["content"] if i["title"] == "夕食")
    assert dinner["local_start_time"] == "22:30" and "確定済み" in dinner["note"]


# ---------------------------------------------------------------- 編集・採用・Undo

def test_edit_adopt_and_undo(auth_client, audit_calls):
    client, owner, p, base, days, ev = _setup(auth_client)
    b = _create(client, base, title="雨の日案", scenario_type="rain").json()
    content = b["content"]
    for i in content:
        if i["title"] == "清水寺":
            i["removed"] = True
        if i["title"] == "博物館":
            i["local_start_time"] = "10:00"
        if i["title"] == "嵐山":
            i["day_id"] = days["d1"]["id"]
            i["title"] = "嵐山(屋内)"
    content.append({"day_id": days["d2"]["id"], "title": "水族館", "event_type": "museum",
                    "local_start_time": "11:00", "sort_order": 5})
    url = f"{base}/branches/{b['id']}"
    assert client.put(f"{url}/content", json={"events": content}).status_code == 428
    assert client.put(f"{url}/content", json={"events": content}, headers={"If-Match": "9"}).status_code == 409
    saved = client.put(f"{url}/content", json={"events": content}, headers={"If-Match": str(b["revision"])})
    assert saved.status_code == 200, saved.text
    s = saved.json()
    assert s["summary"] == {"added": 1, "removed": 1, "updated": 2, "time_changed": 1}
    ops = {o.get("title", o.get("key")): o for o in s["ops"]}
    assert ops["博物館"]["fields"] == {"local_start_time": "10:00"}
    assert ops["博物館"]["before"] == {"local_start_time": "14:00"}
    assert ops["嵐山"]["fields"] == {"day_id": days["d1"]["id"], "title": "嵐山(屋内)"}

    rev = _plan_rev(client, p)
    adopted = client.post(f"{url}/adopt", headers={"If-Match": str(s["revision"])})
    assert adopted.status_code == 200, adopted.text
    a = adopted.json()
    assert a["plan_revision"] == rev + 1 and a["branch"]["state"] == "adopted" and a["branch"]["can_edit"] is False
    detail = client.get(f"/api/v1/plans/{p}").json()
    titles = sorted(e["title"] for d in detail["days"] for e in d["events"])
    assert titles == sorted(["昼食", "博物館", "夕食", "嵐山(屋内)", "水族館"])
    museum = next(e for d in detail["days"] for e in d["events"] if e["title"] == "博物館")
    assert museum["local_start_time"] == "10:00"
    assert museum["start_at"].startswith("2026-11-01T01:00:00") and museum["end_at"].startswith("2026-11-01T03:00:00")
    assert audit_calls[-1]["action"] == "branch_adopted" and audit_calls[-1]["details"]["removed"] == 1
    # 採用後は編集・再採用できない
    assert client.post(f"{url}/adopt", headers={"If-Match": str(a["branch"]["revision"])}).status_code == 409
    # 本案の「元に戻す」で全て戻る
    undo = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)})
    assert undo.status_code == 200, undo.text
    detail = client.get(f"/api/v1/plans/{p}").json()
    titles = sorted(e["title"] for d in detail["days"] for e in d["events"])
    assert titles == sorted(["清水寺", "昼食", "博物館", "夕食", "嵐山"])
    assert client.get(url).json()["state"] == "adopted_undone"


def test_conflicts_block_adoption(auth_client, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    b = _create(client, base, title="案").json()
    content = b["content"]
    for i in content:
        if i["title"] == "清水寺":
            i["local_start_time"] = "08:00"
        if i["title"] == "昼食":
            i["removed"] = True
        if i["title"] == "博物館":
            i["title"] = "美術館"
    url = f"{base}/branches/{b['id']}"
    s = client.put(f"{url}/content", json={"events": content}, headers={"If-Match": str(b["revision"])}).json()
    # 分岐後に本案で: 清水寺の時刻を変える(競合)、昼食に予約を紐付ける(外せない)、博物館を削除(変更先が無い)
    rev = _plan_rev(client, p)
    r = client.put(f"/api/v1/plans/{p}/events/{ev['kiyomizu']['id']}", json={"local_start_time": "09:30"},
                   headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert client.post(f"/api/v1/plans/{p}/reservations", json={
        "type": "restaurant", "provider_name": "料亭", "event_id": ev["lunch"]["id"]}).status_code == 201
    rev = _plan_rev(client, p)
    assert client.delete(f"/api/v1/plans/{p}/events/{ev['museum']['id']}",
                         headers={"If-Match": str(rev)}).status_code == 200
    detail = client.get(url).json()
    assert detail["plan_changed_since_base"] is True
    reasons = sorted((c["title"], c["reason"]) for c in detail["conflicts"])
    assert reasons == [("博物館", "deleted_in_plan"), ("昼食", "has_relations"), ("清水寺", "changed_in_plan")]
    rev = _plan_rev(client, p)
    res = client.post(f"{url}/adopt", headers={"If-Match": str(s["revision"])})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "branch_conflict"
    assert _plan_rev(client, p) == rev  # 本案は変わらない

    # 分岐案を直す(本案と同じ値にする・外さない・元が消えた予定は変えない)と採用できる
    fixed = detail["content"]
    for i in fixed:
        if i["title"] == "清水寺":
            i["local_start_time"] = "09:30"
        if i["title"] == "昼食":
            i["removed"] = False
        if i["title"] == "美術館":
            i["title"] = "博物館"
        if i["title"] == "夕食":
            i["local_start_time"] = "21:00"
    s2 = client.put(f"{url}/content", json={"events": fixed}, headers={"If-Match": str(s["revision"])}).json()
    assert s2["conflicts"] == [] and s2["summary"]["updated"] == 2  # 清水寺(本案と同じ値)と夕食
    ok = client.post(f"{url}/adopt", headers={"If-Match": str(s2["revision"])})
    assert ok.status_code == 200, ok.text


def test_locked_and_validation(auth_client, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    b = _create(client, base).json()
    url = f"{base}/branches/{b['id']}"
    content = [dict(i) for i in b["content"]]
    content[0]["title"] = "変更"
    s = client.put(f"{url}/content", json={"events": content}, headers={"If-Match": "1"}).json()
    db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(content[0]["source_event_id"])) \
        .update({"locked": True})
    db_session.commit()
    assert client.get(url).json()["conflicts"][0]["reason"] == "locked"
    assert client.post(f"{url}/adopt", headers={"If-Match": str(s["revision"])}).status_code == 409

    put = lambda items: client.put(f"{url}/content", json={"events": items},  # noqa: E731
                                   headers={"If-Match": str(s["revision"])})
    assert put(content[1:]).status_code == 422  # 元の予定を欠かせない(外す場合はremoved)
    assert put(content + [dict(content[0])]).status_code == 422  # 重複
    bad = [dict(i) for i in content]
    bad[1]["local_start_time"] = "25:00"
    assert put(bad).status_code == 422
    bad = [dict(i) for i in content]
    bad[1]["day_id"] = str(uuid.uuid4())
    assert put(bad).status_code == 422
    bad = [dict(i) for i in content] + [{"day_id": days["d1"]["id"], "title": "  "}]
    assert put(bad).status_code == 422
    no_change = _create(client, base).json()
    res = client.post(f"{base}/branches/{no_change['id']}/adopt", headers={"If-Match": "1"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "no_changes"


def test_discard_delete_and_permissions(auth_client, make_user, db_session):
    client, owner, p, base, days, ev = _setup(auth_client)
    b = _create(client, base, title="欠席案", scenario_type="absence",
                assumptions={"absent_member": "花子", "note": "花子が来られない場合"}).json()
    url = f"{base}/branches/{b['id']}"
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(viewer)
    listed = client.get(f"{base}/branches").json()
    assert listed[0]["title"] == "欠席案" and listed[0]["can_edit"] is False and "content" not in listed[0]
    assert client.get(url).json()["assumptions"]["absent_member"] == "花子"
    assert _create(client, base).status_code == 403
    assert client.patch(url, json={"status": "discarded"}, headers={"If-Match": "1"}).status_code == 403
    stranger, _ = make_user()
    _act_as(stranger)
    assert client.get(f"{base}/branches").status_code == 403
    _act_as(owner)
    d = client.patch(url, json={"status": "discarded", "title": "欠席案(見送り)"}, headers={"If-Match": "1"})
    assert d.status_code == 200 and d.json()["state"] == "discarded" and d.json()["can_edit"] is False
    assert client.put(f"{url}/content", json={"events": b["content"]}, headers={"If-Match": "2"}).status_code == 409
    assert client.patch(url, json={"status": "adopted"}, headers={"If-Match": "2"}).status_code == 422
    assert client.delete(url, headers={"If-Match": "2"}).status_code == 200
    assert client.get(url).status_code == 404
    assert client.get(f"{base}/branches/not-a-uuid").status_code == 404
