"""
[Gate G8] FR-021・FR-039 旅行の所有者の移譲(DOC-04 SC-18、DOC-11 §3「共有権限・削除は最近の認証を要求」)。

エンドポイント:
- GET  /plans/{plan_id}/ownership-transfer         : 手続き中の移譲と、移譲できる相手(所有者)/自分あての申し出(受け取る人)
- POST /plans/{plan_id}/ownership-transfer         : 所有者がパスワードで本人確認して申し出る(参加済みの会員の共同編集者へ)
- POST /plans/{plan_id}/ownership-transfer/cancel  : 所有者が取り下げる
- GET  /ownership-transfers/incoming               : 自分あての手続き中の申し出(期限内)
- POST /ownership-transfers/{id}/accept            : 受け取る人がパスワードで本人確認して受け入れる(ここで所有者が替わる)
- POST /ownership-transfers/{id}/decline           : 受け取る人が断る

決まり:
- 旅行ごとに手続き中は1件(DB の部分の一意の索引)。期限(OWNERSHIP_TRANSFER_DAYS、既定7日)を過ぎた申し出は受け入れられず、
  次の申し出の時に取り下げとして閉じる
- 手続き中は旅行の削除と、受け取る人を共同編集者から外すことを止める(409 ownership_transfer_pending)
- 受け入れの時に、旅行の所有者がまだ申し出た人であること・受け取る人がまだ参加していることを確かめ直す(行を固定して)
- 前の所有者は選んだ役割(editor / viewer)の共同編集者として残るか、外れる(none)
- 旅行の中身は旅行のデータ鍵で暗号化されているため、移譲で暗号を掛け直す必要は無い
- 監査には ID・役割・結果だけを残す(メールアドレス・旅行名・メッセージは残さない)
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import auth_manager, get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import PlanCollaborator, PlanOwnershipTransfer, TravelPlan, User
from app.services import notify
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(tags=["ownership"])
KEEP_ROLES = ("editor", "viewer", "none")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def transfer_days() -> int:
    return max(1, int(getattr(settings, "OWNERSHIP_TRANSFER_DAYS", 7) or 7))


def _expired(t: PlanOwnershipTransfer, now: Optional[datetime] = None) -> bool:
    exp = _aware(cast(Optional[datetime], t.expires_at))
    return exp is not None and exp <= (now or _now())


def pending_for(db: Session, plan_id: Any) -> Optional[PlanOwnershipTransfer]:
    """手続き中で期限内の移譲(無ければ None)。他の画面(削除・共同編集者を外す)の止めにも使う。"""
    t = db.query(PlanOwnershipTransfer).filter(PlanOwnershipTransfer.plan_id == plan_id,
                                               PlanOwnershipTransfer.status == "pending").first()
    if t is None or _expired(t):
        return None
    return t


def pending_error() -> HTTPException:
    return HTTPException(status_code=409, detail={
        "code": "ownership_transfer_pending",
        "message": "所有者の移譲の手続き中です。移譲を取り下げるか、相手が受け入れる・断るまでお待ちください"})


def _audit(request: Request, user: User, action: str, t: PlanOwnershipTransfer, extra: Optional[Dict] = None):
    record_audit_event(
        action=action, resource_type="plan_ownership_transfer", user_id=user.id, resource_id=t.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details={"plan_id": str(t.plan_id), "keep_role": t.keep_role, **(extra or {})},
    )


def _reauth(request: Request, user: Any, password: Optional[str], purpose: str) -> None:
    if not user.hashed_password or user.user_type == "guest":
        raise HTTPException(status_code=403, detail={
            "code": "registered_only", "message": "所有者の移譲は会員登録したアカウントだけが使えます"})
    if not check_rate_limit(f"reauth:{user.id}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited", "message": "確認の回数が上限に達しました。しばらく待ってから再試行してください"})
    if not password or not auth_manager.verify_password(password, user.hashed_password):
        record_audit_event(action="reauth_failed", resource_type="user", user_id=user.id, resource_id=user.id,
                           ip_address=request.client.host if request.client else None, details={"purpose": purpose})
        raise HTTPException(status_code=403, detail={"code": "reauth_failed", "message": "パスワードが正しくありません"})


def _db_user(db: Session, current: User) -> User:
    user = db.query(User).filter(User.id == current.id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="アカウントが見つかりません")
    return user


def _name(user: Optional[User]) -> str:
    return cast(str, (user.username if user is not None and user.username else None) or "メンバー")


def _eligible(db: Session, plan: TravelPlan) -> List[Dict[str, Any]]:
    """移譲できる相手: 参加済み(accepted)・会員(ゲストでない)・有効・削除の申し込み中でない共同編集者。"""
    out = []
    rows = (db.query(PlanCollaborator, User).join(User, User.id == PlanCollaborator.user_id)
            .filter(PlanCollaborator.plan_id == plan.id, PlanCollaborator.status == "accepted").all())
    for c, u in rows:
        if u.id == plan.user_id or not u.is_active or u.user_type == "guest" or not u.hashed_password:
            continue
        if u.deletion_due_at is not None:
            continue
        out.append({"collaborator_id": str(c.id), "name": _name(u), "role": c.role})
    return out


def _view(db: Session, t: PlanOwnershipTransfer, me: User) -> Dict[str, Any]:
    users = {u.id: u for u in db.query(User).filter(User.id.in_([t.from_user_id, t.to_user_id])).all()}
    return {
        "id": str(t.id), "plan_id": str(t.plan_id), "status": t.status if not (t.status == "pending" and _expired(t))
        else "expired",
        "from_name": _name(users.get(t.from_user_id)), "to_name": _name(users.get(t.to_user_id)),
        "keep_role": t.keep_role, "message": t.message if me.id in (t.from_user_id, t.to_user_id) else None,
        "expires_at": cast(datetime, _aware(cast(datetime, t.expires_at))).isoformat(),
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "responded_at": t.responded_at.isoformat() if t.responded_at else None,
        "is_recipient": me.id == t.to_user_id, "is_sender": me.id == t.from_user_id,
    }


class TransferCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    collaborator_id: str = Field(..., max_length=64)
    password: str = Field(..., min_length=1, max_length=200)
    keep_role: str = "editor"
    message: Optional[str] = Field(None, max_length=500)

    @field_validator("keep_role")
    @classmethod
    def _v_keep(cls, v):
        if v not in KEEP_ROLES:
            raise ValueError(f"keep_role は {list(KEEP_ROLES)} のどれかです")
        return v


class PasswordBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(..., min_length=1, max_length=200)


@router.get("/plans/{plan_id}/ownership-transfer", response_model=dict)
def get_transfer(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    t = (db.query(PlanOwnershipTransfer).filter(PlanOwnershipTransfer.plan_id == plan.id,
                                                PlanOwnershipTransfer.status == "pending").first())
    visible = t is not None and current_user.id in (t.from_user_id, t.to_user_id)
    return {
        "plan_id": str(plan.id), "role": role,
        "pending": _view(db, t, current_user) if visible and t is not None else None,
        "transfer_in_progress": t is not None and not _expired(t),
        "candidates": _eligible(db, plan) if role == "owner" else [],
        "can_transfer": role == "owner" and current_user.user_type != "guest" and bool(current_user.hashed_password),
        "transfer_days": transfer_days(),
    }


@router.post("/plans/{plan_id}/ownership-transfer", status_code=201, response_model=dict)
def create_transfer(plan_id: str, payload: TransferCreate, request: Request, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")
    me = _db_user(db, current_user)
    _reauth(request, me, payload.password, "ownership_transfer")
    try:
        cid = uuid.UUID(payload.collaborator_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="相手の指定が正しくありません")
    eligible = {c["collaborator_id"] for c in _eligible(db, plan)}
    collab = db.query(PlanCollaborator).filter(PlanCollaborator.id == cid, PlanCollaborator.plan_id == plan.id).first()
    if collab is None or str(cid) not in eligible:
        raise HTTPException(status_code=422, detail={
            "code": "not_eligible",
            "message": "移譲できるのは、参加済みの会員の共同編集者だけです(招待中・ゲスト・削除の申し込み中の人は選べません)"})
    old: Any = (db.query(PlanOwnershipTransfer)
                .filter(PlanOwnershipTransfer.plan_id == plan.id, PlanOwnershipTransfer.status == "pending").first())
    if old is not None:
        if not _expired(old):
            raise pending_error()
        old.status = "cancelled"  # 期限切れの申し出を閉じる
        old.responded_at = _now()
        db.flush()
    t = PlanOwnershipTransfer(
        id=uuid.uuid4(), plan_id=plan.id, from_user_id=me.id, to_user_id=collab.user_id, status="pending",
        keep_role=payload.keep_role, message=(payload.message or "").strip() or None,
        expires_at=_now() + timedelta(days=transfer_days()),
    )
    db.add(t)
    notify.deliver(db, plan, [cast(uuid.UUID, collab.user_id)], "ownership_transfer", "旅行の所有者の移譲の申し出",
                   f"{_name(me)} さんから「{plan.title}」の所有者を引き継ぐ申し出が届きました。お知らせの画面で受け入れるか"
                   f"断ってください(期限 {transfer_days()} 日)。", target_type="plan", target_id=cast(uuid.UUID, plan.id),
                   direct_ids=[cast(uuid.UUID, collab.user_id)])
    db.commit()
    db.refresh(t)
    _audit(request, me, "plan_ownership_transfer_requested", t)
    return _view(db, t, me)


@router.post("/plans/{plan_id}/ownership-transfer/cancel", response_model=dict)
def cancel_transfer(plan_id: str, request: Request, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")
    t: Any = db.query(PlanOwnershipTransfer).filter(PlanOwnershipTransfer.plan_id == plan.id,
                                                    PlanOwnershipTransfer.status == "pending").first()
    if t is None:
        raise HTTPException(status_code=404, detail="手続き中の移譲はありません")
    t.status = "cancelled"
    t.responded_at = _now()
    db.commit()
    _audit(request, current_user, "plan_ownership_transfer_cancelled", t)
    return _view(db, t, current_user)


def _incoming(db: Session, user: User) -> List[PlanOwnershipTransfer]:
    rows = (db.query(PlanOwnershipTransfer).join(TravelPlan, TravelPlan.id == PlanOwnershipTransfer.plan_id)
            .filter(PlanOwnershipTransfer.to_user_id == user.id, PlanOwnershipTransfer.status == "pending",
                    TravelPlan.deleted_at.is_(None))
            .order_by(PlanOwnershipTransfer.created_at.desc()).all())
    return [t for t in rows if not _expired(t)]


@router.get("/ownership-transfers/incoming", response_model=List[dict])
def list_incoming(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    out = []
    for t in _incoming(db, current_user):
        plan = db.query(TravelPlan).filter(TravelPlan.id == t.plan_id).first()
        out.append({**_view(db, t, current_user), "plan_title": plan.title if plan else None})
    return out


def _get_incoming(db: Session, transfer_id: str, user: User) -> Any:
    try:
        tid = uuid.UUID(transfer_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="申し出が見つかりません")
    t: Any = (db.query(PlanOwnershipTransfer)
              .filter(PlanOwnershipTransfer.id == tid, PlanOwnershipTransfer.to_user_id == user.id)
              .with_for_update().first())
    if t is None:
        raise HTTPException(status_code=404, detail="申し出が見つかりません")
    if t.status != "pending":
        raise HTTPException(status_code=409, detail={"code": "transfer_closed", "message": "この申し出は既に閉じています"})
    if _expired(t):
        raise HTTPException(status_code=410, detail={"code": "transfer_expired",
                                                     "message": "申し出の期限が過ぎています。所有者にもう一度申し出てもらってください"})
    return t


@router.post("/ownership-transfers/{transfer_id}/accept", response_model=dict)
def accept_transfer(transfer_id: str, payload: PasswordBody, request: Request, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)):
    me = _db_user(db, current_user)
    _reauth(request, me, payload.password, "ownership_transfer_accept")
    t = _get_incoming(db, transfer_id, me)
    plan: Any = (db.query(TravelPlan).filter(TravelPlan.id == t.plan_id, TravelPlan.deleted_at.is_(None))
                 .with_for_update().first())
    mine = None
    if plan is not None:
        mine = db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id,
                                                 PlanCollaborator.user_id == me.id,
                                                 PlanCollaborator.status == "accepted").first()
    if plan is None or plan.user_id != t.from_user_id or mine is None or me.deletion_due_at is not None:
        t.status = "cancelled"
        t.responded_at = _now()
        db.commit()
        raise HTTPException(status_code=409, detail={
            "code": "transfer_invalidated",
            "message": "旅行の所有者・参加の状態が変わったため、この申し出は無効になりました"})
    previous = db.query(User).filter(User.id == t.from_user_id).first()
    from app.services import plan_item_deletion

    plan_item_deletion.detach_collaborator_references(db, mine.id)
    db.delete(mine)
    db.flush()
    plan.user_id = me.id
    if t.keep_role in ("editor", "viewer") and previous is not None:
        db.add(PlanCollaborator(id=uuid.uuid4(), plan_id=plan.id, user_id=previous.id,
                                email=previous.email or f"{previous.id.hex[:8]}@invalid.local", role=t.keep_role,
                                status="accepted", decided_at=_now()))
    t.status = "accepted"
    t.responded_at = _now()
    if previous is not None:
        notify.deliver(db, plan, [cast(uuid.UUID, previous.id)], "ownership_transfer", "所有者の移譲が完了しました",
                       f"{_name(me)} さんが「{plan.title}」の所有者を引き継ぎました。", target_type="plan",
                       target_id=cast(uuid.UUID, plan.id), direct_ids=[cast(uuid.UUID, previous.id)])
    db.commit()
    _audit(request, me, "plan_ownership_transferred", t)
    return _view(db, t, me)


@router.post("/ownership-transfers/{transfer_id}/decline", response_model=dict)
def decline_transfer(transfer_id: str, request: Request, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    me = _db_user(db, current_user)
    t = _get_incoming(db, transfer_id, me)
    t.status = "declined"
    t.responded_at = _now()
    plan = db.query(TravelPlan).filter(TravelPlan.id == t.plan_id).first()
    notify.deliver(db, plan, [cast(uuid.UUID, t.from_user_id)], "ownership_transfer", "所有者の移譲が断られました",
                   f"{_name(me)} さんが所有者の移譲の申し出を断りました。", target_type="plan",
                   target_id=cast(uuid.UUID, t.plan_id), direct_ids=[cast(uuid.UUID, t.from_user_id)])
    db.commit()
    _audit(request, me, "plan_ownership_transfer_declined", t)
    return _view(db, t, me)


def close_for_user(db: Session, user_id: Any) -> int:
    """アカウントを削除する時、その人が申し出た・受け取る手続き中の移譲を取り下げにする(呼出側が commit)。"""
    rows: List[Any] = db.query(PlanOwnershipTransfer).filter(
        PlanOwnershipTransfer.status == "pending",
        (PlanOwnershipTransfer.from_user_id == user_id) | (PlanOwnershipTransfer.to_user_id == user_id)).all()
    for t in rows:
        t.status = "cancelled"
        t.responded_at = _now()
    return len(rows)
