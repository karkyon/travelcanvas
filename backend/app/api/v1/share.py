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
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.core.plan_access import require_plan_access
from app.models.models import Notification, PlanCollaborator, PlanShareLink, TravelPlan, User

router = APIRouter(prefix="/travel-plans", tags=["share"])


def _get_owned_plan(db: Session, plan_id: uuid.UUID, user: User) -> TravelPlan:
    """共有リンク・コラボレーターの管理操作(作成/更新/失効/削除/招待)は
    ownerのみに許可する(editor/viewerには許可しない)。"""
    plan, _role = require_plan_access(db, plan_id, user, min_role="owner")
    return plan


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _share_link_to_dict(share: PlanShareLink, raw_token: Optional[str] = None) -> dict:
    """[Gate #30] tokenの生値はDBに保存していないため、生成直後の
    レスポンス(raw_tokenが渡された場合)でのみ完全なURLを返す。それ以外
    (一覧・更新後の再取得)ではtoken_prefixのみを返し、生値は二度と
    再現しない(トークン漏洩時の影響範囲を最小化するための意図的な設計)。
    """
    now = datetime.now(timezone.utc)
    is_expired = bool(share.expires_at and share.expires_at <= now)
    is_exhausted = bool(share.max_uses is not None and share.use_count >= share.max_uses)
    return {
        "id": str(share.id),
        "plan_id": str(share.plan_id),
        "url": f"/s/{raw_token}" if raw_token else None,
        "token_prefix": share.token_prefix,
        "permission": share.permission,
        "has_passcode": share.passcode_hash is not None,
        "max_uses": share.max_uses,
        "use_count": share.use_count,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None,
        "is_active": not (share.revoked_at or is_expired or is_exhausted),
        "created_at": share.created_at.isoformat() if share.created_at else None,
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
    }


# ===== 共有リンク =====

@router.post("/{plan_id}/share")
async def create_share_link(
    plan_id: uuid.UUID,
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
    )
    db.add(share)
    db.commit()
    db.refresh(share)

    return _share_link_to_dict(share, raw_token=raw_token)


@router.get("/{plan_id}/share")
async def list_share_links(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    shares = db.query(PlanShareLink).filter(PlanShareLink.plan_id == plan.id).all()
    return [_share_link_to_dict(s) for s in shares]


@router.put("/{plan_id}/share/{share_id}")
async def update_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    share = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
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

    db.commit()
    db.refresh(share)
    return _share_link_to_dict(share)


@router.post("/{plan_id}/share/{share_id}/revoke")
async def revoke_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate #30] ownerが共有リンクを即時失効させる。削除(DELETE)と異なり
    レコード自体は監査目的で残す。"""
    plan = _get_owned_plan(db, plan_id, current_user)
    share = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共有リンクが見つかりません")

    share.revoked_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(share)
    return _share_link_to_dict(share)


@router.delete("/{plan_id}/share/{share_id}")
async def delete_share_link(
    plan_id: uuid.UUID,
    share_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    share = db.query(PlanShareLink).filter(PlanShareLink.id == share_id, PlanShareLink.plan_id == plan.id).first()
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="共有リンクが見つかりません")

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
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    plan = _get_owned_plan(db, plan_id, current_user)
    collab = (
        db.query(PlanCollaborator)
        .filter(PlanCollaborator.id == collaborator_id, PlanCollaborator.plan_id == plan.id)
        .first()
    )
    if not collab:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="コラボレーターが見つかりません")

    db.delete(collab)
    db.commit()
    return {"success": True}


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
    if not collab or collab.email != current_user.email:
        # 他人宛の招待IDを推測されてもstatusを変更できないよう、存在有無を
        # 問わず同一の404で応答する(IDOR対策)。
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
    if not collab or collab.email != current_user.email:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="招待が見つかりません")
    if collab.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="この招待は既に処理済みです")

    collab.status = "declined"
    collab.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(collab)
    return _collaborator_to_dict(collab)
