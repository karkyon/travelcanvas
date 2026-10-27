"""
[Gate P7] FR-019 What-if・旅程ブランチ(DOC-04 SC-17、DOC-05 §7.6)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET    /branches                    : 分岐案の一覧(viewer以上)
- POST   /branches                    : 本案から分岐案を作る(editor以上)。想定(雨天・遅延・欠席・予算・体力・自由)ごとに
                                        自動で案を作るが、本案は変えない
- GET    /branches/{id}               : 分岐案の詳細(予定・本案との差分・採用できない理由)
- PUT    /branches/{id}/content       : 分岐案の予定を保存する(If-Match: 分岐案のrevision)
- PATCH  /branches/{id}               : 題名・想定メモの変更、破棄・下書きへ戻す(If-Match)
- POST   /branches/{id}/adopt         : 分岐案での変更を本案へ1つの変更セットとして適用する(If-Match)。
                                        本案の「元に戻す」で取り消せる。分岐後に本案で同じ予定が変わっていた、
                                        確定済み、予約・移動等と紐付いた予定を外す、などは409で止める(黙って上書きしない)
- DELETE /branches/{id}               : 分岐案を削除する(If-Match)
- PUT    /branches/{id}/resources     : [Gate G8] 案の中の移動区間・予約の変更を保存する(If-Match。branch-v2)
- GET    /branches/{id}/adoption-preview : [Gate G8] 採用の前の確かめ(変更ごとの ID・頼る変更・競合・作る準備)。?only= で選ぶ
- POST   /branches/{id}/adopt に {"only": [変更の ID]} を送ると、選んだ変更だけを当てる(残りは当てずに案を閉じる)

権限: 閲覧はviewer以上、作成・編集・採用・削除はeditor以上。監査には件数だけを記録する。
"""
import uuid
from datetime import datetime, time as time_cls, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Set, cast

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, func as sa_func
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import Base, get_db
from app.core.plan_access import require_plan_access
from app.api.v1 import plans as plans_api
from app.models.models import (
    ChangeSet, DocumentLink, ItineraryBranch, TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import branches as br
from app.services import branch_resources as brs
from app.services import member_policy
from app.services.audit_service import record_audit_event
from app.services.readiness import member_names
from app.services.today_mode import zone_for

router = APIRouter(prefix="/plans", tags=["branches"])

MAX_ACTIVE_BRANCHES = 20


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


# ===== スキーマ =====

class BranchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., min_length=1, max_length=200)
    scenario_type: str = "custom"
    assumptions: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("title")
    @classmethod
    def _v_title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("題名を入力してください")
        return v

    @field_validator("scenario_type")
    @classmethod
    def _v_scenario(cls, v):
        if v not in br.SCENARIOS:
            raise ValueError(f"scenario_type must be one of {list(br.SCENARIOS)}")
        return v


class BranchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    note: Optional[str] = Field(None, max_length=500)
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v is not None and v not in ("draft", "discarded"):
            raise ValueError("statusはdraftかdiscardedです(採用はadoptで行います)")
        return v


class ContentItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Optional[str] = Field(None, max_length=64)
    source_event_id: Optional[str] = None
    day_id: str
    title: str = Field(..., max_length=200)
    event_type: str = Field("activity", max_length=50)
    local_start_time: Optional[str] = None
    is_all_day: bool = False
    sort_order: int = Field(0, ge=0, le=10_000)
    removed: bool = False
    note: Optional[str] = Field(None, max_length=500)
    # 応答の予定をそのまま送り返せるよう受け付けるが使わない(確定かどうかは本案の値で決める)
    locked: Optional[bool] = None


class ContentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: List[ContentItem] = Field(..., max_length=500)
    # [Gate G8] 予定と一緒に、移動区間・予約の変更も保存する(省くと今の変更を新しい予定で確かめ直す)
    resources: Optional[Dict[str, Any]] = None


class ResourcesUpdate(BaseModel):
    """[Gate G8] FR-019 案の中の移動区間・予約の変更(形は app/services/branch_resources.py)。"""
    model_config = ConfigDict(extra="forbid")
    segments: List[Dict[str, Any]] = Field(default_factory=list, max_length=brs.MAX_SEGMENT_OPS)
    reservations: List[Dict[str, Any]] = Field(default_factory=list, max_length=brs.MAX_RESERVATION_OPS)


class AdoptRequest(BaseModel):
    """[Gate G8] 選んだ変更だけを採用する(省くと全て)。"""
    model_config = ConfigDict(extra="forbid")
    only: Optional[List[str]] = Field(None, max_length=1500)


# ===== 共通 =====

def _audit(action: str, request: Request, user: User, branch: ItineraryBranch, details: Dict[str, Any]) -> None:
    record_audit_event(
        action=action, resource_type="itinerary_branch", user_id=user.id, resource_id=branch.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # 予定名・メモは記録しない
        details={"plan_id": str(branch.plan_id), **details},
    )


def _require_if_match(revision: int, if_match: Optional[str]) -> None:
    if if_match is None:
        raise HTTPException(status_code=428, detail="If-Matchヘッダーが必要です(分岐案のrevision)")
    try:
        expected = int(if_match)
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Matchの形式が不正です")
    if expected != revision:
        raise HTTPException(status_code=409, detail=f"分岐案が他の変更で更新されています(現在のrevision: {revision})")


def _snapshot(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
            .order_by(TravelDay.local_date, TravelDay.sort_order).all())
    events = (db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id)
              .order_by(TravelEvent.sort_order).all())
    return {
        "days": [{"id": str(d.id), "local_date": d.local_date.isoformat(), "timezone_id": d.timezone_id,
                  "title": d.title} for d in days],
        "events": [br.event_item(e) for e in events],
    }


