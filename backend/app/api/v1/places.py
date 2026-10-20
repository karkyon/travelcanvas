"""
[Gate C2] FR-008 場所の一元管理(DOC-02 FR-008・FC-027〜030、DOC-04 SC-09)。

- GET  /places/{place_id}                : 場所の詳細(正式名・別名・住所・座標・入口・階・電話・Web・営業時間・休業日・価格帯・
                                           予約の要否・アクセシビリティ・メモ)と、項目ごとの出典(検索の提供元・取得時刻/利用者の入力)、
                                           この場所を使う予定(閲覧者が見られる旅行のものだけ)
- PATCH /places/{place_id}               : 項目を直す(If-Match: 場所の revision)。直した項目の出典は「利用者の入力」
- PUT  /places/{place_id}/opening-hours  : 曜日ごとの営業時間を置き換える(If-Match)
- GET  /plans/{plan_id}/places           : この旅行が使っている場所(予定・移動区間・候補)の一覧

見られるのは作った人と、この場所を使う旅行のメンバー。直せるのは、この場所を使う全ての旅行を編集できる人(app/services/place_access.py)。
見られない場所は 404(存在を区別させない)。同じ場所 ID を予定・移動区間・候補が参照する(地図・しおりも同じ値を使う)。
"""
import re
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access, resolve_plan_role
from app.models.models import (
    FieldSource, OpeningHours, Place, PlanCandidate, SourceRecord, TravelDay, TravelEvent, TravelPlan, TravelSegment,
    User,
)
from app.services import candidates as cs
from app.services import place_access
from app.services.audit_service import record_audit_event

router = APIRouter(tags=["places"])

TEXT_FIELDS = {"name": 200, "category": 50, "address": 500, "phone": 40, "entrance_note": 500, "floor": 40,
               "price_range": 40, "accessibility_note": 1000, "closed_days": 200, "note": 2000}
_PHONE = re.compile(r"^\+?[0-9][0-9\-\s()]{3,38}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")
PROVIDER_LABEL = {"user": "利用者の入力", "url": "登録した URL", "wikipedia": "Wikipedia", "nominatim": "OpenStreetMap",
                  "overpass": "OpenStreetMap"}


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _audit(action: str, user: User, place: Place, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="place", user_id=user.id, resource_id=place.id,
                       details=details)


def _require_rev(place: Place, if_match: Optional[str]) -> None:
    if if_match is None or not if_match.strip():
        raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(場所のrevision)")
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != (place.revision or 1):
        raise _bad("revision_conflict", f"場所が他の人の変更で更新されています(現在のrevision: {place.revision})", 409)


def _sources(db: Session, place: Place) -> Dict[str, Dict[str, Any]]:
    """項目ごとの最新の出典"""
    out: Dict[str, Dict[str, Any]] = {}
    rows = (db.query(FieldSource, SourceRecord).join(SourceRecord, FieldSource.source_record_id == SourceRecord.id)
            .filter(FieldSource.place_id == place.id).order_by(FieldSource.created_at).all())
    for fs, src in rows:
        out[fs.field_name] = {"provider": src.provider, "label": PROVIDER_LABEL.get(src.provider, src.provider),
                              "source_url": src.source_url, "retrieved_at": _iso(src.retrieved_at)}
    return out


