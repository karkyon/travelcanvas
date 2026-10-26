"""
[Gate L4] FR-018 説明可能な最適化の統合テスト(実PostgreSQL)。

検証する主な性質:
- 候補の計算はDBを変えない。並び順と時刻をまとめて提案する(時刻の枠を早い順に割り当て直す)
- 動かさない予定: 確定(ロック)・予約付き・終日・位置なし。時刻のある予定と混在する時刻なしの予定も動かさない
- 「移動が最短の案」と「制約・検証を優先した案」。制約(L2)と実行可能性検証(L3)の結果の差分(新たに出る・解消する)と理由の文
- 適用: If-Match(本案のrevision)と入力の版(input_fingerprint)。1つの変更セットで「元に戻す」で全て戻る。
  候補計算の後に制約が変わった → 409 optimization_stale、存在しない候補 → 409 candidate_not_found
- 権限: viewerは計算のみ(can_apply=false)、適用は403。部外者403
"""
import uuid

import pytest

from app.api.v1 import optimization as optimization_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet, PlanCollaborator
from app.services import optimizer as opt


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(optimization_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


# 東西に並んだ4地点(約1kmおき)。現在の順は A→C→B→D(行ったり来たり)
LAT = 35.0
LON = {"A": 135.70, "B": 135.711, "C": 135.722, "D": 135.733}


def _setup(auth_client, order=("A", "C", "B", "D"), times=("09:00", "10:00", "11:00", "12:00")):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "最適化テスト"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()
    ev = {}
    for name, t in zip(order, times):
        body = {"day_id": day["id"], "title": f"地点{name}", "event_type": "sightseeing", "latitude": LAT,
                "longitude": LON[name]}
        if t:
            body["local_start_time"] = t
        res = client.post(f"{base}/events", json=body, headers=_ik())
        assert res.status_code == 201, res.text
        ev[name] = res.json()
    return client, owner, p, base, day, ev


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _day_events(client, p):
    d = client.get(f"/api/v1/plans/{p}").json()["days"][0]
    return [(e["title"], e["local_start_time"]) for e in sorted(d["events"], key=lambda e: e["sort_order"])]


# ---------------------------------------------------------------- 単体

def _item(i, t="09:00", **kw):
    return opt.Item(id=i, title=i, latitude=kw.get("lat", LAT), longitude=kw.get("lon", LON.get(i, 135.7)),
                    local_start_time=t, is_all_day=kw.get("all_day", False), sort_order=kw.get("order", 0),
                    locked=kw.get("locked", False), has_reservation=kw.get("res", False))


def test_classify_and_time_slots():
    items = [_item("A", "09:00"), _item("C", "10:00"), _item("L", "10:30", locked=True),
             _item("B", "11:00"), _item("N", None), _item("R", "13:00", res=True), _item("X", "14:00", lat=None)]
    movable, reasons, warnings = opt.classify(items)
    assert movable == ["A", "C", "B"]
    assert reasons["L"].startswith("確定") and reasons["R"].startswith("予約") and reasons["X"].startswith("位置")
    assert reasons["N"].startswith("時刻のない予定")
    assert any("時刻のない予定1件" in w for w in warnings) and any("位置" in w for w in warnings)
    order = ["A", "B", "L", "C", "N", "R", "X"]  # B と C の位置を入れ替えた並び
    times = opt.assign_times(items, movable, order)
    assert times["B"] == "10:00" and times["C"] == "11:00" and times["L"] == "10:30" and times["N"] is None
    orders = opt.candidate_orders(items, movable)
    assert orders[0] == [i.id for i in items] and len(orders) == len({tuple(o) for o in orders})
    # 全順列(3件=6通り)が候補に含まれ、固定の予定の位置は変わらない
    assert len(orders) == 6 and all(o[2] == "L" and o[4:] == ["N", "R", "X"] for o in orders)


def test_route_totals_and_hash_are_deterministic():
    items = [_item(i) for i in ("A", "C", "B", "D")]
    by_id = {i.id: i for i in items}
    km_now, _m, unknown = opt.route_totals(["A", "C", "B", "D"], by_id)
    km_best, _m2, _u = opt.route_totals(["A", "B", "C", "D"], by_id)
    assert unknown == 0 and km_best < km_now
    assert opt.order_hash(["A", "B"], {"A": "09:00"}) == opt.order_hash(["A", "B"], {"A": "09:00"})
    assert opt.order_hash(["A", "B"], {"A": "09:00"}) != opt.order_hash(["B", "A"], {"A": "09:00"})


# ---------------------------------------------------------------- API

def test_candidates_reorder_with_time_slots_and_do_not_touch_plan(auth_client):
    client, owner, p, base, day, ev = _setup(auth_client)
    rev = _rev(client, p)
    res = client.post(f"{base}/days/{day['id']}/optimization-candidates", json={"travel_mode": "walking"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert _rev(client, p) == rev  # 計算だけでは本案は変わらない
    assert body["algorithm_version"] == "explainable-opt-v1"
    assert body["validation_algorithm_version"] == "feasibility-v2"  # [Gate G7] 移動・滞在の既定を足した版
    assert body["movable_count"] == 4 and body["fixed"] == [] and body["can_apply"] is True
    assert len(body["candidates"]) == 1  # 制約が無いので最短の案と制約優先の案は同じ(1つにまとめる)
    c = body["candidates"][0]
    assert c["kinds"] == ["shortest"] and c["label"] == "移動が最短の案"
    titles = [ev_["title"] for ev_ in (next(e for e in ev.values() if e["id"] == i) for i in c["order"])]
    assert titles in (["地点A", "地点B", "地点C", "地点D"], ["地点D", "地点C", "地点B", "地点A"])
    assert c["metrics"]["saved_distance_km"] > 0.5
    assert c["metrics"]["distance_km"] < body["current"]["metrics"]["distance_km"]
    changes = {x["title"]: (x["before_index"], x["after_index"], x["before_time"], x["after_time"])
               for x in c["changes"]}
    if titles[0] == "地点A":
        assert changes == {"地点C": (2, 3, "10:00", "11:00"), "地点B": (3, 2, "11:00", "10:00")}
    assert any("移動距離が約" in s for s in c["explanations"]) and any("順番が変わります" in s for s in c["explanations"])


def test_constraint_aware_candidate_and_apply_undo(auth_client, db_session, audit_calls):
    client, owner, p, base, day, ev = _setup(auth_client)
    # 地点Cは11:30より後に始める(ハード制約)。現在(10:00)も、最短の案(11:00)も違反する
    con = client.post(f"{base}/constraints", json={
        "title": "地点Cは午後", "constraint_type": "meeting", "hardness": "hard", "operator": "after",
        "value": {"value": "11:30"}, "scope_type": "event", "scope_id": ev["C"]["id"]})
    assert con.status_code == 201, con.text
    body = client.post(f"{base}/days/{day['id']}/optimization-candidates").json()
    assert body["current"]["metrics"]["constraints_violated"] == 1
    kinds = {tuple(c["kinds"]): c for c in body["candidates"]}
    best = kinds[("constraints",)]
    shortest = kinds[("shortest",)]
    assert best["metrics"]["constraints_violated"] == 0
    assert best["metrics"]["error"] < body["current"]["metrics"]["error"]
    assert shortest["metrics"]["constraints_violated"] == 1
    assert [i["code"] for i in best["resolved_issues"]] == ["CONSTRAINT_TIME_VIOLATION"]
    assert best["new_issues"] == [] and any("守れていない制約が1件減ります" in s for s in best["explanations"])
    times = {x["title"]: x["after_time"] for x in best["changes"]}
    assert times.get("地点C") == "12:00"  # 最後の枠(12:00)へ

    rev = _rev(client, p)
    url = f"{base}/days/{day['id']}/optimization-candidates/apply"
    payload = {"candidate_id": best["id"], "input_fingerprint": body["input_fingerprint"]}
    assert client.post(url, json=payload).status_code == 400
    assert client.post(url, json=payload, headers={"If-Match": str(rev + 5)}).status_code == 409
    bad = client.post(url, json={**payload, "candidate_id": "nope"}, headers={"If-Match": str(rev)})
    assert bad.status_code == 409 and bad.json()["detail"]["code"] == "candidate_not_found"
    done = client.post(url, json=payload, headers={"If-Match": str(rev)})
    assert done.status_code == 200, done.text
    assert done.json()["plan_revision"] == rev + 1 and done.json()["changed"] >= 2
    after = _day_events(client, p)
    assert ("地点C", "12:00") in after and after[-1] == ("地点C", "12:00")
    cs = db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p),
                                            ChangeSet.resulting_revision == rev + 1).one()
    assert cs.source == "optimization"
    assert audit_calls[-1]["action"] == "optimization_applied" and "地点" not in str(audit_calls)
    # 適用後は制約を満たす(検証の結果も同じ)
    run = client.post(f"{base}/validation-runs").json()
    assert run["counts"]["error"] == 0
    # 元に戻す
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    assert _day_events(client, p) == [("地点A", "09:00"), ("地点C", "10:00"), ("地点B", "11:00"), ("地点D", "12:00")]


def test_fixed_events_stay_and_stale_fingerprint(auth_client):
    client, owner, p, base, day, ev = _setup(auth_client)
    # 地点Bを予約付きにする(守る予定)
    assert client.post(f"{base}/reservations", json={
        "type": "activity", "provider_name": "体験", "event_id": ev["B"]["id"]}).status_code == 201
    body = client.post(f"{base}/days/{day['id']}/optimization-candidates").json()
    assert body["fixed"] == [{"event_id": ev["B"]["id"], "title": "地点B", "reason": "予約と紐付いている"}]
    for c in body["candidates"]:
        assert c["order"][2] == ev["B"]["id"]  # 予約付きの予定は3番目のまま
        assert all(x["event_id"] != ev["B"]["id"] for x in c["changes"])
    assert body["candidates"], "B以外の並べ替えで短くなる"
    # 候補の計算後に制約を追加 → 入力の版が変わり適用しない
    client.post(f"{base}/constraints", json={"title": "予算", "constraint_type": "budget_limit", "hardness": "hard",
                                             "operator": "max", "value": {"value": 50000, "unit": "JPY"}})
    rev = _rev(client, p)
    res = client.post(f"{base}/days/{day['id']}/optimization-candidates/apply",
                      json={"candidate_id": body["candidates"][0]["id"],
                            "input_fingerprint": body["input_fingerprint"]},
                      headers={"If-Match": str(rev)})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "optimization_stale"
    assert _rev(client, p) == rev


def test_no_better_order_and_untimed_day(auth_client):
    client, owner, p, base, day, ev = _setup(auth_client, order=("A", "B", "C", "D"))
    body = client.post(f"{base}/days/{day['id']}/optimization-candidates").json()
    assert body["candidates"] == [] and "今の順番より良い候補は見つかりませんでした" in body["warnings"]
    client2 = _setup(auth_client, order=("A", "C", "B"), times=(None, None, None))
    c2, _o, p2, base2, day2, ev2 = client2
    body2 = c2.post(f"{base2}/days/{day2['id']}/optimization-candidates").json()
    cand = body2["candidates"][0]
    # 時刻のない日は並び順だけ変わる
    assert all(x["before_time"] is None and x["after_time"] is None for x in cand["changes"])
    rev = _rev(c2, p2)
    assert c2.post(f"{base2}/days/{day2['id']}/optimization-candidates/apply",
                   json={"candidate_id": cand["id"], "input_fingerprint": body2["input_fingerprint"]},
                   headers={"If-Match": str(rev)}).status_code == 200
    titles = [t for t, _ in _day_events(c2, p2)]
    assert titles in (["地点A", "地点B", "地点C"], ["地点C", "地点B", "地点A"])


def test_permissions(auth_client, make_user, db_session):
    client, owner, p, base, day, ev = _setup(auth_client)
    viewer, _ = make_user()
    outsider, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(viewer)
    body = client.post(f"{base}/days/{day['id']}/optimization-candidates").json()
    assert body["can_apply"] is False and body["candidates"]
    res = client.post(f"{base}/days/{day['id']}/optimization-candidates/apply",
                      json={"candidate_id": body["candidates"][0]["id"],
                            "input_fingerprint": body["input_fingerprint"]},
                      headers={"If-Match": str(body["base_revision"])})
    assert res.status_code == 403
    _act_as(outsider)
    assert client.post(f"{base}/days/{day['id']}/optimization-candidates").status_code == 403
    _act_as(owner)
    assert client.post(f"{base}/days/{uuid.uuid4()}/optimization-candidates").status_code == 404
    assert client.post(f"{base}/days/{day['id']}/optimization-candidates",
                       json={"travel_mode": "teleport"}).status_code == 422