def _related_event_ids(db: Session, event_ids: List[uuid.UUID], exclude_segments: Optional[Set[str]] = None,
                       exclude_reservations: Optional[Set[str]] = None) -> Set[str]:
    """予約・移動区間・経路候補・リンク・文書などと紐付いている予定(外すと紐付けが失われるもの)。
    [Gate G8] 同じ採用で外す区間・付け替える(取り消す予定の)予約の紐付けは数えない(採用の中で先に解くため)。"""
    if not event_ids:
        return set()
    ex_seg = [uuid.UUID(x) for x in (exclude_segments or set())]
    ex_res = [uuid.UUID(x) for x in (exclude_reservations or set())]
    related: Set[str] = set()
    for table in Base.metadata.sorted_tables:
        if table.name == "travel_events":
            continue
        for col in table.columns:
            if any(fk.column.table.name == "travel_events" for fk in col.foreign_keys):
                q = select(col).where(col.in_(event_ids))
                if table.name == "travel_segments" and ex_seg:
                    q = q.where(table.c.id.notin_(ex_seg))
                if table.name == "reservations" and ex_res:
                    q = q.where(table.c.id.notin_(ex_res))
                if table.name == "event_reservations" and ex_res:
                    q = q.where(table.c.reservation_id.notin_(ex_res))
                rows = db.execute(q.distinct()).all()
                related.update(str(r[0]) for r in rows if r[0] is not None)
    links = db.query(DocumentLink.entity_id).filter(
        DocumentLink.entity_type == "event", DocumentLink.entity_id.in_(event_ids)).all()
    for (eid,) in links:
        related.add(str(eid))
    return related


def _state(b: ItineraryBranch, db: Session) -> str:
    if b.status == "adopted" and b.adopted_change_set_id:
        cs = db.query(ChangeSet).filter(ChangeSet.id == b.adopted_change_set_id).first()
        if cs is not None and cs.undone_at is not None:
            return "adopted_undone"
    return b.status


def _resources_snapshot(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    """[Gate G8] 本案の移動区間・予約(取消・削除を除く予約)の写し。分岐の基準・今の本案との比較に使う。"""
    from app.models.models import EventReservation, Reservation, TravelSegment

    segs = db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id).order_by(TravelSegment.created_at).all()
    rows = (db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
            .order_by(Reservation.created_at).all())
    links: Dict[str, List[Any]] = {}
    if rows:
        for link in db.query(EventReservation).filter(EventReservation.reservation_id.in_([r.id for r in rows])):
            links.setdefault(str(link.reservation_id), []).append(link)
    return {"segments": [brs.segment_item(x) for x in segs],
            "reservations": [brs.reservation_item(r, links.get(str(r.id), [])) for r in rows]}


def _resources(b: ItineraryBranch) -> Dict[str, Any]:
    return brs.normalized(cast(Optional[Dict[str, Any]], b.resources))


def _evaluate(db: Session, plan: TravelPlan, b: ItineraryBranch, only: Optional[Set[str]] = None) -> Dict[str, Any]:
    """[Gate G8] 予定の変更(ops)・区間と予約の変更(resources)・競合。only は選んだ変更の ID(None は全て)。"""
    all_ops = br.compute_ops(b.base_snapshot, b.content)
    for o in all_ops:
        o["op_id"] = brs.op_id_for_event(o)
    all_res = _resources(b)
    ops = all_ops if only is None else [o for o in all_ops if o["op_id"] in only]
    res = brs.select(all_res, only)
    current_events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    current = {str(e.id): br.event_item(e) for e in current_events}
    day_ids = {str(d.id) for d in db.query(TravelDay.id).filter(TravelDay.plan_id == plan.id).all()}
    removal_ids = [uuid.UUID(o["event_id"]) for o in ops if o["op"] == "remove"]
    ex_seg: Set[str] = set()
    ex_res: Set[str] = set()
    for o in ops:
        if o["op"] == "remove":
            s_ids, r_ids = brs.resolving_ops(o["event_id"], res)
            ex_seg |= s_ids
            ex_res |= r_ids
    conflicts = br.find_conflicts(ops, b.base_snapshot, current, day_ids,
                                  _related_event_ids(db, removal_ids, ex_seg, ex_res))
    for c in conflicts:
        c["kind"] = "event"
        c["op_id"] = f"event:add:{c['key']}" if c.get("op") == "add" and c.get("key") else f"event:{c.get('event_id')}"
    if res.get("segments") or res.get("reservations"):
        cur = _resources_snapshot(db, plan)
        conflicts += brs.find_conflicts(res, {x["id"]: x for x in cur["segments"]},
                                        {x["id"]: x for x in cur["reservations"]}, set(current))
    deps = brs.dependencies(all_ops, all_res)
    return {"ops": ops, "all_ops": all_ops, "resources": res, "all_resources": all_res, "conflicts": conflicts,
            "dependencies": deps,
            "missing": brs.missing_dependencies(only, deps) if only is not None else []}


def _response(db: Session, plan: TravelPlan, b: ItineraryBranch, user: User, role: str, names: Dict,
              detail: bool, hidden: Optional[Set[str]] = None) -> Dict[str, Any]:
    ops = br.compute_ops(b.base_snapshot, b.content)
    state = _state(b, db)
    resources = _resources(b)
    if hidden is None:
        hidden = set(member_policy.hidden_for(db, plan, role, user))
    out: Dict[str, Any] = {
        "id": str(b.id), "plan_id": str(b.plan_id),
        "algorithm_version": brs.ALGORITHM_VERSION if (resources["segments"] or resources["reservations"])
        else br.ALGORITHM_VERSION,
        "title": b.title, "scenario_type": b.scenario_type, "assumptions": b.assumptions,
        "base_revision": b.base_revision, "plan_revision": plan.revision,
        "plan_changed_since_base": plan.revision != b.base_revision,
        "status": b.status, "state": state,
        "created_by_name": names.get(b.created_by_user_id, "メンバー外"),
        "adopted_at": _iso(b.adopted_at),
        "adopted_by_name": names.get(b.adopted_by_user_id) if b.adopted_by_user_id else None,
        "summary": br.summarize(ops),
        "resource_summary": _resource_summary(resources, hidden),
        "can_edit": role in ("owner", "editor") and b.status == "draft",
        "revision": b.revision, "created_at": _iso(b.created_at), "updated_at": _iso(b.updated_at),
    }
    if detail:
        evaluation = _evaluate(db, plan, b) if b.status == "draft" else {"ops": ops, "conflicts": []}
        for o in evaluation["ops"]:
            o.setdefault("op_id", brs.op_id_for_event(o))
        base_res = resources["base"] or (_resources_snapshot(db, plan) if b.status == "draft" else
                                         {"segments": [], "reservations": []})
        out.update({
            "days": b.base_snapshot["days"],
            "content": b.content,
            "ops": evaluation["ops"],
            "conflicts": _visible_conflicts(evaluation["conflicts"], hidden),
            "day_counts": br.day_counts(b.base_snapshot, b.content),
            "resources": brs.visible({**resources, "base": base_res}, hidden),
        })
    return out


