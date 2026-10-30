"""
[Gate G11] 行き先が未定の旅行相談(G11 の段階5 Intake。docs/ux/G11_UIUX全範囲_実装仕様.md §2.5・§3.5)。

- GET  /trip-intents/status                       : 使える provider(文章の読み取り・方面の提案・位置・道路・宿・混み具合)
- POST /trip-intents/extract                      : 文章と画面の項目から、確かめる条件の一覧(保存しない。文章はログに残さない)
- POST /trip-intents/areas                        : 書かれた方面の位置(地名の照会)・直線距離・照会の状態(保存しない)
- POST /trip-intents/draft                        : 選んだ方面と候補で、未確定の旅程の下書き(旅行)を作る
- GET  /plans/{plan_id}/trip-intent               : 下書き(方面・条件・日と時間帯の並び・照会の状態)
- PUT  /plans/{plan_id}/trip-intent/slots         : 下書きの並びを変える(If-Match: 旅行の revision。前の並びへ戻すのも同じ口)
- POST /plans/{plan_id}/trip-intent/commit        : 日付を決めて、下書きの並びを旅程(日・予定)にする(1回の変更として元に戻せる)

文章からの読み取りは決まった規則だけ(AI は未接続)。運転時間・宿・混み具合・営業時間の値は作らない。
旅の個人的な理由は保存しない。監査には件数と方面の数だけを残す(文章・地名は残さない)。
"""
import uuid
from datetime import date as date_cls
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.api.v1 import candidates as candidates_api
from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    Place, PlanCandidate, SearchCandidate, SourceRecord, TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import candidates as cs
from app.services import trip_intent as ti
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/trip-intents", tags=["trip-intents"])
plan_router = APIRouter(prefix="/plans", tags=["trip-intents"])

KEY = "trip_intent"


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _geocoder_enabled() -> bool:
    return bool((settings.TRIP_INTENT_GEOCODER or "").strip())


@router.get("/status")
def intent_status(current_user: User = Depends(get_current_user_or_guest)):
    return {
        "extractor": "text_rules", "ai_connected": False,
        "providers": {"geocode": "nominatim" if _geocoder_enabled() else None, "route": None, "lodging": None,
                      "crowd": None, "destination_suggestions": None},
    }


class ExtractIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field("", max_length=4000)
    origin: Optional[str] = Field(None, max_length=100)
    travel_window: Optional[str] = Field(None, max_length=60)
    # [Gate G11] 画面の「旅行の時期」(日付が決まっている / おおよその時期)
    date_status: Optional[Literal["window", "fixed"]] = None
    start_date: Optional[date_cls] = None
    party_size: Optional[int] = Field(None, ge=1, le=30)
    nights: Optional[int] = Field(None, ge=0, le=14)
    transport: Optional[Literal["car", "public", "undecided"]] = None
    highway: Optional[bool] = None
    one_way_hours: Optional[float] = Field(None, ge=0.5, le=24)
    one_way_strength: Optional[Literal["preferred", "required", "undecided"]] = None
    room: Optional[Literal["same_room", "multiple_rooms", "undecided"]] = None
    budget_scope: Optional[Literal["total", "per_person", "undecided"]] = None
    preferences: List[str] = Field(default_factory=list, max_length=10)
    areas: List[str] = Field(default_factory=list, max_length=ti.MAX_AREAS)


@router.post("/extract")
def extract_intent(body: ExtractIn, current_user: User = Depends(get_current_user_or_guest)):
    if not body.text.strip() and not body.origin and not body.areas:
        raise _bad("invalid_field", "希望の文章か、出発地・方面のどれかを入力してください")
    fields = body.model_dump(exclude={"text"}, exclude_none=True)
    if any(len(a) > 40 for a in body.areas):
        raise _bad("invalid_field", "方面の名前は40文字までです")
    return ti.extract(body.text, fields)


class AreasIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: str = Field("", max_length=100)
    areas: List[str] = Field(..., min_length=1, max_length=ti.MAX_AREAS)
    one_way_hours: Optional[float] = Field(None, ge=0.5, le=24)
    one_way_strength: Optional[Literal["preferred", "required", "undecided"]] = None


@router.post("/areas")
async def compare_areas(body: AreasIn, current_user: User = Depends(get_current_user_or_guest)):
    names = list(dict.fromkeys(a.strip() for a in body.areas if a.strip()))
    if not names or any(len(a) > 40 for a in names):
        raise _bad("invalid_field", "方面の名前を1〜40文字で入力してください")
    return await ti.compare_areas(body.origin.strip(), names, body.one_way_hours, body.one_way_strength,
                                  enabled=_geocoder_enabled())


