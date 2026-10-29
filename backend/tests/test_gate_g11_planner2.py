"""
[Gate G11] 段階6(Planner2): 路線バス・高速バスの区別(docs/ux/G11_UIUX全範囲_実装仕様.md §4、UIX-M04)。

検証する主な性質:
- 区間・経路候補の語彙に express_bus(高速バス)がある。DB の CHECK も広がっていて保存できる(500 にならない)
- 高速バスの所要時間は推定として出す(路線バスより速い目安。値は is_estimate)
- 避けたい移動手段: 「高速バス」は express_bus と区別する前に保存した bus、「バス」は両方、「新幹線」は shinkansen と train、
  「ヘリ」は helicopter に当たる(違反の候補を落とさない)
- 表示の名前(実行可能性・思い出・予定表の書き出し)に新しい値の名前がある
"""
import uuid

from app.services import feasibility as fz
from app.services.route_estimator import estimate_leg
from app.services.constraint_evaluation import ConstraintSet
from tests.test_gate_l3_validation import _constraint, _day, _event, _segment, _snap


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_express_bus_vocabulary_and_estimate():
    from app.api.v1.segments import MODES
    from app.services.branch_resources import MODES as BRANCH_MODES

    assert "express_bus" in MODES and "express_bus" in BRANCH_MODES and "bus" in MODES
    express = estimate_leg(35.0, 135.7, 35.6, 139.7, "express_bus")
    local = estimate_leg(35.0, 135.7, 35.6, 139.7, "bus")
    assert express and express["mode"] == "express_bus" and express["is_estimate"] is True
    assert express["duration_minutes"] < local["duration_minutes"]


def test_segments_accept_express_bus(auth_client):
    client, _owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "高速バス"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()["id"]
    a, b = (client.post(f"{base}/events", json={"day_id": day, "title": t, "latitude": lat, "longitude": 135.7},
                        headers=_ik()).json()["id"] for t, lat in (("京都駅", 35.0), ("名古屋駅", 35.2)))
    r = client.post(f"{base}/segments", json={"from_event_id": a, "to_event_id": b, "mode": "express_bus"},
                    headers=_ik())
    assert r.status_code == 201, r.text
    assert r.json()["mode"] == "express_bus" and r.json()["duration_minutes"] is not None
    seg = r.json()["id"]
    r = client.get(f"{base}/segments")
    assert [s["mode"] for s in r.json() if s["id"] == seg] == ["express_bus"]


def test_avoid_transport_maps_bus_kinds():
    assert set(fz._modes_for("高速バスは使わない")) == {"express_bus", "bus"}
    assert set(fz._modes_for("夜行バス")) == {"express_bus", "bus"}
    assert fz._modes_for("路線バス") == ["bus"]
    assert set(fz._modes_for("バス")) == {"bus", "express_bus"}
    assert set(fz._modes_for("新幹線")) == {"shinkansen", "train"}
    assert fz._modes_for("ヘリは避けたい") == ["helicopter"]
    d = _day()
    a, b, c = _event(d, "A", "09:00"), _event(d, "B", "10:00"), _event(d, "C", "12:00")
    express = _segment(a, b, mode="express_bus", duration=120)
    local = _segment(b, c, mode="bus", duration=20)
    avoid = _constraint("avoid", {"value": "高速バス"}, ctype="avoid_transport")
    r = fz.evaluate(_snap([d], [a, b, c], [express, local]), ConstraintSet([avoid]))
    found = [f for f in r.findings if f.code == "AVOIDED_TRANSPORT_USED"]
    assert {f.entity_id for f in found} == {express.id, local.id}
    assert {f.entity_label for f in found} == {"高速バス", "バス"}


def test_labels_for_new_modes():
    from app.services import itinerary_export, memory_replan

    for table in (fz.MODE_LABEL, memory_replan.MODE_LABEL, itinerary_export.MODE_LABEL):
        assert table["express_bus"] == "高速バス" and table["shinkansen"] == "新幹線" and table["helicopter"] == "ヘリ"