def _resource_summary(resources: Dict[str, Any], hidden: Set[str]) -> Dict[str, int]:
    s = brs.summarize(resources)
    if "reservations" in hidden:
        s["reservations_relinked"] = 0
        s["reservations_cancel_planned"] = 0
    return s


def _visible_conflicts(conflicts: List[Dict[str, Any]], hidden: Set[str]) -> List[Dict[str, Any]]:
    """予約を隠す人には、予約の競合の名前を出さない(採用できない理由があることは出す)。"""
    if "reservations" not in hidden:
        return conflicts
    out = []
    for c in conflicts:
        if c.get("kind") == "reservation":
            c = {"kind": "reservation", "op_id": "reservation:hidden", "op": c.get("op"), "reason": "hidden"}
        out.append(c)
    return out


def _get(db: Session, plan: TravelPlan, branch_id: str) -> ItineraryBranch:
    try:
        bid = uuid.UUID(str(branch_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="分岐案が見つかりません")
    b = db.query(ItineraryBranch).filter(ItineraryBranch.id == bid, ItineraryBranch.plan_id == plan.id,
                                         ItineraryBranch.deleted_at.is_(None)).first()
    if b is None:
        raise HTTPException(status_code=404, detail="分岐案が見つかりません")
    return b


def _names(db: Session, branches: List[ItineraryBranch]) -> Dict:
    ids = {b.created_by_user_id for b in branches} | {b.adopted_by_user_id for b in branches if b.adopted_by_user_id}
    return member_names(db, ids)


# ===== エンドポイント =====

@router.get("/{plan_id}/branches", response_model=List[dict])
def list_branches(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    rows = (db.query(ItineraryBranch).filter(ItineraryBranch.plan_id == plan.id, ItineraryBranch.deleted_at.is_(None))
            .order_by(ItineraryBranch.created_at.desc()).all())
    names = _names(db, rows)
    return [_response(db, plan, b, current_user, role, names, detail=False) for b in rows]


@router.post("/{plan_id}/branches", status_code=201, response_model=dict)
def create_branch(plan_id: str, payload: BranchCreate, request: Request, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    ok, err = br.assumptions_ok(payload.scenario_type, payload.assumptions)
    if not ok:
        raise HTTPException(status_code=422, detail=err)
    active = db.query(sa_func.count(ItineraryBranch.id)).filter(
        ItineraryBranch.plan_id == plan.id, ItineraryBranch.deleted_at.is_(None),
        ItineraryBranch.status == "draft").scalar()
    if active >= MAX_ACTIVE_BRANCHES:
        raise HTTPException(status_code=409, detail=f"下書きの分岐案は{MAX_ACTIVE_BRANCHES}件までです")
    base = _snapshot(db, plan)
    try:
        content = br.apply_scenario(payload.scenario_type, payload.assumptions, base)
    except br.BranchError as e:
        raise HTTPException(status_code=422, detail=str(e))
    b = ItineraryBranch(
        id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, title=payload.title,
        scenario_type=payload.scenario_type, assumptions=payload.assumptions, base_revision=plan.revision,
        base_snapshot=base, content=content, status="draft",
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    summary = br.summarize(br.compute_ops(base, content))
    _audit("branch_created", request, current_user, b, {"scenario_type": b.scenario_type, **summary})
    return _response(db, plan, b, current_user, role, _names(db, [b]), detail=True)


@router.get("/{plan_id}/branches/{branch_id}", response_model=dict)
def get_branch(plan_id: str, branch_id: str, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    b = _get(db, plan, branch_id)
    return _response(db, plan, b, current_user, role, _names(db, [b]), detail=True)


@router.put("/{plan_id}/branches/{branch_id}/content", response_model=dict)
def put_content(plan_id: str, branch_id: str, payload: ContentUpdate, db: Session = Depends(get_db),
                if_match: Optional[str] = Header(None, alias="If-Match"),
                current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    b = _get(db, plan, branch_id)
    _require_if_match(b.revision, if_match)
    if b.status != "draft":
        raise HTTPException(status_code=409, detail="採用・破棄した分岐案は編集できません")
    try:
        content = br.validate_content([i.model_dump(exclude={"locked"}) for i in payload.events], b.base_snapshot)
    except br.BranchError as e:
        raise HTTPException(status_code=422, detail=str(e))
    hidden = set(member_policy.hidden_for(db, plan, role, current_user))
    current_res = _resources(b)
    if payload.resources is not None:
        _check_resource_input(payload.resources, hidden, current_res)
        raw = payload.resources
    else:
        raw = {"segments": current_res["segments"], "reservations": current_res["reservations"]}
    row: Any = b
    row.resources = _validated_resources(db, plan, b, raw, content)
    row.content = content
    b.revision += 1
    db.commit()
    db.refresh(b)
    return _response(db, plan, b, current_user, role, _names(db, [b]), detail=True)


def _check_resource_input(raw: Dict[str, Any], hidden: Set[str], current: Dict[str, Any]) -> None:
    """[Gate G8] 予約・費用を見せない参加者は、その変更を送れない(今の変更を消すこともできない)。"""
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="予約・区間の変更の形が正しくありません")
    if "reservations" in hidden and (raw.get("reservations") or current["reservations"]):
        if raw.get("reservations") != current["reservations"]:
            raise member_policy.hidden_error("reservations")
    if "costs" in hidden:
        def costs(ops):
            return [(o.get("segment_id") or o.get("key"), (o.get("fields") or {}).get("cost"),
                     (o.get("fields") or {}).get("currency")) for o in ops or [] if isinstance(o, dict)
                    and ("cost" in (o.get("fields") or {}) or "currency" in (o.get("fields") or {}))]
        if costs(raw.get("segments")) != costs(current["segments"]):
            raise member_policy.hidden_error("costs")


def _validated_resources(db: Session, plan: TravelPlan, b: ItineraryBranch, raw: Dict[str, Any],
                         content: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """[Gate G8] 予約・区間の変更を予定と合わせて確かめる。変更が無ければ NULL(予定だけの案)。"""
    if not (raw.get("segments") or raw.get("reservations")):
        return None
    current = _resources(b)
    base = current["base"] or _resources_snapshot(db, plan)
    try:
        return brs.validate(raw, base, content)
    except brs.ResourceError as e:
        raise HTTPException(status_code=422, detail={"code": "invalid_branch_resources", "message": str(e)})


@router.put("/{plan_id}/branches/{branch_id}/resources", response_model=dict)
def put_resources(plan_id: str, branch_id: str, payload: ResourcesUpdate, db: Session = Depends(get_db),
                  if_match: Optional[str] = Header(None, alias="If-Match"),
                  current_user: User = Depends(get_current_user_or_guest)):
    """[Gate G8] FR-019 案の中の移動区間・予約の変更を保存する。本案は変えない。"""
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    b: Any = _get(db, plan, branch_id)
    _require_if_match(b.revision, if_match)
    if b.status != "draft":
        raise HTTPException(status_code=409, detail="採用・破棄した分岐案は編集できません")
    hidden = set(member_policy.hidden_for(db, plan, role, current_user))
    raw = payload.model_dump()
    _check_resource_input(raw, hidden, _resources(b))
    b.resources = _validated_resources(db, plan, b, raw, cast(List[Dict[str, Any]], b.content))
    b.revision += 1
    db.commit()
    db.refresh(b)
    return _response(db, plan, b, current_user, role, _names(db, [b]), detail=True)


@router.patch("/{plan_id}/branches/{branch_id}", response_model=dict)
def update_branch(plan_id: str, branch_id: str, payload: BranchUpdate, request: Request,
                  db: Session = Depends(get_db), if_match: Optional[str] = Header(None, alias="If-Match"),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    b = _get(db, plan, branch_id)
    _require_if_match(b.revision, if_match)
    if b.status == "adopted":
        raise HTTPException(status_code=409, detail="採用した分岐案は変更できません")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="題名を入力してください")
        b.title = title
    if "note" in data:
        b.assumptions = {**(b.assumptions or {}), "note": data["note"]}
    if "status" in data and data["status"] != b.status:
        b.status = data["status"]
        _audit(f"branch_{'discarded' if b.status == 'discarded' else 'reopened'}", request, current_user, b, {})
    b.revision += 1
    db.commit()
    db.refresh(b)
    return _response(db, plan, b, current_user, role, _names(db, [b]), detail=True)


def _apply_time(event: TravelEvent, day: Any, new_time: Optional[str], old_time: Any = None,
                old_date: Any = None) -> None:
    """時刻を変えた予定は、開始日時(start_at)を持っていれば同じ日の新しい時刻へ合わせ、終了も同じだけずらす。
    [Gate G7] FR-005 start_at の無い予定(画面で作った予定)も、終了(end_at)を開始と同じだけずらす(old_time・old_date が
    分かる時。日をまたぐ予定の所要時間を保つ)。"""
    if event.start_at is None:
        from app.services import event_times as et

        if old_date is not None and old_date != day.local_date and event.end_at is not None:
            event.end_at = et._aware(event.end_at) + (day.local_date - old_date)
        if new_time is None:
            event.end_at = None  # 開始の無い予定に終了だけを残さない
            return
        et.shift_end_with_start(event, day.local_date, day.timezone_id, old_time, new_time)
        return
    if new_time is None:
        event.start_at = None
        event.end_at = None
        return
    h, m = (int(x) for x in new_time.split(":"))
    new_start = datetime.combine(day.local_date, time_cls(h, m), tzinfo=zone_for(day.timezone_id))
    old_start = event.start_at if event.start_at.tzinfo else event.start_at.replace(tzinfo=dt_timezone.utc)
    if event.end_at is not None:
        old_end = event.end_at if event.end_at.tzinfo else event.end_at.replace(tzinfo=dt_timezone.utc)
        event.end_at = new_start + (old_end - old_start)
    event.start_at = new_start


def _parse_only(only: Optional[List[str]], evaluation_ids: Set[str]) -> Optional[Set[str]]:
    if only is None:
        return None
    chosen = {str(x) for x in only}
    unknown = sorted(chosen - evaluation_ids)
    if unknown:
        raise HTTPException(status_code=422, detail={
            "code": "unknown_branch_ops", "message": "この案に無い変更が選ばれています", "op_ids": unknown[:20]})
    if not chosen:
        raise HTTPException(status_code=422, detail={"code": "no_ops_selected", "message": "採用する変更を選んでください"})
    return chosen


def _all_op_ids(evaluation: Dict[str, Any]) -> Set[str]:
    ids = {o["op_id"] for o in evaluation["all_ops"]}
    res = evaluation["all_resources"]
    ids |= {brs.op_id_for_segment(x) for x in res["segments"]}
    ids |= {brs.op_id_for_reservation(x) for x in res["reservations"]}
    return ids


def _preview(db: Session, plan: TravelPlan, b: ItineraryBranch, only: Optional[Set[str]], hidden: Set[str]):
    evaluation = _evaluate(db, plan, b, only)
    base = evaluation["all_resources"]["base"] or {"segments": [], "reservations": []}
    seg_base = {x["id"]: x for x in base.get("segments") or []}
    res_base = {x["id"]: x for x in base.get("reservations") or []}
    snap = cast(Dict[str, Any], b.base_snapshot)
    titles = {e["source_event_id"]: e["title"] for e in snap["events"]}
    titles.update({e["key"]: e["title"] for e in cast(List[Dict[str, Any]], b.content) if not e.get("source_event_id")})

    def ref_label(ref):
        if not ref:
            return None
        return titles.get(ref.get("event") or ref.get("key"), "予定")

    chosen = only if only is not None else _all_op_ids(evaluation)
    items: List[Dict[str, Any]] = []
    for o in evaluation["all_ops"]:
        label = o.get("title") or (o.get("fields") or {}).get("title") or "予定"
        items.append({"op_id": o["op_id"], "kind": "event", "op": o["op"], "label": label,
                      "selected": o["op_id"] in chosen, "requires": evaluation["dependencies"].get(o["op_id"], [])})
    for x in evaluation["all_resources"]["segments"]:
        oid = brs.op_id_for_segment(x)
        if x["op"] == "add":
            label = f"{ref_label(x['fields'].get('from'))} → {ref_label(x['fields'].get('to'))}"
        else:
            sb = seg_base.get(x["segment_id"], {})
            label = f"{titles.get(sb.get('from_event_id'), '場所')} → {titles.get(sb.get('to_event_id'), '場所')}"
        items.append({"op_id": oid, "kind": "segment", "op": x["op"], "label": label, "selected": oid in chosen,
                      "requires": evaluation["dependencies"].get(oid, [])})
    tasks = []
    if "reservations" not in hidden:
        for x in evaluation["all_resources"]["reservations"]:
            oid = brs.op_id_for_reservation(x)
            rb = res_base.get(x["reservation_id"], {})
            label = rb.get("label") or "予約"
            if x["op"] == "relink":
                label = f"{label} → {ref_label(x.get('to')) or '紐付けを外す'}"
            items.append({"op_id": oid, "kind": "reservation", "op": x["op"], "label": label,
                          "selected": oid in chosen, "requires": evaluation["dependencies"].get(oid, [])})
            if x["op"] == "cancel" and oid in chosen:
                tasks.append({"title": _cancel_task_title(rb.get("label") or "予約"),
                              "due_at": rb.get("cancellation_deadline")})
    selected_any = any(i["selected"] for i in items)
    return {
        "branch_id": str(b.id), "algorithm_version": brs.ALGORITHM_VERSION, "items": items,
        "conflicts": _visible_conflicts(evaluation["conflicts"], hidden),
        "missing_dependencies": evaluation["missing"], "tasks": tasks,
        "reservations_hidden": "reservations" in hidden,
        "can_adopt": b.status == "draft" and selected_any and not evaluation["conflicts"] and not evaluation["missing"],
        "partial": only is not None and set(only) != _all_op_ids(evaluation),
    }, evaluation


def _cancel_task_title(label: str) -> str:
    return f"予約の取消の手続き: {label}"[:200]


@router.get("/{plan_id}/branches/{branch_id}/adoption-preview", response_model=dict)
def adoption_preview(plan_id: str, branch_id: str, only: Optional[str] = Query(None, max_length=60000),
                     db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    """[Gate G8] FR-019 採用の前の確かめ。DB は変えない。only はカンマ区切りの変更の ID。"""
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    b = _get(db, plan, branch_id)
    hidden = set(member_policy.hidden_for(db, plan, role, current_user))
    if b.status != "draft":
        raise HTTPException(status_code=409, detail="採用・破棄した分岐案です")
    ev = _evaluate(db, plan, b)
    chosen = _parse_only([x for x in only.split(",") if x.strip()] if only is not None else None, _all_op_ids(ev))
    out, _ = _preview(db, plan, b, chosen, hidden)
    out["can_adopt"] = out["can_adopt"] and role in ("owner", "editor")
    return out


@router.post("/{plan_id}/branches/{branch_id}/adopt", response_model=dict)
def adopt_branch(plan_id: str, branch_id: str, request: Request, db: Session = Depends(get_db),
                 payload: Optional[AdoptRequest] = Body(None),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    b = _get(db, plan, branch_id)
    _require_if_match(b.revision, if_match)
    if b.status != "draft":
        raise HTTPException(status_code=409, detail="採用・破棄した分岐案は採用できません")
    hidden = set(member_policy.hidden_for(db, plan, role, current_user))
    full = _evaluate(db, plan, b)
    if "reservations" in hidden and full["all_resources"]["reservations"]:
        # 予約を見せない参加者は、予約の変更を含む案を採用できない(何が変わるかを確かめられないため)
        raise member_policy.hidden_error("reservations")
    only = _parse_only(payload.only if payload else None, _all_op_ids(full))
    evaluation = _evaluate(db, plan, b, only) if only is not None else full
    ops, conflicts, res = evaluation["ops"], evaluation["conflicts"], evaluation["resources"]
    if evaluation["missing"]:
        raise HTTPException(status_code=422, detail={
            "code": "branch_dependency_missing",
            "message": "選んだ変更が頼る変更(足した予定など)も選んでください",
            "missing_dependencies": evaluation["missing"]})
    if conflicts:
        raise HTTPException(status_code=409, detail={
            "code": "branch_conflict",
            "message": "本案と食い違う変更があるため採用できません。分岐案を直してから採用してください",
            "conflicts": _visible_conflicts(conflicts, hidden),
        })
    if not ops and not res["segments"] and not res["reservations"]:
        raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "本案からの変更がありません"})

    changes = apply_branch(db, plan, ops, res, current_user)
    new_revision = plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "branch", changes)
    cs = db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id,
                                    ChangeSet.resulting_revision == new_revision).first()
    b.status = "adopted"
    b.adopted_at = _now()
    b.adopted_by_user_id = current_user.id
    b.adopted_change_set_id = cs.id if cs else None
    b.revision += 1
    db.commit()
    db.refresh(b)
    left_out = sorted(_all_op_ids(full) - only) if only is not None else []
    _audit("branch_adopted", request, current_user, b, {
        "plan_revision": new_revision, **br.summarize(ops), **brs.summarize(res), "left_out": len(left_out)})
    return {"branch": _response(db, plan, b, current_user, role, _names(db, [b]), detail=True),
            "plan_revision": new_revision, "left_out": left_out,
            "tasks_created": sum(1 for c in changes if c[0] == "preparation_task")}


def apply_branch(db: Session, plan: TravelPlan, ops: List[Dict[str, Any]], resources: Dict[str, Any],
                 user: User) -> List[tuple]:
    """[Gate G8] 予定の変更・区間と予約の変更を本案へ当てる(1つの変更セット)。順番:
    予定を足す・変える → 予約を付け替える(取り消す予定の予約は紐付けを外す)→ 区間を外す・変える・足す → 予定を外す →
    取消の手続きの準備を作る。Undo(plans.undo_last_change)はこの逆の順で戻す。"""
    keyed: Dict[str, uuid.UUID] = {}
    first = [o for o in ops if o["op"] != "remove"]
    removes = [o for o in ops if o["op"] == "remove"]
    changes = apply_ops(db, plan, first, keyed=keyed)
    changes += _apply_reservations(db, plan, resources, keyed)
    changes += _apply_segments(db, plan, resources, keyed)
    changes += apply_ops(db, plan, removes)
    changes += _cancel_tasks(db, plan, resources, user)
    return changes


def _ref_id(ref: Optional[Dict[str, str]], keyed: Dict[str, uuid.UUID]) -> Optional[uuid.UUID]:
    if not ref:
        return None
    if ref.get("event"):
        return uuid.UUID(ref["event"])
    return keyed[ref["key"]]


def _links_state(db: Session, r: Any) -> Dict[str, Any]:
    from app.models.models import EventReservation

    links = db.query(EventReservation).filter(EventReservation.reservation_id == r.id).order_by(EventReservation.id)
    return {"event_id": str(r.event_id) if r.event_id else None,
            "links": [{"id": str(x.id), "event_id": str(x.event_id), "relation_type": x.relation_type,
                       "is_locked": bool(x.is_locked)} for x in links]}


def _apply_reservations(db: Session, plan: TravelPlan, resources: Dict[str, Any],
                        keyed: Dict[str, uuid.UUID]) -> List[tuple]:
    from app.models.models import EventReservation, Reservation

    changes: List[tuple] = []
    for x in resources.get("reservations") or []:
        r: Any = (db.query(Reservation)
                  .filter(Reservation.id == uuid.UUID(x["reservation_id"]), Reservation.plan_id == plan.id)
                  .with_for_update().first())
        if r is None:
            continue
        before = _links_state(db, r)
        target = _ref_id(x.get("to"), keyed) if x["op"] == "relink" else None
        db.query(EventReservation).filter(EventReservation.reservation_id == r.id).delete(synchronize_session=False)
        row: Any = r
        row.event_id = target
        if target is not None:
            db.add(EventReservation(id=uuid.uuid4(), event_id=target, reservation_id=r.id, relation_type="primary",
                                    is_locked=False))
        row.revision = (r.revision or 1) + 1
        db.flush()
        changes.append(("reservation_links", r.id, "update", before, _links_state(db, r)))
    return changes


def _apply_segments(db: Session, plan: TravelPlan, resources: Dict[str, Any],
                    keyed: Dict[str, uuid.UUID]) -> List[tuple]:
    from decimal import Decimal

    from app.models.models import TravelSegment
    from app.services.route_estimator import estimate_leg

    changes: List[tuple] = []
    for x in resources.get("segments") or []:
        if x["op"] == "add":
            continue
        seg: Any = (db.query(TravelSegment)
                    .filter(TravelSegment.id == uuid.UUID(x["segment_id"]), TravelSegment.plan_id == plan.id).first())
        if seg is None:
            continue
        before = plans_api._segment_to_dict(seg)
        if x["op"] == "remove":
            changes.append(("travel_segment", seg.id, "delete", before, None))
            db.delete(seg)
            db.flush()
            continue
        _set_segment_fields(seg, x["fields"])
        row: Any = seg
        row.revision = (seg.revision or 1) + 1
        db.flush()
        changes.append(("travel_segment", seg.id, "update", before, plans_api._segment_to_dict(seg)))
    for x in resources.get("segments") or []:
        if x["op"] != "add":
            continue
        f = x["fields"]
        src, dst = _ref_id(f["from"], keyed), _ref_id(f["to"], keyed)
        seg = cast(Any, TravelSegment)(
            id=uuid.uuid4(), plan_id=plan.id, from_event_id=src, to_event_id=dst, mode=f["mode"],
            status=f.get("status") or "planned", is_estimate=True, provider="manual", algorithm_version="manual-v1",
            computed_at=_now())
        _set_segment_fields(seg, {k: v for k, v in f.items() if k not in ("from", "to")})
        if seg.duration_minutes is None or seg.distance_km is None:
            a: Any = db.query(TravelEvent).filter(TravelEvent.id == src).first()
            c: Any = db.query(TravelEvent).filter(TravelEvent.id == dst).first()
            leg = estimate_leg(a.latitude if a else None, a.longitude if a else None,
                               c.latitude if c else None, c.longitude if c else None, f["mode"])
            if leg is not None:
                if seg.distance_km is None:
                    seg.distance_km = leg["distance_km"]
                if seg.duration_minutes is None and leg.get("duration_minutes") is not None:
                    seg.duration_minutes = leg["duration_minutes"]
        else:
            seg.is_estimate = False
        if seg.cost is not None and not isinstance(seg.cost, Decimal):
            seg.cost = Decimal(str(seg.cost))
        db.add(seg)
        db.flush()
        changes.append(("travel_segment", seg.id, "create", None, plans_api._segment_to_dict(seg)))
    return changes


def _set_segment_fields(seg: Any, fields: Dict[str, Any]) -> None:
    from decimal import Decimal

    for k, v in fields.items():
        if k in ("planned_departure_at", "planned_arrival_at", "last_departure_at"):
            setattr(seg, k, datetime.fromisoformat(v) if v else None)
        elif k == "cost":
            seg.cost = Decimal(v) if v is not None else None
        elif k in ("duration_minutes", "distance_km"):
            setattr(seg, k, v)
            seg.is_estimate = False
        else:
            setattr(seg, k, v)


def _cancel_tasks(db: Session, plan: TravelPlan, resources: Dict[str, Any], user: User) -> List[tuple]:
    """取り消す予定にした予約ごとに「予約の取消の手続き」の準備を作る(予約の状態は変えない。期限は取消期限)。"""
    from app.models.models import PreparationTask, Reservation

    changes: List[tuple] = []
    for x in resources.get("reservations") or []:
        if x["op"] != "cancel":
            continue
        r: Any = db.query(Reservation).filter(Reservation.id == uuid.UUID(x["reservation_id"])).first()
        if r is None:
            continue
        key = f"branch-cancel:{r.id}"
        exists = db.query(PreparationTask).filter(PreparationTask.plan_id == plan.id,
                                                  PreparationTask.readiness_key == key,
                                                  PreparationTask.deleted_at.is_(None)).first()
        if exists is not None:
            continue
        task: Any = PreparationTask(
            id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=user.id,
            title=_cancel_task_title(r.provider_name or r.type or "予約"),
            description=("分岐案の採用で、この予約を取り消す予定になりました。予約先で取消の手続きをしてから、"
                         "予約の状態を「取消」にしてください(TravelCanvas からは取り消しません)。"
                         + (f" メモ: {x['note']}" if x.get("note") else ""))[:2000],
            completion_criteria="予約先で取消が済み、予約の状態を「取消」にした",
            due_at=r.cancellation_deadline, status="open", related_type="reservation", related_id=r.id,
            readiness_key=key,
        )
        db.add(task)
        db.flush()
        changes.append(("preparation_task", task.id, "create", None, {"readiness_key": key, "title": task.title}))
    return changes


def apply_ops(db: Session, plan: TravelPlan, ops: List[Dict[str, Any]],
              keyed: Optional[Dict[str, uuid.UUID]] = None) -> List[tuple]:
    """差分(ops)を本案の予定へ当て、変更セット用の (entity_type, id, action, before, after) を返す。
    [Gate P10] 再計画の承認(app/api/v1/replans.py)でも同じ処理を使うため関数に切り出した。
    [Gate G8] keyed を渡すと、足した予定の key → 新しい予定の ID を入れる(区間・予約の付け替えで使う)。"""
    days = {str(d.id): d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}
    changes = []
    for o in ops:
        if o["op"] == "add":
            f = o["fields"]
            ev = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=uuid.UUID(f["day_id"]), title=f["title"],
                             event_type=f["event_type"], local_start_time=f["local_start_time"],
                             is_all_day=f["is_all_day"], sort_order=f["sort_order"])
            db.add(ev)
            db.flush()
            if keyed is not None and o.get("key"):
                keyed[o["key"]] = cast(uuid.UUID, ev.id)
            changes.append(("travel_event", ev.id, "create", None, plans_api._event_to_dict(ev)))
        elif o["op"] == "remove":
            ev = db.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(o["event_id"])).first()
            if ev is None:
                continue
            changes.append(("travel_event", ev.id, "delete", plans_api._event_to_dict(ev), None))
            db.delete(ev)
        else:
            ev = db.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(o["event_id"])).first()
            before = plans_api._event_to_dict(ev)
            f = o["fields"]
            old_time, old_date = ev.local_start_time, days[str(ev.day_id)].local_date
            if "day_id" in f:
                ev.day_id = uuid.UUID(f["day_id"])
            for k in ("title", "event_type", "is_all_day", "sort_order"):
                if k in f:
                    setattr(ev, k, f[k])
            if "local_start_time" in f or "day_id" in f:
                new_time = f.get("local_start_time", ev.local_start_time)
                ev.local_start_time = new_time
                _apply_time(ev, days[str(ev.day_id)], new_time, old_time, old_date)
            db.flush()
            changes.append(("travel_event", ev.id, "update", before, plans_api._event_to_dict(ev)))
    return changes


# ===================================================================== [Gate G7] FR-019 比較

def _cost_items(db: Session, plan: TravelPlan) -> List[Dict[str, Any]]:
    """予約(取消を除く)・区間・支出(取消を除く)の金額と、紐付く予定。"""
    from app.models.models import EventReservation, Expense, Reservation, TravelSegment

    items: List[Dict[str, Any]] = []
    reservations = db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None),
                                                Reservation.status != "cancelled").all()
    links: Dict[uuid.UUID, Set[str]] = {}
    if reservations:
        for link in db.query(EventReservation).filter(
                EventReservation.reservation_id.in_([r.id for r in reservations])).all():
            links.setdefault(cast(uuid.UUID, link.reservation_id), set()).add(str(link.event_id))
    for r in reservations:
        evs: Set[str] = set(links.get(cast(uuid.UUID, r.id), set()))
        if r.event_id:
            evs.add(str(r.event_id))
        items.append({"kind": "reservation", "id": str(r.id), "label": r.provider_name or r.type or "予約",
                      "status": r.status, "currency": r.currency, "amount": r.total_amount, "event_ids": evs})
    for sg in db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id, TravelSegment.status != "cancelled"):
        evs = {str(x) for x in (sg.from_event_id, sg.to_event_id) if x}
        items.append({"kind": "segment", "id": str(sg.id), "currency": sg.currency, "amount": sg.cost,
                      "event_ids": evs})
    for ex in db.query(Expense).filter(Expense.plan_id == plan.id, Expense.voided_at.is_(None)):
        amount = -ex.amount if ex.kind == "refund" else ex.amount
        evs = {str(ex.related_id)} if ex.related_type == "event" and ex.related_id else set()
        items.append({"kind": "expense", "id": str(ex.id), "currency": ex.currency, "amount": amount,
                      "event_ids": evs})
    return items