def _detail(db: Session, place: Place, user: User) -> Dict[str, Any]:
    plans = {p.id: p for p in db.query(TravelPlan).filter(
        TravelPlan.id.in_(place_access.referencing_plan_ids(db, place.id)), TravelPlan.deleted_at.is_(None)).all()}
    visible = {pid for pid, p in plans.items() if resolve_plan_role(db, p, user)}
    events = []
    if visible:
        days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id.in_(visible)).all()}
        for e in db.query(TravelEvent).filter(TravelEvent.place_id == place.id, TravelEvent.plan_id.in_(visible)).all():
            d = days.get(e.day_id)
            events.append({"event_id": str(e.id), "plan_id": str(e.plan_id), "plan_title": plans[e.plan_id].title,
                           "title": e.title, "date": d.local_date.isoformat() if d else None,
                           "local_start_time": e.local_start_time})
        events.sort(key=lambda x: (x["date"] or "", x["local_start_time"] or "99:99"))
    hours = sorted(db.query(OpeningHours).filter(OpeningHours.place_id == place.id).all(),
                   key=lambda h: (h.day_of_week, h.open_time or ""))
    return {
        "id": str(place.id), "name": place.name, "aliases": list(place.aliases or []), "category": place.category,
        "address": place.address, "latitude": place.latitude, "longitude": place.longitude,
        "phone": place.phone, "website": place.website, "entrance_note": place.entrance_note, "floor": place.floor,
        "reservation_required": place.reservation_required, "price_range": place.price_range,
        "accessibility_note": place.accessibility_note, "closed_days": place.closed_days, "note": place.note,
        "opening_hours": [{"day_of_week": h.day_of_week, "open_time": h.open_time, "close_time": h.close_time}
                          for h in hours],
        "sources": _sources(db, place), "events": events, "revision": place.revision or 1,
        "can_edit": place_access.can_edit(db, place, user),
        "updated_at": _iso(place.updated_at or place.created_at),
    }


@router.get("/places/{place_id}")
def get_place(place_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    place = place_access.get_viewable(db, place_id, current_user)
    return _detail(db, place, current_user)


class PlacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, max_length=400)
    aliases: Optional[List[str]] = Field(None, max_length=10)
    category: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=1000)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = Field(None, max_length=80)
    website: Optional[str] = Field(None, max_length=4000)
    entrance_note: Optional[str] = Field(None, max_length=1000)
    floor: Optional[str] = Field(None, max_length=80)
    reservation_required: Optional[bool] = None
    price_range: Optional[str] = Field(None, max_length=80)
    accessibility_note: Optional[str] = Field(None, max_length=2000)
    closed_days: Optional[str] = Field(None, max_length=400)
    note: Optional[str] = Field(None, max_length=4000)


def _user_source(db: Session, place: Place) -> SourceRecord:
    src = SourceRecord(place_id=place.id, provider="user", retrieved_at=_now(), freshness_state="fresh")
    db.add(src)
    db.flush()
    return src


def _require_edit(db: Session, place: Place, user: User) -> None:
    if not place_access.can_edit(db, place, user):
        raise _bad("forbidden", "この場所を使う全ての旅行の編集の権限が無いため、直せません", 403)


