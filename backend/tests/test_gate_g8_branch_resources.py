"""
[Gate G8] FR-019 案の中で予約・移動区間そのものを変える分岐(branch-v2)の統合テスト(実PostgreSQL)。

検証する主な性質:
- 案の中で区間を変える・外す・足す、予約を付け替える・取り消す予定にする。保存しても本案は変わらない
- 予定を外す時、その予定に付いた区間を外し・予約を付け替えれば採用できる(G7 までは「紐付きのある予定」で止まった)
- 採用は1つの変更セット。本案の「元に戻す」で予定・区間・予約の紐付け・作った準備が全て戻る
- 取り消す予定にした予約は、外部へ何も送らず、状態も変えず、準備の一覧に「予約の取消の手続き」を作る(期限は取消期限)
- 採用の前の確かめ(adoption-preview): 変更ごとの ID・頼る変更・競合・作る準備。選んだ変更だけを当てる(頼る変更が
  欠けると 422)。分岐の後に本案で同じ区間・予約が変わっていれば 409(黙って上書きしない)
- 比較: 区間の費用・予約の取消を反映する
- 予約・費用を見せない参加者には、その変更の中身を出さず、送らせない
"""
import uuid

import pytest

from app.api.v1 import branches as branches_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet, EventReservation, PlanCollaborator, PreparationTask, Reservation, TravelPlan
from app.services import branch_resources as brs


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(branches_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


LAT = 35.10


def _setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "G8 分岐"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-21", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()

    def ev(title, t, lon):
        r = client.post(f"{base}/events", json={"day_id": d1["id"], "title": title, "local_start_time": t,
                                                "latitude": LAT, "longitude": lon, "event_type": "sightseeing"},
                        headers=_ik())
        assert r.status_code == 201, r.text
        return r.json()

    a = ev("美冨久酒造", "10:00", 135.70)
    b = ev("藤居本家", "13:00", 135.80)
    c = ev("岡村本家", "15:00", 135.81)
    res = client.post(f"{base}/reservations", json={
        "type": "activity", "provider_name": "酒蔵見学", "event_id": c["id"], "total_amount": 3000, "currency": "JPY",
        "cancellation_deadline": "2026-11-19T15:00:00+09:00"})
    assert res.status_code == 201, res.text
    seg = client.post(f"{base}/segments", json={"from_event_id": b["id"], "to_event_id": c["id"], "mode": "driving",
                                                "duration_minutes": 15, "cost": 500, "currency": "JPY"},
                      headers=_ik())
    assert seg.status_code == 201, seg.text
    return p, base, d1, {"a": a, "b": b, "c": c}, res.json(), seg.json()


def _plan_rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _branch(client, base):
    r = client.post(f"{base}/branches", json={"title": "車をやめて岡村本家を外す", "scenario_type": "custom"})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- 単体

def test_validate_rejects_bad_shapes():
    base = {"segments": [{"id": "s1", "from_event_id": "e1", "to_event_id": "e2", "cost": None, "currency": None,
                          "planned_departure_at": None, "planned_arrival_at": None}],
            "reservations": [{"id": "r1", "label": "見学", "status": "confirmed", "event_ids": ["e2"],
                              "locked": False},
                             {"id": "r2", "label": "固定", "status": "confirmed", "event_ids": ["e1"], "locked": True}]}
    content = [{"key": "e1", "source_event_id": "e1", "removed": False},
               {"key": "e2", "source_event_id": "e2", "removed": True},
               {"key": "new-1", "source_event_id": None, "removed": False}]
    ok = brs.validate({"segments": [{"op": "remove", "segment_id": "s1"}],
                       "reservations": [{"op": "relink", "reservation_id": "r1", "to": {"key": "new-1"}}]},
                      base, content)
    assert ok["segments"] == [{"op": "remove", "segment_id": "s1"}]
    bad = [
        {"segments": [{"op": "update", "segment_id": "s1", "fields": {"mode": "train"}}]},  # 外す予定につながる
        {"segments": [{"op": "update", "segment_id": "zz", "fields": {"mode": "train"}}]},
        {"segments": [{"op": "add", "fields": {"from": {"event": "e1"}, "to": {"event": "e2"}, "mode": "train"}}]},
        {"segments": [{"op": "add", "fields": {"from": {"event": "e1"}, "to": {"key": "new-1"}, "mode": "rocket"}}]},
        {"segments": [{"op": "add", "fields": {"from": {"event": "e1"}, "to": {"key": "new-1"}, "mode": "train",
                                               "cost": 100}}]},  # 通貨なし
        {"reservations": [{"op": "cancel", "reservation_id": "r2"}]},  # 確定した紐付け
        {"reservations": [{"op": "relink", "reservation_id": "r1", "to": {"event": "e2"}}]},  # 外す予定へ
        {"reservations": [{"op": "cancel", "reservation_id": "r1"}, {"op": "cancel", "reservation_id": "r1"}]},
        {"unknown": []},
    ]
    for raw in bad:
        with pytest.raises(brs.ResourceError):
            brs.validate(raw, base, content)


# ---------------------------------------------------------------- 統合

def test_resources_adopt_and_undo_restore_everything(auth_client, db_session, audit_calls):
    client, owner = auth_client
    p, base, d1, ev, res, seg = _setup(client)
    b = _branch(client, base)
    assert b["resources"]["base_segments"][0]["id"] == seg["id"]
    assert b["resources"]["base_reservations"][0]["label"] == "酒蔵見学"
    rev0 = _plan_rev(client, p)
    content = b["content"]
    for i in content:
        if i["title"] == "岡村本家":
            i["removed"] = True
    content.append({"key": "new-sake", "source_event_id": None, "day_id": d1["id"], "title": "喜多酒造",
                    "event_type": "sightseeing", "local_start_time": "15:30", "is_all_day": False, "sort_order": 9,
                    "removed": False, "note": None})
    # 岡村本家を外すだけでは、区間と予約が付いているため採用できない
    saved = client.put(f"{base}/branches/{b['id']}/content", json={"events": content},
                       headers={"If-Match": str(b["revision"])})
    assert saved.status_code == 200, saved.text
    reasons = [c["reason"] for c in saved.json()["conflicts"]]
    assert reasons == ["has_relations"]
    # 区間は外し、新しい区間を足し、予約は新しい予定へ付け替える
    resources = {
        "segments": [{"op": "remove", "segment_id": seg["id"]},
                     {"op": "add", "key": "walk-1", "fields": {"from": {"event": ev["b"]["id"]},
                                                               "to": {"key": "new-sake"}, "mode": "walking",
                                                               "duration_minutes": 20}}],
        "reservations": [{"op": "relink", "reservation_id": res["id"], "to": {"key": "new-sake"}}],
    }
    r = client.put(f"{base}/branches/{b['id']}/resources", json=resources,
                   headers={"If-Match": str(saved.json()["revision"])})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["conflicts"] == [] and d["algorithm_version"] == "branch-v2"
    assert d["resource_summary"] == {"segments_added": 1, "segments_removed": 1, "segments_updated": 0,
                                     "reservations_relinked": 1, "reservations_cancel_planned": 0}
    assert _plan_rev(client, p) == rev0  # 本案は変わらない
    # 採用の前の確かめ: 区間と予約の付け替えは、足した予定に頼る
    pv = client.get(f"{base}/branches/{b['id']}/adoption-preview")
    assert pv.status_code == 200, pv.text
    items = {i["op_id"]: i for i in pv.json()["items"]}
    assert items["segment:add:walk-1"]["requires"] == ["event:add:new-sake"]
    assert items[f"reservation:{res['id']}"]["requires"] == ["event:add:new-sake"]
    assert pv.json()["can_adopt"] is True and pv.json()["tasks"] == []
    # 頼る変更を選ばないと採用できない
    only = [f"reservation:{res['id']}"]
    pv2 = client.get(f"{base}/branches/{b['id']}/adoption-preview", params={"only": ",".join(only)})
    assert pv2.json()["missing_dependencies"] == [{"op_id": only[0], "requires": ["event:add:new-sake"]}]
    bad = client.post(f"{base}/branches/{b['id']}/adopt", json={"only": only}, headers={"If-Match": str(d["revision"])})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "branch_dependency_missing"
    unknown = client.post(f"{base}/branches/{b['id']}/adopt", json={"only": ["event:nope"]},
                          headers={"If-Match": str(d["revision"])})
    assert unknown.status_code == 422
    adopted = client.post(f"{base}/branches/{b['id']}/adopt", headers={"If-Match": str(d["revision"])})
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["plan_revision"] == rev0 + 1 and adopted.json()["left_out"] == []
    plan = client.get(f"/api/v1/plans/{p}").json()
    titles = sorted(e["title"] for day in plan["days"] for e in day["events"])
    assert titles == sorted(["美冨久酒造", "藤居本家", "喜多酒造"])
    new_id = next(e["id"] for day in plan["days"] for e in day["events"] if e["title"] == "喜多酒造")
    segs = client.get(f"{base}/segments").json()
    assert len(segs) == 1 and segs[0]["from_event_id"] == ev["b"]["id"] and segs[0]["to_event_id"] == new_id
    assert segs[0]["mode"] == "walking" and segs[0]["duration_minutes"] == 20
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    db_session.refresh(rr)
    assert str(rr.event_id) == new_id and rr.status == "confirmed"
    links = db_session.query(EventReservation).filter(EventReservation.reservation_id == rr.id).all()
    assert [str(x.event_id) for x in links] == [new_id]
    cs = db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p)).order_by(
        ChangeSet.resulting_revision.desc()).first()
    assert cs.source == "branch"
    # 元に戻す: 予定・区間・予約の紐付けが全て戻る
    undo = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": f'"{rev0 + 1}"'})
    assert undo.status_code == 200, undo.text
    plan = client.get(f"/api/v1/plans/{p}").json()
    titles = sorted(e["title"] for day in plan["days"] for e in day["events"])
    assert titles == sorted(["美冨久酒造", "藤居本家", "岡村本家"])
    segs = client.get(f"{base}/segments").json()
    assert [(s["id"], s["mode"], s["cost"]) for s in segs] == [(seg["id"], "driving", "500.00")]
    db_session.expire_all()
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    assert str(rr.event_id) == ev["c"]["id"]
    links = db_session.query(EventReservation).filter(EventReservation.reservation_id == rr.id).all()
    assert [str(x.event_id) for x in links] == [ev["c"]["id"]]
    adopted_audit = [c for c in audit_calls if c["action"] == "branch_adopted"][0]
    assert "酒蔵見学" not in str(adopted_audit) and "喜多酒造" not in str(adopted_audit)


