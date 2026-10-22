"""
[Gate P14] FR-054 Plan-to-Memory・FR-053 旅の達成指標(DOC-04 SC-42 Journey Review、DOC-15 CA-011/012)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET    /journey                             : 日ごとの予定と実績・記録の件数・実績の提案・達成指標(viewer以上)
- PUT    /journey/events/{event_id}           : 実績を記録・変更する(editor以上。既存の実績を変える時は If-Match: 実績のrevision)
- DELETE /journey/events/{event_id}           : 実績を消す(editor以上。予定は変わらない)
- POST   /journey/events/{event_id}/carry-over: 行かなかった予定を、別の旅行(自分が編集できる)の日へ予定として戻す
                                                (戻し先の変更セット source=carry_over で「元に戻す」可能)

予定(travel_events)は実績で上書きしない。実績の提案には、閲覧者本人の位置の軌跡(暗号化してサーバーへ保存したもの)だけを使い、
他の人の軌跡は使わない。監査に予定名・メモを残さない。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.services import member_policy
from app.models.models import (
    EventActual, LocationPointBatch, LocationTrack, Memory, TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import journey as jr
from app.services import location_tracks as lt
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["journey"])


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _actual_dict(a: Optional[EventActual]) -> Optional[Dict[str, Any]]:
    if a is None:
        return None
    return {"status": a.status, "actual_start_at": _iso(a.actual_start_at), "actual_end_at": _iso(a.actual_end_at),
            "source": a.source, "note": a.note, "revision": a.revision,
            "updated_at": _iso(a.updated_at or a.created_at)}


def _own_track_points(db: Session, plan: TravelPlan, user: User) -> List[Dict[str, Any]]:
    """閲覧者本人の、サーバーへ保存した軌跡の点(時刻順)。復号できなければ使わない(提案が出ないだけ)。"""
    tracks = db.query(LocationTrack.id).filter(
        LocationTrack.plan_id == plan.id, LocationTrack.user_id == user.id, LocationTrack.mode == "synced").all()
    out: List[Dict[str, Any]] = []
    if not tracks:
        return out
    try:
        for b in db.query(LocationPointBatch).filter(LocationPointBatch.track_id.in_([t[0] for t in tracks])).all():
            for p in lt.decode(decrypt_payload(b.points_ciphertext)):
                out.append({"t": datetime.fromisoformat(p["t"]), "lat": p["lat"], "lng": p["lng"]})
    except EncryptionNotConfigured:
        return []
    out.sort(key=lambda p: p["t"])
    return out


def _get_event(db: Session, plan: TravelPlan, event_id: str) -> TravelEvent:
    try:
        eid = uuid.UUID(str(event_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="予定が見つかりません")
    ev = db.query(TravelEvent).filter(TravelEvent.id == eid, TravelEvent.plan_id == plan.id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="予定が見つかりません")
    return ev


def _audit(action: str, user: User, plan: TravelPlan, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="event_actual", user_id=user.id, resource_id=plan.id,
                       details={"plan_id": str(plan.id), **details})


class ActualInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    actual_start_at: Optional[datetime] = None
    actual_end_at: Optional[datetime] = None
    source: str = "manual"
    note: Optional[str] = Field(None, max_length=500)


class CarryOverInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_plan_id: uuid.UUID
    target_day_id: uuid.UUID


@router.get("/{plan_id}/journey")
def get_journey(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).order_by(
        TravelDay.local_date, TravelDay.sort_order).all()
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    actuals = {a.event_id: a for a in db.query(EventActual).filter(EventActual.plan_id == plan.id).all()}
    # 記録は閲覧者に見えるもの(本人の記録とメンバーに公開された記録)だけを数える
    mems = (db.query(Memory.event_id, Memory.kind, Memory.occurred_at)
            .filter(Memory.plan_id == plan.id, Memory.event_id.isnot(None))
            .filter((Memory.author_user_id == current_user.id) | (Memory.visibility == "members")).all())
    mem_by_event: Dict[uuid.UUID, List[Any]] = {}
    for eid, kind, occurred in mems:
        mem_by_event.setdefault(eid, []).append((kind, occurred))
    points = _own_track_points(db, plan, current_user)

    out_days = []
    planned_ids: List[str] = []
    actual_map: Dict[str, Dict[str, Any]] = {}
    for d in days:
        evs = sorted((e for e in events if e.day_id == d.id),
                     key=lambda e: (e.local_start_time or "99:99", e.sort_order, str(e.id)))
        rows = []
        for e in evs:
            key = str(e.id)
            planned_ids.append(key)
            a = actuals.get(e.id)
            if a:
                actual_map[key] = {"status": a.status, "actual_start_at": a.actual_start_at,
                                   "actual_end_at": a.actual_end_at}
            ms = mem_by_event.get(e.id, [])
            suggestion = None
            if not a or a.status == "visited" and a.actual_start_at is None:
                s = jr.suggest_actual({"latitude": e.latitude, "longitude": e.longitude}, points,
                                      [m[1] for m in ms])
                if s:
                    suggestion = {"actual_start_at": _iso(s["actual_start_at"]),
                                  "actual_end_at": _iso(s["actual_end_at"]), "basis": s["basis"], "points": s["points"]}
            planned = jr.planned_start(d.local_date, e.local_start_time, d.timezone_id)
            rows.append({
                "event_id": key, "title": e.title, "planned_time": e.local_start_time,
                "planned_start_at": _iso(planned), "has_location": e.latitude is not None and e.longitude is not None,
                "actual": _actual_dict(a), "memory_count": len(ms),
                "photo_count": sum(1 for m in ms if m[0] == "photo"), "suggestion": suggestion,
                "start_diff_minutes": jr.start_diff_minutes(planned, a.actual_start_at if a else None),
            })
        out_days.append({"day_id": str(d.id), "date": d.local_date.isoformat(), "title": d.title,
                         "timezone_id": d.timezone_id, "events": rows})

    photo_ids = [str(eid) for eid, ms in mem_by_event.items() if any(k == "photo" for k, _ in ms)]
    distance = lt.distance_m([{"t": p["t"].isoformat(), "lat": p["lat"], "lng": p["lng"]} for p in points]) \
        if points else None
    return {
        "plan_id": str(plan.id), "title": plan.title, "days": out_days,
        "metrics": jr.metrics(planned_ids, actual_map, photo_ids, [str(k) for k in mem_by_event], distance),
        "can_edit": role in ("owner", "editor"),
    }


@router.put("/{plan_id}/journey/events/{event_id}")
def put_actual(plan_id: str, event_id: str, body: ActualInput, db: Session = Depends(get_db),
               if_match: Optional[str] = Header(None, alias="If-Match"),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    ev = _get_event(db, plan, event_id)
    if body.status not in ("visited", "skipped"):
        raise _bad("invalid_field", "実績は「行った」か「行かなかった」です")
    if body.source not in ("manual", "suggested"):
        raise _bad("invalid_field", "実績の出どころが不正です")
    for v in (body.actual_start_at, body.actual_end_at):
        if v is not None and v.tzinfo is None:
            raise _bad("invalid_field", "時刻にはタイムゾーンを含めてください")
    if body.status == "skipped" and (body.actual_start_at or body.actual_end_at):
        raise _bad("invalid_field", "行かなかった予定には到着・出発の時刻を付けられません")
    if body.actual_start_at and body.actual_end_at and body.actual_end_at < body.actual_start_at:
        raise _bad("invalid_field", "出発は到着より後にしてください")
    note = (body.note or "").strip() or None
    a = db.query(EventActual).filter(EventActual.plan_id == plan.id, EventActual.event_id == ev.id).first()
    if a:
        if if_match is None or not if_match.strip():
            raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(実績のrevision)")
        try:
            expected = int(if_match.strip('"'))
        except ValueError:
            raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
        if expected != a.revision:
            raise _bad("revision_conflict", f"実績が他の人の変更で更新されています(現在のrevision: {a.revision})", 409)
        a.revision += 1
    else:
        a = EventActual(plan_id=plan.id, event_id=ev.id, recorded_by_user_id=current_user.id)
        db.add(a)
    a.status, a.actual_start_at, a.actual_end_at = body.status, body.actual_start_at, body.actual_end_at
    a.source, a.note = body.source, note
    a.recorded_by_user_id = current_user.id
    db.commit()
    db.refresh(a)
    _audit("event_actual.put", current_user, plan,
           {"status": a.status, "source": a.source, "with_times": a.actual_start_at is not None})
    return {"event_id": str(ev.id), "actual": _actual_dict(a)}


@router.delete("/{plan_id}/journey/events/{event_id}", status_code=204)
def delete_actual(plan_id: str, event_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    ev = _get_event(db, plan, event_id)
    a = db.query(EventActual).filter(EventActual.plan_id == plan.id, EventActual.event_id == ev.id).first()
    if not a:
        raise HTTPException(status_code=404, detail="この予定の実績はありません")
    db.delete(a)
    db.commit()
    _audit("event_actual.delete", current_user, plan, {})
    return Response(status_code=204)


@router.post("/{plan_id}/journey/events/{event_id}/carry-over", status_code=201)
def carry_over(plan_id: str, event_id: str, body: CarryOverInput, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, _role, src_hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    ev = _get_event(db, plan, event_id)
    a = db.query(EventActual).filter(EventActual.plan_id == plan.id, EventActual.event_id == ev.id).first()
    if a and a.status == "visited":
        raise _bad("already_visited", "行った予定は次の旅行へ戻せません(行かなかった・未記録の予定だけ)", 409)
    if body.target_plan_id == plan.id:
        raise _bad("same_plan", "同じ旅行へは戻せません。別の旅行を選んでください")
    target, _trole = require_plan_access(db, body.target_plan_id, current_user, min_role="editor")
    day = db.query(TravelDay).filter(TravelDay.id == body.target_day_id, TravelDay.plan_id == target.id).first()
    if not day:
        raise _bad("day_not_found", "戻し先の日が見つかりません")
    max_sort = db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count()
    # 場所・種類・メモだけを写す(時刻・予約・確定ロック・費用は写さない)
    # [Gate G2] FR-045 元の旅行で隠されている項目(メモ・住所と位置)は写さない
    hide_place = "event_address" in src_hidden
    new_event = TravelEvent(plan_id=target.id, day_id=day.id, place_id=None if hide_place else ev.place_id,
                            title=ev.title, description=None if "event_notes" in src_hidden else ev.description,
                            event_type=ev.event_type, address=None if hide_place else ev.address,
                            latitude=None if hide_place else ev.latitude,
                            longitude=None if hide_place else ev.longitude, sort_order=max_sort)
    db.add(new_event)
    db.flush()
    revision = plans_api._record_change_and_bump_revision(
        db, target, current_user, "carry_over", "travel_event", new_event.id, "create",
        before_json=None, after_json=plans_api._event_to_dict(new_event),
    )
    _audit("event_actual.carry_over", current_user, plan, {"target_plan_id": str(target.id)})
    return {"event_id": str(new_event.id), "target_plan_id": str(target.id), "target_day_id": str(day.id),
            "target_revision": revision}
