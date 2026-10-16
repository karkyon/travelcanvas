"""
[Gate L4] FR-018 説明可能な最適化(DOC-04 SC-16、DOC-02 FC-058 最適化再現、B-007)。

エンドポイント(/plans/{plan_id}/days/{day_id} 配下):
- POST /optimization-candidates        : 1日の並べ替え候補を計算する(viewer以上、DBは変えない)。
    候補ごとに、移動距離・移動時間(内部推定)、実行可能性検証(feasibility-v1、制約L2を含む)の件数と、
    元の順と比べて新たに出る問題・解消する問題、順番・時刻の変化、理由の文を返す。
    「移動が最短の案」と「制約・検証を優先した案」を選ぶ(同じなら1つにまとめる)。
- POST /optimization-candidates/apply  : 選んだ候補を本案へ適用する(editor以上、If-Match: 本案のrevision)。
    候補を計算した時の入力(input_fingerprint: 旅程・制約・予約・区間の版)が変わっていれば409 optimization_stale。
    サーバーで同じ入力から候補を計算し直し、指定された候補(candidate_id)が見つからなければ409 candidate_not_found。
    並び順と時刻をまとめて1つの変更セット(source=optimization)で記録し、本案の「元に戻す」で全て戻る。

動かさない予定: 確定(ロック)済み・予約付き・終日・位置なし(と、時刻のある予定と混在する時刻なしの予定)。
従来の /optimization-proposal(Gate #33)は互換のため残す。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.v1 import branches as branches_api
from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    ChangeSet, EventReservation, PlanConstraint, Reservation, TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import feasibility
from app.services import optimizer as opt
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import load_constraints_for_evaluation

router = APIRouter(prefix="/plans", tags=["optimization"])

TRAVEL_MODES = ("walking", "driving", "train", "bus", "bicycle", "taxi")


class CandidatesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    travel_mode: str = "walking"

    @field_validator("travel_mode")
    @classmethod
    def _v_mode(cls, v):
        if v not in TRAVEL_MODES:
            raise ValueError(f"travel_mode must be one of {list(TRAVEL_MODES)}")
        return v


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str = Field(..., min_length=1, max_length=64)
    input_fingerprint: str = Field(..., min_length=1, max_length=128)
    travel_mode: str = "walking"

    @field_validator("travel_mode")
    @classmethod
    def _v_mode(cls, v):
        if v not in TRAVEL_MODES:
            raise ValueError(f"travel_mode must be one of {list(TRAVEL_MODES)}")
        return v


def _day_or_404(db: Session, plan: TravelPlan, day_id: str) -> TravelDay:
    try:
        did = uuid.UUID(str(day_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="指定した日程が見つかりません")
    day = db.query(TravelDay).filter(TravelDay.id == did, TravelDay.plan_id == plan.id).first()
    if day is None:
        raise HTTPException(status_code=404, detail="指定した日程が見つかりません")
    return day


def _reserved_ids(db: Session, ids: List[uuid.UUID]) -> set:
    if not ids:
        return set()
    out = {r[0] for r in db.query(Reservation.event_id).filter(Reservation.event_id.in_(ids)).all()}
    out |= {r[0] for r in db.query(EventReservation.event_id).filter(EventReservation.event_id.in_(ids)).all()}
    return {str(i) for i in out if i is not None}


def _finding(f: feasibility.Finding) -> Dict[str, Any]:
    # 秘匿制約の値は判定側で文面に含めない(feasibility-v1)。根拠・修正候補はここでは返さない
    return {"code": f.code, "severity": f.severity, "message": f.message, "entity_label": f.entity_label,
            "is_private_constraint": bool(f.constraint and f.constraint.is_private)}


def _compute(db: Session, plan: TravelPlan, day: TravelDay, travel_mode: str) -> Dict[str, Any]:
    events = (db.query(TravelEvent).filter(TravelEvent.day_id == day.id)
              .order_by(TravelEvent.sort_order, TravelEvent.id).all())
    reserved = _reserved_ids(db, [e.id for e in events])
    items = [opt.Item(id=str(e.id), title=e.title, latitude=e.latitude, longitude=e.longitude,
                      local_start_time=e.local_start_time, is_all_day=bool(e.is_all_day),
                      sort_order=e.sort_order or 0, locked=bool(e.locked), has_reservation=str(e.id) in reserved)
             for e in events]
    by_id = {i.id: i for i in items}
    movable, reasons, warnings = opt.classify(items)
    if len(movable) > opt.MAX_MOVABLE_FOR_SEARCH:
        warnings.append(f"並べ替えられる予定が{opt.MAX_MOVABLE_FOR_SEARCH}件を超えるため、候補を計算していません")
    orders = opt.candidate_orders(items, movable)

    now = datetime.now(dt_timezone.utc)
    fingerprint = feasibility.compute_fingerprint(db, plan)
    snap = feasibility.load_snapshot(db, plan)
    cset = load_constraints_for_evaluation(db, plan, at=now)
    ids = [c.id for c in cset.constraints] + list(cset.unavailable)
    rows = {c.id: c for c in db.query(PlanConstraint).filter(PlanConstraint.id.in_(ids))} if ids else {}
    titles = {cid: c.title for cid, c in rows.items() if c.privacy_level == "shared" and c.title}
    owners = {cid: c.owner_user_id for cid, c in rows.items()}
    sorted_slots = sorted(i.sort_order for i in items)

    def evaluate(order: List[str]) -> Dict[str, Any]:
        times = opt.assign_times(items, movable, order)
        new_orders = {eid: sorted_slots[idx] for idx, eid in enumerate(order)}
        sim = opt.simulated_snapshot(snap, day.local_date, day.timezone_id, times, new_orders)
        result = feasibility.evaluate(sim, cset, titles=titles, unavailable_owners=owners)
        km, minutes, unknown = opt.route_totals(order, by_id, travel_mode)
        return {"order": order, "times": times, "result": result, "summary": opt.summarize_findings(result),
                "km": km, "minutes": minutes, "unknown": unknown, "id": opt.order_hash(order, times),
                "sort_orders": new_orders}

    evals = [evaluate(o) for o in orders]
    base = evals[0]
    others = evals[1:]
    picks: List[tuple] = []
    if others:
        shortest = min(others, key=lambda e: (e["km"], opt.score(e["summary"], e["km"]), e["id"]))
        if shortest["km"] < base["km"] - 0.01:
            picks.append(("shortest", shortest))
        best = min(evals, key=lambda e: (opt.score(e["summary"], e["km"]), e["id"]))
        if best is not base and opt.score(best["summary"], best["km"])[:3] < opt.score(base["summary"], base["km"])[:3]:
            picks.append(("constraints", best))
    merged: Dict[str, Dict[str, Any]] = {}
    for kind, e in picks:
        merged.setdefault(e["id"], {"eval": e, "kinds": []})["kinds"].append(kind)

    labels = {"shortest": "移動が最短の案", "constraints": "制約・検証を優先した案"}
    candidates = []
    for cid, m in merged.items():
        e = m["eval"]
        changes = []
        for idx, eid in enumerate(e["order"]):
            before_idx = next(i for i, it in enumerate(items) if it.id == eid)
            before_t, after_t = by_id[eid].local_start_time, e["times"][eid]
            if before_idx != idx or before_t != after_t:
                changes.append({"event_id": eid, "title": by_id[eid].title, "before_index": before_idx + 1,
                                "after_index": idx + 1, "before_time": before_t, "after_time": after_t})
        new, resolved = opt.diff_findings(base["result"], e["result"])
        saved_km = round(base["km"] - e["km"], 2)
        saved_min = round(base["minutes"] - e["minutes"], 1)
        candidates.append({
            "id": cid, "kinds": m["kinds"], "label": "・".join(labels[k] for k in m["kinds"]),
            "order": e["order"], "changes": changes,
            "metrics": {"distance_km": e["km"], "duration_minutes": e["minutes"], "unknown_legs": e["unknown"],
                        "saved_distance_km": saved_km, "saved_duration_minutes": saved_min, **e["summary"]},
            "new_issues": [_finding(f) for f in new], "resolved_issues": [_finding(f) for f in resolved],
            "explanations": opt.explain(changes, saved_km, base["summary"], e["summary"]),
        })
    if not candidates and not warnings:
        warnings.append("今の順番より良い候補は見つかりませんでした")
    return {
        "plan_id": str(plan.id), "day_id": str(day.id), "local_date": day.local_date.isoformat(),
        "algorithm_version": opt.ALGORITHM_VERSION, "validation_algorithm_version": feasibility.ALGORITHM_VERSION,
        "travel_mode": travel_mode, "base_revision": plan.revision, "input_fingerprint": fingerprint,
        "current": {"order": base["order"],
                    "metrics": {"distance_km": base["km"], "duration_minutes": base["minutes"],
                                "unknown_legs": base["unknown"], **base["summary"]}},
        "fixed": [{"event_id": eid, "title": by_id[eid].title, "reason": r} for eid, r in reasons.items()],
        "movable_count": len(movable),
        "candidates": candidates, "warnings": warnings,
        "_evals": {c["id"]: merged[c["id"]]["eval"] for c in candidates},
    }


def _public(result: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in result.items() if not k.startswith("_")}


@router.post("/{plan_id}/days/{day_id}/optimization-candidates", response_model=dict)
def optimization_candidates(plan_id: str, day_id: str, payload: Optional[CandidatesRequest] = None,
                            db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    day = _day_or_404(db, plan, day_id)
    result = _public(_compute(db, plan, day, (payload or CandidatesRequest()).travel_mode))
    result["can_apply"] = role in ("owner", "editor")
    return result


@router.post("/{plan_id}/days/{day_id}/optimization-candidates/apply", response_model=dict)
def apply_optimization_candidate(plan_id: str, day_id: str, payload: ApplyRequest, request: Request,
                                 db: Session = Depends(get_db),
                                 if_match: Optional[str] = Header(None, alias="If-Match"),
                                 current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    day = _day_or_404(db, plan, day_id)
    plans_api._require_if_match(plan, if_match)
    result = _compute(db, plan, day, payload.travel_mode)
    if result["input_fingerprint"] != payload.input_fingerprint:
        raise HTTPException(status_code=409, detail={
            "code": "optimization_stale",
            "message": "候補を計算した後に旅程・制約・予約が変わりました。もう一度候補を計算してください",
        })
    e = result["_evals"].get(payload.candidate_id)
    if e is None:
        raise HTTPException(status_code=409, detail={
            "code": "candidate_not_found", "message": "この候補は今の旅程では選べません。もう一度候補を計算してください",
        })
    events = {str(ev.id): ev for ev in db.query(TravelEvent).filter(TravelEvent.day_id == day.id).all()}
    changes = []
    for eid in e["order"]:
        ev = events[eid]
        new_sort = e["sort_orders"][eid]
        new_time = e["times"][eid]
        if ev.sort_order == new_sort and ev.local_start_time == new_time:
            continue
        before = plans_api._event_to_dict(ev)
        ev.sort_order = new_sort
        if new_time != ev.local_start_time:
            ev.local_start_time = new_time
            branches_api._apply_time(ev, day, new_time)
        db.flush()
        changes.append(("travel_event", ev.id, "update", before, plans_api._event_to_dict(ev)))
    if not changes:
        raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "この候補では旅程は変わりません"})
    new_revision = plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "optimization", changes)
    cs = db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id, ChangeSet.resulting_revision == new_revision).first()
    record_audit_event(
        action="optimization_applied", resource_type="travel_plan", user_id=current_user.id, resource_id=plan.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details={"day_id": str(day.id), "changed": len(changes), "algorithm_version": opt.ALGORITHM_VERSION,
                 "candidate_id": payload.candidate_id, "plan_revision": new_revision},
    )
    return {"plan_revision": new_revision, "changed": len(changes), "change_set_id": str(cs.id) if cs else None,
            "algorithm_version": opt.ALGORITHM_VERSION}
