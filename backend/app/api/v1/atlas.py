"""
[Gate P15] FR-052 Personal Travel Atlas(DOC-04 SC-41、DOC-15 CA-010)。

- GET /atlas           : 自分が参加している旅行(所有・承諾済みの共同編集)を横断して、訪れた地域を区画で集計する
                         (precision=region|area、year=年で絞り込み)。旅行ごとの件数と、Atlasから除いているかを返す
- PUT /atlas/settings  : Atlasに含めない旅行を設定する(旅行単位の公開範囲。users.preferences["atlas"] に保存、migrationなし)

材料: 行った実績(P14、旅行の共有データ)・本人の位置付きの記録(P12)・本人の位置の軌跡(P13、サーバー保存分)・
これからの旅行の位置付きの予定。他の人の記録・軌跡は使わない。Atlasは本人だけが見る(共有・公開は作らない)。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload
from app.core.database import get_db
from app.models.models import (
    EventActual, LocationAreaCell, LocationPointBatch, LocationTrack, Memory, PlanCollaborator, TravelDay, TravelEvent,
    TravelPlan, User,
)
from app.api.v1 import visits as visits_api
from app.services import atlas as at
from app.services import visit_assessment as va
from app.services import location_tracks as lt
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/atlas", tags=["atlas"])

PREF_KEY = "atlas"


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _db_user(db: Session, current: User) -> User:
    return db.query(User).filter(User.id == current.id).first() or current


def _excluded(user: User) -> List[str]:
    raw = (user.preferences or {}).get(PREF_KEY)
    ids = raw.get("excluded_plan_ids") if isinstance(raw, dict) else None
    return [str(x) for x in ids] if isinstance(ids, list) else []


def _plans(db: Session, user: User) -> List[TravelPlan]:
    member_ids = {r[0] for r in db.query(PlanCollaborator.plan_id).filter(
        PlanCollaborator.user_id == user.id, PlanCollaborator.status == "accepted").all()}
    q = db.query(TravelPlan).filter(TravelPlan.deleted_at.is_(None))
    q = q.filter((TravelPlan.user_id == user.id) | (TravelPlan.id.in_(member_ids))) if member_ids \
        else q.filter(TravelPlan.user_id == user.id)
    return q.order_by(TravelPlan.created_at).all()


def _observations(db: Session, plan: TravelPlan, user: User, now: datetime) -> List[Dict[str, Any]]:
    obs: List[Dict[str, Any]] = []
    title = plan.title or "(名前なし)"
    days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}
    events = {e.id: e for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()}
    actuals = {a.event_id: a for a in db.query(EventActual).filter(EventActual.plan_id == plan.id).all()}
    # [Gate V2] FR-051 地点単位の除外: 本人が地図から隠した予定・「行っていない」と直した予定は Atlas に出さない。
    # 隠した予定の場所の半径の中の軌跡の点・記録も出さない
    excluded_events = visits_api.hidden_event_ids(db, plan.id, user.id)
    hidden_only = visits_api.hidden_only_event_ids(db, plan.id, user.id)
    hidden_places = [(e.latitude, e.longitude, va.radius_for(e.event_type)) for eid, e in events.items()
                     if eid in hidden_only and e.latitude is not None and e.longitude is not None]

    def in_hidden_place(lat: float, lng: float) -> bool:
        return any(va._haversine_m(hl, hg, lat, lng) <= r for hl, hg, r in hidden_places)

    def day_time(day_id) -> Optional[datetime]:
        d = days.get(day_id)
        return datetime(d.local_date.year, d.local_date.month, d.local_date.day, tzinfo=dt_timezone.utc) if d else None

    window = lt.trip_window([(d.local_date, d.timezone_id) for d in days.values()], plan.start_date, plan.end_date)
    upcoming = bool(window and window[1] > now)
    for eid, e in events.items():
        if e.latitude is None or e.longitude is None or eid in excluded_events:
            continue
        a = actuals.get(eid)
        base = {"lat": e.latitude, "lng": e.longitude, "plan_id": str(plan.id), "plan_title": title}
        if a and a.status == "visited":
            stayed = bool(a.actual_start_at and a.actual_end_at and
                          (a.actual_end_at - a.actual_start_at).total_seconds() >= at.STAY_MINUTES * 60)
            obs.append({**base, "state": "STAYED" if stayed else "VISITED", "kind": "actual",
                        "at": a.actual_start_at or day_time(e.day_id)})
        elif not a and upcoming:
            obs.append({**base, "state": "PLANNED", "kind": "planned", "at": None, "year_at": day_time(e.day_id)})
    for mm in db.query(Memory).filter(Memory.plan_id == plan.id, Memory.author_user_id == user.id,
                                      Memory.latitude.isnot(None)).all():
        if mm.latitude is None or mm.longitude is None:
            continue
        if mm.event_id in excluded_events or in_hidden_place(mm.latitude, mm.longitude):
            continue
        obs.append({"lat": mm.latitude, "lng": mm.longitude, "plan_id": str(plan.id), "plan_title": title,
                    "state": "VISITED", "kind": "memory", "at": mm.occurred_at or mm.created_at})
    track_ids = [t[0] for t in db.query(LocationTrack.id).filter(
        LocationTrack.plan_id == plan.id, LocationTrack.user_id == user.id, LocationTrack.mode == "synced").all()]
    if track_ids:
        try:
            for b in db.query(LocationPointBatch).filter(LocationPointBatch.track_id.in_(track_ids)).all():
                for p in lt.decode(decrypt_payload(b.points_ciphertext)):
                    if in_hidden_place(p["lat"], p["lng"]):
                        continue
                    obs.append({"lat": p["lat"], "lng": p["lng"], "plan_id": str(plan.id), "plan_title": title,
                                "state": "PASS_THROUGH", "kind": "track", "at": datetime.fromisoformat(p["t"])})
        except EncryptionNotConfigured:
            pass
    # [Gate L5] 「訪問地域だけ同期」の区画(端末で集計した 0.1度の区画と滞在時間。生の座標は無い)
    for c in db.query(LocationAreaCell).filter(LocationAreaCell.plan_id == plan.id,
                                               LocationAreaCell.user_id == user.id).all():
        lat, lng = lt.cell_center(c.cell_key)
        obs.append({"lat": lat, "lng": lng, "plan_id": str(plan.id), "plan_title": title,
                    "state": lt.area_state(c.dwell_seconds), "kind": "area", "at": c.first_at})
    return obs


def _year(o: Dict[str, Any]) -> Optional[int]:
    t = o.get("at") or o.get("year_at")
    return t.year if t else None


@router.get("")
def get_atlas(precision: str = Query("region"), year: Optional[int] = Query(None, ge=1900, le=2200),
              db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    if precision not in at.PRECISIONS:
        raise HTTPException(status_code=422, detail={"code": "invalid_field",
                                                     "message": "precision は region か area です"})
    user = _db_user(db, current_user)
    excluded = set(_excluded(user))
    now = _now()
    plans_out = []
    all_obs: List[Dict[str, Any]] = []
    years = set()
    for p in _plans(db, user):
        obs = _observations(db, p, user, now)
        for o in obs:
            y = _year(o)
            if y:
                years.add(y)
        is_excluded = str(p.id) in excluded
        plans_out.append({"plan_id": str(p.id), "title": p.title or "(名前なし)", "excluded": is_excluded,
                          "observations": len(obs), "is_owner": p.user_id == user.id})
        if not is_excluded:
            all_obs.extend(o for o in obs if year is None or _year(o) == year)
    cells = at.aggregate(all_obs, precision)
    return {"precision": precision, "year": year, "years": sorted(years), "plans": plans_out, "cells": cells,
            "summary": at.summarize(cells)}


class AtlasSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    excluded_plan_ids: List[uuid.UUID] = Field(default_factory=list, max_length=500)


@router.put("/settings")
def put_settings(body: AtlasSettings, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    user = _db_user(db, current_user)
    accessible = {p.id for p in _plans(db, user)}
    unknown = [str(x) for x in body.excluded_plan_ids if x not in accessible]
    if unknown:
        # 見えない旅行のIDは存在を区別せずまとめて拒否する
        raise HTTPException(status_code=422, detail={"code": "unknown_plan",
                                                     "message": "参加していない旅行は指定できません"})
    prefs = dict(user.preferences or {})
    prefs[PREF_KEY] = {"excluded_plan_ids": sorted({str(x) for x in body.excluded_plan_ids})}
    user.preferences = prefs
    db.commit()
    record_audit_event(action="atlas.settings", resource_type="user", user_id=user.id, resource_id=user.id,
                       details={"excluded": len(prefs[PREF_KEY]["excluded_plan_ids"])})
    return {"excluded_plan_ids": prefs[PREF_KEY]["excluded_plan_ids"]}
