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

[Gate G4] COL-03 通知の設定(GET/PUT /notifications/settings、PUT/DELETE /notifications/settings/plans/{plan_id})、
通知から対象(予定・予約・費用・投票)へ移るリンク(link)、読んでいない通知のまとめ(GET /notifications/digest)。
"""
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.core.plan_access import require_plan_access
from app.models.models import Notification, TravelPlan, User
from app.services import notify
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/notifications", tags=["notifications"])


_COMMENT_TARGETS = ("event", "reservation", "expense")


def _link(n: Notification) -> Optional[str]:
    """[Gate G4] 通知から移る画面(アプリの中のパスだけ)。予定・予約・費用へのコメントは、その対象のコメントの画面。"""
    if not n.related_plan_id:
        return None
    base = "/planner/%s" % n.related_plan_id
    if n.target_type in _COMMENT_TARGETS and n.target_id:
        return "%s/discussion?target=%s&id=%s" % (base, n.target_type, n.target_id)
    if n.target_type in ("poll", "plan") or (n.type or "").startswith(("poll", "comment")):
        return base + "/discussion"
    return base


def _notification_to_dict(n: Notification) -> dict:
    return {
        "target_type": n.target_type,
        "target_id": str(n.target_id) if n.target_id else None,
        "link": _link(n),
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


# ===== [Gate G4] COL-03 通知の設定・まとめ

class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: Optional[str] = Field(None, pattern="^(all|mentions|none)$")
    email_digest: Optional[str] = Field(None, pattern="^(off|daily)$")


class PlanSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: str = Field(..., pattern="^(all|mentions|none)$")


@router.get("/settings")
async def get_settings(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    return notify.get_preferences(db, current_user)


@router.put("/settings")
async def put_settings(body: SettingsIn, current_user: User = Depends(get_current_active_user),
                       db: Session = Depends(get_db)):
    if body.email_digest == "daily":
        if not notify.email_available():
            raise HTTPException(status_code=409, detail={"code": "email_unavailable",
                                                         "message": "この環境ではメールを送れません(管理者の設定が必要です)"})
        if not current_user.email or getattr(current_user, "is_guest", False):
            raise HTTPException(status_code=409, detail={"code": "no_email",
                                                         "message": "メールアドレスが登録されていません"})
    notify.set_preference(db, current_user, None, body.level, body.email_digest)
    db.commit()
    record_audit_event(action="notification.settings", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, details={"level": body.level, "email_digest": body.email_digest})
    return notify.get_preferences(db, current_user)


@router.put("/settings/plans/{plan_id}")
async def put_plan_settings(plan_id: str, body: PlanSettingsIn, current_user: User = Depends(get_current_active_user),
                            db: Session = Depends(get_db)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    pid: Any = plan.id
    notify.set_preference(db, current_user, pid, body.level, None)
    db.commit()
    return notify.get_preferences(db, current_user)


@router.delete("/settings/plans/{plan_id}")
async def delete_plan_settings(plan_id: str, current_user: User = Depends(get_current_active_user),
                               db: Session = Depends(get_db)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    pid: Any = plan.id
    notify.clear_plan_preference(db, current_user, pid)
    db.commit()
    return notify.get_preferences(db, current_user)


@router.get("/digest")
async def get_digest(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    """読んでいない通知を旅行ごと・種類ごとにまとめる(画面の「まとめ」)。"""
    rows = (db.query(Notification.related_plan_id, Notification.type, func.count(Notification.id),
                     func.max(Notification.created_at))
            .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
            .group_by(Notification.related_plan_id, Notification.type).all())
    plan_ids = [r[0] for r in rows if r[0]]
    titles = {p.id: p.title for p in db.query(TravelPlan).filter(TravelPlan.id.in_(plan_ids)).all()} if plan_ids else {}
    groups: Dict[Optional[str], Dict[str, Any]] = {}
    for pid, ntype, count, latest in rows:
        key = str(pid) if pid else None
        g = groups.setdefault(key, {"plan_id": key, "plan_title": titles.get(pid) if pid else None,
                                    "total": 0, "latest_at": None, "types": []})
        g["total"] += count
        g["types"].append({"type": ntype, "count": count})
        iso = latest.isoformat() if latest else None
        if iso and (g["latest_at"] is None or iso > g["latest_at"]):
            g["latest_at"] = iso
    items = sorted(groups.values(), key=lambda g: g["latest_at"] or "", reverse=True)
    for g in items:
        g["types"].sort(key=lambda t: -t["count"])
    return {"total": sum(g["total"] for g in items), "groups": items}
