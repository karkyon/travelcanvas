"""
[Gate SpotMode] FR-060 スポットモード(利用者の決定 2026-11-18。DOC-02 v6.0 FR-060、DOC-04 v6.0 SC-49/SC-50)。

旅程の中に「自由に歩くエリア」を置き、中の候補(候補箱)を当日の天気・体調・気分で選んで歩く。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET    /spot-areas                         : エリアの一覧(候補・着いた・行きたい印・その日の営業時間)。viewer 以上
- GET    /spot-areas/suggest                 : 候補箱で近くにまとまっている所(エリアの案)。editor 以上
- POST   /spot-areas                         : 作る(editor 以上)
- PUT    /spot-areas/{area_id}               : 直す(候補の並び・優先・滞在も入れ替え。着いた・行きたい印は同じ候補なら残す)。
                                               If-Match: エリアの revision
- DELETE /spot-areas/{area_id}               : 消す(If-Match。候補箱の候補は残す)
- POST   /spot-areas/{area_id}/items         : 候補を1つ足す(当日に「周りを探す」で見つけた所など。editor 以上)
- POST   /spot-areas/{area_id}/items/{item_id}/visit   : 着いた / 今日はやめる(skipped)。editor 以上(実績と同じ)
- DELETE /spot-areas/{area_id}/items/{item_id}/visit   : 取り消す
- PUT    /spot-areas/{area_id}/items/{item_id}/want    : 自分の「行きたい」印(viewer 以上。投票の回答と同じ扱い)
- DELETE /spot-areas/{area_id}/items/{item_id}/want    : 外す
- PUT    /spot-areas/{area_id}/split         : 別行動にする(自分の集合の場所・時刻・ひとこと)。viewer 以上。メンバーに知らせる
- DELETE /spot-areas/{area_id}/split         : 合流した(自分の別行動を消す)
- POST   /spot-areas/{area_id}/nearby        : 今いる場所の周りを探す(押した時だけ。場所の検索の利用枠を使う)。
                                               今いる場所は探すのに使うだけで、保存・監査に残さない

距離はすべて直線の目安(道順ではない)。監査に候補の名前・座標を残さない。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    OpeningHours, PlaceSpecialHours, PlanCandidate, SpotArea, SpotAreaItem, SpotAreaSplit, TravelDay, TravelPlan,
    User,
)
from app.services import notify, place_hours
from app.services import spot_areas as sa
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["spot-areas"])

NEARBY_KINDS: Dict[str, tuple] = {
    # kind: (探す言葉, place_finder のジャンル)
    "all": ("", "all"), "toilet": ("トイレ", "all"), "rest": ("休憩所", "all"), "cafe": ("", "cafe"),
    "sweets": ("", "sweets"), "food": ("食べ歩き", "meal"), "souvenir": ("", "souvenir"), "sight": ("", "sightseeing"),
    "locker": ("コインロッカー", "all"),
}


def _bad(code: str, message: str, status: int = 422) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _uuid(value: str, label: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise _bad("invalid_id", "%s が正しくありません" % label)


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _audit(action: str, request: Request, user: User, area_id: Any, plan_id: Any, extra: Optional[Dict] = None) -> None:
    record_audit_event(action=action, resource_type="spot_area", user_id=user.id, resource_id=area_id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255],
                       details={"plan_id": str(plan_id), **(extra or {})})


class ItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_id: str
    genre: Optional[Literal["food", "cafe", "gift", "sight", "rest", "other"]] = None
    priority: Literal["want", "maybe"] = "maybe"
    stay_minutes: int = Field(20, ge=5, le=240)


class AreaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., min_length=1, max_length=100)
    day_id: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    meet_label: Optional[str] = Field(None, max_length=100)
    meet_time: Optional[str] = None
    meet_latitude: Optional[float] = Field(None, ge=-90, le=90)
    meet_longitude: Optional[float] = Field(None, ge=-180, le=180)
    radius_m: Optional[int] = Field(None, ge=100, le=3000)
    suggest_on_approach: bool = True
    items: List[ItemIn] = Field(default_factory=list, max_length=sa.MAX_ITEMS)

    @field_validator("title", "meet_label")
    @classmethod
    def _strip(cls, v):
        if v is None:
            return v
        v = " ".join(v.split())
        return v or None

    @field_validator("start_time", "end_time", "meet_time")
    @classmethod
    def _time(cls, v):
        if v in (None, ""):
            return None
        if not sa.TIME_RE.match(v):
            raise ValueError("時刻は HH:MM で書いてください")
        return v


class VisitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skipped: bool = False


class SplitIn(BaseModel):
    """[Gate SpotMode-2] 別行動の約束。今いる場所は送らない。"""
    model_config = ConfigDict(extra="forbid")
    meet_label: Optional[str] = Field(None, max_length=100)
    meet_time: Optional[str] = None
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("meet_label", "note")
    @classmethod
    def _strip(cls, v):
        if v is None:
            return v
        v = " ".join(v.split())
        return v or None

    @field_validator("meet_time")
    @classmethod
    def _time(cls, v):
        if v in (None, ""):
            return None
        if not sa.TIME_RE.match(v):
            raise ValueError("時刻は HH:MM で書いてください")
        return v


class NearbyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    radius_m: int = Field(500, ge=100, le=3000)
    within_area: bool = False
    kind: Literal["all", "toilet", "rest", "cafe", "sweets", "food", "souvenir", "sight", "locker"] = "all"
    query: Optional[str] = Field(None, max_length=60)


# ---- 読み出し -------------------------------------------------------------------------------------------------

def _names(db: Session, ids) -> Dict[str, str]:
    keys = {uuid.UUID(str(i)) for i in ids if i}
    if not keys:
        return {}
    return {str(u.id): (u.username or "ゲスト") for u in db.query(User).filter(User.id.in_(keys)).all()}


def _hours(db: Session, cands: List[PlanCandidate], local_date) -> Dict[Any, Dict[str, Any]]:
    if local_date is None:
        return {}
    pids = {c.place_id for c in cands if c.place_id}
    if not pids:
        return {}
    weekly: Dict[Any, list] = {}
    for h in db.query(OpeningHours).filter(OpeningHours.place_id.in_(pids)).all():
        weekly.setdefault(h.place_id, []).append(h)
    special: Dict[Any, list] = {}
    for h in db.query(PlaceSpecialHours).filter(PlaceSpecialHours.place_id.in_(pids),
                                                PlaceSpecialHours.local_date == local_date).all():
        special.setdefault(h.place_id, []).append(h)
    out = {}
    for pid in pids:
        if pid in weekly or pid in special:
            out[pid] = place_hours.to_json(place_hours.day_hours(local_date, weekly.get(pid, []), special.get(pid, [])))
    return out


def _area_json(db: Session, area: SpotArea, me: User, role: str, days: Dict[Any, TravelDay]) -> Dict[str, Any]:
    from app.services import weather_fit as wf
    items = sorted(area.items, key=lambda i: (i.sort_order, str(i.id)))
    day = days.get(area.day_id) if area.day_id else None
    hours = _hours(db, [i.candidate for i in items], day.local_date if day else None)
    splits = sorted(area.splits, key=lambda s: (s.meet_time, str(s.id)))
    names = _names(db, [i.visited_by_user_id for i in items] + [u for i in items for u in (i.wanted_by or [])]
                   + [s.user_id for s in splits])
    pts = [(float(i.candidate.latitude), float(i.candidate.longitude)) for i in items
           if i.candidate.latitude is not None and i.candidate.longitude is not None]
    center = sa.center_of(pts)
    out_items = []
    for i in items:
        c = i.candidate
        wanted = [str(u) for u in (i.wanted_by or [])]
        out_items.append({
            "id": str(i.id), "candidate_id": str(c.id), "title": c.title, "note": c.note, "category": c.category,
            "address": c.address, "latitude": c.latitude, "longitude": c.longitude,
            "place_id": str(c.place_id) if c.place_id else None,
            "genre": i.genre, "genre_label": sa.GENRES.get(i.genre, "そのほか"), "priority": i.priority,
            "stay_minutes": i.stay_minutes, "sort_order": i.sort_order,
            "visited_at": _iso(i.visited_at),
            "visited_by": names.get(str(i.visited_by_user_id)) if i.visited_by_user_id else None,
            "skipped": bool(i.skipped),
            "wanted_by": [names.get(u, "(退会した利用者)") for u in wanted], "wanted_by_me": str(me.id) in wanted,
            "fit": wf.fit(c.title, None, c.note, c.category)["fit"], "seats": sa.seats(c.title, c.category, i.genre),
            "hours_today": hours.get(c.place_id) if c.place_id else None,
        })
    return {
        "id": str(area.id), "title": area.title, "day_id": str(area.day_id) if area.day_id else None,
        "local_date": day.local_date.isoformat() if day else None, "timezone_id": day.timezone_id if day else None,
        "start_time": area.start_time, "end_time": area.end_time,
        "meet_label": area.meet_label, "meet_time": area.meet_time,
        "meet_latitude": area.meet_latitude, "meet_longitude": area.meet_longitude,
        "center_latitude": round(center[0], 6) if center else None,
        "center_longitude": round(center[1], 6) if center else None,
        "radius_m": area.radius_m, "suggest_on_approach": area.suggest_on_approach, "revision": area.revision,
        "items": out_items, "can_edit": role in ("owner", "editor"),
        "splits": [{"name": names.get(str(s.user_id), "(退会した利用者)"), "is_me": s.user_id == me.id,
                    "meet_label": s.meet_label, "meet_time": s.meet_time, "note": s.note,
                    "since": _iso(s.updated_at or s.created_at)} for s in splits],
    }


def _days(db: Session, plan: TravelPlan) -> Dict[Any, TravelDay]:
    return {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}


def _get_area(db: Session, plan: TravelPlan, area_id: str, lock: bool = False) -> SpotArea:
    q = db.query(SpotArea).filter(SpotArea.id == _uuid(area_id, "area_id"), SpotArea.plan_id == plan.id)
    if lock:
        q = q.with_for_update()
    area = q.first()
    if area is None:
        raise HTTPException(status_code=404, detail="エリアが見つかりません")
    return area


def _get_item(db: Session, area: SpotArea, item_id: str, lock: bool = True) -> SpotAreaItem:
    q = db.query(SpotAreaItem).filter(SpotAreaItem.id == _uuid(item_id, "item_id"), SpotAreaItem.area_id == area.id)
    if lock:
        q = q.with_for_update()
    item = q.first()
    if item is None:
        raise HTTPException(status_code=404, detail="エリアの候補が見つかりません")
    return item


def _if_match(value: Optional[str], current: int) -> None:
    if value is None or not value.strip():
        raise HTTPException(status_code=428, detail={"code": "if_match_required", "message": "If-Match が必要です"})
    if value.strip().strip('"') != str(current):
        raise HTTPException(status_code=409, detail={"code": "revision_conflict",
                                                     "message": "ほかの人が先に直しました。読み直してください",
                                                     "current_revision": current})


@router.get("/{plan_id}/spot-areas")
def list_areas(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    days = _days(db, plan)
    areas = db.query(SpotArea).filter(SpotArea.plan_id == plan.id).order_by(SpotArea.created_at, SpotArea.id).all()

    def key(a: SpotArea):
        d = days.get(a.day_id)
        made = a.created_at.isoformat() if a.created_at else ""
        return (d.local_date.isoformat() if d else "9999", a.start_time or "99:99", made)
    areas.sort(key=key)
    return {"areas": [_area_json(db, a, current_user, role, days) for a in areas],
            "can_edit": role in ("owner", "editor"), "genres": sa.GENRES}


@router.get("/{plan_id}/spot-areas/suggest")
def suggest_areas(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    cands = db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id).all()
    used = {i.candidate_id for i in db.query(SpotAreaItem).join(SpotArea, SpotArea.id == SpotAreaItem.area_id)
            .filter(SpotArea.plan_id == plan.id).all()}
    return {"suggestions": sa.suggest_clusters(cands, used), "within_m": sa.CLUSTER_M}


# ---- 作る・直す・消す -----------------------------------------------------------------------------------------

def _apply(db: Session, plan: TravelPlan, area: SpotArea, body: AreaIn) -> None:
    if body.start_time and body.end_time and body.end_time <= body.start_time:
        raise _bad("invalid_time_range", "終わりは始まりより後にしてください")
    if (body.meet_latitude is None) != (body.meet_longitude is None):
        raise _bad("invalid_meet_point", "集合の場所の緯度と経度は両方を入れてください")
    day_id = None
    if body.day_id:
        day_id = _uuid(body.day_id, "day_id")
        if db.query(TravelDay.id).filter(TravelDay.id == day_id, TravelDay.plan_id == plan.id).first() is None:
            raise _bad("day_not_found", "その日はこの旅行にありません")
    ids = [_uuid(i.candidate_id, "candidate_id") for i in body.items]
    if len(set(ids)) != len(ids):
        raise _bad("duplicate_candidate", "同じ候補が2回あります")
    rows = db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id,
                                          PlanCandidate.id.in_(ids)).all() if ids else []
    cands = {c.id: c for c in rows}
    for cid in ids:
        c = cands.get(cid)
        if c is None:
            raise _bad("candidate_not_found", "候補がこの旅行の候補箱にありません")
        if c.status == "dismissed" or c.merged_into_id:
            raise _bad("candidate_unavailable", "見送った候補・まとめた候補はエリアに入れられません")
    area.title = body.title
    area.day_id = day_id
    area.start_time, area.end_time = body.start_time, body.end_time
    area.meet_label, area.meet_time = body.meet_label, body.meet_time
    area.meet_latitude, area.meet_longitude = body.meet_latitude, body.meet_longitude
    area.suggest_on_approach = body.suggest_on_approach
    old = {i.candidate_id: i for i in area.items}
    keep: List[SpotAreaItem] = []
    for n, (cid, it) in enumerate(zip(ids, body.items)):
        c = cands[cid]
        row = old.pop(cid, None) or SpotAreaItem(id=uuid.uuid4(), area_id=area.id, candidate_id=cid, wanted_by=[])
        row.candidate = c
        row.genre = it.genre or sa.guess_genre(c.title, c.category, c.note)
        row.priority, row.stay_minutes, row.sort_order = it.priority, it.stay_minutes, n
        keep.append(row)
    for gone in old.values():
        area.items.remove(gone)
    for row in keep:
        if row not in area.items:
            area.items.append(row)
    pts = [(float(c.latitude), float(c.longitude)) for c in cands.values()
           if c.latitude is not None and c.longitude is not None]
    if body.radius_m is not None:
        area.radius_m = body.radius_m
    elif pts:
        center = sa.center_of(pts)
        assert center is not None
        area.radius_m = sa.radius_for(center, pts)


def _respond(db: Session, plan: TravelPlan, area: SpotArea, user: User, role: str) -> Dict[str, Any]:
    db.refresh(area)
    return _area_json(db, area, user, role, _days(db, plan))


@router.post("/{plan_id}/spot-areas", status_code=201)
def create_area(plan_id: str, body: AreaIn, request: Request, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if db.query(SpotArea).filter(SpotArea.plan_id == plan.id).count() >= 30:
        raise _bad("too_many_areas", "エリアは1つの旅行に30までです")
    area = SpotArea(id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, title=body.title, revision=1)
    db.add(area)
    _apply(db, plan, area, body)
    db.commit()
    _audit("spot_area_created", request, current_user, area.id, plan.id, {"items": len(body.items)})
    return _respond(db, plan, area, current_user, role)


@router.put("/{plan_id}/spot-areas/{area_id}")
def update_area(plan_id: str, area_id: str, body: AreaIn, request: Request,
                if_match: Optional[str] = Header(None, alias="If-Match"), db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    area = _get_area(db, plan, area_id, lock=True)
    _if_match(if_match, area.revision)
    _apply(db, plan, area, body)
    area.revision += 1
    db.commit()
    _audit("spot_area_updated", request, current_user, area.id, plan.id, {"items": len(body.items)})
    return _respond(db, plan, area, current_user, role)


@router.delete("/{plan_id}/spot-areas/{area_id}", status_code=204)
def delete_area(plan_id: str, area_id: str, request: Request, if_match: Optional[str] = Header(None, alias="If-Match"),
                db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    area = _get_area(db, plan, area_id, lock=True)
    _if_match(if_match, area.revision)
    db.delete(area)
    db.commit()
    _audit("spot_area_deleted", request, current_user, area_id, plan.id)
    return Response(status_code=204)


@router.post("/{plan_id}/spot-areas/{area_id}/items", status_code=201)
def add_item(plan_id: str, area_id: str, body: ItemIn, request: Request, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    area = _get_area(db, plan, area_id, lock=True)
    if len(area.items) >= sa.MAX_ITEMS:
        raise _bad("too_many_items", "エリアの候補は%dまでです" % sa.MAX_ITEMS)
    cid = _uuid(body.candidate_id, "candidate_id")
    c = db.query(PlanCandidate).filter(PlanCandidate.id == cid, PlanCandidate.plan_id == plan.id).first()
    if c is None:
        raise _bad("candidate_not_found", "候補がこの旅行の候補箱にありません")
    if c.status == "dismissed" or c.merged_into_id:
        raise _bad("candidate_unavailable", "見送った候補・まとめた候補はエリアに入れられません")
    if any(i.candidate_id == cid for i in area.items):
        raise _bad("duplicate_candidate", "その候補はもうエリアにあります", 409)
    area.items.append(SpotAreaItem(id=uuid.uuid4(), area_id=area.id, candidate_id=cid, candidate=c, wanted_by=[],
                                   genre=body.genre or sa.guess_genre(c.title, c.category, c.note),
                                   priority=body.priority, stay_minutes=body.stay_minutes,
                                   sort_order=max([i.sort_order for i in area.items], default=-1) + 1))
    area.revision += 1
    db.commit()
    _audit("spot_area_item_added", request, current_user, area.id, plan.id)
    return _respond(db, plan, area, current_user, role)


# ---- 当日の操作(着いた・今日はやめる・行きたい印) ---------------------------------------------------------------

@router.post("/{plan_id}/spot-areas/{area_id}/items/{item_id}/visit")
def visit_item(plan_id: str, area_id: str, item_id: str, body: VisitIn, request: Request,
               db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    area = _get_area(db, plan, area_id)
    item = _get_item(db, area, item_id)
    if body.skipped:
        item.skipped, item.visited_at, item.visited_by_user_id = True, None, None
    else:
        item.skipped = False
        if item.visited_at is None:  # 2 回押しても最初の時刻のまま
            item.visited_at, item.visited_by_user_id = _now(), current_user.id
    db.commit()
    _audit("spot_area_visit", request, current_user, area.id, plan.id, {"skipped": body.skipped})
    return _respond(db, plan, area, current_user, role)


@router.delete("/{plan_id}/spot-areas/{area_id}/items/{item_id}/visit")
def unvisit_item(plan_id: str, area_id: str, item_id: str, request: Request, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    area = _get_area(db, plan, area_id)
    item = _get_item(db, area, item_id)
    item.visited_at, item.visited_by_user_id, item.skipped = None, None, False
    db.commit()
    _audit("spot_area_visit_cleared", request, current_user, area.id, plan.id)
    return _respond(db, plan, area, current_user, role)


def _want(plan_id: str, area_id: str, item_id: str, on: bool, db: Session, user: User):
    plan, role = require_plan_access(db, plan_id, user, min_role="viewer")
    area = _get_area(db, plan, area_id)
    item = _get_item(db, area, item_id)
    me = str(user.id)
    current = [str(u) for u in (item.wanted_by or [])]
    item.wanted_by = sorted(set(current) | {me}) if on else [u for u in current if u != me]
    db.commit()
    return _respond(db, plan, area, user, role)


@router.put("/{plan_id}/spot-areas/{area_id}/items/{item_id}/want")
def want_item(plan_id: str, area_id: str, item_id: str, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)):
    return _want(plan_id, area_id, item_id, True, db, current_user)


@router.delete("/{plan_id}/spot-areas/{area_id}/items/{item_id}/want")
def unwant_item(plan_id: str, area_id: str, item_id: str, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user_or_guest)):
    return _want(plan_id, area_id, item_id, False, db, current_user)


# ---- 別行動(集合の約束の共有) ------------------------------------------------------------------------------------

@router.put("/{plan_id}/spot-areas/{area_id}/split")
def split_off(plan_id: str, area_id: str, body: SplitIn, request: Request, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)):
    """[Gate SpotMode-2] 別行動にする。集合の場所・時刻を省くとエリアの集合を使う。メンバーに知らせる(位置は送らない)。"""
    from app.services.constraint_evaluation import member_user_ids

    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    area = _get_area(db, plan, area_id, lock=True)
    meet_time = body.meet_time or area.meet_time or area.end_time
    if not meet_time:
        raise _bad("meet_time_required", "集合の時刻を入れてください(エリアに集合の時刻がありません)")
    meet_label = body.meet_label or area.meet_label
    row = db.query(SpotAreaSplit).filter(SpotAreaSplit.area_id == area.id,
                                         SpotAreaSplit.user_id == current_user.id).first()
    first = row is None
    if row is None:
        row = SpotAreaSplit(id=uuid.uuid4(), area_id=area.id, user_id=current_user.id, meet_time=meet_time)
        db.add(row)
    row.meet_label, row.meet_time, row.note = meet_label, meet_time, body.note
    who = current_user.username or "ゲスト"
    where = f"{meet_label}で" if meet_label else ""
    notify.deliver(db, plan, member_user_ids(db, plan) - {current_user.id}, "spot_split",
                   f"「{area.title}」で別行動", f"{who}さんが別行動にしました。{meet_time}に{where}合流します。"
                   if first else f"{who}さんの集合が {meet_time}{('・' + meet_label) if meet_label else ''} に変わりました。",
                   target_type="plan", target_id=None)
    db.commit()
    _audit("spot_area_split", request, current_user, area.id, plan.id, {"first": first})
    return _respond(db, plan, area, current_user, role)


@router.delete("/{plan_id}/spot-areas/{area_id}/split")
def rejoin(plan_id: str, area_id: str, request: Request, db: Session = Depends(get_db),
           current_user: User = Depends(get_current_user_or_guest)):
    """[Gate SpotMode-2] 合流した(自分の別行動を消す)。無くても 200(押し直しても困らない)。"""
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    area = _get_area(db, plan, area_id, lock=True)
    db.query(SpotAreaSplit).filter(SpotAreaSplit.area_id == area.id,
                                   SpotAreaSplit.user_id == current_user.id).delete(synchronize_session=False)
    db.commit()
    _audit("spot_area_rejoin", request, current_user, area.id, plan.id)
    db.expire(area)
    return _respond(db, plan, area, current_user, role)


# ---- 周りを探す ---------------------------------------------------------------------------------------------------

@router.post("/{plan_id}/spot-areas/{area_id}/nearby")
async def nearby(plan_id: str, area_id: str, body: NearbyIn, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    from app.api.v1.spot_intake import _limit, _recorder
    from app.services import place_finder as pf
    from app.services import weather_fit as wf

    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    area = _get_area(db, plan, area_id)
    _limit(current_user, "spot-nearby")
    word, genre = NEARBY_KINDS[body.kind]
    text = " ".join(x for x in ((body.query or "").strip(), word) if x)
    me = (body.latitude, body.longitude)
    pts = [(float(i.candidate.latitude), float(i.candidate.longitude)) for i in area.items
           if i.candidate.latitude is not None and i.candidate.longitude is not None]
    center = sa.center_of(pts)
    record = _recorder(db, current_user, "spot.nearby")
    res = await pf.find(db, plan, text, genre, "area", record, points=[me])
    db.commit()
    have = {i.candidate.title for i in area.items}
    rows: List[Dict[str, Any]] = []
    for c in res.get("candidates", []):
        name, lat, lng = c.get("name") or "", c.get("latitude"), c.get("longitude")
        if not name or lat is None or lng is None:
            continue
        d = sa.distance_m(me, (float(lat), float(lng)))
        if d > body.radius_m:
            continue
        if body.within_area and center is not None and sa.distance_m(center, (float(lat), float(lng))) > area.radius_m:
            continue
        genre_guess = sa.guess_genre(name, c.get("category"), c.get("genre_label"))
        rows.append({"name": name, "address": c.get("address"), "latitude": lat, "longitude": lng,
                     "distance_m": int(round(d)), "walk_minutes": max(1, int(-(-d // 80))),
                     "genre": genre_guess, "genre_label": sa.GENRES[genre_guess], "category": c.get("category"),
                     "fit": wf.fit(name, c.get("category"), None, c.get("genre"))["fit"],
                     "provider": (c.get("providers") or [c.get("provider")])[0], "url": c.get("url"),
                     "in_area": name in have})
    rows.sort(key=lambda r: r["distance_m"])
    return {"kind": body.kind, "results": rows[:20], "sources": res.get("sources", []),
            "failed_providers": res.get("failed_providers", []),
            "message": None if rows else "この範囲には見つかりませんでした。範囲を広げてみてください"}