def test_cancel_planned_creates_task_and_never_cancels(auth_client, db_session):
    client, owner = auth_client
    p, base, d1, ev, res, seg = _setup(client)
    b = _branch(client, base)
    content = b["content"]
    for i in content:
        if i["title"] == "岡村本家":
            i["removed"] = True
    body = {"events": content, "resources": {
        "segments": [{"op": "update", "segment_id": seg["id"],
                      "fields": {"mode": "train", "cost": 300, "currency": "JPY"}}],
        "reservations": [{"op": "cancel", "reservation_id": res["id"], "note": "雨の時"}]}}
    # 外す予定(岡村本家)につながる区間は変えられない(外すしかない)
    bad = client.put(f"{base}/branches/{b['id']}/content", json=body, headers={"If-Match": str(b["revision"])})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_branch_resources"
    body["resources"]["segments"] = [{"op": "remove", "segment_id": seg["id"]}]
    saved = client.put(f"{base}/branches/{b['id']}/content", json=body, headers={"If-Match": str(b["revision"])})
    assert saved.status_code == 200, saved.text
    assert saved.json()["conflicts"] == []
    cmp_ = client.get(f"{base}/branches/{b['id']}/comparison").json()["branches"][0]
    assert cmp_["affected_reservations"][0]["cancel_planned"] is True
    assert cmp_["costs"]["removed"] == [{"currency": "JPY", "amount": "3500.00"}]
    pv = client.get(f"{base}/branches/{b['id']}/adoption-preview").json()
    assert pv["tasks"] == [{"title": "予約の取消の手続き: 酒蔵見学", "due_at": pv["tasks"][0]["due_at"]}]
    assert pv["tasks"][0]["due_at"].startswith("2026-11-19T06:00:00")
    rev = _plan_rev(client, p)
    adopted = client.post(f"{base}/branches/{b['id']}/adopt", headers={"If-Match": str(saved.json()["revision"])})
    assert adopted.status_code == 200, adopted.text
    assert adopted.json()["tasks_created"] == 1
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    db_session.refresh(rr)
    assert rr.status == "confirmed" and rr.event_id is None  # 取り消さない。紐付けだけ外す
    task = db_session.query(PreparationTask).filter(PreparationTask.plan_id == uuid.UUID(p),
                                                    PreparationTask.related_id == rr.id).one()
    assert task.status == "open" and task.readiness_key == f"branch-cancel:{rr.id}" and "雨の時" in task.description
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": f'"{rev + 1}"'}).status_code == 200
    db_session.expire_all()
    task = db_session.query(PreparationTask).filter(PreparationTask.id == task.id).one()
    assert task.deleted_at is not None
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    assert str(rr.event_id) == ev["c"]["id"]


