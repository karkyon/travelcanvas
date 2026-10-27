"""[Gate G7] FR-019 What-if の比較(branch-compare-v1)。本案と分岐案(最大3つ)を、移動時間・検証(制約を含む)・
疲れ・費用・予約への影響で並べて比べる。DBは変えない(比べるだけ。採用は従来どおり adopt)。

- 分岐案の予定は「今の本案に分岐案での変更(ops)を当てた姿」で比べる(採用した時と同じ姿)
- 移動: 日ごとに予定を時刻(無ければ並び)の順に並べ、隣り合う予定の間に区間があればその所要時間・距離、
  無ければ緯度経度からの概算(transit、直線距離ベース)。位置の無い区間は「不明」に数える(作り話をしない)
- 検証: feasibility(移動・滞在の既定を含む)の件数と、本案と比べて新たに出る問題・解消する問題
- 費用: 予約(取消を除く)・区間・支出(取消を除く)の合計を通貨ごとに。分岐案で外す予定に紐付く分は「外れる費用」として
  分けて示す(予約は外しても自動では取り消されない。取消料がかかることがある)
- 予算の想定(budget_cut_percent)があれば、本案の合計から下げた目標に届くかを示す
"""
from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, time as time_cls, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from app.services import feasibility as fz
from app.services.route_estimator import estimate_leg
from app.services.today_mode import parse_local_time, zone_for

ALGORITHM_VERSION = "branch-compare-v1"
MAX_BRANCHES = 3
_NS = uuid.UUID("6f1c2d0e-4b7a-4c55-9a2e-0d7b1e3f5a90")


def simulate(snap: fz.Snapshot, ops: List[Dict[str, Any]], days: Dict[str, Any]) -> Tuple[fz.Snapshot, Set[str]]:
    """本案のスナップショットに分岐案の変更を当てた姿と、外す予定のID。days: 日程ID → DayInfo"""
    removed = {o["event_id"] for o in ops if o["op"] == "remove"}
    updates = {o["event_id"]: o["fields"] for o in ops if o["op"] == "update"}
    events: List[fz.EventInfo] = []
    for e in snap.events:
        key = str(e.id)
        if key in removed:
            continue
        f = updates.get(key)
        if not f:
            events.append(e)
            continue
        day = days.get(f.get("day_id", str(e.day.id)), e.day)
        start, end = e.start, e.end
        if "local_start_time" in f or day.id != e.day.id:
            t = parse_local_time(f.get("local_start_time")) if "local_start_time" in f else (
                e.start.astimezone(zone_for(e.day.timezone_id)).time() if e.start is not None else None)
            if t is None:
                start, end = None, None
            else:
                new_start = datetime.combine(day.local_date, time_cls(t.hour, t.minute),
                                             tzinfo=zone_for(day.timezone_id)).astimezone(timezone.utc)
                end = new_start + (end - start) if end is not None and start is not None else None
                start = new_start
        events.append(replace(e, day=day, start=start, end=end, title=f.get("title", e.title),
                              event_type=f.get("event_type", e.event_type),
                              is_all_day=bool(f.get("is_all_day", e.is_all_day)),
                              sort_order=int(f.get("sort_order", e.sort_order))))
    for o in ops:
        if o["op"] != "add":
            continue
        f = o["fields"]
        day = days.get(f["day_id"])
        if day is None:
            continue
        t = parse_local_time(f.get("local_start_time"))
        start = datetime.combine(day.local_date, time_cls(t.hour, t.minute), tzinfo=zone_for(day.timezone_id)) \
            .astimezone(timezone.utc) if t is not None and not f.get("is_all_day") else None
        events.append(fz.EventInfo(
            id=uuid.uuid5(_NS, str(o["key"])), day=day, title=f["title"], description="", address="",
            event_type=f.get("event_type") or "activity", place_id=None, is_all_day=bool(f.get("is_all_day")),
            start=start, end=None, sort_order=int(f.get("sort_order") or 0),
        ))
    removed_ids = {uuid.UUID(r) for r in removed}
    segments = [s for s in snap.segments if s.from_event_id not in removed_ids and s.to_event_id not in removed_ids]
    links = [link for link in snap.links if link.event_id not in removed_ids]
    return replace(snap, events=events, segments=segments, links=links), removed


def _ref_uuid(ref: Optional[Dict[str, str]]) -> Optional[uuid.UUID]:
    if not ref:
        return None
    return uuid.UUID(ref["event"]) if ref.get("event") else uuid.uuid5(_NS, str(ref["key"]))


