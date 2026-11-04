"""
[Gate G11] 行き先が未定の旅行相談(G11 の段階5 Intake。docs/ux/G11_UIUX全範囲_実装仕様.md §2.5・§3.5)。

- GET  /trip-intents/status                       : 使える provider(文章の読み取り・方面の提案・位置・道路・宿・混み具合)
- POST /trip-intents/extract                      : 文章と画面の項目から、確かめる条件の一覧(保存しない。文章はログに残さない)
- POST /trip-intents/areas                        : 書かれた方面の位置(地名の照会)・直線距離・照会の状態(保存しない)
- POST /trip-intents/draft                        : 選んだ方面と候補で、未確定の旅程の下書き(旅行)を作る
- [Gate ConsultAI] 旅行を作る前の相談で外部の提供元を使う(押した時だけ・Idempotency-Key・相談の口座で 50円と回数):
  POST /trip-intents/ai/session        : 相談を始める(送らない)
  GET  /trip-intents/ai/status         : 同意・クラス・鍵の確認・模擬かどうか・相談の口座(送らない)
  POST /trip-intents/ai/extract        : 文章を AI(OpenAI Responses・構造化の出力)で読み取る。「AI · 未確認」として返す
  POST /trip-intents/ai/places-search  : Google で場所を探す(方面の位置の近く)。保存しない
  POST /trip-intents/ai/route          : Google で出発地から方面への経路を調べる。保存しない
  GET  /trip-intents/area-images       : [Gate AreaImages] 方面の代表画像(Wikipedia・無料)。保存しない
  POST /trip-intents/spots/resolve     : [Gate AreaSpots] 名前で挙がった場所を Wikipedia の記事に結び付けて候補にする(無料)
  POST /trip-intents/ai/spots          : [Gate AreaSpots] 方面の代表的な場所を AI に頼み(1回)、記事に結び付けて候補にする
- GET  /plans/{plan_id}/trip-intent               : 下書き(方面・条件・日と時間帯の並び・照会の状態)
- PUT  /plans/{plan_id}/trip-intent/slots         : 下書きの並びを変える(If-Match: 旅行の revision。前の並びへ戻すのも同じ口)
- POST /plans/{plan_id}/trip-intent/commit        : 日付を決めて、下書きの並びを旅程(日・予定)にする(1回の変更として元に戻せる)

規則の読み取り(/extract)は送らない。AI の読み取り(/ai/extract)は同意・クラス・枠・確認済みの鍵が揃った時だけ送る。
運転時間・宿・混み具合・営業時間の値は作らない(経路は Google の結果だけを、出典と時刻つきで示す)。
旅の個人的な理由は保存しない。監査には件数と方面の数だけを残す(文章・地名は残さない)。
"""
import json
import uuid
from urllib.parse import urlsplit
from datetime import date as date_cls
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
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
    Place, PlanCandidate, SearchCandidate, SourceRecord, TravelDay, TravelEvent, TravelPlan, TripConsultSession, User,
)
from app.services import candidates as cs
from app.services import consents
from app.services import consult_ai
from app.services import consult_turn
from app.services import cost_guard as cg
from app.services import free_usage
from app.services import membership_tiers as mt
from app.services import provider_calls as pc
from app.services import provider_secrets as ps
from app.services import provider_stub
from app.services import trip_intent as ti
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/trip-intents", tags=["trip-intents"])

# [Gate SearchUAT] Google の場所の URL として受け付ける名前(他の URL は place ID から作り直す)
GOOGLE_MAPS_HOSTS = frozenset({"maps.google.com", "www.google.com", "google.com", "goo.gl", "maps.app.goo.gl"})
plan_router = APIRouter(prefix="/plans", tags=["trip-intents"])

KEY = "trip_intent"


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _geocoder_enabled() -> bool:
    return bool((settings.TRIP_INTENT_GEOCODER or "").strip())