def test_partial_adoption_and_three_way_conflicts(auth_client, db_session):
    client, owner = auth_client
    p, base, d1, ev, res, seg = _setup(client)
    b = _branch(client, base)
    content = b["content"]
    for i in content:
        if i["title"] == "美冨久酒造":
            i["local_start_time"] = "09:30"
    body = {"events": content, "resources": {
        "segments": [{"op": "update", "segment_id": seg["id"], "fields": {"mode": "taxi", "duration_minutes": 10}}],
        "reservations": [{"op": "relink", "reservation_id": res["id"], "to": {"event": ev["b"]["id"]}}]}}
    saved = client.put(f"{base}/branches/{b['id']}/content", json=body, headers={"If-Match": str(b["revision"])})
    assert saved.status_code == 200, saved.text
    rev = saved.json()["revision"]
    # 分岐の後に本案で同じ区間の同じ項目を変える → その区間の変更は競合
    plan_rev = _plan_rev(client, p)
    up = client.patch(f"{base}/segments/{seg['id']}", json={"mode": "bus"}, headers={"If-Match": f'"{plan_rev}"'})
    assert up.status_code == 200, up.text
    detail = client.get(f"{base}/branches/{b['id']}").json()
    seg_conf = [c for c in detail["conflicts"] if c["kind"] == "segment"]
    assert seg_conf == [{"kind": "segment", "op_id": f"segment:{seg['id']}", "op": "update",
                         "reason": "changed_in_plan", "fields": ["mode"]}]
    blocked = client.post(f"{base}/branches/{b['id']}/adopt", headers={"If-Match": str(rev)})
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "branch_conflict"
    # 区間の変更を外して、予定の時刻と予約の付け替えだけを採用する
    ev_a = f"event:{ev['a']['id']}"
    only = [ev_a, f"reservation:{res['id']}"]
    pv = client.get(f"{base}/branches/{b['id']}/adoption-preview", params={"only": ",".join(only)}).json()
    assert pv["can_adopt"] is True and pv["partial"] is True
    assert {i["op_id"]: i["selected"] for i in pv["items"]}[f"segment:{seg['id']}"] is False
    ok = client.post(f"{base}/branches/{b['id']}/adopt", json={"only": only}, headers={"If-Match": str(rev)})
    assert ok.status_code == 200, ok.text
    assert ok.json()["left_out"] == [f"segment:{seg['id']}"]
    segs = client.get(f"{base}/segments").json()
    assert segs[0]["mode"] == "bus"  # 本案の変更は上書きしない
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    db_session.refresh(rr)
    assert str(rr.event_id) == ev["b"]["id"]


