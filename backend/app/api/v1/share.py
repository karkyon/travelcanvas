"""
プラン共有・コラボレーターAPI

[Gate #25] backend/app/api/v1/には共有機能のエンドポイントが一切存在せず、
フロントエンド(SharePage.tsx)も間違ったURL(/plans/...、実プレフィックスは
/travel-plans)を叩く作りだった。加えてDBにも共有リンク・コラボレーターを
保持するテーブルが存在しなかった(models.pyにSharePermission enumだけが
定義され、対応するテーブルは無かった)。本Gateで新規テーブル2つを追加する
マイグレーション(既存テーブルへのALTER/DROPなし)を実施した上で、実際に
動作するCRUD APIとして実装する。

注意: メール送信は実装していない。招待はDB上にpending状態のレコードを
作成するのみで、実際のメール通知は行われない(フロントエンド側の表示も
本Gateで「メールは送信されません」という実態に合わせて修正する)。

[Gate #30] 本Gate以前は、招待を承諾する手段(accept API)自体が存在せず、
また owner 以外(accepted な collaborator)がプランへアクセスするための
権限チェックも travel.py/plans.py/ai.py のどこにも実装されていなかった。
本Gateで /invitations/{id}/accept・/decline を追加し、`app.core.plan_access`
経由でcollaboratorの実アクセスを可能にした。また共有トークンの平文DB保存
(監査指摘)を修正し、失効・使用回数上限・パスコードにも対応した。

[Gate F45] FR-045(CA-003)項目単位の共有の規則。作成・更新で見せる項目(fields / preset)を受け取り、
機密(CONFIDENTIAL)は acknowledge_confidential が無いと保存しない。RESTRICTED は 422 で拒む
(app/services/share_policy.py)。所有者は発行前(POST /{plan_id}/share-preview)と発行後
(GET /{plan_id}/share/{share_id}/preview)に、閲覧者に見える内容を使用回数を消費せずに確認できる。
発行・変更・失効・削除を監査へ記録する(トークン・合言葉・内容は残さず、項目名と設定の有無だけ)。
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.core.plan_access import require_plan_access
from app.models.models import (
    Document, Notification, PlanCollaborator, PlanShareLink, Reservation, ShareAccessLog, Ticket, TravelEvent,
    TravelPlan, User,
)
from app.services import member_policy, plan_item_deletion, share_policy, usage
from app.services.audit_service import record_audit_event
from app.api.v1.public_share import build_public_view

router = APIRouter(prefix="/travel-plans", tags=["share"])


def _get_owned_plan(db: Session, plan_id: uuid.UUID, user: User) -> TravelPlan:
    """共有リンク・コラボレーターの管理操作(作成/更新/失効/削除/招待)は
    ownerのみに許可する(editor/viewerには許可しない)。"""
    plan, _role = require_plan_access(db, plan_id, user, min_role="owner")
    return plan


def _plan_is_deleted(db: Session, plan_id) -> bool:
    """[Gate B-012] 論理削除済み(または存在しない)プランか。"""
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()
    return plan is None or plan.deleted_at is not None


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _share_link_to_dict(share: PlanShareLink, raw_token: Optional[str] = None, db: Optional[Session] = None) -> dict:
    """[Gate #30] tokenの生値はDBに保存していないため、生成直後の
    レスポンス(raw_tokenが渡された場合)でのみ完全なURLを返す。それ以外
    (一覧・更新後の再取得)ではtoken_prefixのみを返し、生値は二度と
    再現しない(トークン漏洩時の影響範囲を最小化するための意図的な設計)。

    [Gate #41 / CA-002] 「閲覧回数・最終閲覧日時」の受入条件に対応するため、
    last_accessed_atを追加する。ShareAccessLog(既存、Gate #31.5B)から
    result='success'の最新created_atを引く。dbが渡されない場合(生成直後、
    まだアクセスされ得ない)はNoneのまま返す。
    """
    now = datetime.now(timezone.utc)
    is_expired = bool(share.expires_at and share.expires_at <= now)
    is_exhausted = bool(share.max_uses is not None and share.use_count >= share.max_uses)

    last_accessed_at = None
    if db is not None:
        last_log = (
            db.query(ShareAccessLog)
            .filter(ShareAccessLog.share_id == share.id, ShareAccessLog.result == "success")
            .order_by(ShareAccessLog.created_at.desc())
            .first()
        )
        if last_log and last_log.created_at:
            last_accessed_at = last_log.created_at.isoformat()

    return {
        "id": str(share.id),
        "plan_id": str(share.plan_id),
        "url": f"/s/{raw_token}" if raw_token else None,
        "token_prefix": share.token_prefix,
        "permission": share.permission,
        "has_passcode": share.passcode_hash is not None,
        "max_uses": share.max_uses,
        "use_count": share.use_count,
        "last_accessed_at": last_accessed_at,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
        "is_active": not (share.revoked_at or is_expired or is_exhausted),
        "created_at": share.created_at.isoformat() if share.created_at else None,
        # [Gate F45] 見せる項目(NULL の既存リンクは標準)
        "fields": share_policy.fields_of(share.policy),
        # [Gate G4] COL-05 受け取った人が許可された項目だけを自分の旅行へ複製してよいか / FC-097 失効の理由
        "allow_clone": bool(share.allow_clone),
        "revoked_reason": share.revoked_reason,
    }


def _resolve_policy(payload: dict) -> dict:
    try:
        return share_policy.resolve(payload)
    except share_policy.SharePolicyError as e:
        raise HTTPException(status_code=422, detail=e.detail())


def _audit_share(action: str, request: Request, user: User, share: PlanShareLink, extra: Optional[dict] = None) -> None:
    """[Gate F45] 監査にはトークン・合言葉・プランの内容を残さず、項目名と設定の有無だけを残す。"""
    details = {
        "plan_id": str(share.plan_id),
        "permission": share.permission,
        "fields": share_policy.fields_of(share.policy),
        "has_passcode": share.passcode_hash is not None,
        "has_expiry": share.expires_at is not None,
        "max_uses": share.max_uses,
    }
    details.update(extra or {})
    record_audit_event(
        action=action,
        resource_type="plan_share_link",
        user_id=user.id,
        resource_id=share.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details=details,
    )


def _withheld(db: Session, plan_id, fields: list) -> dict:
    """[Gate F45] 所有者のプレビュー用: 閲覧者に見せない情報の件数(内容は返さない)。"""
    reservations = (
        db.query(Reservation).filter(Reservation.plan_id == plan_id, Reservation.deleted_at.is_(None)).all()
    )
    tickets = (
        db.query(Ticket).join(Reservation, Ticket.reservation_id == Reservation.id)
        .filter(Reservation.plan_id == plan_id, Reservation.deleted_at.is_(None), Ticket.deleted_at.is_(None))
        .count()
    )
    documents = db.query(Document).filter(Document.plan_id == plan_id, Document.deleted_at.is_(None)).count()
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan_id).all()
    return {
        "reservations": 0 if "reservation_summary" in fields else len(reservations),
        "confirmation_numbers": sum(1 for r in reservations if r.confirmation_number_ciphertext is not None),
        "tickets": tickets,
        "documents": documents,
        "exact_locations": sum(1 for e in events if e.latitude is not None and e.longitude is not None),
        "event_addresses": 0 if "event_address" in fields else sum(1 for e in events if e.address),
        "event_notes": 0 if "event_notes" in fields else sum(1 for e in events if e.description),
    }


def _preview(db: Session, plan: TravelPlan, fields: list, permission: str) -> dict:
    return {
        "fields": list(fields),
        "view": build_public_view(db, plan, fields, permission),
        "withheld": _withheld(db, plan.id, fields),
        "catalog": share_policy.catalog(),
    }


def _collaborator_to_dict(collab: PlanCollaborator) -> dict:
    return {
        "id": str(collab.id),
        "user_id": str(collab.user_id) if collab.user_id else "",
        "plan_id": str(collab.plan_id),
        "role": collab.role,
        "email": collab.email,
        "name": None,
        "status": collab.status,
        "decided_at": collab.decided_at.isoformat() if collab.decided_at else None,
        # [Gate G2] FR-045 この参加者だけの項目の規則(null は役割の既定に従う)
        "field_policy_hidden": member_policy.member_override(collab),
    }


# ===== 共有リンク =====

@router.post("/{plan_id}/share")
async def create_share_link(
    plan_id: uuid.UUID,
    request: Request,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """共有リンクを新規発行する。生トークンはこのレスポンスでのみ返す
    (DBにはSHA-256ハッシュのみ保存するため、以降は二度と取得できない)。"""
    plan = _get_owned_plan(db, plan_id, current_user)

    permission = payload.get("permission", "view")
    if permission not in ("view", "edit"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="permissionはview/editのいずれかです")

    expires_at = None
    if payload.get("expires_at"):
        try:
            expires_at = datetime.fromisoformat(str(payload["expires_at"]).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expires_atの形式が不正です")

    max_uses = payload.get("max_uses")
    if max_uses is not None:
        try:
            max_uses = int(max_uses)
            if max_uses < 1:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_usesは1以上の整数です")

    passcode = payload.get("passcode")
    passcode_hash = _hash_token(passcode) if passcode else None
    policy = _resolve_policy(payload)
    allow_clone = payload.get("allow_clone", False)
    if not isinstance(allow_clone, bool):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="allow_cloneは真偽値です")

    raw_token = secrets.token_urlsafe(24)
    share = PlanShareLink(
        id=uuid.uuid4(),
        plan_id=plan.id,
        token_hash=_hash_token(raw_token),
        token_prefix=raw_token[:8],
        permission=permission,
        expires_at=expires_at,
        max_uses=max_uses,
        passcode_hash=passcode_hash,
        policy=policy,
        allow_clone=allow_clone,
    )
    usage.charge(db, "user", plan.user_id, "share_links")  # [Gate G5] BILL-02
    db.add(share)
    db.commit()
    db.refresh(share)
    _audit_share("share_link_created", request, current_user, share)

    return _share_link_to_dict(share, raw_token=raw_token)


@router.post("/{plan_id}/share-preview")
async def preview_share_policy(
    plan_id: uuid.UUID,
    payload: Optional[dict] = Body(None),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate F45] 発行前の共有前プレビュー(所有者のみ)。リンクは作らず、閲覧者に見える内容と、
    見せない情報の件数を返す。入力の検証は発行と同じ(機密は確認が必要、RESTRICTED は 422)。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    payload = payload or {}
    policy = _resolve_policy(payload)
    permission = payload.get("permission", "view")
    if permission not in ("view", "edit"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="permissionはview/editのいずれかです")
    return _preview(db, plan, policy["fields"], permission)


@router.get("/{plan_id}/share/{share_id}/preview")
async def preview_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate F45] 発行済みリンクで閲覧者に見える内容(所有者のみ)。使用回数を消費せず、閲覧記録も残さない。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    share: Any = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共有リンクが見つかりません")
    return _preview(db, plan, share_policy.fields_of(share.policy), share.permission)


@router.get("/{plan_id}/share")
async def list_share_links(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    shares = db.query(PlanShareLink).filter(PlanShareLink.plan_id == plan.id).all()
    return [_share_link_to_dict(s, db=db) for s in shares]


@router.put("/{plan_id}/share/{share_id}")
async def update_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    request: Request,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    share: Any = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共有リンクが見つかりません")

    if "permission" in payload and payload["permission"] is not None:
        if payload["permission"] not in ("view", "edit"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="permissionはview/editのいずれかです")
        share.permission = payload["permission"]

    if "expires_at" in payload:
        if payload["expires_at"]:
            try:
                share.expires_at = datetime.fromisoformat(str(payload["expires_at"]).replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expires_atの形式が不正です")
        else:
            share.expires_at = None

    if "max_uses" in payload:
        if payload["max_uses"] is None:
            share.max_uses = None
        else:
            try:
                max_uses = int(payload["max_uses"])
                if max_uses < 1:
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_usesは1以上の整数です")
            share.max_uses = max_uses

    if "passcode" in payload:
        # 空文字/nullで保護を解除できるようにする。
        share.passcode_hash = _hash_token(payload["passcode"]) if payload["passcode"] else None

    if share_policy.has_policy_input(payload):
        share.policy = _resolve_policy(payload)

    if "allow_clone" in payload:
        if not isinstance(payload["allow_clone"], bool):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="allow_cloneは真偽値です")
        share.allow_clone = payload["allow_clone"]

    db.commit()
    db.refresh(share)
    _audit_share("share_link_updated", request, current_user, share,
                 {"changed": sorted(k for k in payload if k in (
                     "permission", "expires_at", "max_uses", "passcode", "fields", "preset", "allow_clone"))})
    return _share_link_to_dict(share)


@router.post("/{plan_id}/share/{share_id}/revoke")
async def revoke_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate #30] ownerが共有リンクを即時失効させる。削除(DELETE)と異なり
    レコード自体は監査目的で残す。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    share: Any = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共有リンクが見つかりません")

    share.revoked_at = datetime.now(timezone.utc)
    share.revoked_reason = share.revoked_reason or "owner"
    db.commit()
    db.refresh(share)
    _audit_share("share_link_revoked", request, current_user, share)
    return _share_link_to_dict(share)


@router.delete("/{plan_id}/share/{share_id}")
async def delete_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    share: Any = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共有リンクが見つかりません")

    _audit_share("share_link_deleted", request, current_user, share)
    db.delete(share)
    db.commit()
    return {"success": True}


# ===== コラボレーター =====

@router.post("/{plan_id}/collaborators")
async def invite_collaborator(
    plan_id: uuid.UUID,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """コラボレーターを招待する。メール送信は実装していないため、招待された側には
    何も通知されない(pending状態のレコードが作成されるのみ)。"""
    plan = _get_owned_plan(db, plan_id, current_user)

    email = payload.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="emailは必須です")
    role = payload.get("role", "viewer")
    if role not in ("viewer", "editor"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="roleはviewer/editorのいずれかです")

    existing = (
        db.query(PlanCollaborator)
        .filter(PlanCollaborator.plan_id == plan.id, PlanCollaborator.email == email)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="このメールアドレスは既に招待されています")

    invited_user = db.query(User).filter(User.email == email).first()

    collab = PlanCollaborator(
        id=uuid.uuid4(),
        plan_id=plan.id,
        user_id=invited_user.id if invited_user else None,
        email=email,
        role=role,
        status="pending",
        invite_message=payload.get("message"),
    )
    db.add(collab)

    # [Gate #26] 招待先が既存ユーザーであれば通知を作成する。
    # メール送信は実装していないため、招待先が未登録メールアドレスの場合は
    # 通知もメールもどちらも届かない(相手にリンクを直接共有する必要がある)。
    if invited_user:
        notification = Notification(
            id=uuid.uuid4(),
            user_id=invited_user.id,
            type="collaborator_invite",
            title=f"「{plan.title}」に招待されました",
            message=(payload.get("message") or f"{current_user.username}さんから旅行プランへの招待が届いています。").strip(),
            related_plan_id=plan.id,
        )
        db.add(notification)

    db.commit()
    db.refresh(collab)

    return _collaborator_to_dict(collab)


@router.get("/{plan_id}/collaborators")
async def list_collaborators(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    collaborators = db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id).all()
    return [_collaborator_to_dict(c) for c in collaborators]


@router.delete("/{plan_id}/collaborators/{collaborator_id}")
async def remove_collaborator(
    plan_id: uuid.UUID,
    collaborator_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """共同編集者の削除(アクセス取消し)。[Gate B-013] 参加者・チケット担当者に
    割り当てられていると外部キー違反で500になっていた。アクセス取消しは常に成功させ、
    割当だけを外す(参加者・チケット・予約の本体は残す)。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    collab = (
        db.query(PlanCollaborator)
        .filter(PlanCollaborator.id == collaborator_id, PlanCollaborator.plan_id == plan.id)
        .first()
    )
    if not collab:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="コラボレーターが見つかりません")
    # [Gate G8] FR-021 移譲の手続き中は、受け取る人を外さない(先に移譲を取り下げる)
    from app.api.v1 import ownership

    pending = ownership.pending_for(db, plan.id)
    if pending is not None and collab.user_id is not None and pending.to_user_id == collab.user_id:
        raise ownership.pending_error()

    detached = plan_item_deletion.detach_collaborator_references(db, collab.id)
    removed_id = collab.id
    db.delete(collab)
    db.commit()

    # 監査にはメールアドレス等の個人情報を残さず、件数だけを記録する
    record_audit_event(
        action="collaborator_removed",
        resource_type="plan_collaborator",
        user_id=current_user.id,
        resource_id=removed_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        details={"plan_id": str(plan.id), **detached},
    )
    return {"success": True, "detached": detached}


# ===== 招待の承諾・辞退 =====
# [Gate #30] 招待(PlanCollaborator, status="pending")を作成するAPIは
# Gate #25から存在したが、招待された側がそれを承諾/辞退する手段が一切
# 存在しなかった(承諾してもstatusが"accepted"になることはなく、従って
# require_plan_access も永久にこのユーザーを弾き続けていた)。
#
# 注意: これらのrouteは`/{plan_id}/...`パターンと衝突しない(plan_idの
# 位置に来る"invitations"という固定文字列のrouteであり、他のrouteは
# 全てplan_id位置の次に"share"または"collaborators"という別の固定文字列
# を要求するため、パス構造として重複しない)。

@router.get("/invitations")
async def list_my_invitations(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """自分のメールアドレス宛に届いている招待の一覧(pending中心、履歴として
    accepted/declinedも含めて返す)。"""
    invitations = (
        db.query(PlanCollaborator)
        .filter(PlanCollaborator.email == current_user.email)
        .order_by(PlanCollaborator.created_at.desc())
        .all()
    )
    result = []
    for inv in invitations:
        plan = db.query(TravelPlan).filter(TravelPlan.id == inv.plan_id).first()
        if plan is not None and plan.deleted_at is not None:
            continue  # [Gate B-012] 論理削除済みプランへの招待は表示しない
        item = _collaborator_to_dict(inv)
        item["plan_title"] = plan.title if plan else None
        result.append(item)
    return result


@router.post("/invitations/{collaborator_id}/accept")
async def accept_invitation(
    collaborator_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    collab = db.query(PlanCollaborator).filter(PlanCollaborator.id == collaborator_id).first()
    if not collab or collab.email != current_user.email or _plan_is_deleted(db, collab.plan_id):
        # 他人宛の招待IDを推測されてもstatusを変更できないよう、存在有無を
        # 問わず同一の404で応答する(IDOR対策)。論理削除済みプランへの招待も同じ扱い。
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="招待が見つかりません")
    if collab.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="この招待は既に処理済みです")

    collab.status = "accepted"
    collab.user_id = current_user.id
    collab.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(collab)
    return _collaborator_to_dict(collab)


@router.post("/invitations/{collaborator_id}/decline")
async def decline_invitation(
    collaborator_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    collab = db.query(PlanCollaborator).filter(PlanCollaborator.id == collaborator_id).first()
    if not collab or collab.email != current_user.email or _plan_is_deleted(db, collab.plan_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="招待が見つかりません")
    if collab.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="この招待は既に処理済みです")

    collab.status = "declined"
    collab.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(collab)
    return _collaborator_to_dict(collab)