def _dt(v: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(v) if v else None


def simulate_resources(snap: fz.Snapshot, resources: Dict[str, Any]) -> fz.Snapshot:
    """[Gate G8] 案の中の区間(変える・外す・足す)と予約(付け替え・取り消す予定)の変更を当てた姿。"""
    seg_ops = resources.get("segments") or []
    res_ops = resources.get("reservations") or []
    if not seg_ops and not res_ops:
        return snap
    removed = {o["segment_id"] for o in seg_ops if o["op"] == "remove"}
    updates = {o["segment_id"]: o["fields"] for o in seg_ops if o["op"] == "update"}
    segments: List[fz.SegmentInfo] = []
    for sg in snap.segments:
        key = str(sg.id)
        if key in removed:
            continue
        f = updates.get(key)
        if f:
            kw: Dict[str, Any] = {}
            for name in ("mode", "status", "duration_minutes", "distance_km", "currency", "preparation_minutes",
                         "buffer_before_minutes"):
                if name in f:
                    kw[name] = f[name] if f[name] is not None or name in ("duration_minutes", "distance_km",
                                                                          "currency") else getattr(sg, name)
            for name in ("planned_departure_at", "planned_arrival_at", "last_departure_at"):
                if name in f:
                    kw[name] = _dt(f[name])
            if "cost" in f:
                kw["cost"] = Decimal(f["cost"]) if f["cost"] is not None else None
            sg = replace(sg, **kw)
        segments.append(sg)
    for o in seg_ops:
        if o["op"] != "add":
            continue
        f = o["fields"]
        segments.append(fz.SegmentInfo(
            id=uuid.uuid5(_NS, "segment:" + str(o["key"])), from_event_id=_ref_uuid(f.get("from")),
            to_event_id=_ref_uuid(f.get("to")), mode=f["mode"], status=f.get("status") or "planned",
            duration_minutes=f.get("duration_minutes"), distance_km=f.get("distance_km"),
            preparation_minutes=int(f.get("preparation_minutes") or 0),
            buffer_before_minutes=int(f.get("buffer_before_minutes") or 0),
            planned_departure_at=_dt(f.get("planned_departure_at")),
            planned_arrival_at=_dt(f.get("planned_arrival_at")),
            cost=Decimal(f["cost"]) if f.get("cost") is not None else None, currency=f.get("currency"),
            last_departure_at=_dt(f.get("last_departure_at")),
        ))
    touched = {uuid.UUID(o["reservation_id"]) for o in res_ops}
    links = [link for link in snap.links if link.reservation_id not in touched]
    for o in res_ops:
        target = _ref_uuid(o.get("to")) if o["op"] == "relink" else None
        if target is not None:
            links.append(fz.LinkInfo(event_id=target, reservation_id=uuid.UUID(o["reservation_id"]),
                                     relation_type="primary"))
    return replace(snap, segments=segments, links=links)


def resource_cost_items(items: List[Dict[str, Any]], resources: Dict[str, Any]) -> List[Dict[str, Any]]:
    """[Gate G8] 費用の行(branches._cost_items)へ区間・予約の変更を当てる。取り消す予定の予約は「外れる費用」へ。"""
    seg_ops = resources.get("segments") or []
    res_ops = {o["reservation_id"]: o for o in resources.get("reservations") or []}
    removed = {o["segment_id"] for o in seg_ops if o["op"] == "remove"}
    updates = {o["segment_id"]: o["fields"] for o in seg_ops if o["op"] == "update"}
    out: List[Dict[str, Any]] = []
    for it in items:
        it = dict(it)
        if it["kind"] == "segment":
            f = updates.get(it["id"])
            if f and ("cost" in f or "currency" in f):
                it["amount"] = f.get("cost", it["amount"])
                it["currency"] = f.get("currency", it["currency"])
            if it["id"] in removed or (f and f.get("status") == "cancelled"):
                it["cancelled"] = True  # 外す・取消にする区間の費用は「外れる費用」
        elif it["kind"] == "reservation" and it["id"] in res_ops:
            o = res_ops[it["id"]]
            if o["op"] == "cancel":
                it["cancelled"] = True
                it["event_ids"] = set()
            else:
                ref = o.get("to")
                it["event_ids"] = {str(_ref_uuid(ref))} if ref else set()
        out.append(it)
    for o in seg_ops:
        if o["op"] == "add" and o["fields"].get("cost") is not None:
            f = o["fields"]
            out.append({"kind": "segment", "id": "segment:add:" + o["key"], "currency": f.get("currency"),
                        "amount": f["cost"], "event_ids": {str(_ref_uuid(f.get("from"))), str(_ref_uuid(f.get("to")))}})
    return out


def travel(snap: fz.Snapshot, coords: Dict[uuid.UUID, Tuple[Optional[float], Optional[float]]]) -> Dict[str, Any]:
    """移動の合計(分・km)と不明な区間の数。"""
    minutes = km = 0.0
    unknown = legs = 0
    by_day: Dict[uuid.UUID, List[fz.EventInfo]] = {}
    for e in snap.events:
        if not e.is_all_day:
            by_day.setdefault(e.day.id, []).append(e)
    segs = {(s.from_event_id, s.to_event_id): s for s in snap.segments if s.status != "cancelled"}
    far = datetime.max.replace(tzinfo=timezone.utc)
    for events in by_day.values():
        ordered = sorted(events, key=lambda e: (e.start or far, e.sort_order))
        for a, b in zip(ordered, ordered[1:]):
            legs += 1
            s = segs.get((a.id, b.id))
            if s is not None and s.duration_minutes is not None:
                minutes += float(s.duration_minutes)
                km += float(s.distance_km or 0)
                continue
            fa, fb = coords.get(a.id, (None, None)), coords.get(b.id, (None, None))
            leg = estimate_leg(fa[0], fa[1], fb[0], fb[1], "transit")
            if leg is None:
                unknown += 1
                continue
            minutes += leg["duration_minutes"] or 0
            km += leg["distance_km"]
    return {"minutes": int(round(minutes)), "km": round(km, 1), "legs": legs, "unknown_legs": unknown,
            "is_estimate": True}


def money_add(acc: Dict[str, Decimal], currency: Optional[str], amount: Any) -> None:
    if amount is None or not currency:
        return
    acc[currency] = acc.get(currency, Decimal("0")) + Decimal(str(amount))


def money_out(acc: Dict[str, Decimal]) -> List[Dict[str, str]]:
    return [{"currency": c, "amount": f"{acc[c]:.2f}"} for c in sorted(acc)]


def costs(items: Iterable[Dict[str, Any]], removed: Set[str]) -> Dict[str, Any]:
    """items: {kind, currency, amount, event_ids(set of str)}。外す予定だけに紐付く費用は removed へ。
    区間は端の予定のどちらかを外せば一緒に消える(simulate と同じ)。"""
    kept: Dict[str, Decimal] = {}
    gone: Dict[str, Decimal] = {}
    for it in items:
        ev = it.get("event_ids") or set()
        hit = bool(ev & removed) if it.get("kind") == "segment" else bool(ev) and ev <= removed
        if it.get("cancelled"):  # [Gate G8] 取り消す予定の予約(取消料がかかることがある)
            hit = True
        if hit:
            money_add(gone, it["currency"], it["amount"])
        else:
            money_add(kept, it["currency"], it["amount"])
    return {"total": money_out(kept), "removed": money_out(gone)}


def budget_target(plan_total: List[Dict[str, str]], branch_total: List[Dict[str, str]],
                  cut_percent: Optional[int]) -> Optional[List[Dict[str, Any]]]:
    if not cut_percent:
        return None
    branch = {x["currency"]: Decimal(x["amount"]) for x in branch_total}
    out = []
    for x in plan_total:
        target = (Decimal(x["amount"]) * (Decimal(100 - cut_percent) / Decimal(100))).quantize(Decimal("0.01"))
        got = branch.get(x["currency"], Decimal("0"))
        out.append({"currency": x["currency"], "target": f"{target:.2f}", "branch": f"{got:.2f}",
                    "met": got <= target})
    return out


def finding_out(f: fz.Finding) -> Dict[str, Any]:
    return {"code": f.code, "severity": f.severity, "message": f.message, "entity_label": f.entity_label,
            "estimated": bool((f.evidence or {}).get("estimated")),
            "is_private_constraint": bool(f.constraint and f.constraint.is_private)}


def column(result: fz.EvaluationResult, trav: Dict[str, Any], cost: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    statuses = [r["status"] for r in result.constraint_results]
    fatigue = [m["fatigue_percent"] for m in result.day_metrics]
    return {
        "counts": fz.counts(result.findings),
        "constraints_violated": statuses.count("violated"),
        "constraints_satisfied": statuses.count("satisfied"),
        "travel": trav,
        "max_fatigue_percent": max(fatigue) if fatigue else None,
        "heavy_days": sum(1 for m in result.day_metrics if m.get("level") == "heavy"),
        "costs": cost,
    }