class IntentIn(BaseModel):
    """下書きに残す条件(旅の理由・文章は受け取らない)"""
    model_config = ConfigDict(extra="forbid")
    origin: Optional[str] = Field(None, max_length=100)
    party_size: Optional[int] = Field(None, ge=1, le=30)
    nights: int = Field(..., ge=0, le=14)
    transport: Literal["car", "public", "undecided"] = "undecided"
    highway: bool = False
    one_way_hours: Optional[float] = Field(None, ge=0.5, le=24)
    one_way_strength: Literal["preferred", "required", "undecided"] = "undecided"
    room: Literal["same_room", "multiple_rooms", "undecided"] = "undecided"
    budget_min: Optional[int] = Field(None, ge=0, le=10_000_000)
    budget_max: Optional[int] = Field(None, ge=0, le=10_000_000)
    budget_scope: Literal["total", "per_person", "undecided"] = "undecided"
    date_status: Literal["undecided", "window", "fixed"] = "undecided"
    travel_window: Optional[str] = Field(None, max_length=60)
    preferences: List[str] = Field(default_factory=list, max_length=10)


class AreaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=40)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    provider: Optional[Literal["nominatim"]] = None
    retrieved_at: Optional[datetime] = None


class DraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    area: AreaIn
    intent: IntentIn
    search_candidate_ids: List[uuid.UUID] = Field(default_factory=list, max_length=30)
    source_urls: List[str] = Field(default_factory=list, max_length=10)


def _title(area: str, nights: int) -> str:
    return f"{area}・{'日帰り' if nights == 0 else f'{nights}泊{nights + 1}日'}の旅程案"[:200]


