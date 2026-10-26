"""
[Gate P17] FR-057 Memory Replan(DOC-15 CA-015、DOC-04 SC-42 の「次回候補」)。

- GET  /plans/{plan_id}/memory-replan        : 自分が参加している「ほかの旅行」の予定と実績から傾向(根拠つき)を出し、
                                               この旅行への提案を返す(viewer以上。旅程は変えない)
- POST /plans/{plan_id}/memory-replan/apply  : 提案を適用する(editor以上。If-Match: 本案のrevision、input_fingerprint で
                                               提案を作った時の入力と同じか確認し、違えば409 replan_stale)。
                                               1つの変更セット(source=memory_replan)で記録し、本案の「元に戻す」で取り消せる

AIは使わない(集計の規則だけ)。傾向の材料は閲覧者が参加している旅行の実績(旅行の共有データ)だけ。
[Gate G7] MEM-03: 同じ同行者の属性の旅行を優先し(basis)、移動手段の傾向(slow_transport)から区間の前の余裕を足す提案を作る。
監査には件数だけを記録し、予定名を残さない。
"""
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import branches as branches_api
from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    EventActual, EventReservation, PlanCollaborator, Reservation, TravelDay, TravelEvent, TravelPlan, TravelSegment,
    User,
)
from app.services import journey as jr
from app.services import memory_replan as mr
from app.services import movement as mv
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["memory-replan"])


def _days(db: Session, plan: TravelPlan) -> List[Dict[str, Any]]:
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).order_by(TravelDay.local_date).all()
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    out = []
    for d in days:
        out.append({"id": d.id, "local_date": d.local_date, "timezone_id": d.timezone_id, "events": [
            {"id": e.id, "title": e.title, "event_type": e.event_type, "local_start_time": e.local_start_time,
             "locked": e.locked, "sort_order": e.sort_order} for e in events if e.day_id == d.id]})
    return out


def _blocked(db: Session, plan: TravelPlan) -> set:
    ids = {r[0] for r in db.query(Reservation.event_id).filter(
        Reservation.plan_id == plan.id, Reservation.event_id.isnot(None)).all()}
    ids |= {r[0] for r in db.query(EventReservation.event_id).join(
        Reservation, Reservation.id == EventReservation.reservation_id).filter(Reservation.plan_id == plan.id).all()}
    return {str(x) for x in ids}


def _other_plans(db: Session, user: User, exclude_id) -> List[TravelPlan]:
    member_ids = {r[0] for r in db.query(PlanCollaborator.plan_id).filter(
        PlanCollaborator.user_id == user.id, PlanCollaborator.status == "accepted").all()}
    q = db.query(TravelPlan).filter(TravelPlan.deleted_at.is_(None), TravelPlan.id != exclude_id)
    q = q.filter((TravelPlan.user_id == user.id) | (TravelPlan.id.in_(member_ids))) if member_ids \
        else q.filter(TravelPlan.user_id == user.id)
    return q.all()


def _segments(db: Session, plan: TravelPlan, days: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    titles = {str(e["id"]): e["title"] for d in days for e in d["events"]}
    out = []
    for sg in db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id).all():
        label = f"{titles.get(str(sg.from_event_id), '出発地')} → {titles.get(str(sg.to_event_id), '到着地')}"
        out.append({"id": sg.id, "mode": sg.mode, "status": sg.status, "to_event_id": sg.to_event_id,
                    "buffer_before_minutes": sg.buffer_before_minutes, "label": label[:200]})
    return out


def _planned(d, e):
    return jr.planned_start(d["local_date"], e.get("local_start_time"), d["timezone_id"])


