"""
[Gate PlanB] 日ごとの案(プランB)の API。すべて /api/v1/plans/{plan_id} の下。閲覧は viewer 以上、作る・変える・切り替えは editor 以上。

- GET    /variants                    : 日付ごとの案の一覧(今の案・控え・しまった案の要約)
- POST   /variants                    : 案を作る {local_date, source: copy_active|copy_day|blank, source_day_id?, name?,
                                        reason?, conditions?, also_dates?: [日付](同じ元のしかたで、ほかの日にも作る=案の組)}
- GET    /variants/{day_id}           : 案の日(予定・区間)。旅程の画面が控えの案を開く時に使う
- PATCH  /variants/{day_id}           : 名前・理由・条件・しまう(archived)/控えへ戻す(standby)  If-Match
- DELETE /variants/{day_id}           : 控え・しまった案を消す(今の案は消せない)  If-Match
- GET    /variants/{day_id}/check     : 今の案にした時の前後のつながり・予約・時刻の検証
- POST   /variants/{day_id}/switch    : 今の案にする {reason?, note?, phase?, join_event_id?, done_event_ids?, place_label?,
                                        group: true で案の組をまとめて}  If-Match。元に戻す(/undo)で戻せる
- GET    /variant-switches            : 切り替えの記録(旅の記録・書き出し)
"""
import uuid
from datetime import date as date_cls
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, selectinload

from app.api.v1 import plans as P
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import DayVariantSwitch, TravelDay, TravelEvent, TravelSegment, User
from app.services import day_variants as dv

router = APIRouter(prefix="/plans", tags=["day-variants"])


class Conditions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    party_size: Optional[int] = Field(None, ge=1, le=99)
    absent_member_ids: List[str] = Field(default_factory=list, max_length=50)
    transport_mode: Optional[str] = Field(None, max_length=20)
    prefer_indoor: bool = False
    note: Optional[str] = Field(None, max_length=200)


class VariantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    local_date: date_cls
    source: str = Field("copy_active", pattern="^(copy_active|copy_day|blank)$")
    source_day_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(None, max_length=40)
    reason: Optional[str] = None
    conditions: Optional[Conditions] = None
    also_dates: List[date_cls] = Field(default_factory=list, max_length=30)


class VariantPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, max_length=40)
    reason: Optional[str] = None
    conditions: Optional[Conditions] = None
    status: Optional[str] = Field(None, pattern="^(standby|archived)$")


class SwitchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Optional[str] = None
    note: Optional[str] = Field(None, max_length=200)
    phase: str = Field("planning", pattern="^(planning|during|after)$")
    join_event_id: Optional[uuid.UUID] = None
    done_event_ids: List[uuid.UUID] = Field(default_factory=list, max_length=100)
    place_label: Optional[str] = Field(None, max_length=80)
    group: bool = False