@router.get("/status")
def intent_status(current_user: User = Depends(get_current_user_or_guest)):
    # 規則の読み取りの口の状態(AI の読み取りは /ai/status)
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
    # [Gate AreaAI] 方面の名前 → 都道府県(AI の案。同じ名前の別の場所を避ける手がかり)
    area_prefs: Dict[str, str] = Field(default_factory=dict, max_length=ti.MAX_AREAS)


@router.get("/area-images")
async def area_images(names: List[str] = Query(..., min_length=1, max_length=10),
                      current_user: User = Depends(get_current_user_or_guest), db: Session = Depends(get_db)):
    """[Gate AreaImages] 比べる方面の代表画像(Wikipedia の記事の代表画像・無料)。出典の記事の URL つき。保存しない"""
    from app.services import area_images as ai_img

    clean = list(dict.fromkeys(n.strip() for n in names if n and n.strip()))
    if not clean or any(len(n) > 40 for n in clean):
        raise _bad("invalid_field", "方面の名前を1〜40文字で指定してください")
    images, sent = await ai_img.lookup(clean)
    if sent:
        free_usage.record(db, current_user, "wikipedia", "area.images",
                          result_code="ok" if any(images.values()) else "empty")
        db.commit()
    return {"images": images, "attribution": "Wikipedia(記事の代表画像・自由なライセンスの画像)"}


class SpotIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=40)
    kind: Optional[str] = Field(None, max_length=20)
    note: Optional[str] = Field(None, max_length=80)


class SpotsResolveIn(BaseModel):
    """[Gate AreaSpots] 名前で挙がった観光の場所(方面の提案の代表的な場所)を地図の位置・写真つきの候補にする(無料)"""
    model_config = ConfigDict(extra="forbid")
    area: str = Field(..., min_length=1, max_length=40)
    pref: Optional[str] = Field(None, max_length=4)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    spots: List[SpotIn] = Field(..., min_length=1, max_length=12)


@router.post("/spots/resolve")
async def resolve_spots(body: SpotsResolveIn, current_user: User = Depends(get_current_user_or_guest),
                        db: Session = Depends(get_db)):
    from app.api.v1 import search as search_api
    from app.services import spot_resolver

    raw = await spot_resolver.resolve([s.model_dump() for s in body.spots], body.latitude, body.longitude, body.pref)
    free_usage.record(db, current_user, "wikipedia", "spots.resolve", result_code="ok" if raw else "empty")
    rows = search_api.persist_candidates(db, current_user, raw, f"spots:{body.area}",
                                         (body.latitude, body.longitude), spot_resolver.MAX_KM)
    return {"candidates": rows, "attribution": "Wikipedia(記事の位置・代表画像・説明)"}


@router.post("/areas")
async def compare_areas(body: AreasIn, current_user: User = Depends(get_current_user_or_guest),
                        db: Session = Depends(get_db)):
    names = list(dict.fromkeys(a.strip() for a in body.areas if a.strip()))
    if not names or any(len(a) > 40 for a in names):
        raise _bad("invalid_field", "方面の名前を1〜40文字で入力してください")
    prefs = {k: v for k, v in body.area_prefs.items()
             if k in names and isinstance(v, str) and 2 <= len(v) <= 4 and v.endswith(("都", "道", "府", "県"))}
    result = await ti.compare_areas(body.origin.strip(), names, body.one_way_hours, body.one_way_strength,
                                    enabled=_geocoder_enabled(), prefs=prefs)
    # [Gate FR059-D11] 地名の照会(Nominatim)へ実際に送った回数を残す(地名は残さない)
    calls = int(result.pop("_geocode_calls", 0) or 0)
    if calls:
        failed = any(a["geocode"]["status"] == "unavailable" for a in result["areas"])
        free_usage.record(db, current_user, "nominatim", "geocode.areas", request_count=calls,
                          result_code="unavailable" if failed else "ok")
        db.commit()
    return result


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
    # [Gate ConsultAI] 予算の対象・期間・上限か目安か(旅行全体の額を宿泊費にしない)
    budget_target: Literal["lodging", "transport", "food", "trip_total", "other", "undecided"] = "undecided"
    budget_period: Literal["per_night", "all_nights", "whole_trip", "undecided"] = "undecided"
    budget_kind: Literal["cap", "guide", "undecided"] = "undecided"
    date_status: Literal["undecided", "window", "fixed"] = "undecided"
    travel_window: Optional[str] = Field(None, max_length=60)
    preferences: List[str] = Field(default_factory=list, max_length=10)
    # [Gate ConsultAI] 決まった項目に分けられない希望(その他)。利用者が確かめた分だけ下書きへ残す
    notes: List[str] = Field(default_factory=list, max_length=ti.MAX_NOTES)
    # [Gate F07] 確かめた予算の全て(宿・旅行全体など複数。上の budget_* は以前と同じ主な予算)
    budgets: List["BudgetItemIn"] = Field(default_factory=list, max_length=6)


