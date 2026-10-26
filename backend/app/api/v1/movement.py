"""
[Gate G7] MOVE-03 移動・滞在の既定 / FR-005 変更の影響のプレビュー。

- GET  /plans/{plan_id}/movement-settings          : 旅行の移動・滞在の既定(行が無ければ既定値。viewer以上)
- PUT  /plans/{plan_id}/movement-settings          : 保存する(editor以上。If-Match: 既定の revision、まだ無ければ 0)。
                                                     変えると実行可能性の検証の結果は古くなる(is_stale)
- POST /plans/{plan_id}/events/{event_id}/impact-preview : 予定の時刻・日程の変更や削除を、保存する前に検証へかけて、
                                                     新たに出る問題・解消する問題・関係する区間と予約の数を返す(editor以上。
                                                     DBは変えない)。日をまたぐ終了(local_end_time + end_day_offset)も試せる

値は利用者の入力と既定だけで、外部の提供元は使わない。監査には変えた項目の名前だけを残す(同行者の属性の値は残さない)。
"""
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import (
    EventReservation, PlanConstraint, Reservation, TravelDay, TravelEvent, TravelPlan, TravelSegment, User,
)
from app.services import event_times as et
from app.services import feasibility
from app.services import member_policy
from app.services import movement as mv
from app.services import optimizer as opt
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import load_constraints_for_evaluation

router = APIRouter(prefix="/plans", tags=["movement"])


def _bad(code: str, message: str, status: int = 422) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _view(db: Session, plan: TravelPlan, role: str) -> Dict[str, Any]:
    settings, revision = mv.load_settings(db, plan)
    return {
        "plan_id": str(plan.id), "algorithm_version": mv.ALGORITHM_VERSION,
        "settings": settings, "revision": revision, "is_default": revision == 0,
        "effective": mv.rules_view(mv.rules_from(settings)),
        "defaults": mv.DEFAULTS,
        "event_types": [{"key": k, "label": mv.TYPE_LABEL[k], "default_minutes": mv.DEFAULT_STAY[k],
                         "estimated": k not in mv.NOT_ESTIMATED} for k in mv.EVENT_TYPES],
        "paces": [{"key": k, "label": mv.PACE_LABEL[k], **v} for k, v in mv.PACES.items()],
        "can_edit": role in ("owner", "editor"),
    }


@router.get("/{plan_id}/movement-settings", response_model=dict)
def get_movement_settings(plan_id: str, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user_or_guest)):
    plan, role, _hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    return _view(db, plan, role)


class MovementSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settings: Dict[str, Any] = Field(...)


@router.put("/{plan_id}/movement-settings", response_model=dict)
def put_movement_settings(plan_id: str, payload: MovementSettingsIn, request: Request, db: Session = Depends(get_db),
                          if_match: Optional[str] = Header(None, alias="If-Match"),
                          current_user: User = Depends(get_current_user_or_guest)):
    plan, role, _hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    if if_match is None or not if_match.strip().strip('"').isdigit():
        raise _bad("if_match_required", "If-Match(移動の既定の版。まだ無ければ 0)が必要です", 428)
    before, _rev = mv.load_settings(db, plan)
    try:
        row = mv.save(db, plan, current_user.id, payload.settings, int(if_match.strip().strip('"')))
    except mv.MovementError as e:
        raise _bad(e.code, e.message, 409 if e.code == "movement_settings_conflict" else 422)
    db.commit()
    changed = sorted(k for k in row.settings if row.settings.get(k) != before.get(k))
    record_audit_event(
        action="movement_settings_updated", resource_type="travel_plan", user_id=current_user.id,
        resource_id=plan.id, ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details={"revision": row.revision, "changed": changed},
    )
    return _view(db, plan, role)


# ============================================================ FR-005 変更の影響のプレビュー

class ImpactIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    local_start_time: Optional[str] = None
    local_end_time: Optional[str] = None
    end_day_offset: Optional[int] = Field(None, ge=0, le=et.MAX_DAY_OFFSET)
    day_id: Optional[str] = None
    delete: bool = False


def _finding_out(f: feasibility.Finding) -> Dict[str, Any]:
    return {"code": f.code, "severity": f.severity, "message": f.message, "entity_label": f.entity_label,
            "estimated": bool((f.evidence or {}).get("estimated")),
            "is_private_constraint": bool(f.constraint and f.constraint.is_private)}


def evaluation_context(db: Session, plan: TravelPlan):
    """(snapshot, constraint_set, titles, owners, rules)。検証と同じ入力。"""
    now = datetime.now(timezone.utc)
    snap = feasibility.load_snapshot(db, plan)
    cset = load_constraints_for_evaluation(db, plan, at=now)
    ids = [c.id for c in cset.constraints] + list(cset.unavailable)
    rows = {c.id: c for c in db.query(PlanConstraint).filter(PlanConstraint.id.in_(ids))} if ids else {}
    titles = {cid: c.title for cid, c in rows.items() if c.privacy_level == "shared" and c.title}
    owners = {cid: c.owner_user_id for cid, c in rows.items()}
    return snap, cset, titles, owners, mv.load_rules(db, plan)