def _coords(db: Session, plan: TravelPlan) -> Dict[uuid.UUID, Any]:
    return {cast(uuid.UUID, e.id): (e.latitude, e.longitude)
            for e in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id)}


def _compare(db: Session, plan: TravelPlan, rows: List[ItineraryBranch], role: str, hidden) -> Dict[str, Any]:
    from app.api.v1.movement import evaluation_context
    from app.services import branch_compare as bc
    from app.services import feasibility as fz
    from app.services import optimizer as opt

    snap, cset, titles, owners, rules = evaluation_context(db, plan)
    base = fz.evaluate(snap, cset, titles=titles, unavailable_owners=owners, movement=rules)
    coords = _coords(db, plan)
    show_costs = "costs" not in hidden
    show_res = "reservations" not in hidden
    items = _cost_items(db, plan) if (show_costs or show_res) else []
    # 予約を見せない参加者には、予約の金額も含めない(費用の合計から予約の有無を推測させない)
    cost_items = [i for i in items if i["amount"] is not None and (show_res or i["kind"] != "reservation")]
    plan_cost = bc.costs(cost_items, set()) if show_costs else None
    days = {str(d.id): d for d in snap.days}
    out_branches = []
    for b in rows:
        ops = br.compute_ops(cast(Dict[str, Any], b.base_snapshot), cast(List[Dict[str, Any]], b.content))
        sim, removed = bc.simulate(snap, ops, days)
        # [Gate G8] 案の中の区間・予約の変更も当てた姿で比べる
        res = _resources(b)
        sim = bc.simulate_resources(sim, res)
        b_items = bc.resource_cost_items(items, res)
        b_cost_items = [i for i in b_items if i["amount"] is not None and (show_res or i["kind"] != "reservation")]
        result = fz.evaluate(sim, cset, titles=titles, unavailable_owners=owners, movement=rules)
        new, resolved = opt.diff_findings(base, result)
        new = [f for f in new if not member_policy.validation_issue_hidden(hidden, f.code, f.entity_type)]
        resolved = [f for f in resolved if not member_policy.validation_issue_hidden(hidden, f.code, f.entity_type)]
        cost = bc.costs(b_cost_items, removed) if show_costs else None
        affected = None
        if show_res:
            affected = [{"id": i["id"], "label": i["label"], "status": i["status"],
                         **({"cancel_planned": True} if i.get("cancelled") else {})} for i in b_items
                        if i["kind"] == "reservation"
                        and (i.get("cancelled") or (i["event_ids"] and i["event_ids"] <= removed))]
        assumptions: Dict[str, Any] = cast(Dict[str, Any], b.assumptions) or {}
        cut = assumptions.get("budget_cut_percent") if b.scenario_type == "budget" else None
        out_branches.append({
            "id": str(b.id), "title": b.title, "scenario_type": b.scenario_type, "state": _state(b, db),
            "summary": br.summarize(ops),
            "resource_summary": _resource_summary(res, set(hidden)),
            "conflicts": len(_evaluate(db, plan, b)["conflicts"]) if b.status == "draft" else 0,
            **bc.column(result, bc.travel(sim, coords), cost),
            "new_issues": [bc.finding_out(f) for f in new], "resolved_issues": [bc.finding_out(f) for f in resolved],
            "affected_reservations": affected,
            "budget_target": bc.budget_target(plan_cost["total"], cost["total"], cut)
            if show_costs and cut and plan_cost and cost else None,
        })
    return {
        "plan_id": str(plan.id), "plan_revision": plan.revision, "algorithm_version": bc.ALGORITHM_VERSION,
        "validation_algorithm_version": fz.ALGORITHM_VERSION, "movement_applied": rules is not None,
        "plan": {"title": "本案", **bc.column(base, bc.travel(snap, coords), plan_cost)},
        "branches": out_branches, "costs_hidden": not show_costs, "reservations_hidden": not show_res,
        "can_adopt": role in ("owner", "editor"),
    }


