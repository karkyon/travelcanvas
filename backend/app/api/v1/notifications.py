"""
通知API

[Gate #26] Header.tsxの通知ベルアイコンは常に赤い未読バッジ(実データと無関係な
固定表示)付きで/notificationsへの導線があったが、遷移先は「開発中です」の
固定表示で、バックエンドにも通知を保持するテーブル・エンドポイントが一切
存在しなかった。notificationsテーブルを新規追加(既存テーブルへのALTER/DROPなし)
した上で、実際に動作するAPIとして実装する。

現時点で通知が作成されるのは以下のイベントのみ:
- コラボレーター招待時、招待先メールアドレスが既存ユーザーのものであれば
  そのユーザーへ通知を作成する(share.py側で呼び出す)。
それ以外のイベント(最適化完了、プラン更新等)からの通知生成は本Gateの
スコープ外(将来の拡張として、必要になった時点で追加する)。
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.models.models import Notification, User

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _notification_to_dict(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "related_plan_id": str(n.related_plan_id) if n.related_plan_id else None,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/")
async def list_notifications(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    unread_only: bool = False,
    limit: int = 50,
):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712
    notifications = query.order_by(Notification.created_at.desc()).limit(min(limit, 100)).all()
    return [_notification_to_dict(n) for n in notifications]


@router.get("/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    count = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
        .scalar()
        or 0
    )
    return {"unread_count": count}


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == current_user.id)
        .first()
    )
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通知が見つかりません")

    notification.is_read = True
    db.commit()
    return {"success": True}


@router.post("/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True})
    )
    db.commit()
    return {"success": True, "updated_count": updated}