@router.post("/{plan_id}/events/{event_id}/impact-preview", response_model=dict)
def preview_event_impact(plan_id: str, event_id: str, payload: ImpactIn, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user_or_guest)):
    plan, _role, hidden = member_policy.require_access(db, plan_id, current_user, "editor")
    try:
        eid = uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="イベントが見つかりません")
    ev = db.query(TravelEvent).filter(TravelEvent.id == eid, TravelEvent.plan_id == plan.id).first()
    if ev is None:
        raise HTTPException(status_code=404, detail="イベントが見つかりません")
    found = db.query(TravelDay).filter(TravelDay.id == ev.day_id).first()
    if found is None:
        raise HTTPException(status_code=404, detail="日程が見つかりません")
    # ORM の行(列の値)を値として扱う
    day: Any = found
    target: Any = found
    if payload.day_id:
        try:
            target = db.query(TravelDay).filter(TravelDay.id == uuid.UUID(payload.day_id),
                                                TravelDay.plan_id == plan.id).first()
        except ValueError:
            target = None
        if target is None:
            raise _bad("day_missing", "移す先の日程が見つかりません", 404)
    ev_end: Any = ev.end_at

    snap, cset, titles, owners, rules = evaluation_context(db, plan)
    before = feasibility.evaluate(snap, cset, titles=titles, unavailable_owners=owners, movement=rules)
    info = next((e for e in snap.events if e.id == ev.id), None)
    fields = payload.model_dump(exclude_unset=True)
    end_offset: Optional[int] = None
    if payload.delete:
        events = [e for e in snap.events if e.id != ev.id]
        segments = [s for s in snap.segments if ev.id not in (s.from_event_id, s.to_event_id)]
        sim = replace(snap, events=events, segments=segments,
                      links=[link for link in snap.links if link.event_id != ev.id])
    else:
        new_day = feasibility.DayInfo(target.id, target.local_date, target.timezone_id or "UTC")
        start = info.start if info is not None else None
        end = info.end if info is not None else None
        try:
            if "local_start_time" in fields:
                start = (et.local_dt(new_day.local_date, payload.local_start_time, new_day.timezone_id)
                         if payload.local_start_time else None)
                if end is not None and info is not None and info.start is not None and start is not None \
                        and "local_end_time" not in fields:
                    end = start + (end - info.start)
            elif target.id != day.id and start is not None:
                start = start + (target.local_date - day.local_date)
                end = end + (target.local_date - day.local_date) if end is not None else None
            if "local_end_time" in fields or "end_day_offset" in fields:
                local_end = payload.local_end_time if "local_end_time" in fields else \
                    et.end_fields(ev_end, day.local_date, day.timezone_id)[0]
                if local_end:
                    if start is None:
                        raise et.EventTimeError("end_requires_start", "終了時刻を入れるには、先に開始時刻を入れてください")
                    end, end_offset = et.end_from_local(new_day.local_date, new_day.timezone_id, local_end,
                                                        payload.end_day_offset, start)
                else:
                    end = None
            et.check_range(start, end)
        except et.EventTimeError as e:
            raise _bad(e.code, e.message)
        events = []
        for x in snap.events:
            if x.id == ev.id:
                events.append(replace(x, day=new_day, start=start, end=end))
            else:
                events.append(x)
        sim = replace(snap, events=events)
    after = feasibility.evaluate(sim, cset, titles=titles, unavailable_owners=owners, movement=rules)
    new, resolved = opt.diff_findings(before, after)
    new = [f for f in new if not member_policy.validation_issue_hidden(hidden, f.code, f.entity_type)]
    resolved = [f for f in resolved if not member_policy.validation_issue_hidden(hidden, f.code, f.entity_type)]
    seg_count = db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id).filter(
        (TravelSegment.from_event_id == ev.id) | (TravelSegment.to_event_id == ev.id)).count()
    res_ids = {r[0] for r in db.query(EventReservation.reservation_id).filter(EventReservation.event_id == ev.id)}
    res_ids |= {r[0] for r in db.query(Reservation.id).filter(Reservation.event_id == ev.id,
                                                              Reservation.deleted_at.is_(None))}
    summary: List[str] = []
    if new:
        summary.append(f"この変更で新たに{len(new)}件の問題が出ます")
    if resolved:
        summary.append(f"この変更で{len(resolved)}件の問題が解消します")
    if not new and not resolved:
        summary.append("検証の結果は変わりません")
    if seg_count:
        summary.append(f"この予定につながる移動が{seg_count}件あります" + ("(削除すると一緒に消えます)" if payload.delete else ""))
    if res_ids and "reservations" not in hidden:
        summary.append(f"予約{len(res_ids)}件と紐付いています" + ("(削除すると紐付けが外れます)" if payload.delete else ""))
    if end_offset:
        summary.append(f"終了は開始の{end_offset}日後です(日をまたぐ予定)")
    return {
        "event_id": str(ev.id), "plan_revision": plan.revision,
        "algorithm_version": feasibility.ALGORITHM_VERSION,
        "before": feasibility.counts(before.findings), "after": feasibility.counts(after.findings),
        "new_issues": [_finding_out(f) for f in new], "resolved_issues": [_finding_out(f) for f in resolved],
        "related": {"segments": seg_count, "reservations": 0 if "reservations" in hidden else len(res_ids)},
        "end_day_offset": end_offset, "summary": summary,
    }