def test_reservation_changed_in_plan_blocks_and_undo_refuses_after_relink(auth_client, db_session):
    client, owner = auth_client
    p, base, d1, ev, res, seg = _setup(client)
    b = _branch(client, base)
    r = client.put(f"{base}/branches/{b['id']}/resources", json={
        "reservations": [{"op": "relink", "reservation_id": res["id"], "to": {"event": ev["a"]["id"]}}]},
        headers={"If-Match": str(b["revision"])})
    assert r.status_code == 200, r.text
    # 本案で予約を別の予定へ付け替える → 競合
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    rr.event_id = uuid.UUID(ev["b"]["id"])
    db_session.query(EventReservation).filter(EventReservation.reservation_id == rr.id).delete()
    db_session.add(EventReservation(event_id=uuid.UUID(ev["b"]["id"]), reservation_id=rr.id))
    db_session.commit()
    detail = client.get(f"{base}/branches/{b['id']}").json()
    assert [c["reason"] for c in detail["conflicts"]] == ["changed_in_plan"]
    # 戻す: 本案を合わせてから採用し、その後に本案でまた付け替えると、元に戻すは 409
    db_session.query(EventReservation).filter(EventReservation.reservation_id == rr.id).delete()
    db_session.add(EventReservation(event_id=uuid.UUID(ev["c"]["id"]), reservation_id=rr.id))
    rr.event_id = uuid.UUID(ev["c"]["id"])
    db_session.commit()
    detail = client.get(f"{base}/branches/{b['id']}").json()
    assert detail["conflicts"] == []
    rev = _plan_rev(client, p)
    assert client.post(f"{base}/branches/{b['id']}/adopt", headers={"If-Match": str(detail["revision"])}
                       ).status_code == 200
    db_session.expire_all()
    rr = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).one()
    rr.event_id = uuid.UUID(ev["b"]["id"])
    db_session.commit()
    undo = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": f'"{rev + 1}"'})
    assert undo.status_code == 409, undo.text


