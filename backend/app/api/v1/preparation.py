"""
[Gate P1] FR-025 持ち物 / FR-026 準備タスク・レディネス(DOC-02 FR-025・FR-026 / DOC-05 §8.5)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET  /members                         : 担当者の選択肢(所有者+承諾済みの共同編集者)。viewer以上
- GET/POST /packing-items               : 持ち物の一覧・追加
- PATCH/DELETE /packing-items/{id}      : 持ち物の変更・削除(If-Match = 持ち物のrevision)
- GET  /packing-suggestions             : 旅程と条件から作る持ち物の候補(追加・不要・数量変更)
- GET/POST /preparation-tasks           : 準備タスクの一覧・追加
- PATCH/DELETE /preparation-tasks/{id}  : 準備タスクの変更・削除(If-Match = タスクのrevision)
- GET  /readiness                       : 準備状況(未予約・未確認・未支払・期限・未割当・持ち物不足)

権限:
- 共有の持ち物・タスクの作成/変更/削除: editor以上
- 個人の持ち物(scope=personal): 作成者本人だけが見え、変更・削除できる(viewerでも自分の分は作れる)
- 担当者は(viewerであっても)自分が担当する共有の持ち物の状態・タスクの完了状態だけを変更できる
- 閲覧: viewer以上

個人の持ち物は名前・メモを暗号化して保存し(FC-070 薬・健康用品は本人限定)、他のメンバーには
一覧にも件数にも出さない。監査ログには名前・メモ・説明を記録しない。
"""
import json
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.crypto import EncryptionNotConfigured, decrypt_payload, encrypt_payload
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    Document,
    PackingItem,
    PlanCollaborator,
    PreparationTask,
    Reservation,
    TravelEvent,
    TravelPlan,
    TravelSegment,
    User,
)
from app.services import packing_suggestions, readiness
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import member_user_ids

router = APIRouter(prefix="/plans", tags=["preparation"])

PACKING_CATEGORIES = ("clothing", "toiletries", "health", "documents", "electronics", "money", "gear", "other")
PACKING_STATUSES = {"to_prepare", "to_buy", "packed", "after_use"}
PACKING_SCOPES = {"shared", "personal"}
TASK_STATUSES = {"open", "done"}
RELATED_TYPES = {"event", "reservation", "segment", "document", "packing_item"}


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _strip_or_none(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


# ===== スキーマ =====

class PackingItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=120)
    note: Optional[str] = Field(None, max_length=500)
    category: str = "other"
    quantity: int = Field(1, ge=1, le=999)
    is_required: bool = False
    status: str = "to_prepare"
    scope: str = "shared"
    assignee_user_id: Optional[str] = None
    suggestion_key: Optional[str] = Field(None, max_length=40)

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("nameを入力してください")
        return v

    @field_validator("category")
    @classmethod
    def _v_category(cls, v):
        if v not in PACKING_CATEGORIES:
            raise ValueError(f"category must be one of {list(PACKING_CATEGORIES)}")
        return v

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v not in PACKING_STATUSES:
            raise ValueError(f"status must be one of {sorted(PACKING_STATUSES)}")
        return v

    @field_validator("scope")
    @classmethod
    def _v_scope(cls, v):
        if v not in PACKING_SCOPES:
            raise ValueError(f"scope must be one of {sorted(PACKING_SCOPES)}")
        return v


class PackingItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(None, min_length=1, max_length=120)
    note: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = None
    quantity: Optional[int] = Field(None, ge=1, le=999)
    is_required: Optional[bool] = None
    status: Optional[str] = None
    assignee_user_id: Optional[str] = None

    @field_validator("category")
    @classmethod
    def _v_category(cls, v):
        if v is not None and v not in PACKING_CATEGORIES:
            raise ValueError(f"category must be one of {list(PACKING_CATEGORIES)}")
        return v

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v is not None and v not in PACKING_STATUSES:
            raise ValueError(f"status must be one of {sorted(PACKING_STATUSES)}")
        return v


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    completion_criteria: Optional[str] = Field(None, max_length=500)
    due_at: Optional[datetime] = None
    assignee_user_id: Optional[str] = None
    related_type: Optional[str] = None
    related_id: Optional[str] = None
    readiness_key: Optional[str] = Field(None, max_length=80)

    @field_validator("title")
    @classmethod
    def _v_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("titleを入力してください")
        return v

    @field_validator("due_at")
    @classmethod
    def _v_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v

    @field_validator("related_type")
    @classmethod
    def _v_related(cls, v):
        if v is not None and v not in RELATED_TYPES:
            raise ValueError(f"related_type must be one of {sorted(RELATED_TYPES)}")
        return v


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    completion_criteria: Optional[str] = Field(None, max_length=500)
    due_at: Optional[datetime] = None
    assignee_user_id: Optional[str] = None
    status: Optional[str] = None

    @field_validator("due_at")
    @classmethod
    def _v_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v is not None and v not in TASK_STATUSES:
            raise ValueError(f"status must be one of {sorted(TASK_STATUSES)}")
        return v