class BudgetItemIn(BaseModel):
    """[Gate F07] 予算の1つ。額・全員の合計か1人あたりか・何人分か・対象・期間・上限か目安かを分ける"""
    model_config = ConfigDict(extra="forbid")
    min_yen: Optional[int] = Field(None, ge=0, le=10_000_000)
    max_yen: Optional[int] = Field(None, ge=0, le=10_000_000)
    unit: Literal["total", "per_person", "undecided"] = "undecided"
    people: Optional[int] = Field(None, ge=1, le=30)
    target: Literal["lodging", "transport", "food", "trip_total", "other", "undecided"] = "undecided"
    period: Literal["per_night", "all_nights", "whole_trip", "undecided"] = "undecided"
    kind: Literal["cap", "guide", "undecided"] = "undecided"


IntentIn.model_rebuild()


class AreaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=40)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    provider: Optional[Literal["nominatim"]] = None
    retrieved_at: Optional[datetime] = None


class GooglePlacePick(BaseModel):
    """[Gate SearchUAT] 旅行相談で選んだ Google の場所。Google の利用条件により、保存するのは place ID(無期限で可)と
    Google マップの URL だけ。名前・住所・位置は保存しない(下書きでは「Google の場所」とし、開いて確かめる)。"""
    model_config = ConfigDict(extra="forbid")
    place_id: str = Field(..., min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_-]+$")
    maps_uri: Optional[str] = Field(None, max_length=2000)


class DraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    area: AreaIn
    intent: IntentIn
    search_candidate_ids: List[uuid.UUID] = Field(default_factory=list, max_length=30)
    google_places: List[GooglePlacePick] = Field(default_factory=list, max_length=30)
    source_urls: List[str] = Field(default_factory=list, max_length=10)
    # [Gate ConsultAI] AI・場所の検索・経路を使った相談。使った額・回数をこの旅行の口座へ移し、相談を閉じる
    consult_session_id: Optional[uuid.UUID] = None


def _title(area: str, nights: int) -> str:
    return f"{area}・{'日帰り' if nights == 0 else f'{nights}泊{nights + 1}日'}の旅程案"[:200]