def _json_values(node):
    """JSON の中の値(dict の値・list の要素)をすべて集める。"""
    out = []
    if isinstance(node, dict):
        for v in node.values():
            out.extend(_json_values(v))
    elif isinstance(node, list):
        for v in node:
            out.extend(_json_values(v))
    else:
        out.append(node)
    return out


def test_member_policy_hides_reservation_and_cost_changes(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base, d1, ev, res, seg = _setup(client)
    b = _branch(client, base)
    r = client.put(f"{base}/branches/{b['id']}/resources", json={
        "segments": [{"op": "update", "segment_id": seg["id"], "fields": {"cost": 900, "currency": "JPY"}}],
        "reservations": [{"op": "cancel", "reservation_id": res["id"]}]}, headers={"If-Match": str(b["revision"])})
    assert r.status_code == 200, r.text
    member, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="editor",
                                    status="accepted"))
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
    plan.member_field_policy = {"roles": {"editor": ["costs", "reservations"]}}
    db_session.commit()
    try:
        _act_as(member)
        got = client.get(f"{base}/branches/{b['id']}")
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["resources"]["reservations_hidden"] is True and body["resources"]["reservations"] == []
        assert body["resources"]["base_reservations"] == [] and "酒蔵見学" not in got.text
        # 費用 900 が値として残っていない(文字列 "900" の検索は、乱数の ID・時刻に含まれると誤って落ちる)
        assert not {str(v) for v in _json_values(body)} & {"900", "900.0", "900.00"}
        assert body["resource_summary"]["reservations_cancel_planned"] == 0
        # 隠した予約の変更を消す・費用を変えることはできない
        cur = body["revision"]
        bad = client.put(f"{base}/branches/{b['id']}/resources", json={"segments": [], "reservations": []},
                         headers={"If-Match": str(cur)})
        assert bad.status_code == 403
        bad = client.post(f"{base}/branches/{b['id']}/adopt", headers={"If-Match": str(cur)})
        assert bad.status_code == 403
        pv = client.get(f"{base}/branches/{b['id']}/adoption-preview").json()
        assert pv["reservations_hidden"] is True and pv["tasks"] == [] and "酒蔵見学" not in str(pv)
    finally:
        _act_as(owner)