@router.post("/draft", status_code=201)
def create_draft(body: DraftIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    intent = body.intent.model_dump()
    if set(intent["preferences"]) - set(ti.PREFERENCES):
        raise _bad("invalid_field", "過ごし方の項目が正しくありません")
    lo, hi = intent["budget_min"], intent["budget_max"]
    if lo is not None and hi is not None and lo > hi:
        raise _bad("invalid_field", "宿泊費の下限が上限より大きくなっています")
    if (body.area.latitude is None) != (body.area.longitude is None):
        raise _bad("invalid_field", "方面の緯度と経度は両方を指定してください")
    if body.area.retrieved_at is not None and body.area.retrieved_at.tzinfo is None:
        raise _bad("invalid_field", "日時にはタイムゾーンを含めてください")
    urls: List[str] = []
    for raw in body.source_urls:
        try:
            url = cs.canonical_url(raw)
        except cs.CandidateInputError as e:
            raise _bad(e.code, str(e))
        if url and url not in urls:
            urls.append(url)
    picked: List[SearchCandidate] = []
    for sid in dict.fromkeys(body.search_candidate_ids):
        sc = db.query(SearchCandidate).filter(SearchCandidate.id == sid,
                                              SearchCandidate.searched_by_user_id == current_user.id).first()
        if sc is None:
            # 他の人の検索結果は存在を区別せず 404
            raise HTTPException(status_code=404, detail="検索結果が見つかりません")
        picked.append(sc)

    try:
        area_name = cs.clean_text(body.area.name, 40, "方面", required=True) or ""
    except cs.CandidateInputError as e:
        raise _bad(e.code, str(e))
    plan = TravelPlan(user_id=current_user.id, title=_title(area_name, intent["nights"]), destination=area_name,
                      status="draft")
    db.add(plan)
    db.flush()
    rows: List[PlanCandidate] = []
    for sc in picked:
        src = db.query(SourceRecord).filter(SourceRecord.candidate_id == sc.id).order_by(
            SourceRecord.created_at.desc()).first()
        url = None
        if src and src.source_url:
            try:
                url = cs.canonical_url(src.source_url)
            except cs.CandidateInputError:
                url = None
        rows.append(PlanCandidate(plan_id=plan.id, created_by_user_id=current_user.id,
                                  title=(sc.name or "(名前なし)")[:200], source_kind="search", source_url=url,
                                  provider=sc.provider, external_id=sc.external_id, retrieved_at=sc.retrieved_at,
                                  category=sc.category, address=sc.address, latitude=sc.latitude,
                                  longitude=sc.longitude, priority=2, status="open"))
    for url in urls:
        rows.append(PlanCandidate(plan_id=plan.id, created_by_user_id=current_user.id,
                                  title=(cs.url_label(url) or "参考の記事・投稿")[:200], source_kind="url",
                                  source_url=url, priority=3, status="open",
                                  note="旅行相談で参考として足した出典(場所は未確認)"))
    for r in rows:
        db.add(r)
    db.flush()
    placeable = [{"id": str(r.id), "category": r.category} for r in rows if r.source_kind == "search"]
    plan.preferences = {KEY: {
        "version": 1,
        "intent": intent,
        "area": {"name": area_name, "latitude": body.area.latitude, "longitude": body.area.longitude,
                 "provider": body.area.provider,
                 "retrieved_at": body.area.retrieved_at.isoformat() if body.area.retrieved_at else None},
        "slots": ti.initial_slots(placeable, intent["nights"]),
        "committed_at": None,
        "created_at": ti.now().isoformat(),
    }}
    db.commit()
    record_audit_event(action="trip_intent.draft", resource_type="travel_plan", user_id=current_user.id,
                       resource_id=plan.id, details={"candidates": len(rows), "nights": intent["nights"]})
    return {"plan_id": str(plan.id), "revision": plan.revision, "candidates": len(rows)}


def _intent_of(plan: TravelPlan) -> Dict[str, Any]:
    data = (plan.preferences or {}).get(KEY) if isinstance(plan.preferences, dict) else None
    if not isinstance(data, dict):
        raise _bad("not_intent_draft", "この旅行は旅行相談から作った下書きではありません", 404)
    return data


def _committed(db: Session, plan: TravelPlan, data: Dict[str, Any]) -> Optional[str]:
    """旅程にした時刻。旅程にした後に「元に戻す」で日程が消えたら、下書きに戻る(None)"""
    at = data.get("committed_at")
    if at and db.query(TravelDay).filter(TravelDay.plan_id == plan.id).count() > 0:
        return str(at)
    return None


def _draft_view(db: Session, plan: TravelPlan, role: str) -> Dict[str, Any]:
    data = _intent_of(plan)
    intent = data.get("intent") or {}
    nights = int(intent.get("nights") or 0)
    rows = db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id).order_by(PlanCandidate.created_at).all()
    event_ids = {r[0] for r in db.query(TravelEvent.id).filter(TravelEvent.plan_id == plan.id).all()}
    cands = [{
        "id": str(r.id), "title": r.title, "category": r.category, "latitude": r.latitude, "longitude": r.longitude,
        "provider": r.provider, "retrieved_at": r.retrieved_at.isoformat() if r.retrieved_at else None,
        "source_url": r.source_url, "source_kind": r.source_kind,
        "status": candidates_api._effective_status(r, event_ids),
    } for r in rows]
    placed = {s["candidate_id"] for s in data.get("slots") or []}
    days = [{"day": d, "label": f"{d}日目",
             "parts": [{"id": p, "label": ti.PART_LABEL[p]} for p in ti.day_parts(d, nights + 1)]}
            for d in range(1, nights + 2)]
    committed = _committed(db, plan, data)
    return {
        "plan_id": str(plan.id), "title": plan.title, "revision": plan.revision,
        "can_edit": role in ("owner", "editor"), "area": data.get("area"), "intent": intent, "nights": nights,
        "days": days, "slots": data.get("slots") or [], "candidates": cands, "committed_at": committed,
        "checklist": {
            "places": {"status": "selected" if placed else "none", "count": len(placed)},
            "lodging": {"status": "not_connected"},
            "route": {"status": "not_connected"},
            "hours": {"status": "date_pending" if not committed else "check_in_planner"},
        },
    }