@router.patch("/places/{place_id}")
def update_place(place_id: str, body: PlacePatch, db: Session = Depends(get_db),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    place = place_access.get_viewable(db, place_id, current_user)
    _require_edit(db, place, current_user)
    _require_rev(place, if_match)
    fields = body.model_dump(exclude_unset=True)
    changed: Dict[str, Any] = {}
    try:
        for name, limit in TEXT_FIELDS.items():
            if name in fields:
                value = cs.clean_text(fields[name], limit, name, required=(name == "name"))
                if name == "phone" and value and not _PHONE.match(value):
                    raise cs.CandidateInputError("invalid_field", "電話番号は数字・+・-・括弧・空白で入れてください")
                changed[name] = value
        if "website" in fields:
            changed["website"] = cs.canonical_url(fields["website"])
        if "aliases" in fields:
            aliases = []
            for a in fields["aliases"] or []:
                v = cs.clean_text(a, 100, "別名")
                if v and v not in aliases:
                    aliases.append(v)
            changed["aliases"] = aliases
        if "latitude" in fields or "longitude" in fields:
            changed["latitude"], changed["longitude"] = cs.check_location(fields.get("latitude"),
                                                                          fields.get("longitude"))
        if "reservation_required" in fields:
            changed["reservation_required"] = fields["reservation_required"]
    except cs.CandidateInputError as e:
        raise _bad(e.code, str(e))
    actual = {k: v for k, v in changed.items() if getattr(place, k) != v}
    if actual:
        src = _user_source(db, place)
        for k, v in actual.items():
            setattr(place, k, v)
            db.add(FieldSource(place_id=place.id, field_name=k,
                               value=None if v is None else str(v)[:2000], source_record_id=src.id))
        place.revision = (place.revision or 1) + 1
        db.commit()
        db.refresh(place)
    _audit("place.update", current_user, place, {"fields": sorted(actual)})
    return _detail(db, place, current_user)


class HoursItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day_of_week: int = Field(..., ge=0, le=6)
    open_time: str
    close_time: str


class HoursInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hours: List[HoursItem] = Field(default_factory=list, max_length=21)


@router.put("/places/{place_id}/opening-hours")
def put_opening_hours(place_id: str, body: HoursInput, db: Session = Depends(get_db),
                      if_match: Optional[str] = Header(None, alias="If-Match"),
                      current_user: User = Depends(get_current_user_or_guest)):
    place = place_access.get_viewable(db, place_id, current_user)
    _require_edit(db, place, current_user)
    _require_rev(place, if_match)
    per_day: Dict[int, int] = {}
    for h in body.hours:
        if not _TIME.match(h.open_time) or not _TIME.match(h.close_time):
            raise _bad("invalid_field", "時刻は HH:MM で入れてください")
        if h.open_time == h.close_time:
            raise _bad("invalid_field", "開く時刻と閉じる時刻が同じです")
        per_day[h.day_of_week] = per_day.get(h.day_of_week, 0) + 1
        if per_day[h.day_of_week] > 3:
            raise _bad("invalid_field", "1日の営業時間の区切りは3つまでです")
    src = _user_source(db, place)
    db.query(OpeningHours).filter(OpeningHours.place_id == place.id).delete(synchronize_session=False)
    for h in body.hours:
        # 閉じる時刻が開く時刻より前なら、日をまたぐ営業(例 18:00〜02:00)
        db.add(OpeningHours(place_id=place.id, day_of_week=h.day_of_week, open_time=h.open_time,
                            close_time=h.close_time, source_record_id=src.id))
    db.add(FieldSource(place_id=place.id, field_name="opening_hours", value=str(len(body.hours)),
                       source_record_id=src.id))
    place.revision = (place.revision or 1) + 1
    db.commit()
    db.refresh(place)
    _audit("place.opening_hours", current_user, place, {"count": len(body.hours)})
    return _detail(db, place, current_user)


@router.get("/plans/{plan_id}/places")
def plan_places(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    ids = {r[0] for r in db.query(TravelEvent.place_id).filter(TravelEvent.plan_id == plan.id,
                                                               TravelEvent.place_id.isnot(None)).all()}
    for seg in db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id).all():
        ids |= {i for i in (seg.from_place_id, seg.to_place_id) if i}
    ids |= {r[0] for r in db.query(PlanCandidate.place_id).filter(PlanCandidate.plan_id == plan.id,
                                                                  PlanCandidate.place_id.isnot(None)).all()}
    places = db.query(Place).filter(Place.id.in_(ids)).all() if ids else []
    counts: Dict[uuid.UUID, int] = {}
    for (pid,) in db.query(TravelEvent.place_id).filter(TravelEvent.plan_id == plan.id,
                                                        TravelEvent.place_id.isnot(None)).all():
        counts[pid] = counts.get(pid, 0) + 1
    return {"plan_id": str(plan.id), "places": [
        {"id": str(p.id), "name": p.name, "category": p.category, "address": p.address, "phone": p.phone,
         "has_opening_hours": db.query(OpeningHours).filter(OpeningHours.place_id == p.id).count() > 0,
         "event_count": counts.get(p.id, 0)} for p in sorted(places, key=lambda x: x.name or "")]}
