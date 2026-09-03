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
"""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.models.models import Notification, PlanCollaborator, PlanShareLink, TravelPlan, User

router = APIRouter(prefix="/travel-plans", tags=["share"])


def _get_owned_plan(db: Session, plan_id: uuid.UUID, user: User) -> TravelPlan:
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="旅行プランが見つかりません")
    if plan.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="アクセス権限がありません")
    return plan


def _share_link_to_dict(share: PlanShareLink) -> dict:
    return {
        "id": str(share.id),
        "plan_id": str(share.plan_id),
        "url": f"/share/{share.token}",
        "permission": share.permission,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
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
    }


# ===== 共有リンク =====

@router.post("/{plan_id}/share")
async def create_share_link(
    plan_id: uuid.UUID,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
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

    share = PlanShareLink(
        id=uuid.uuid4(),
        plan_id=plan.id,
        token=secrets.token_urlsafe(16),
        permission=permission,
        expires_at=expires_at,
    )
    db.add(share)
    db.commit()
    db.refresh(share)

    return _share_link_to_dict(share)


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