# ===== 共通 =====

def _parse_uuid(raw: Optional[str], label: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{label}の形式が不正です")


def _resolve_assignee(raw: Optional[str], members: Set[uuid.UUID]) -> Optional[uuid.UUID]:
    if raw is None or str(raw).strip() == "":
        return None
    uid = _parse_uuid(raw, "assignee_user_id")
    if uid not in members:
        raise HTTPException(status_code=422, detail="担当者はこのプランのメンバーから選んでください")
    return uid


def _require_if_match(revision: int, if_match: Optional[str], label: str) -> None:
    if if_match is None or if_match.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)",
        )
    try:
        expected = int(if_match.strip().strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{label}が他の変更で更新されています(現在のリビジョン: {revision})",
        )


def _audit(action: str, resource_type: str, request: Request, user: User, resource_id, plan_id,
           details: Optional[Dict[str, Any]] = None) -> None:
    record_audit_event(
        action=action,
        resource_type=resource_type,
        user_id=user.id,
        resource_id=resource_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # 名前・メモ・説明(個人的な内容になり得る本文)は記録しない
        details={"plan_id": str(plan_id), **(details or {})},
    )


def _names(db: Session, ids) -> Dict[uuid.UUID, str]:
    ids = {i for i in ids if i}
    return readiness.member_names(db, ids)


# ===== 個人の持ち物の暗号化 =====

def _encrypt_personal(name: str, note: Optional[str]) -> bytes:
    try:
        return encrypt_payload(json.dumps({"name": name, "note": note}, ensure_ascii=False).encode("utf-8"))
    except EncryptionNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="個人の持ち物の暗号化が設定されていません(サーバー側のENCRYPTION_KEY未設定)",
        )


def _decrypt_personal(item: PackingItem) -> Optional[Dict[str, Any]]:
    if not item.payload_ciphertext:
        return None
    try:
        data = json.loads(decrypt_payload(item.payload_ciphertext).decode("utf-8"))
    except (EncryptionNotConfigured, ValueError):
        return None
    return data if isinstance(data, dict) else None


# ===== メンバー =====