@plan_router.get("/{plan_id}/trip-intent")
def get_draft(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _draft_view(db, plan, role)


class SlotIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: int = Field(..., ge=1, le=15)
    part: Literal["morning", "lunch", "afternoon", "evening", "stay"]
    candidate_id: str = Field(..., max_length=40)


class SlotsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slots: List[SlotIn] = Field(..., max_length=60)


def _save(plan: TravelPlan, data: Dict[str, Any]) -> None:
    prefs = dict(plan.preferences or {})
    prefs[KEY] = data
    plan.preferences = prefs
    flag_modified(plan, "preferences")
    plan.revision += 1


@plan_router.put("/{plan_id}/trip-intent/slots")
def update_slots(plan_id: str, body: SlotsIn, db: Session = Depends(get_db),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    plans_api._require_if_match(plan, if_match)
    data = dict(_intent_of(plan))
    if _committed(db, plan, data):
        raise _bad("already_committed", "この下書きはもう旅程にしました。並びは旅程の画面で変えてください", 409)
    nights = int((data.get("intent") or {}).get("nights") or 0)
    rows = db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id, PlanCandidate.status != "dismissed").all()
    ids = {str(r.id) for r in rows}
    slots = [s.model_dump() for s in body.slots]
    err = ti.check_slots(slots, nights, ids)
    if err:
        raise _bad("invalid_slots", err)
    data["slots"] = ti.sort_slots(slots)
    _save(plan, data)
    db.commit()
    record_audit_event(action="trip_intent.slots", resource_type="travel_plan", user_id=current_user.id,
                       resource_id=plan.id, details={"slots": len(slots)})
    return _draft_view(db, plan, role)


class CommitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date_cls
    timezone_id: str = Field("Asia/Tokyo", max_length=64)


@plan_router.post("/{plan_id}/trip-intent/commit", status_code=201)
def commit_draft(plan_id: str, body: CommitIn, db: Session = Depends(get_db),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    plans_api._require_if_match(plan, if_match)
    data = dict(_intent_of(plan))
    if _committed(db, plan, data):
        raise _bad("already_committed", "この下書きはもう旅程にしました", 409)
    if db.query(TravelDay).filter(TravelDay.plan_id == plan.id).count() > 0:
        raise _bad("has_days", "この旅行にはもう日程があります。旅程の画面で予定を足してください", 409)
    try:
        ZoneInfo(body.timezone_id)
    except (ZoneInfoNotFoundError, ValueError):
        raise _bad("invalid_field", "時刻帯(タイムゾーン)の名前が正しくありません")
    nights = int((data.get("intent") or {}).get("nights") or 0)
    rows = {str(r.id): r for r in db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id).all()}
    slots = ti.sort_slots(list(data.get("slots") or []))
    err = ti.check_slots(slots, nights, set(rows))
    if err:
        raise _bad("invalid_slots", err)
    changes: List[tuple] = []
    days: Dict[int, TravelDay] = {}
    for d in range(1, nights + 2):
        day = TravelDay(plan_id=plan.id, local_date=body.start_date + timedelta(days=d - 1),
                        timezone_id=body.timezone_id,
                        title=f"{d}日目", sort_order=d - 1)
        db.add(day)
        db.flush()
        days[d] = day
        changes.append(("travel_day", day.id, "create", None, plans_api._day_to_dict(day)))
    counts: Dict[int, int] = {}
    for s in slots:
        c = rows[s["candidate_id"]]
        place = db.query(Place).filter(Place.id == c.place_id).first() if c.place_id else None
        if place is None:
            place = candidates_api._place_from_candidate(db, c, current_user)
            c.place_id = place.id
        day = days[s["day"]]
        ev = TravelEvent(plan_id=plan.id, day_id=day.id, place_id=place.id, title=c.title, description=c.note,
                         event_type=ti.EVENT_TYPE_OF_PART.get(s["part"], "sightseeing"), local_start_time=None,
                         address=c.address, latitude=c.latitude, longitude=c.longitude,
                         sort_order=counts.get(s["day"], 0))
        counts[s["day"]] = counts.get(s["day"], 0) + 1
        db.add(ev)
        db.flush()
        changes.append(("travel_event", ev.id, "create", None, plans_api._event_to_dict(ev)))
        c.status, c.scheduled_event_id, c.merged_into_id = "scheduled", ev.id, None
        c.revision += 1
    # 旅行の開始・終了の日は、作成の画面(TravelPlanCreate)と同じく日付の 0時(UTC)で持つ(日の時刻帯は travel_days が持つ)
    plan.start_date = datetime(body.start_date.year, body.start_date.month, body.start_date.day, tzinfo=dt_timezone.utc)
    end = body.start_date + timedelta(days=nights)
    plan.end_date = datetime(end.year, end.month, end.day, tzinfo=dt_timezone.utc)
    data["committed_at"] = ti.now().isoformat()
    prefs = dict(plan.preferences or {})
    prefs[KEY] = data
    plan.preferences = prefs
    flag_modified(plan, "preferences")
    # 日・予定を1つの変更として記録する(旅程の画面の「元に戻す」1回で全て戻る)。この関数が commit する
    revision = plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "trip_intent", changes)
    record_audit_event(action="trip_intent.commit", resource_type="travel_plan", user_id=current_user.id,
                       resource_id=plan.id, details={"days": nights + 1, "events": len(slots)})
    return {"plan_id": str(plan.id), "revision": revision,
            "days": [{"id": str(days[d].id), "local_date": days[d].local_date.isoformat()} for d in sorted(days)],
            "events": len(slots)}