@router.get("/{plan_id}/branches/{branch_id}/comparison", response_model=dict)
def compare_branch(plan_id: str, branch_id: str, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user_or_guest)):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    b = _get(db, plan, branch_id)
    return _compare(db, plan, [b], role, hidden)


@router.get("/{plan_id}/branches-comparison", response_model=dict)
def compare_branches(plan_id: str, ids: str = Query(..., max_length=200), db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    """[Gate G7] FR-019 本案と分岐案(最大3つ、カンマ区切り)を並べて比べる。"""
    from app.services import branch_compare as bc

    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    keys = [k.strip() for k in ids.split(",") if k.strip()]
    if not keys or len(keys) > bc.MAX_BRANCHES or len(set(keys)) != len(keys):
        raise HTTPException(status_code=422, detail={
            "code": "invalid_branch_selection", "message": f"比べる分岐案を1〜{bc.MAX_BRANCHES}つ選んでください"})
    return _compare(db, plan, [_get(db, plan, k) for k in keys], role, hidden)


@router.delete("/{plan_id}/branches/{branch_id}", response_model=dict)
def delete_branch(plan_id: str, branch_id: str, request: Request, db: Session = Depends(get_db),
                  if_match: Optional[str] = Header(None, alias="If-Match"),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    b = _get(db, plan, branch_id)
    _require_if_match(b.revision, if_match)
    b.deleted_at = _now()
    b.revision += 1
    db.commit()
    _audit("branch_deleted", request, current_user, b, {})
    return {"message": "分岐案を削除しました", "revision": b.revision}
