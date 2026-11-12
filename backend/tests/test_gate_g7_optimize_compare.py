"""[Gate G7] MOVE-04 目的の内訳・条件変更・部分の採用 / FR-019 What-if の比較 の試験(実PostgreSQL)。

- 候補と今の順に目的の内訳(移動距離・検証と制約・疲れ・公平さの値・重み・点)が付く。重みを送ると「条件に合わせた案」
- 重みの検査(範囲・知らない条件・全部0)は 422
- 部分の採用: 選んだ予定だけを動かした結果の確認(DBは変えない)→ 適用は選んだ予定だけ・1つの変更セットで元に戻る。
  案で変わらない予定を選ぶと 422、候補の計算後に入力が変わると 409
[Gate PlanB-P8] FR-019 の本案と分岐案の比較の試験は、もしもの案をやめたため消した(日ごとの案の比較は test_gate_planb_variants)
"""
import uuid

import pytest

from app.api.v1 import optimization as optimization_api
from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import ChangeSet
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
