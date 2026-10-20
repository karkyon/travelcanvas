"""
[Gate C2] FR-007 候補箱(DOC-02 FR-007・FC-019/023、DOC-04 SC-08、DOC-14 §7.1/7.2)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET    /candidates                       : 候補の一覧(viewer以上)。出典・登録した人・優先度・状態・重複の候補(理由つき)
- POST   /candidates                       : 候補を足す(editor以上)。URL・テキスト・手入力。URL は正規化して出典として残す
                                             (サーバーから取りに行かない)
- POST   /candidates/from-search           : 本人の検索結果(search_candidates)から足す(提供元・取得時刻を引き継ぐ)
- PATCH  /candidates/{id}                  : 名前・メモ・優先度・場所・見送る/戻す(If-Match: 候補の revision)
- DELETE /candidates/{id}                  : 消す(editor以上)
- POST   /candidates/{id}/schedule         : 旅程に追加する(日・時刻)。場所(places)を作り(無ければ)、予定を作る。
                                             変更セット source=candidate で「元に戻す」可能。候補は消さない
- POST   /candidates/{id}/merge            : 重複の候補を別の候補へまとめる(まとめた側は見送りになり、出典は一覧に残る)

予定が消えた候補は「候補」に戻る(DOC-14 §3.1「予定から外した場合は削除ではなく既定では候補へ戻す」。読む時に判定する)。
監査に候補の名前・URL を残さない。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    FieldSource, Place, PlanCandidate, SearchCandidate, SourceRecord, TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import candidates as cs
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["candidates"])

MAX_CANDIDATES_PER_PLAN = 1000
STATUS_LABEL = {"open": "候補", "scheduled": "予定に配置済み", "dismissed": "見送り"}


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _audit(action: str, user: User, plan: TravelPlan, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="plan_candidate", user_id=user.id, resource_id=plan.id,
                       details={"plan_id": str(plan.id), **details})


def _guard(fn):
    try:
        return fn()
    except cs.CandidateInputError as e:
        raise _bad(e.code, str(e))


def _effective_status(c: PlanCandidate, event_ids: set) -> str:
    if c.status == "scheduled" and c.scheduled_event_id not in event_ids:
        return "open"  # 予定が消えた → 候補に戻る
    return c.status


def _names(db: Session, ids) -> Dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (u.username or "(名前なし)") for u in db.query(User).filter(User.id.in_(ids)).all()}


def _to_dict(c: PlanCandidate, event_ids: set, names: Dict[uuid.UUID, str], dupes: List[Dict[str, Any]],
             merged_from: List[Dict[str, Any]]) -> Dict[str, Any]:
    status = _effective_status(c, event_ids)
    return {
        "id": str(c.id), "title": c.title, "note": c.note, "source_kind": c.source_kind,
        "source_url": c.source_url, "source_label": cs.url_label(c.source_url), "provider": c.provider,
        "retrieved_at": _iso(c.retrieved_at), "place_id": str(c.place_id) if c.place_id else None,
        "category": c.category, "address": c.address, "latitude": c.latitude, "longitude": c.longitude,
        "priority": c.priority, "status": status, "status_label": STATUS_LABEL[status],
        "scheduled_event_id": str(c.scheduled_event_id) if status == "scheduled" else None,
        "merged_into_id": str(c.merged_into_id) if c.merged_into_id else None,
        "created_by": names.get(c.created_by_user_id, "(退会した利用者)"),
        "created_at": _iso(c.created_at), "revision": c.revision,
        "duplicates": dupes, "merged_from": merged_from,
    }


def _list(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    rows = db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id).order_by(
        PlanCandidate.priority, PlanCandidate.created_at).all()
    event_ids = {r[0] for r in db.query(TravelEvent.id).filter(TravelEvent.plan_id == plan.id).all()}
    names = _names(db, [r.created_by_user_id for r in rows])
    plain = [{"id": str(r.id), "title": r.title, "provider": r.provider, "external_id": r.external_id,
              "latitude": r.latitude, "longitude": r.longitude, "address": r.address, "source_url": r.source_url,
              "status": _effective_status(r, event_ids), "merged_into_id": r.merged_into_id} for r in rows]
    dupes = cs.find_duplicates(plain)
    merged: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        if r.merged_into_id:
            merged.setdefault(str(r.merged_into_id), []).append(
                {"id": str(r.id), "title": r.title, "source_url": r.source_url, "provider": r.provider})
    items = [_to_dict(r, event_ids, names, dupes.get(str(r.id), []), merged.get(str(r.id), [])) for r in rows]
    counts = {k: sum(1 for i in items if i["status"] == k) for k in STATUS_LABEL}
    return {"plan_id": str(plan.id), "items": items, "counts": counts,
            "duplicate_pairs": sum(len(v) for v in dupes.values()) // 2}


def _get(db: Session, plan: TravelPlan, cid: str) -> PlanCandidate:
    try:
        u = uuid.UUID(str(cid))
    except ValueError:
        raise HTTPException(status_code=404, detail="候補が見つかりません")
    c = db.query(PlanCandidate).filter(PlanCandidate.id == u, PlanCandidate.plan_id == plan.id).first()
    if not c:
        raise HTTPException(status_code=404, detail="候補が見つかりません")
    return c


def _require_rev(c: PlanCandidate, if_match: Optional[str]) -> None:
    if if_match is None or not if_match.strip():
        raise HTTPException(status_code=400, detail="If-Matchヘッダーが必要です(候補のrevision)")
    try:
        expected = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != c.revision:
        raise _bad("revision_conflict", f"候補が他の人の変更で更新されています(現在のrevision: {c.revision})", 409)


def _limit(db: Session, plan: TravelPlan) -> None:
    if db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id).count() >= MAX_CANDIDATES_PER_PLAN:
        raise _bad("too_many", f"1つの旅行の候補は{MAX_CANDIDATES_PER_PLAN}件までです", 409)


class CandidateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(None, max_length=400)
    note: Optional[str] = Field(None, max_length=4000)
    source_url: Optional[str] = Field(None, max_length=4000)
    category: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=1000)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    priority: int = Field(2, ge=1, le=3)


@router.get("/{plan_id}/candidates")
def list_candidates(plan_id: str, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return {**_list(db, plan), "can_edit": role in ("owner", "editor")}


@router.post("/{plan_id}/candidates", status_code=201)
def create_candidate(plan_id: str, body: CandidateInput, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _limit(db, plan)
    url = _guard(lambda: cs.canonical_url(body.source_url))
    title = _guard(lambda: cs.clean_text(body.title, 200, "名前"))
    if not title:
        if not url:
            raise _bad("invalid_field", "名前か URL を入力してください")
        title = cs.url_label(url) or url[:200]
    note = _guard(lambda: cs.clean_text(body.note, 2000, "メモ"))
    lat, lng = _guard(lambda: cs.check_location(body.latitude, body.longitude))
    kind = "url" if url else ("text" if note else "manual")
    c = PlanCandidate(plan_id=plan.id, created_by_user_id=current_user.id, title=title, note=note, source_kind=kind,
                      source_url=url, category=_guard(lambda: cs.clean_text(body.category, 50, "種類")),
                      address=_guard(lambda: cs.clean_text(body.address, 500, "住所")), latitude=lat, longitude=lng,
                      priority=body.priority, status="open")
    db.add(c)
    db.commit()
    _audit("candidate.create", current_user, plan, {"source_kind": kind})
    return {"id": str(c.id), **_list(db, plan)}


class FromSearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    search_candidate_id: uuid.UUID
    priority: int = Field(2, ge=1, le=3)


@router.post("/{plan_id}/candidates/from-search", status_code=201)
def create_from_search(plan_id: str, body: FromSearchInput, db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    _limit(db, plan)
    sc = db.query(SearchCandidate).filter(SearchCandidate.id == body.search_candidate_id,
                                          SearchCandidate.searched_by_user_id == current_user.id).first()
    if not sc:
        # 他の人の検索結果は存在を区別せず 404
        raise HTTPException(status_code=404, detail="検索結果が見つかりません")
    src = db.query(SourceRecord).filter(SourceRecord.candidate_id == sc.id).order_by(
        SourceRecord.created_at.desc()).first()
    url = None
    if src and src.source_url:
        try:
            url = cs.canonical_url(src.source_url)
        except cs.CandidateInputError:
            url = None
    c = PlanCandidate(plan_id=plan.id, created_by_user_id=current_user.id, title=(sc.name or "(名前なし)")[:200],
                      source_kind="search", source_url=url, provider=sc.provider, external_id=sc.external_id,
                      retrieved_at=sc.retrieved_at, category=sc.category, address=sc.address,
                      latitude=sc.latitude, longitude=sc.longitude, priority=body.priority, status="open")
    db.add(c)
    db.commit()
    _audit("candidate.create", current_user, plan, {"source_kind": "search", "provider": sc.provider})
    return {"id": str(c.id), **_list(db, plan)}


class CandidatePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(None, max_length=400)
    note: Optional[str] = Field(None, max_length=4000)
    priority: Optional[int] = Field(None, ge=1, le=3)
    status: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=1000)
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@router.patch("/{plan_id}/candidates/{candidate_id}")
def update_candidate(plan_id: str, candidate_id: str, body: CandidatePatch, db: Session = Depends(get_db),
                     if_match: Optional[str] = Header(None, alias="If-Match"),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    c = _get(db, plan, candidate_id)
    _require_rev(c, if_match)
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields:
        c.title = _guard(lambda: cs.clean_text(body.title, 200, "名前", required=True))
    if "note" in fields:
        c.note = _guard(lambda: cs.clean_text(body.note, 2000, "メモ"))
    if "category" in fields:
        c.category = _guard(lambda: cs.clean_text(body.category, 50, "種類"))
    if "address" in fields:
        c.address = _guard(lambda: cs.clean_text(body.address, 500, "住所"))
    if "latitude" in fields or "longitude" in fields:
        c.latitude, c.longitude = _guard(lambda: cs.check_location(body.latitude, body.longitude))
    if body.priority is not None:
        c.priority = body.priority
    if "status" in fields:
        event_ids = {r[0] for r in db.query(TravelEvent.id).filter(TravelEvent.plan_id == plan.id).all()}
        current = _effective_status(c, event_ids)
        if body.status not in ("open", "dismissed"):
            raise _bad("invalid_field", "状態は「候補」か「見送り」です(予定への配置は旅程に追加で行います)")
        if current == "scheduled":
            raise _bad("scheduled", "予定に配置済みの候補は、予定を消すと候補に戻ります", 409)
        c.status, c.scheduled_event_id = body.status, None
        if body.status == "open":
            c.merged_into_id = None
    c.revision += 1
    db.commit()
    _audit("candidate.update", current_user, plan, {"fields": sorted(fields)})
    return _list(db, plan)


@router.delete("/{plan_id}/candidates/{candidate_id}", status_code=204)
def delete_candidate(plan_id: str, candidate_id: str, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    c = _get(db, plan, candidate_id)
    db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id, PlanCandidate.merged_into_id == c.id).update(
        {PlanCandidate.merged_into_id: None, PlanCandidate.status: "open"}, synchronize_session=False)
    db.delete(c)
    db.commit()
    _audit("candidate.delete", current_user, plan, {})
    return Response(status_code=204)


class ScheduleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day_id: uuid.UUID
    local_start_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    event_type: str = Field("sightseeing", max_length=30)


def _place_from_candidate(db: Session, c: PlanCandidate, user: User) -> Place:
    place = Place(name=c.title, category=c.category, latitude=c.latitude, longitude=c.longitude, address=c.address,
                  created_by=user.id)
    db.add(place)
    db.flush()
    src = SourceRecord(place_id=place.id, provider=c.provider or ("url" if c.source_url else "user"),
                       source_url=c.source_url, retrieved_at=c.retrieved_at or c.created_at or _now(),
                       freshness_state="fresh")
    db.add(src)
    db.flush()
    for name, value in (("name", c.title), ("category", c.category), ("latitude", c.latitude),
                        ("longitude", c.longitude), ("address", c.address)):
        if value is not None:
            db.add(FieldSource(place_id=place.id, field_name=name, value=str(value), source_record_id=src.id))
    return place


@router.post("/{plan_id}/candidates/{candidate_id}/schedule", status_code=201)
def schedule_candidate(plan_id: str, candidate_id: str, body: ScheduleInput, db: Session = Depends(get_db),
                       if_match: Optional[str] = Header(None, alias="If-Match"),
                       current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    c = _get(db, plan, candidate_id)
    _require_rev(c, if_match)
    event_ids = {r[0] for r in db.query(TravelEvent.id).filter(TravelEvent.plan_id == plan.id).all()}
    if _effective_status(c, event_ids) == "scheduled":
        raise _bad("already_scheduled", "この候補はもう予定に配置しています", 409)
    day = db.query(TravelDay).filter(TravelDay.id == body.day_id, TravelDay.plan_id == plan.id).first()
    if not day:
        raise _bad("day_not_found", "追加する日が見つかりません")
    place = None
    if c.place_id:
        place = db.query(Place).filter(Place.id == c.place_id).first()
    if place is None:
        place = _place_from_candidate(db, c, current_user)
        c.place_id = place.id
    max_sort = db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count()
    ev = TravelEvent(plan_id=plan.id, day_id=day.id, place_id=place.id, title=c.title, description=c.note,
                     event_type=body.event_type, local_start_time=body.local_start_time, address=c.address,
                     latitude=c.latitude, longitude=c.longitude, sort_order=max_sort)
    db.add(ev)
    db.flush()
    revision = plans_api._record_change_and_bump_revision(
        db, plan, current_user, "candidate", "travel_event", ev.id, "create",
        before_json=None, after_json=plans_api._event_to_dict(ev),
    )
    c.status, c.scheduled_event_id, c.merged_into_id = "scheduled", ev.id, None
    c.revision += 1
    db.commit()
    _audit("candidate.schedule", current_user, plan, {"day_id": str(day.id)})
    return {"event_id": str(ev.id), "place_id": str(place.id), "plan_revision": revision, **_list(db, plan)}


class MergeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    into_id: uuid.UUID


@router.post("/{plan_id}/candidates/{candidate_id}/merge")
def merge_candidate(plan_id: str, candidate_id: str, body: MergeInput, db: Session = Depends(get_db),
                    if_match: Optional[str] = Header(None, alias="If-Match"),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    c = _get(db, plan, candidate_id)
    _require_rev(c, if_match)
    target = _get(db, plan, str(body.into_id))
    if target.id == c.id:
        raise _bad("same_candidate", "同じ候補へはまとめられません")
    if target.merged_into_id:
        raise _bad("target_merged", "まとめ先の候補は、すでに別の候補へまとめられています")
    event_ids = {r[0] for r in db.query(TravelEvent.id).filter(TravelEvent.plan_id == plan.id).all()}
    if _effective_status(c, event_ids) == "scheduled":
        raise _bad("scheduled", "予定に配置済みの候補は、まとめる側にできません", 409)
    # まとめた側にまとめられていた候補も、まとめ先へ付け替える(連鎖しない)
    db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id, PlanCandidate.merged_into_id == c.id).update(
        {PlanCandidate.merged_into_id: target.id}, synchronize_session=False)
    c.status, c.scheduled_event_id, c.merged_into_id = "dismissed", None, target.id
    if not target.note and c.note:
        target.note = c.note
        target.revision += 1
    c.revision += 1
    db.commit()
    _audit("candidate.merge", current_user, plan, {})
    return _list(db, plan)