@router.post("/draft", status_code=201)
def create_draft(body: DraftIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    intent = body.intent.model_dump()
    notes = [" ".join(n.split())[:100] for n in intent.get("notes") or [] if isinstance(n, str) and n.strip()]
    intent["notes"] = list(dict.fromkeys(notes))[:ti.MAX_NOTES]
    if set(intent["preferences"]) - set(ti.PREFERENCES):
        raise _bad("invalid_field", "過ごし方の項目が正しくありません")
    lo, hi = intent["budget_min"], intent["budget_max"]
    if lo is not None and hi is not None and lo > hi:
        raise _bad("invalid_field", "宿泊費の下限が上限より大きくなっています")
    for b in intent.get("budgets") or []:
        if b["min_yen"] is None and b["max_yen"] is None:
            raise _bad("invalid_field", "予算の額を入れてください")
        if b["min_yen"] is not None and b["max_yen"] is not None and b["min_yen"] > b["max_yen"]:
            raise _bad("invalid_field", "予算の下限が上限より大きくなっています")
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
    session = None
    if body.consult_session_id is not None:
        # 本人の開いている相談だけを移す(期限切れでも使った分は移す。他の人の・閉じた相談は無視して下書きは作る)
        session = (db.query(TripConsultSession)
                   .filter(TripConsultSession.id == body.consult_session_id,
                           TripConsultSession.user_id == current_user.id,
                           TripConsultSession.plan_id.is_(None), TripConsultSession.closed_at.is_(None))
                   .with_for_update().first())
    plan = TravelPlan(user_id=current_user.id, title=_title(area_name, intent["nights"]), destination=area_name,
                      status="draft")
    db.add(plan)
    db.flush()
    moved = None
    if session is not None:
        moved = cg.adopt_consult_account(db, session.id, plan)
        if moved is None:
            db.rollback()
            raise _bad("consult_pending", "外部の提供元の応答を待っている操作があります。終わってから下書きを作ってください",
                       409)
        session.plan_id, session.closed_at = plan.id, ti.now()
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
    seen_google: set = set()
    for g in body.google_places:
        if g.place_id in seen_google:
            continue
        seen_google.add(g.place_id)
        try:
            maps = cs.canonical_url(g.maps_uri) if g.maps_uri else None
        except cs.CandidateInputError:
            maps = None
        if maps and urlsplit(maps).hostname not in GOOGLE_MAPS_HOSTS:
            maps = None
        maps = maps or f"https://www.google.com/maps/place/?q=place_id:{g.place_id}"
        if maps in urls:
            urls.remove(maps)
        rows.append(PlanCandidate(plan_id=plan.id, created_by_user_id=current_user.id,
                                  title="Google の場所(名前は Google マップで確認)", source_kind="search",
                                  source_url=maps, provider="google_places", external_id=g.place_id,
                                  retrieved_at=ti.now(), priority=2, status="open",
                                  note="旅行相談で Google の検索から選んだ場所。Google の利用条件により名前・住所・位置は保存していません"))
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
                       resource_id=plan.id, details={"candidates": len(rows), "nights": intent["nights"],
                                                     "consult_usage_moved_jpy": moved["moved_jpy"] if moved else None})
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
                         event_type=ti.event_type_of(s["part"], c.category), local_start_time=None,
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


# ===================================================================== [Gate ConsultAI] 旅行を作る前の相談で外部の提供元を使う

_SECRET_MESSAGE = {
    "secret_unverified": "管理者が鍵の有効性をまだ確かめていないため、送りません",
    "secret_verification_expired": "鍵の確認の期限が切れたため、送りません(管理者が確認し直します)",
    "secret_verification_stale": "設定が変わったため、鍵の確認をやり直すまで送りません",
    "secret_rejected": "提供元が鍵を受け付けていないため、送りません",
}
_CONSENT_MESSAGE = "AI の利用に同意していないため、相談の文章を AI へ送りません。同意するか、AI を使わずに読み取ってください"


def _ai_bad(code: str, message: str, status: int = 422, extra: Optional[Dict[str, Any]] = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message,
                                                     "fallbacks": list(cg.FALLBACKS), **(extra or {})})


def _session(db: Session, user: User, session_id: Any) -> TripConsultSession:
    try:
        sid = uuid.UUID(str(session_id))
    except (ValueError, TypeError):
        raise _ai_bad("consult_not_found", "相談が見つかりません。最初からやり直してください", 404)
    row = db.query(TripConsultSession).filter(TripConsultSession.id == sid,
                                              TripConsultSession.user_id == user.id).first()
    if row is None:
        raise _ai_bad("consult_not_found", "相談が見つかりません。最初からやり直してください", 404)
    if row.plan_id is not None or row.closed_at is not None:
        raise _ai_bad("consult_closed", "この相談からはもう旅程の下書きを作りました。新しい相談を始めてください", 409)
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=dt_timezone.utc)
    if expires <= ti.now():
        raise _ai_bad("consult_expired", "相談の期限が切れました。最初からやり直してください", 409)
    return row


def _idem(value: Optional[str]) -> str:
    key = (value or "").strip()
    if not key or len(key) > 80:
        raise _ai_bad("idempotency_key_required", "Idempotency-Key(80文字まで)が要ります")
    return key