def _compute(db: Session, plan: TravelPlan, user: User) -> Dict[str, Any]:
    samples: List[Dict[str, Any]] = []
    transport: List[Dict[str, Any]] = []
    for p in _other_plans(db, user, plan.id):
        acts = db.query(EventActual).filter(EventActual.plan_id == p.id).all()
        if not acts:
            continue
        actuals = {str(a.event_id): {"status": a.status, "actual_start_at": a.actual_start_at,
                                     "actual_end_at": a.actual_end_at} for a in acts}
        past_days = _days(db, p)
        party = mv.party_of(db, p)  # [Gate G7] MEM-03 同行者の属性
        samples.extend(mr.sample_rows(past_days, actuals, str(p.id), p.title or "(名前なし)", _planned, party))
        transport.extend(mr.transport_rows(past_days, actuals, _segments(db, p, past_days),
                                           str(p.title or "(名前なし)"), party, _planned))
    party = mv.party_of(db, plan)
    ins = mr.insights(samples, party, transport)
    days = _days(db, plan)
    blocked = _blocked(db, plan)
    segments = _segments(db, plan, days)
    proposals = mr.proposals(ins, days, blocked) + mr.transport_proposals(ins, segments)
    return {"insights": ins, "proposals": proposals, "party": party, "party_label": mr.party_label(party),
            "input_fingerprint": mr.fingerprint(days, blocked, ins, segments), "sample_count": len(samples),
            "transport_sample_count": len(transport)}


@router.get("/{plan_id}/memory-replan")
def get_memory_replan(plan_id: str, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    result = _compute(db, plan, current_user)
    return {**result, "plan_id": str(plan.id), "plan_revision": plan.revision,
            "algorithm_version": mr.ALGORITHM_VERSION, "can_apply": role in ("owner", "editor")}


class ApplyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposal_id: str = Field(..., min_length=1, max_length=64)
    input_fingerprint: str = Field(..., min_length=1, max_length=64)


@router.post("/{plan_id}/memory-replan/apply")
def apply_memory_replan(plan_id: str, body: ApplyInput, db: Session = Depends(get_db),
                        if_match: Optional[str] = Header(None, alias="If-Match"),
                        current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    plans_api._require_if_match(plan, if_match)
    result = _compute(db, plan, current_user)
    if result["input_fingerprint"] != body.input_fingerprint:
        raise HTTPException(status_code=409, detail={
            "code": "replan_stale", "message": "提案を作った後に旅程か過去の記録が変わりました。提案を読み込み直してください"})
    proposal = next((p for p in result["proposals"] if p["id"] == body.proposal_id), None)
    if not proposal:
        raise HTTPException(status_code=409, detail={"code": "proposal_not_found",
                                                     "message": "この提案は今は使えません。提案を読み込み直してください"})
    changes = []
    if proposal.get("target") == "segment":
        # [Gate G7] MEM-03 移動手段の傾向: 区間の前の余裕を足す(区間の変更として記録し、元に戻せる)
        for c in proposal["changes"]:
            sg = db.query(TravelSegment).filter(TravelSegment.id == uuid.UUID(c["segment_id"]),
                                                TravelSegment.plan_id == plan.id).first()
            if not sg:
                continue
            before = plans_api._segment_to_dict(sg)
            sg.buffer_before_minutes = c["to"]
            setattr(sg, "revision", int(sg.revision or 1) + 1)
            db.flush()
            changes.append(("travel_segment", sg.id, "update", before, plans_api._segment_to_dict(sg)))
    for c in ([] if proposal.get("target") == "segment" else proposal["changes"]):
        ev = db.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(c["event_id"]),
                                          TravelEvent.plan_id == plan.id).first()
        if not ev:
            continue
        before = plans_api._event_to_dict(ev)
        old_time = ev.local_start_time
        ev.local_start_time = c["to"]
        # [Gate G7] FR-005 終了(日をまたぐ予定を含む)も同じだけずらす
        branches_api._apply_time(ev, ev.day, c["to"], old_time)
        changes.append(("travel_event", ev.id, "update", before, plans_api._event_to_dict(ev)))
    if not changes:
        raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "変える予定がありません"})
    revision = plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "memory_replan", changes)
    record_audit_event(action="memory_replan.apply", resource_type="travel_plan", user_id=current_user.id,
                       resource_id=plan.id, details={"kind": proposal["kind"], "changes": len(changes),
                                                     "minutes": proposal["minutes"]})
    return {"plan_id": str(plan.id), "plan_revision": revision, "applied": len(changes), "proposal_id": proposal["id"]}