def _reason(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    if v not in dv.REASONS:
        raise HTTPException(status_code=422, detail={"code": "invalid_reason", "message": "理由の指定が正しくありません"})
    return v


def _day(db: Session, plan, day_id) -> TravelDay:
    with dv.all_variants(db):
        d = db.query(TravelDay).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first()
    if d is None:
        raise HTTPException(status_code=404, detail={"code": "variant_not_found", "message": "案が見つかりません"})
    return d


def _summary(db: Session, d: TravelDay) -> Dict[str, Any]:
    evs = dv._events(db, d)
    timed = [e.local_start_time[:5] for e in evs if e.local_start_time]
    return {
        "day_id": str(d.id), "local_date": d.local_date.isoformat(), "label": d.variant_label, "name": dv.label_name(d),
        "status": d.variant_status, "reason": d.variant_reason,
        "reason_label": dv.REASON_LABEL.get(d.variant_reason or "", None), "conditions": d.variant_conditions or {},
        "group_id": str(d.variant_group_id) if d.variant_group_id else None,
        "copied_from_day_id": str(d.copied_from_day_id) if d.copied_from_day_id else None,
        "events": len(evs), "first_time": min(timed) if timed else None, "last_time": max(timed) if timed else None,
        "titles": [e.title for e in evs[:6]],
    }


@router.get("/{plan_id}/variants")
def list_variants(plan_id: str, local_date: Optional[date_cls] = None, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user, "viewer")
    with dv.all_variants(db):
        q = db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
        if local_date is not None:
            q = q.filter(TravelDay.local_date == local_date)
        days = q.order_by(TravelDay.local_date, TravelDay.variant_label).all()
    out: Dict[str, List[Dict[str, Any]]] = {}
    for d in days:
        out.setdefault(d.local_date.isoformat(), []).append(_summary(db, d))
    return {"revision": plan.revision, "dates": out, "max_per_date": dv.MAX_VARIANTS}


def _make_one(db: Session, plan, user, d0: date_cls, body: VariantCreate, group_id) -> TravelDay:
    same = dv.days_of_date(db, plan.id, d0)
    active = next((d for d in same if d.variant_status == "active"), None)
    if active is None:
        raise HTTPException(status_code=404, detail={"code": "day_not_found", "message": f"{d0} の日がありません"})
    label = dv.next_label(same)
    if label is None or len([d for d in same if d.variant_status != "archived"]) >= dv.MAX_VARIANTS:
        raise HTTPException(status_code=409, detail={"code": "too_many_variants",
                                                     "message": f"{d0} の案は {dv.MAX_VARIANTS} つまでです"})
    src: Optional[TravelDay] = None
    if body.source == "copy_active":
        src = active
    elif body.source == "copy_day":
        if body.source_day_id is None:
            raise HTTPException(status_code=422, detail={"code": "source_required", "message": "写す日を選んでください"})
        src = _day(db, plan, body.source_day_id)
    nd = TravelDay(plan_id=plan.id, local_date=d0, timezone_id=active.timezone_id, title=active.title,
                   sort_order=active.sort_order, variant_status="standby", variant_label=label,
                   variant_name=(body.name or "").strip() or None, variant_reason=_reason(body.reason),
                   variant_conditions=body.conditions.model_dump() if body.conditions else None,
                   variant_group_id=group_id, copied_from_day_id=src.id if src is not None else None)
    db.add(nd)
    db.flush()
    if src is not None:
        dv.copy_day_into(db, src, nd)
    return nd


@router.post("/{plan_id}/variants", status_code=201)
def create_variant(plan_id: str, body: VariantCreate, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user)
    dates = [body.local_date] + [d for d in body.also_dates if d != body.local_date]
    group_id = dv.new_group() if len(dates) > 1 else None
    made: List[TravelDay] = []
    with dv.all_variants(db):
        for d0 in dates:
            made.append(_make_one(db, plan, current_user, d0, body, group_id))
        changes = [("travel_day", d.id, "create", None, P._day_to_dict(d)) for d in made]
        rev = P._record_batch_change_and_bump_revision(db, plan, current_user, "variant", changes)
        return {"revision": rev, "variants": [_summary(db, d) for d in made]}


@router.get("/{plan_id}/variants/{day_id}")
def get_variant(plan_id: str, day_id: uuid.UUID, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan, hidden = P._plan_hidden(db, plan_id, current_user, "viewer")
    with dv.all_variants(db):
        d = (db.query(TravelDay).options(selectinload(TravelDay.events))
             .filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first())
        if d is None:
            raise HTTPException(status_code=404, detail={"code": "variant_not_found", "message": "案が見つかりません"})
        ev_ids = [e.id for e in d.events]
        segs = (db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id,
                                               TravelSegment.to_event_id.in_(ev_ids or [uuid.uuid4()])).all())
        day = P.DayWithEvents(id=str(d.id), local_date=d.local_date, timezone_id=d.timezone_id, title=d.title,
                              notes=d.notes, sort_order=d.sort_order,
                              events=[P._event_out(e, hidden, d) for e in sorted(d.events, key=lambda e: e.sort_order)])
        # 区間は旅程の区間の一覧と同じ形(見積もりは今の座標・条件で計算し直す)
        from app.api.v1 import segments as S

        params, est_rev = S.te.load(db)
        ests = {s.id: S._refresh_estimate(db, s, params, est_rev) for s in segs}
        out_segs = [S._to_response(s, db, ests[s.id]) for s in segs]
        if db.dirty:
            db.commit()
        return {"revision": plan.revision, "variant": _summary(db, d), "day": day.model_dump(mode="json"),
                "segments": out_segs}


@router.patch("/{plan_id}/variants/{day_id}")
def patch_variant(plan_id: str, day_id: uuid.UUID, body: VariantPatch,
                  if_match: Optional[str] = Header(None, alias="If-Match"), db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user)
    P._require_if_match(plan, if_match)
    with dv.all_variants(db):
        d = _day(db, plan, day_id)
        before = P._day_to_dict(d)
        if body.name is not None:
            d.variant_name = body.name.strip() or None
        if body.reason is not None:
            d.variant_reason = _reason(body.reason)
        if body.conditions is not None:
            d.variant_conditions = body.conditions.model_dump()
        if body.status is not None:
            if d.variant_status == "active":
                raise HTTPException(status_code=409, detail={"code": "active_variant",
                                                             "message": "今の案はしまえません。先に別の案に切り替えてください"})
            d.variant_status = body.status
        db.flush()
        rev = P._record_change_and_bump_revision(db, plan, current_user, "variant", "travel_day", d.id, "update",
                                                 before, P._day_to_dict(d))
        return {"revision": rev, "variant": _summary(db, d)}


@router.delete("/{plan_id}/variants/{day_id}")
def delete_variant(plan_id: str, day_id: uuid.UUID, if_match: Optional[str] = Header(None, alias="If-Match"),
                   db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user)
    P._require_if_match(plan, if_match)
    with dv.all_variants(db):
        d = _day(db, plan, day_id)
        if d.variant_status == "active":
            raise HTTPException(status_code=409, detail={"code": "active_variant",
                                                         "message": "今の案は消せません。先に別の案に切り替えてください"})
        before = P._day_to_dict(d)
        before["_events"] = [{**P._event_to_dict(e), "id": str(e.id)} for e in dv._events(db, d)]
        db.delete(d)
        db.flush()
        rev = P._record_change_and_bump_revision(db, plan, current_user, "variant", "travel_day", day_id, "delete",
                                                 before, None)
    return {"revision": rev, "deleted": str(day_id)}


@router.get("/{plan_id}/variants/{day_id}/check")
def check_variant(plan_id: str, day_id: uuid.UUID, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user, "viewer")
    with dv.all_variants(db):
        d = _day(db, plan, day_id)
        party = (d.variant_conditions or {}).get("party_size")
        return {"variant": _summary(db, d), **dv.check_continuity(db, d, party)}


@router.post("/{plan_id}/variants/{day_id}/switch")
def switch_variant(plan_id: str, day_id: uuid.UUID, body: SwitchIn,
                   if_match: Optional[str] = Header(None, alias="If-Match"), db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user)
    P._require_if_match(plan, if_match)
    reason = _reason(body.reason)
    with dv.all_variants(db):
        target = _day(db, plan, day_id)
        targets = [target]
        if body.group and target.variant_group_id is not None:
            targets = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id,
                                                  TravelDay.variant_group_id == target.variant_group_id)
                       .order_by(TravelDay.local_date).all())
        changes: List[tuple] = []
        records: List[DayVariantSwitch] = []
        for t in targets:
            if t.variant_status == "active":
                continue
            before_t = P._day_to_dict(t)
            old = dv.activate(db, t)
            if old is not None:
                changes.append(("travel_day", old.id, "update", {**P._day_to_dict(old), "variant_status": "active"},
                                P._day_to_dict(old)))
            changes.append(("travel_day", t.id, "update", before_t, P._day_to_dict(t)))
            records.append(DayVariantSwitch(
                plan_id=plan.id, local_date=t.local_date, from_day_id=old.id if old else None, to_day_id=t.id,
                from_label=old.variant_label if old else None, to_label=t.variant_label,
                from_name=dv.label_name(old) if old else None, to_name=dv.label_name(t),
                switched_by_user_id=current_user.id, reason=reason, note=body.note, phase=body.phase,
                join_event_id=body.join_event_id if t.id == target.id else None,
                done_event_ids=[str(x) for x in body.done_event_ids] if t.id == target.id else None,
                place_label=body.place_label, group_id=t.variant_group_id if body.group else None))
        if not changes:
            raise HTTPException(status_code=409, detail={"code": "already_active", "message": "もう今の案です"})
        for r in records:
            db.add(r)
        db.flush()
        rev = P._record_batch_change_and_bump_revision(db, plan, current_user, "variant_switch", changes)
        from app.models.models import ChangeSet

        cs = (db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id, ChangeSet.resulting_revision == rev).first())
        for r in records:
            r.change_set_id = cs.id if cs else None
        db.commit()
        return {"revision": rev, "switched": [_summary(db, t) for t in targets],
                "records": [str(r.id) for r in records]}


@router.get("/{plan_id}/variant-switches")
def list_switches(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan = P._get_owned_plan(db, plan_id, current_user, "viewer")
    rows = (db.query(DayVariantSwitch).filter(DayVariantSwitch.plan_id == plan.id)
            .order_by(DayVariantSwitch.switched_at.desc()).limit(200).all())
    return {"switches": [{
        "id": str(r.id), "local_date": r.local_date.isoformat(), "from_label": r.from_label, "to_label": r.to_label,
        "from_name": r.from_name, "to_name": r.to_name,
        "switched_at": r.switched_at.isoformat() if r.switched_at else None,
        "reason": r.reason, "reason_label": dv.REASON_LABEL.get(r.reason or "", None), "note": r.note, "phase": r.phase,
        "place_label": r.place_label, "join_event_id": str(r.join_event_id) if r.join_event_id else None,
        "done_event_ids": r.done_event_ids or [], "undone": r.undone_at is not None,
        "switched_by_me": r.switched_by_user_id == current_user.id,
    } for r in rows]}


_ = (TravelEvent, status)
