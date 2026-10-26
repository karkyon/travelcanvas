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

権限: 閲覧はviewer以上、作成・編集・採用・削除はeditor以上。監査には件数だけを記録する。
"""
import uuid
from datetime import datetime, time as time_cls, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Set, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
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


def _related_event_ids(db: Session, event_ids: List[uuid.UUID]) -> Set[str]:
    """予約・移動区間・経路候補・リンク・文書などと紐付いている予定(外すと紐付けが失われるもの)。"""
    if not event_ids:
        return set()
    related: Set[str] = set()
    for table in Base.metadata.sorted_tables:
        if table.name == "travel_events":
            continue
        for col in table.columns:
            if any(fk.column.table.name == "travel_events" for fk in col.foreign_keys):
                rows = db.execute(select(col).where(col.in_(event_ids)).distinct()).all()
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


def _evaluate(db: Session, plan: TravelPlan, b: ItineraryBranch) -> Dict[str, Any]:
    ops = br.compute_ops(b.base_snapshot, b.content)
    current_events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    current = {str(e.id): br.event_item(e) for e in current_events}
    day_ids = {str(d.id) for d in db.query(TravelDay.id).filter(TravelDay.plan_id == plan.id).all()}
    removal_ids = [uuid.UUID(o["event_id"]) for o in ops if o["op"] == "remove"]
    conflicts = br.find_conflicts(ops, b.base_snapshot, current, day_ids, _related_event_ids(db, removal_ids))
    return {"ops": ops, "conflicts": conflicts}


def _response(db: Session, plan: TravelPlan, b: ItineraryBranch, user: User, role: str, names: Dict,
              detail: bool) -> Dict[str, Any]:
    ops = br.compute_ops(b.base_snapshot, b.content)
    state = _state(b, db)
    out: Dict[str, Any] = {
        "id": str(b.id), "plan_id": str(b.plan_id), "algorithm_version": br.ALGORITHM_VERSION,
        "title": b.title, "scenario_type": b.scenario_type, "assumptions": b.assumptions,
        "base_revision": b.base_revision, "plan_revision": plan.revision,
        "plan_changed_since_base": plan.revision != b.base_revision,
        "status": b.status, "state": state,
        "created_by_name": names.get(b.created_by_user_id, "メンバー外"),
        "adopted_at": _iso(b.adopted_at),
        "adopted_by_name": names.get(b.adopted_by_user_id) if b.adopted_by_user_id else None,
        "summary": br.summarize(ops),
        "can_edit": role in ("owner", "editor") and b.status == "draft",
        "revision": b.revision, "created_at": _iso(b.created_at), "updated_at": _iso(b.updated_at),
    }
    if detail:
        evaluation = _evaluate(db, plan, b) if b.status == "draft" else {"ops": ops, "conflicts": []}
        out.update({
            "days": b.base_snapshot["days"],
            "content": b.content,
            "ops": evaluation["ops"],
            "conflicts": evaluation["conflicts"],
            "day_counts": br.day_counts(b.base_snapshot, b.content),
        })
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
        b.content = br.validate_content([i.model_dump() for i in payload.events], b.base_snapshot)
    except br.BranchError as e:
        raise HTTPException(status_code=422, detail=str(e))
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


@router.post("/{plan_id}/branches/{branch_id}/adopt", response_model=dict)
def adopt_branch(plan_id: str, branch_id: str, request: Request, db: Session = Depends(get_db),
                 if_match: Optional[str] = Header(None, alias="If-Match"),
                 current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    b = _get(db, plan, branch_id)
    _require_if_match(b.revision, if_match)
    if b.status != "draft":
        raise HTTPException(status_code=409, detail="採用・破棄した分岐案は採用できません")
    evaluation = _evaluate(db, plan, b)
    ops, conflicts = evaluation["ops"], evaluation["conflicts"]
    if conflicts:
        raise HTTPException(status_code=409, detail={
            "code": "branch_conflict",
            "message": "本案と食い違う変更があるため採用できません。分岐案を直してから採用してください",
            "conflicts": conflicts,
        })
    if not ops:
        raise HTTPException(status_code=409, detail={"code": "no_changes", "message": "本案からの変更がありません"})

    changes = apply_ops(db, plan, ops)
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
    _audit("branch_adopted", request, current_user, b, {"plan_revision": new_revision, **br.summarize(ops)})
    return {"branch": _response(db, plan, b, current_user, role, _names(db, [b]), detail=True),
            "plan_revision": new_revision}


def apply_ops(db: Session, plan: TravelPlan, ops: List[Dict[str, Any]]) -> List[tuple]:
    """差分(ops)を本案の予定へ当て、変更セット用の (entity_type, id, action, before, after) を返す。
    [Gate P10] 再計画の承認(app/api/v1/replans.py)でも同じ処理を使うため関数に切り出した。"""
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
        result = fz.evaluate(sim, cset, titles=titles, unavailable_owners=owners, movement=rules)
        new, resolved = opt.diff_findings(base, result)
        new = [f for f in new if not member_policy.validation_issue_hidden(hidden, f.code, f.entity_type)]
        resolved = [f for f in resolved if not member_policy.validation_issue_hidden(hidden, f.code, f.entity_type)]
        cost = bc.costs(cost_items, removed) if show_costs else None
        affected = None
        if show_res:
            affected = [{"id": i["id"], "label": i["label"], "status": i["status"]} for i in items
                        if i["kind"] == "reservation" and i["event_ids"] and i["event_ids"] <= removed]
        assumptions: Dict[str, Any] = cast(Dict[str, Any], b.assumptions) or {}
        cut = assumptions.get("budget_cut_percent") if b.scenario_type == "budget" else None
        out_branches.append({
            "id": str(b.id), "title": b.title, "scenario_type": b.scenario_type, "state": _state(b, db),
            "summary": br.summarize(ops),
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
