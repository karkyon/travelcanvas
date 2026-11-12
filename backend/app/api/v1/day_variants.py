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
- GET    /today/switch-options        : 旅行中: 今いる所・時刻から、控えの案ごとの合流点・移動・とばす予定・つながり
- POST   /replans/{replan_id}/save-variant : 再計画の案 A/B を、この日の控えの案として保存する(上書きしない)
"""
import uuid
from datetime import date as date_cls
from typing import Any, Dict, List, Optional, cast

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
    # たたき台の条件(遅れ: 何分・何時から、疲れ: 1 日の予定の上限)
    delay_minutes: Optional[int] = Field(None, ge=15, le=720)
    delay_after: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    max_events: Optional[int] = Field(None, ge=1, le=10)


class VariantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    local_date: date_cls
    source: str = Field("copy_active", pattern="^(copy_active|copy_day|blank)$")
    source_day_id: Optional[uuid.UUID] = None
    name: Optional[str] = Field(None, max_length=40)
    reason: Optional[str] = None
    conditions: Optional[Conditions] = None
    also_dates: List[date_cls] = Field(default_factory=list, max_length=30)
    # 理由に合わせて組み替えたたたき台にする(雨・遅れ・疲れ・移動手段。写す時だけ)
    scaffold: bool = False


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
        if body.scaffold and nd.variant_reason in dv.SCAFFOLD_REASONS:
            cond = dict(nd.variant_conditions or {})
            if nd.variant_reason == "rain":
                # 雨: 屋内を優先・移動の既定は(指定が無ければ)電車・徒歩
                cond["prefer_indoor"] = True
                cond["transport_mode"] = cond.get("transport_mode") or "train"
            cond["scaffold"] = dv.apply_scaffold(db, nd, nd.variant_reason, cond)
            nd.variant_conditions = cond
            db.flush()
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
            # 送られた条件だけを変える(たたき台の印・遅れの条件などは残す)
            d.variant_conditions = {**(d.variant_conditions or {}), **body.conditions.model_dump(exclude_unset=True)}
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
        # 共同の編集者へ知らせる(本文に予定名は入れない。日付と案の記号・名前だけ)
        from app.models.models import Notification
        from app.services.constraint_evaluation import member_user_ids

        msg = "・".join(f"{r.local_date.month}/{r.local_date.day} {r.to_label} {r.to_name}" for r in records)
        for uid in member_user_ids(db, plan):
            if uid == current_user.id:
                continue
            db.add(Notification(id=uuid.uuid4(), user_id=uid, type="variant_switched", title="日の案が切り替わりました",
                                message=f"{msg} に切り替わりました。旅程を確認してください", related_plan_id=plan.id))
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
        "done_event_ids": r.done_event_ids or [], "undone": dv.switch_undone(db, r),
        "switched_by_me": r.switched_by_user_id == current_user.id,
    } for r in rows]}


_ = (TravelEvent, status)


# ---- [P6] 旅行中: 今いる所と時刻から、間に合う合流点つきの切り替え先 ----------------------------

def _hm(v: Optional[str]) -> Optional[int]:
    from app.services.weather_fit import minutes_of

    return minutes_of(v)


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


@router.get("/{plan_id}/today/switch-options")
def switch_options(plan_id: str, date: Optional[date_cls] = None, at: Optional[str] = None,
                   lat: Optional[float] = None, lng: Optional[float] = None, from_event_id: Optional[uuid.UUID] = None,
                   place_label: Optional[str] = None, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    """今日(date)の控えの案ごとに: 合流点(今から間に合う最初の予定)・そこまでの移動・とばす予定・済んだ予定・
    前後のつながり・屋外の予定の数。位置は送らずに予定(from_event_id)を選ぶ形も。位置は記録しない"""
    from datetime import datetime as dt_cls
    from zoneinfo import ZoneInfo

    from app.models.models import PlanAlert
    from app.services import travel_estimate as te
    from app.services import weather_fit as wf

    plan = P._get_owned_plan(db, plan_id, current_user, "viewer")
    with dv.all_variants(db):
        days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id, TravelDay.variant_status == "active")
                .order_by(TravelDay.local_date).all())
        if not days:
            return {"date": None, "now": None, "options": [], "alerts": []}
        tz = ZoneInfo(days[0].timezone_id or "Asia/Tokyo")
        now_local = dt_cls.now(tz)
        the_date = date or now_local.date()
        active = next((d for d in days if d.local_date == the_date), None)
        if active is None:
            return {"date": the_date.isoformat(), "now": None, "options": [], "alerts": [],
                    "message": "この日は旅程にありません"}
        import re as _re

        ok_at = at is None or _re.match(r"^([01]\d|2[0-3]):[0-5]\d$", at)
        now_min = (_hm(at) if at else now_local.hour * 60 + now_local.minute) if ok_at else None
        if now_min is None:
            raise HTTPException(status_code=422, detail={"code": "invalid_time", "message": "時刻は HH:MM で指定してください"})
        cur_events = dv._events(db, active)
        done = [e for e in cur_events if (_hm(e.local_start_time) or 24 * 60) <= now_min]
        # 今いる所: 位置 → 選んだ予定 → 済んだ最後の予定の場所
        here: Optional[tuple] = None
        if lat is not None and lng is not None:
            here = (lat, lng)
        elif from_event_id is not None:
            ev = db.query(TravelEvent).filter(TravelEvent.id == from_event_id, TravelEvent.plan_id == plan.id).first()
            if ev is not None and ev.latitude is not None and ev.longitude is not None:
                here = (ev.latitude, ev.longitude)
        else:
            last = next((e for e in reversed(done) if e.latitude is not None and e.longitude is not None), None)
            if last is not None:
                here = (last.latitude, last.longitude)
        params, rev = te.load(db)
        alerts = (db.query(PlanAlert).filter(PlanAlert.plan_id == plan.id, PlanAlert.status == "active").all())
        day_alerts = [a for a in alerts if a.day_id is None or a.day_id == active.id
                      or (a.event_id is not None and a.event_id in {e.id for e in cur_events})]
        rainy = any(a.kind == "weather" for a in day_alerts)
        options: List[Dict[str, Any]] = []
        variants = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id, TravelDay.local_date == the_date,
                                               TravelDay.variant_status == "standby")
                    .order_by(TravelDay.variant_label).all())
        for v in variants:
            evs = [e for e in dv._events(db, v) if e.parent_event_id is None]
            mode = dv.TRANSPORT_TO_MODE.get((v.variant_conditions or {}).get("transport_mode") or "", "driving")
            join = None
            join_idx = len(evs)
            skipped: List[str] = []
            for i, e in enumerate(evs):
                start = _hm(e.local_start_time)
                if start is None:
                    continue
                travel: Optional[float] = None
                if here is not None:
                    est = te.estimate(here[0], here[1], e.latitude, e.longitude, mode, params, rev)
                    travel = est["duration_minutes"] if est else None
                need = int(round(travel)) if travel is not None else 30  # 分からない時は 30 分を見込む
                if start >= now_min + need:
                    join = {"event_id": str(e.id), "title": e.title, "start": _fmt(start), "mode": mode,
                            "travel_minutes": int(round(travel)) if travel is not None else None,
                            "arrive": _fmt(min(now_min + need, 23 * 60 + 59)), "margin_minutes": start - now_min - need,
                            "travel_known": travel is not None}
                    join_idx = i
                    break
                skipped.append(e.title)
            after = evs[join_idx:]
            outdoor = [e.title for e in after if wf.fit(e.title, e.event_type, e.description)["fit"] == "outdoor"]
            check = dv.check_continuity(db, v, (v.variant_conditions or {}).get("party_size"))
            next_items = [i for i in check["items"] if i["kind"] in ("next", "weather")]
            options.append({
                "variant": _summary(db, v), "join": join, "skipped": skipped if join else [],
                "done": [e.title for e in done], "done_ids": [str(e.id) for e in done], "outdoor_after_join": outdoor,
                "check": {"status": check["status"], "counts": check["counts"], "items": next_items[:4]},
                "recommended": False,
            })
        # 雨の知らせがある時は、屋外の予定が少なく間に合う案を勧める
        if rainy:
            usable = [o for o in options if o["join"]]
            if usable:
                best = min(usable, key=lambda o: (len(cast(List[str], o["outdoor_after_join"])),
                                                  cast(Dict[str, Any], o["variant"])["reason"] != "rain"))
                best["recommended"] = True
        from app.services.replan import KIND_LABELS

        return {
            "revision": plan.revision, "date": the_date.isoformat(), "now": _fmt(now_min), "place_label": place_label,
            "active": _summary(db, active), "here_known": here is not None,
            "alerts": [{"id": str(a.id), "kind": a.kind, "label": KIND_LABELS.get(a.kind, a.kind), "note": a.note}
                       for a in day_alerts],
            "options": options,
        }


# ---- [P6] 再計画の案を「この日の案」として保存する(上書きしないで控えの案にする) -------------------

class SaveReplanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate: str = Field(..., pattern="^[AB]$")
    name: Optional[str] = Field(None, max_length=40)


ALERT_TO_REASON = {"weather": "rain", "delay": "delay", "cancellation": "delay", "closure": "closure"}


@router.post("/{plan_id}/replans/{replan_id}/save-variant", status_code=201)
def save_replan_as_variant(plan_id: str, replan_id: uuid.UUID, body: SaveReplanIn, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    from app.models.models import PlanAlert, Replan
    from app.services import branches as br

    plan = P._get_owned_plan(db, plan_id, current_user)
    r = db.query(Replan).filter(Replan.id == replan_id, Replan.plan_id == plan.id).first()
    if r is None:
        raise HTTPException(status_code=404, detail={"code": "replan_not_found", "message": "再計画が見つかりません"})
    cand = next((c for c in r.candidates if c["id"] == body.candidate), None)
    if cand is None or not cand.get("available"):
        raise HTTPException(status_code=409, detail={"code": "candidate_unavailable", "message": "この案は使えません"})
    ops = br.compute_ops(r.base_snapshot, cand["content"])
    base_ev = {e["source_event_id"]: e for e in r.base_snapshot["events"]}
    by_day: Dict[str, List[Dict[str, Any]]] = {}
    for o in ops:
        if o.get("event_id") in base_ev:
            by_day.setdefault(base_ev[o["event_id"]]["day_id"], []).append(o)
    if not by_day:
        raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "この案では旅程は変わりません"})
    alert = db.query(PlanAlert).filter(PlanAlert.id == r.alert_id).first()
    reason = ALERT_TO_REASON.get(alert.kind if alert else "", "other")
    made: List[TravelDay] = []
    with dv.all_variants(db):
        for day_id, day_ops in by_day.items():
            src = db.query(TravelDay).filter(TravelDay.id == uuid.UUID(day_id), TravelDay.plan_id == plan.id).first()
            if src is None:
                continue
            same = dv.days_of_date(db, plan.id, src.local_date)
            label = dv.next_label(same)
            if label is None or len([d for d in same if d.variant_status != "archived"]) >= dv.MAX_VARIANTS:
                msg = f"{src.local_date} の案は {dv.MAX_VARIANTS} つまでです"
                raise HTTPException(status_code=409, detail={"code": "too_many_variants", "message": msg})
            nd = TravelDay(plan_id=plan.id, local_date=src.local_date, timezone_id=src.timezone_id, title=src.title,
                           sort_order=src.sort_order, variant_status="standby", variant_label=label,
                           variant_name=(body.name or "").strip() or f"再計画 {cand.get('label') or body.candidate}",
                           variant_reason=reason, copied_from_day_id=src.id)
            db.add(nd)
            db.flush()
            idmap = dv.copy_day_into(db, src, nd)["idmap"]
            notes: List[Dict[str, Any]] = []
            for o in day_ops:
                new_id = idmap.get(o["event_id"])
                ev = db.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(new_id)).first() if new_id else None
                if ev is None:
                    continue
                fields = o.get("fields") or {}
                if o["op"] == "remove" or ("day_id" in fields and fields["day_id"] != day_id):
                    notes.append({"kind": "replan", "event_id": None, "title": ev.title,
                                  "text": "外しました" if o["op"] == "remove" else "翌日へ移す案のため、この日の案から外しました"})
                    db.delete(ev)
                    continue
                if "local_start_time" in fields:
                    notes.append({"kind": "replan", "event_id": str(ev.id), "title": ev.title,
                                  "text": f"{(ev.local_start_time or '')[:5]} → {fields['local_start_time']}"})
                    ev.local_start_time = fields["local_start_time"]
            nd.variant_conditions = {"scaffold": notes, "note": f"再計画({cand.get('label') or ''})から保存"}
            db.flush()
            made.append(nd)
        if not made:
            raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "この案では旅程は変わりません"})
        changes = [("travel_day", d.id, "create", None, P._day_to_dict(d)) for d in made]
        rev = P._record_batch_change_and_bump_revision(db, plan, current_user, "variant", changes)
        return {"revision": rev, "variants": [_summary(db, d) for d in made]}