def _send_guard(fn):
    try:
        return fn()
    except cg.CostGuardError as error:
        raise HTTPException(status_code=error.status, detail=error.detail())
    except ps.SecretUnavailable as error:
        message = _SECRET_MESSAGE.get(error.code, "外部の提供元の準備が整っていないため、送りません。手で続けられます")
        raise _ai_bad("provider_not_ready", message, 503, {"reason": error.code})
    except pc.ProviderRejected as error:
        raise _ai_bad("provider_rejected", "提供元が要求を受け付けませんでした(鍵・権限・課金)。枠は使っていません。手で続けられます",
                      503, {"reason": error.code})
    except consult_ai.ConsultAIError as error:
        raise _ai_bad(error.code, error.message, error.status)
    except consult_turn.TurnError as error:
        raise _ai_bad(error.code, error.message, error.status)


def _ai_audit(action: str, user: User, session: TripConsultSession, details: Dict[str, Any]) -> None:
    # 文章・地名・結果は残さない(件数と分類だけ)
    record_audit_event(action=action, resource_type="trip_consult", user_id=user.id, resource_id=session.id,
                       details=details)


@router.post("/ai/session", status_code=201)
def start_consult(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    row = TripConsultSession(id=uuid.uuid4(), user_id=current_user.id,
                             expires_at=ti.now() + timedelta(days=int(settings.CONSULT_SESSION_TTL_DAYS)))
    db.add(row)
    db.commit()
    return {"session_id": str(row.id), "expires_at": row.expires_at.isoformat()}


@router.get("/ai/status")
def consult_ai_status(session_id: Optional[str] = None, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    """送らずに、AI・場所の検索・経路を今使えるか(と使えない理由)を返す。鍵の値・相談の文章は返さない。"""
    body = ai_readiness(db, current_user)
    if session_id:
        try:
            s = _session(db, current_user, session_id)
            body["usage"] = cg.consult_usage(db, s.id, current_user)
        except HTTPException as error:
            body["session_error"] = (error.detail or {}).get("code") if isinstance(error.detail, dict) else None
    return body


def ai_readiness(db: Session, current_user: User) -> Dict[str, Any]:
    """[Gate AdminUAT] 旅行相談の AI・場所・経路を、この利用者が今使えるか(送らない)。運用の UAT の準備の表示と共用。"""
    klass, _src = cg.user_class(db, current_user)
    ops: Dict[str, Any] = {}
    for operation, provider in (("ai.generate", "openai"), ("places.search", "google_places"),
                                ("routes.element", "google_routes")):
        included = klass != "guest" and (not mt.is_tier(klass) or operation in mt.TIER_OPERATIONS[klass])
        reason = None
        try:
            ps.resolve_for_send(db, provider, operation)
            key_ready = True
        except ps.SecretUnavailable as error:
            key_ready, reason = False, error.code
        suspended = cg.is_suspended(provider)
        ops[operation] = {"provider": provider, "included": included, "key_ready": key_ready,
                          "suspended": suspended, "reason": reason if not key_ready else None,
                          "ready": included and key_ready and not suspended}
    body: Dict[str, Any] = {
        "class": klass, "class_label": cg.CLASS_LABEL.get(klass, klass),
        "consent": {"ai_processing": consents.has_consent(current_user, "ai_processing")},
        "operations": ops, "stub": provider_stub.enabled(), "model": pc.openai_model(),
        "max_text_chars": consult_ai.MAX_TEXT_CHARS,
    }
    return body


class AiExtractIn(ExtractIn):
    session_id: uuid.UUID


@router.post("/ai/extract")
def consult_ai_extract(body: AiExtractIn, idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    session = _session(db, current_user, body.session_id)
    key = _idem(idempotency_key)
    if not consents.has_consent(current_user, "ai_processing"):
        raise _ai_bad("consent_required", _CONSENT_MESSAGE, 403)
    if len(body.text.strip()) > consult_ai.MAX_TEXT_CHARS:
        raise _ai_bad("input_too_long", f"AI へ送る文章は {consult_ai.MAX_TEXT_CHARS} 文字までです")
    fields = body.model_dump(exclude={"text", "session_id"}, exclude_none=True)
    result, usage = _send_guard(lambda: consult_ai.extract(db, session, current_user, body.text, fields, key))
    _ai_audit("trip_consult.ai_extract", current_user, session,
              {"items_from_ai": sum(1 for i in result["items"] if i["source"] == "ai"),
               "suggested_areas": len(result["suggested_areas"]), "result": "ok"})
    return {**result, "usage": usage, "saved": False, "stub": provider_stub.enabled(),
            "notice": "AI の読み取りです(未確認)。確かめた行だけを条件に使います。営業時間・料金・混み具合は AI に作らせていません"}


class AiSpotsIn(BaseModel):
    """[Gate AreaSpots] 方面の代表的な場所のおすすめを AI に頼む(1回)。結果は Wikipedia の記事に結び付けて候補にする"""
    model_config = ConfigDict(extra="forbid")
    session_id: uuid.UUID
    area: str = Field(..., min_length=1, max_length=40)
    pref: Optional[str] = Field(None, max_length=4)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    preferences: List[str] = Field(default_factory=list, max_length=10)
    notes: List[str] = Field(default_factory=list, max_length=5)
    party_size: Optional[int] = Field(None, ge=1, le=30)
    nights: Optional[int] = Field(None, ge=0, le=14)


@router.post("/ai/spots")
async def consult_ai_spots(body: AiSpotsIn, idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                           db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    from app.api.v1 import search as search_api
    from app.services import spot_resolver

    session = _session(db, current_user, body.session_id)
    key = _idem(idempotency_key)
    if not consents.has_consent(current_user, "ai_processing"):
        raise _ai_bad("consent_required", _CONSENT_MESSAGE, 403)
    prefs = "・".join(ti.PREFERENCES[p] for p in body.preferences if p in ti.PREFERENCES)
    lines = [f"行き先(方面): {body.area}" + (f"({body.pref})" if body.pref else "")]
    if prefs:
        lines.append(f"過ごし方の希望: {prefs}")
    if body.party_size:
        lines.append(f"人数: {body.party_size}人")
    if body.nights is not None:
        lines.append("日数: " + ("日帰り" if body.nights == 0 else f"{body.nights}泊{body.nights + 1}日"))
    notes = [n.strip()[:60] for n in body.notes if n and n.strip()]
    if notes:
        lines.append("その他の希望: " + "・".join(notes))
    spots, usage = _send_guard(lambda: consult_ai.recommend_spots(db, session, current_user, "\n".join(lines), key))
    raw = await spot_resolver.resolve(spots, body.latitude, body.longitude, body.pref)
    free_usage.record(db, current_user, "wikipedia", "spots.resolve", result_code="ok" if raw else "empty")
    rows = search_api.persist_candidates(db, current_user, raw, f"ai-spots:{body.area}",
                                         (body.latitude, body.longitude), spot_resolver.MAX_KM)
    _ai_audit("trip_consult.ai_spots", current_user, session, {"suggested": len(spots), "resolved": len(rows)})
    return {"candidates": rows, "suggested": len(spots), "usage": usage, "saved": False,
            "stub": provider_stub.enabled(),
            "notice": "AI のおすすめを Wikipedia の記事に結び付けた場所です(営業時間・料金は未照会)"}


class AiTurnIn(BaseModel):
    """[Gate F07] 会話の1ターン。最新の発言と、画面が持つ今の条件の状態(値・確認の状態・ID)だけを受け取る"""
    model_config = ConfigDict(extra="forbid")
    session_id: uuid.UUID
    utterance: str = Field(..., max_length=consult_turn.MAX_UTTERANCE_CHARS * 2)
    state: Dict[str, Any] = Field(default_factory=dict)


@router.post("/ai/turn")
def consult_ai_turn(body: AiTurnIn, idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    """[Gate F07] 追加・訂正・削除・取消・矛盾を、今の条件への変更案として読む(適用しない・保存しない)。
    AI へ送るのは最新の発言と今の条件だけ(以前の発言の全文を送り直さない)。"""
    session = _session(db, current_user, body.session_id)
    key = _idem(idempotency_key)
    if not consents.has_consent(current_user, "ai_processing"):
        raise _ai_bad("consent_required", _CONSENT_MESSAGE, 403)
    if len(json.dumps(body.state, ensure_ascii=False)) > 20000:
        raise _ai_bad("invalid_input", "条件の状態が大きすぎます")
    result, usage = _send_guard(lambda: consult_turn.read_turn(db, session, current_user, body.utterance,
                                                               body.state, key))
    _ai_audit("trip_consult.ai_turn", current_user, session,
              {"changes": len(result["changes"]), "conflicts": len(result["conflicts"]),
               "dropped": result["dropped"], "result": "ok"})
    return {**result, "usage": usage, "saved": False, "stub": provider_stub.enabled(),
            "notice": "AI の読み取りの変更案です(未確認)。確かめた行は、採用するまで変えません"}


def _num(payload: Dict[str, Any], name: str, lo: float, hi: float, required: bool = True) -> Optional[float]:
    value = payload.get(name)
    if value is None and not required:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not lo <= float(value) <= hi:
        raise _ai_bad("invalid_input", f"{name} の値が正しくありません")
    return float(value)


def _coord(payload: Dict[str, Any], name: str, limit: float) -> float:
    value = _num(payload, name, -limit, limit)
    assert value is not None  # required=True
    return value


@router.post("/ai/places-search")
def consult_places(payload: Dict[str, Any] = Body(...),
                   idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                   db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    body = payload if isinstance(payload, dict) else {}
    session = _session(db, current_user, body.get("session_id"))
    query = body.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > 120:
        raise _ai_bad("invalid_input", "探す言葉を 1〜120 文字で入力してください")
    lat = _num(body, "latitude", -90, 90, required=False)
    lng = _num(body, "longitude", -180, 180, required=False)
    if (lat is None) != (lng is None):
        raise _ai_bad("invalid_input", "緯度と経度は両方を指定してください")
    # [Gate SearchUAT F04] 画面で選んだ検索範囲(Google は範囲を優先するだけで、範囲外も返り得る)
    radius_km = _num(body, "radius_km", 0.1, 50, required=False)
    key = _idem(idempotency_key)
    places, usage = _send_guard(lambda: pc.places_search(db, None, current_user, query.strip(), lat, lng, key,
                                                         consult_id=session.id,
                                                         radius_m=radius_km * 1000 if radius_km else None))
    _ai_audit("trip_consult.places_search", current_user, session, {"results": len(places)})
    return {"results": places, "usage": usage, "saved": False, "attribution": "Google",
            "retrieved_at": ti.now().isoformat(), "stub": provider_stub.enabled(),
            "notice": "Google の検索の結果です(営業時間・料金は未確認)。旅行には保存していません"}


@router.post("/ai/route")
def consult_route(payload: Dict[str, Any] = Body(...),
                  idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    body = payload if isinstance(payload, dict) else {}
    session = _session(db, current_user, body.get("session_id"))
    mode = body.get("mode") or "driving"
    if mode not in pc.ROUTE_MODES:
        raise _ai_bad("invalid_input", "移動の手段は driving・walking・bicycling・transit のどれかです")
    origin = (_coord(body, "origin_latitude", 90), _coord(body, "origin_longitude", 180))
    dest = (_coord(body, "dest_latitude", 90), _coord(body, "dest_longitude", 180))
    key = _idem(idempotency_key)
    summary, usage = _send_guard(lambda: pc.route_between(db, None, current_user, origin, dest, mode, key,
                                                          consult_id=session.id))
    _ai_audit("trip_consult.route", current_user, session, {"found": summary is not None, "mode": mode})
    return {"result": summary, "mode": mode, "usage": usage, "saved": False, "attribution": "Google",
            "retrieved_at": ti.now().isoformat(), "stub": provider_stub.enabled(),
            "notice": "Google の経路の結果です(出発の時刻・渋滞は考えていません)。旅行には保存していません"}
