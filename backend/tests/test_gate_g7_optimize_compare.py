"""[Gate G7] MOVE-04 目的の内訳・条件変更・部分の採用 / FR-019 What-if の比較 の試験(実PostgreSQL)。

- 候補と今の順に目的の内訳(移動距離・検証と制約・疲れ・公平さの値・重み・点)が付く。重みを送ると「条件に合わせた案」
- 重みの検査(範囲・知らない条件・全部0)は 422
- 部分の採用: 選んだ予定だけを動かした結果の確認(DBは変えない)→ 適用は選んだ予定だけ・1つの変更セットで元に戻る。
  案で変わらない予定を選ぶと 422、候補の計算後に入力が変わると 409
- 比較: 本案と分岐案(最大3つ)の検証の件数・新たに出る/解消する問題・移動・疲れ・費用・外す予定に紐付く予約と費用・予算の目標
- 費用・予約を見せない設定のメンバーには、比較でも費用・予約を出さない。部外者は 403/404
"""
import uuid

import pytest

from app.api.v1 import branches as branches_api
from app.api.v1 import optimization as optimization_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet, PlanCollaborator, TravelPlan
from app.services import optimizer as opt


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(optimization_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(branches_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


LAT = 35.0
LON = {"A": 135.70, "B": 135.711, "C": 135.722, "D": 135.733}


def _setup(client, order=("A", "C", "B", "D"), times=("09:00", "10:00", "11:00", "12:00")):
    p = client.post("/api/v1/travel-plans/", json={"title": "G7 最適化"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-21", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    ev = {}
    for name, t in zip(order, times):
        r = client.post(f"{base}/events", json={"day_id": day["id"], "title": f"地点{name}", "event_type": "sightseeing",
                                                "latitude": LAT, "longitude": LON[name], "local_start_time": t},
                        headers=_ik())
        assert r.status_code == 201, r.text
        ev[name] = r.json()
    return p, base, day, ev


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _times(client, p):
    d = client.get(f"/api/v1/plans/{p}").json()["days"][0]
    return {e["title"]: e["local_start_time"] for e in d["events"]}


# ================================================================ 単体

def test_weights_objective_and_partial_order_units():
    assert opt.clean_weights(None) is None
    assert opt.clean_weights({"distance": 5})["constraints"] == opt.DEFAULT_WEIGHTS["constraints"]
    for bad in ({"speed": 1}, {"distance": 9}, {"distance": True},
                {"distance": 0, "constraints": 0, "fatigue": 0, "fairness": 0}):
        with pytest.raises(ValueError):
            opt.clean_weights(bad)
    summary = {"error": 1, "warning": 2, "info": 0, "unverified": 0, "constraints_satisfied": 0,
               "constraints_violated": 1}
    o = opt.objective(summary, 3.0, {"fatigue_percent": 80}, {"spread_percent": 50}, opt.DEFAULT_WEIGHTS)
    by = {t["key"]: t for t in o["terms"]}
    assert by["constraints"]["score"] == 19 and by["constraints"]["weighted"] == 57
    assert by["fatigue"]["score"] == 8.0 and by["fairness"]["score"] == 5.0
    assert o["total"] == 3.0 + 57 + 8.0 + 5.0
    items = [opt.Item(id=i, title=i, latitude=LAT, longitude=LON[i], local_start_time=t, is_all_day=False,
                      sort_order=n, locked=False, has_reservation=False)
             for n, (i, t) in enumerate((("A", "09:00"), ("C", "10:00"), ("B", "11:00"), ("D", "12:00")))]
    order, times = opt.partial_order(items, ["A", "C", "B", "D"], ["A", "B", "C", "D"],
                                     {"A": "09:00", "B": "10:00", "C": "11:00", "D": "12:00"}, ["B"])
    # Bだけを10:00へ。Cは今の10:00のまま(同じ時刻の時は選んだ予定を先に)
    assert times == {"A": "09:00", "C": "10:00", "B": "10:00", "D": "12:00"}
    assert order == ["A", "B", "C", "D"]


# ================================================================ 最適化

def test_objective_breakdown_and_weights(auth_client):
    client, _owner = auth_client
    p, base, day, ev = _setup(client)
    url = f"{base}/days/{day['id']}/optimization-candidates"
    plain = client.post(url).json()
    assert plain["weights_given"] is False and plain["movement_applied"] is True
    assert [c["kinds"] for c in plain["candidates"]] == [["shortest"]]  # 条件なしは従来どおり
    keys = [t["key"] for t in plain["current"]["objective"]["terms"]]
    assert keys == ["distance", "constraints", "fatigue", "fairness"]
    cand = plain["candidates"][0]
    assert cand["objective"]["total"] < plain["current"]["objective"]["total"]
    assert cand["metrics"]["fatigue_percent"] is not None and cand["metrics"]["fairness_spread_percent"] is None
    weighted = client.post(url, json={"weights": {"distance": 5, "constraints": 1, "fatigue": 0, "fairness": 0}})
    assert weighted.status_code == 200, weighted.text
    body = weighted.json()
    assert body["weights_given"] is True and body["weights"]["distance"] == 5
    kinds = [k for c in body["candidates"] for k in c["kinds"]]
    assert "balanced" in kinds
    balanced = next(c for c in body["candidates"] if "balanced" in c["kinds"])
    assert "条件に合わせた案" in balanced["label"]
    assert client.post(url, json={"weights": {"distance": 7}}).status_code == 422
    assert client.post(url, json={"weights": {"speed": 1}}).status_code == 422


def test_partial_preview_and_apply_only_selected(auth_client, db_session, audit_calls):
    client, _owner = auth_client
    p, base, day, ev = _setup(client)
    url = f"{base}/days/{day['id']}/optimization-candidates"
    body = client.post(url).json()
    cand = body["candidates"][0]
    changed = {c["title"]: c["event_id"] for c in cand["changes"]}
    assert len(changed) >= 2
    pick_title = sorted(changed)[0]
    pick = changed[pick_title]
    others = [t for t in changed if t != pick_title]
    rev = _rev(client, p)
    prev = client.post(f"{url}/partial-preview", json={"candidate_id": cand["id"], "event_ids": [pick],
                                                       "input_fingerprint": body["input_fingerprint"]})
    assert prev.status_code == 200, prev.text
    pv = prev.json()
    assert pick in [c["event_id"] for c in pv["changes"]]
    assert "objective" in pv and pv["can_apply"] is True
    assert _rev(client, p) == rev  # 確認だけでは変わらない
    # 案で変わらない予定は選べない
    unchanged = next(e["id"] for e in ev.values() if e["id"] not in changed.values())
    bad = client.post(f"{url}/partial-preview", json={"candidate_id": cand["id"], "event_ids": [unchanged],
                                                      "input_fingerprint": body["input_fingerprint"]})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_selection"
    before = _times(client, p)
    done = client.post(f"{url}/apply", json={"candidate_id": cand["id"], "event_ids": [pick],
                                             "input_fingerprint": body["input_fingerprint"]},
                       headers={"If-Match": str(rev)})
    assert done.status_code == 200, done.text
    after = _times(client, p)
    assert after[pick_title] != before[pick_title]
    for t in others:
        assert after[t] == before[t]  # 選ばなかった予定は今の時刻のまま
    assert audit_calls[-1]["details"]["partial"] is True
    cs = db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p),
                                            ChangeSet.resulting_revision == rev + 1).one()
    assert cs.source == "optimization"
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    assert _times(client, p) == before
    # 入力が変わった後の確認は 409
    stale = client.post(f"{url}/partial-preview", json={"candidate_id": cand["id"], "event_ids": [pick],
                                                        "input_fingerprint": body["input_fingerprint"]})
    assert stale.status_code == 409


# ================================================================ 比較

def _branch_setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "G7 比較"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-21", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()

    def ev(title, t, lon, **kw):
        r = client.post(f"{base}/events", json={"day_id": d1["id"], "title": title, "local_start_time": t,
                                                "latitude": LAT, "longitude": lon, "event_type": "sightseeing", **kw},
                        headers=_ik())
        assert r.status_code == 201, r.text
        return r.json()

    a = ev("美冨久酒造", "10:00", 135.70)
    b = ev("藤居本家", "13:00", 135.80)
    c = ev("岡村本家", "15:00", 135.81)
    res = client.post(f"{base}/reservations", json={"type": "activity", "provider_name": "酒蔵見学", "event_id": c["id"],
                                                    "total_amount": 3000, "currency": "JPY"})
    assert res.status_code == 201, res.text
    seg_body = {"from_event_id": b["id"], "to_event_id": c["id"], "mode": "driving", "duration_minutes": 15,
                "cost": 500, "currency": "JPY"}
    seg = client.post(f"{base}/segments", json=seg_body, headers=_ik())
    assert seg.status_code == 201, seg.text
    return p, base, d1, {"a": a, "b": b, "c": c}


def test_branch_comparison_columns_diff_costs_and_budget(auth_client):
    client, _owner = auth_client
    p, base, d1, ev = _branch_setup(client)
    b = client.post(f"{base}/branches", json={"title": "予算を削る", "scenario_type": "budget",
                                              "assumptions": {"budget_cut_percent": 50}}).json()
    content = b["content"]
    for i in content:
        if i["title"] == "岡村本家":
            i["removed"] = True
        if i["title"] == "藤居本家":
            i["local_start_time"] = "10:00"  # 美冨久と同じ時刻にする(新たな問題)
    saved = client.put(f"{base}/branches/{b['id']}/content", json={"events": content},
                       headers={"If-Match": str(b["revision"])})
    assert saved.status_code == 200, saved.text
    r = client.get(f"{base}/branches/{b['id']}/comparison")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["algorithm_version"] == "branch-compare-v1" and body["plan"]["title"] == "本案"
    assert body["plan"]["costs"]["total"] == [{"currency": "JPY", "amount": "3500.00"}]
    col = body["branches"][0]
    assert col["summary"]["removed"] == 1 and col["summary"]["updated"] == 1
    assert "SAME_START_TIME" in [i["code"] for i in col["new_issues"]]
    assert col["costs"]["removed"] == [{"currency": "JPY", "amount": "3500.00"}]
    assert col["costs"]["total"] == []
    assert col["affected_reservations"] == [{"id": col["affected_reservations"][0]["id"], "label": "酒蔵見学",
                                             "status": "confirmed"}]
    assert col["budget_target"] == [{"currency": "JPY", "target": "1750.00", "branch": "0.00", "met": True}]
    assert col["travel"]["legs"] == 1 and body["plan"]["travel"]["legs"] == 2
    assert body["plan"]["travel"]["minutes"] > 0 and col["travel"]["is_estimate"] is True
    assert isinstance(col["max_fatigue_percent"], int)
    # 複数の比較
    b2 = client.post(f"{base}/branches", json={"title": "そのまま", "scenario_type": "rain"}).json()
    many = client.get(f"{base}/branches-comparison", params={"ids": f"{b['id']},{b2['id']}"})
    assert many.status_code == 200 and len(many.json()["branches"]) == 2
    assert many.json()["branches"][1]["new_issues"] == []
    assert client.get(f"{base}/branches-comparison", params={"ids": ",".join([b["id"]] * 2)}).status_code == 422
    four = ",".join(str(uuid.uuid4()) for _ in range(4))
    assert client.get(f"{base}/branches-comparison", params={"ids": four}).status_code == 422
    assert client.get(f"{base}/branches-comparison", params={"ids": str(uuid.uuid4())}).status_code == 404


def test_comparison_hides_costs_and_reservations_by_member_policy(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base, d1, ev = _branch_setup(client)
    b = client.post(f"{base}/branches", json={"title": "案", "scenario_type": "custom"}).json()
    member, _ = make_user()
    stranger, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="viewer",
                                    status="accepted"))
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(p)).one()
    plan.member_field_policy = {"roles": {"viewer": ["costs", "reservations"]}}
    db_session.commit()
    try:
        _act_as(member)
        r = client.get(f"{base}/branches/{b['id']}/comparison")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["costs_hidden"] is True and body["reservations_hidden"] is True
        assert body["plan"]["costs"] is None and body["branches"][0]["affected_reservations"] is None
        assert "酒蔵見学" not in r.text and "3500" not in r.text and body["can_adopt"] is False
        _act_as(stranger)
        assert client.get(f"{base}/branches/{b['id']}/comparison").status_code in (403, 404)
    finally:
        _act_as(owner)