@router.get("/{plan_id}/members", response_model=List[dict])
def list_members(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    members = member_user_ids(db, plan)
    names = _names(db, members)
    roles = {plan.user_id: "owner"}
    for uid, role in (
        db.query(PlanCollaborator.user_id, PlanCollaborator.role)
        .filter(PlanCollaborator.plan_id == plan.id, PlanCollaborator.status == "accepted",
                PlanCollaborator.user_id.isnot(None))
        .all()
    ):
        roles.setdefault(uid, role)
    out = [
        {"user_id": str(uid), "name": names.get(uid, "ゲスト"), "role": roles.get(uid, "viewer"),
         "is_me": uid == current_user.id}
        for uid in members
    ]
    rank = {"owner": 0, "editor": 1, "viewer": 2}
    out.sort(key=lambda m: (rank.get(m["role"], 3), m["name"]))
    return out


# ===== 持ち物 =====

def _packing_query(db: Session, plan: TravelPlan):
    return db.query(PackingItem).filter(PackingItem.plan_id == plan.id, PackingItem.deleted_at.is_(None))


def _visible_to(item: PackingItem, user: User) -> bool:
    return item.scope == "shared" or item.owner_user_id == user.id


def _get_item_or_404(db: Session, plan: TravelPlan, item_id: str, user: User) -> PackingItem:
    try:
        iid = uuid.UUID(str(item_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="持ち物が見つかりません")
    item = _packing_query(db, plan).filter(PackingItem.id == iid).first()
    # 他人の個人の持ち物は存在自体を漏らさない
    if not item or not _visible_to(item, user):
        raise HTTPException(status_code=404, detail="持ち物が見つかりません")
    return item


def _packing_response(item: PackingItem, viewer: User, members: Set[uuid.UUID],
                      names: Dict[uuid.UUID, str]) -> Dict[str, Any]:
    if item.scope == "personal":
        data = _decrypt_personal(item)
        name, note = (data or {}).get("name"), (data or {}).get("note")
        visibility = "full" if data is not None else "unavailable"
    else:
        name, note, visibility = item.name, item.note, "full"
    assignee = item.assignee_user_id
    is_member = assignee in members if assignee else False
    return {
        "id": str(item.id),
        "plan_id": str(item.plan_id),
        "scope": item.scope,
        "is_mine": item.owner_user_id == viewer.id,
        "visibility": visibility,
        "name": name,
        "note": note,
        "category": item.category,
        "quantity": item.quantity,
        "is_required": item.is_required,
        "status": item.status,
        "source": item.source,
        "suggestion_key": item.suggestion_key,
        "assignee_user_id": str(assignee) if is_member else None,
        "assignee_name": names.get(assignee) if is_member else None,
        "assignee_missing": bool(assignee) and not is_member,
        "revision": item.revision,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _sorted_items(items: List[PackingItem]) -> List[PackingItem]:
    order = {c: i for i, c in enumerate(PACKING_CATEGORIES)}
    return sorted(items, key=lambda p: (order.get(p.category, 99), p.created_at or _now(), str(p.id)))


@router.get("/{plan_id}/packing-items", response_model=List[dict])
def list_packing_items(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    members = member_user_ids(db, plan)
    items = [p for p in _packing_query(db, plan).all() if _visible_to(p, current_user)]
    names = _names(db, [p.assignee_user_id for p in items])
    return [_packing_response(p, current_user, members, names) for p in _sorted_items(items)]


@router.post("/{plan_id}/packing-items", status_code=201, response_model=dict)
def create_packing_item(
    plan_id: str,
    payload: PackingItemCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    min_role = "viewer" if payload.scope == "personal" else "editor"
    plan, _role = require_plan_access(db, plan_id, current_user, min_role=min_role)
    members = member_user_ids(db, plan)
    if payload.scope == "personal" and payload.assignee_user_id:
        raise HTTPException(status_code=422, detail="個人の持ち物には担当者を設定できません(本人が用意します)")
    assignee = _resolve_assignee(payload.assignee_user_id, members) if payload.scope == "shared" else None

    key = _strip_or_none(payload.suggestion_key)
    if key is not None and key not in packing_suggestions.RULE_BY_KEY:
        raise HTTPException(status_code=422, detail="不明な候補です(suggestion_key)")
    if key is not None:
        dup = _packing_query(db, plan).filter(PackingItem.suggestion_key == key, PackingItem.scope == payload.scope)
        if payload.scope == "personal":
            dup = dup.filter(PackingItem.owner_user_id == current_user.id)
        if dup.first() is not None:
            raise HTTPException(status_code=409, detail="この候補は既に持ち物に追加されています")

    note = _strip_or_none(payload.note)
    item = PackingItem(
        id=uuid.uuid4(),
        plan_id=plan.id,
        owner_user_id=current_user.id,
        scope=payload.scope,
        assignee_user_id=assignee,
        category=payload.category,
        quantity=payload.quantity,
        is_required=payload.is_required,
        status=payload.status,
        source="suggested" if key else "manual",
        suggestion_key=key,
    )
    if payload.scope == "personal":
        item.payload_ciphertext = _encrypt_personal(payload.name, note)
    else:
        item.name = payload.name
        item.note = note
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="この候補は既に持ち物に追加されています")
    db.refresh(item)
    _audit("packing_item_created", "packing_item", request, current_user, item.id, plan.id,
           {"scope": item.scope, "source": item.source})
    return _packing_response(item, current_user, members, _names(db, [item.assignee_user_id]))


@router.patch("/{plan_id}/packing-items/{item_id}", response_model=dict)
def update_packing_item(
    plan_id: str,
    item_id: str,
    payload: PackingItemUpdate,
    request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    item = _get_item_or_404(db, plan, item_id, current_user)
    members = member_user_ids(db, plan)
    data = payload.model_dump(exclude_unset=True)
    for forbidden_null in ("name", "category", "quantity", "is_required", "status"):
        if forbidden_null in data and data[forbidden_null] is None:
            raise HTTPException(status_code=422, detail=f"{forbidden_null}にnullは指定できません")

    if item.scope == "shared" and role not in ("owner", "editor"):
        # 担当者本人は状態(用意できたか)だけ変更できる
        if not (item.assignee_user_id == current_user.id and set(data) <= {"status"}):
            raise HTTPException(status_code=403, detail="共有の持ち物を変更する権限がありません")
    _require_if_match(item.revision, if_match, "持ち物")

    if item.scope == "personal":
        if "assignee_user_id" in data and data["assignee_user_id"]:
            raise HTTPException(status_code=422, detail="個人の持ち物には担当者を設定できません(本人が用意します)")
        if "name" in data or "note" in data:
            current = _decrypt_personal(item)
            if current is None:
                raise HTTPException(status_code=409, detail="個人の持ち物の内容を復号できないため変更できません")
            name = data["name"].strip() if "name" in data else current.get("name")
            if not name:
                raise HTTPException(status_code=422, detail="nameを入力してください")
            note = _strip_or_none(data["note"]) if "note" in data else current.get("note")
            item.payload_ciphertext = _encrypt_personal(name, note)
    else:
        if "name" in data:
            name = data["name"].strip()
            if not name:
                raise HTTPException(status_code=422, detail="nameを入力してください")
            item.name = name
        if "note" in data:
            item.note = _strip_or_none(data["note"])
        if "assignee_user_id" in data:
            item.assignee_user_id = _resolve_assignee(data["assignee_user_id"], members)
    for field in ("category", "quantity", "is_required", "status"):
        if field in data:
            setattr(item, field, data[field])
    item.revision += 1
    db.commit()
    db.refresh(item)
    _audit("packing_item_updated", "packing_item", request, current_user, item.id, plan.id,
           {"scope": item.scope, "fields": sorted(data)})
    return _packing_response(item, current_user, members, _names(db, [item.assignee_user_id]))


@router.delete("/{plan_id}/packing-items/{item_id}", response_model=dict)
def delete_packing_item(
    plan_id: str,
    item_id: str,
    request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    item = _get_item_or_404(db, plan, item_id, current_user)
    if item.scope == "shared" and role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="共有の持ち物を削除する権限がありません")
    _require_if_match(item.revision, if_match, "持ち物")
    item.deleted_at = _now()
    item.revision += 1
    db.commit()
    _audit("packing_item_deleted", "packing_item", request, current_user, item.id, plan.id, {"scope": item.scope})
    return {"message": "持ち物を削除しました", "revision": item.revision}


@router.get("/{plan_id}/packing-suggestions", response_model=dict)
def get_packing_suggestions(
    plan_id: str,
    overseas: bool = Query(False),
    laundry: bool = Query(False),
    with_children: bool = Query(False),
    takes_medication: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    ctx = packing_suggestions.load_context(
        db, plan, overseas=overseas, laundry=laundry, with_children=with_children,
        takes_medication=takes_medication,
    )
    adopted = []
    for p in _packing_query(db, plan).filter(PackingItem.suggestion_key.isnot(None)).all():
        if not _visible_to(p, current_user):
            continue
        name = p.name if p.scope == "shared" else (_decrypt_personal(p) or {}).get("name")
        adopted.append({"id": str(p.id), "suggestion_key": p.suggestion_key, "name": name,
                        "quantity": p.quantity, "status": p.status})
    return packing_suggestions.build_suggestions(ctx, adopted)


# ===== 準備タスク =====

def _task_query(db: Session, plan: TravelPlan):
    return db.query(PreparationTask).filter(PreparationTask.plan_id == plan.id, PreparationTask.deleted_at.is_(None))


def _get_task_or_404(db: Session, plan: TravelPlan, task_id: str) -> PreparationTask:
    try:
        tid = uuid.UUID(str(task_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="タスクが見つかりません")
    t = _task_query(db, plan).filter(PreparationTask.id == tid).first()
    if not t:
        raise HTTPException(status_code=404, detail="タスクが見つかりません")
    return t


def _related_label(db: Session, plan: TravelPlan, related_type: Optional[str], related_id, viewer: User):
    """(label, missing)。関連先が削除済み・別プランならmissing=True。"""
    if not related_type or not related_id:
        return None, False
    if related_type == "event":
        ev = db.query(TravelEvent).filter(TravelEvent.id == related_id, TravelEvent.plan_id == plan.id).first()
        return (ev.title, False) if ev else (None, True)
    if related_type == "reservation":
        r = db.query(Reservation).filter(Reservation.id == related_id, Reservation.plan_id == plan.id,
                                         Reservation.deleted_at.is_(None)).first()
        return (readiness._reservation_label(r), False) if r else (None, True)
    if related_type == "segment":
        s = db.query(TravelSegment).filter(TravelSegment.id == related_id, TravelSegment.plan_id == plan.id).first()
        return ("移動区間", False) if s else (None, True)
    if related_type == "document":
        d = db.query(Document).filter(Document.id == related_id, Document.plan_id == plan.id,
                                      Document.deleted_at.is_(None)).first()
        return ((d.document_type or "文書"), False) if d else (None, True)
    p = _packing_query(db, plan).filter(PackingItem.id == related_id).first()
    if not p or not _visible_to(p, viewer):
        return None, True
    if p.scope == "personal":
        return (_decrypt_personal(p) or {}).get("name"), False
    return p.name, False


def _task_response(db: Session, plan: TravelPlan, t: PreparationTask, viewer: User, role: str,
                   members: Set[uuid.UUID], names: Dict[uuid.UUID, str]) -> Dict[str, Any]:
    is_member = t.assignee_user_id in members if t.assignee_user_id else False
    label, missing = _related_label(db, plan, t.related_type, t.related_id, viewer)
    due = t.due_at
    if due is not None and due.tzinfo is None:
        due = due.replace(tzinfo=dt_timezone.utc)
    can_edit = role in ("owner", "editor")
    return {
        "id": str(t.id),
        "plan_id": str(t.plan_id),
        "title": t.title,
        "description": t.description,
        "completion_criteria": t.completion_criteria,
        "due_at": _iso(t.due_at),
        "is_overdue": t.status == "open" and due is not None and due < _now(),
        "status": t.status,
        "completed_at": _iso(t.completed_at),
        "completed_by_name": names.get(t.completed_by_user_id) if t.completed_by_user_id else None,
        "assignee_user_id": str(t.assignee_user_id) if is_member else None,
        "assignee_name": names.get(t.assignee_user_id) if is_member else None,
        "assignee_missing": bool(t.assignee_user_id) and not is_member,
        "related_type": t.related_type,
        "related_id": str(t.related_id) if t.related_id else None,
        "related_label": label,
        "related_missing": missing,
        "readiness_key": t.readiness_key,
        "created_by_name": names.get(t.created_by_user_id),
        "can_edit": can_edit,
        "can_complete": can_edit or (is_member and t.assignee_user_id == viewer.id),
        "revision": t.revision,
        "created_at": _iso(t.created_at),
        "updated_at": _iso(t.updated_at),
    }


def _task_names(db: Session, tasks: List[PreparationTask]) -> Dict[uuid.UUID, str]:
    ids = []
    for t in tasks:
        ids += [t.assignee_user_id, t.created_by_user_id, t.completed_by_user_id]
    return _names(db, ids)


def _validate_related(db: Session, plan: TravelPlan, related_type: Optional[str], related_id: Optional[str],
                      viewer: User):
    if related_type is None and related_id is None:
        return None, None
    if related_type is None or related_id is None:
        raise HTTPException(status_code=422, detail="related_typeとrelated_idは両方指定してください")
    rid = _parse_uuid(related_id, "related_id")
    _label, missing = _related_label(db, plan, related_type, rid, viewer)
    if missing:
        raise HTTPException(status_code=422, detail="関連先がこのプラン内に見つかりません")
    return related_type, rid


@router.get("/{plan_id}/preparation-tasks", response_model=List[dict])
def list_tasks(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    members = member_user_ids(db, plan)
    tasks = _task_query(db, plan).all()
    far = datetime.max.replace(tzinfo=dt_timezone.utc)

    def sort_key(t: PreparationTask):
        due = t.due_at
        if due is not None and due.tzinfo is None:
            due = due.replace(tzinfo=dt_timezone.utc)
        return (0 if t.status == "open" else 1, due or far, t.created_at or _now(), str(t.id))

    tasks.sort(key=sort_key)
    names = _task_names(db, tasks)
    return [_task_response(db, plan, t, current_user, role, members, names) for t in tasks]


@router.post("/{plan_id}/preparation-tasks", status_code=201, response_model=dict)
def create_task(
    plan_id: str,
    payload: TaskCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    members = member_user_ids(db, plan)
    assignee = _resolve_assignee(payload.assignee_user_id, members)
    related_type, related_id = _validate_related(db, plan, payload.related_type, payload.related_id, current_user)

    key = _strip_or_none(payload.readiness_key)
    if key is not None:
        current = readiness.compute(db, plan, current_user, decrypt_personal=_decrypt_personal)
        match = next((i for i in current["items"] if i["key"] == key), None)
        if match is None or not match["convertible"]:
            raise HTTPException(status_code=422, detail="指定された準備状況の項目は現在ありません(既に対応済みの可能性があります)")
        if match["task"] is not None:
            raise HTTPException(status_code=409, detail="この項目のタスクは既にあります")
        if related_type is None:
            related_type, related_id = match["entity_type"], uuid.UUID(match["entity_id"])

    t = PreparationTask(
        id=uuid.uuid4(),
        plan_id=plan.id,
        created_by_user_id=current_user.id,
        assignee_user_id=assignee,
        title=payload.title,
        description=_strip_or_none(payload.description),
        completion_criteria=_strip_or_none(payload.completion_criteria),
        due_at=payload.due_at,
        status="open",
        related_type=related_type,
        related_id=related_id,
        readiness_key=key,
    )
    db.add(t)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="この項目のタスクは既にあります")
    db.refresh(t)
    _audit("preparation_task_created", "preparation_task", request, current_user, t.id, plan.id,
           {"from_readiness": key is not None})
    return _task_response(db, plan, t, current_user, role, members, _task_names(db, [t]))


@router.patch("/{plan_id}/preparation-tasks/{task_id}", response_model=dict)
def update_task(
    plan_id: str,
    task_id: str,
    payload: TaskUpdate,
    request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = _get_task_or_404(db, plan, task_id)
    members = member_user_ids(db, plan)
    data = payload.model_dump(exclude_unset=True)
    for forbidden_null in ("title", "status"):
        if forbidden_null in data and data[forbidden_null] is None:
            raise HTTPException(status_code=422, detail=f"{forbidden_null}にnullは指定できません")
    if role not in ("owner", "editor"):
        is_assignee = t.assignee_user_id == current_user.id and current_user.id in members
        if not (is_assignee and set(data) <= {"status"}):
            raise HTTPException(status_code=403, detail="タスクを変更する権限がありません")
    _require_if_match(t.revision, if_match, "タスク")

    if "title" in data:
        title = data["title"].strip()
        if not title:
            raise HTTPException(status_code=422, detail="titleを入力してください")
        t.title = title
    if "description" in data:
        t.description = _strip_or_none(data["description"])
    if "completion_criteria" in data:
        t.completion_criteria = _strip_or_none(data["completion_criteria"])
    if "due_at" in data:
        t.due_at = data["due_at"]
    if "assignee_user_id" in data:
        t.assignee_user_id = _resolve_assignee(data["assignee_user_id"], members)
    if "status" in data and data["status"] != t.status:
        if data["status"] == "done":
            t.status = "done"
            t.completed_at = _now()
            t.completed_by_user_id = current_user.id
        else:
            t.status = "open"
            t.completed_at = None
            t.completed_by_user_id = None
    t.revision += 1
    db.commit()
    db.refresh(t)
    _audit("preparation_task_updated", "preparation_task", request, current_user, t.id, plan.id,
           {"fields": sorted(data), "status": t.status})
    return _task_response(db, plan, t, current_user, role, members, _task_names(db, [t]))


@router.delete("/{plan_id}/preparation-tasks/{task_id}", response_model=dict)
def delete_task(
    plan_id: str,
    task_id: str,
    request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")
    t = _get_task_or_404(db, plan, task_id)
    _require_if_match(t.revision, if_match, "タスク")
    t.deleted_at = _now()
    t.revision += 1
    db.commit()
    _audit("preparation_task_deleted", "preparation_task", request, current_user, t.id, plan.id)
    return {"message": "タスクを削除しました", "revision": t.revision}


# ===== レディネス =====

@router.get("/{plan_id}/readiness", response_model=dict)
def get_readiness(
    plan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_or_guest),
):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return readiness.compute(db, plan, current_user, decrypt_personal=_decrypt_personal)
