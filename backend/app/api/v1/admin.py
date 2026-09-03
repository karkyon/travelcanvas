"""
管理者API

[Gate #24] backend/app/api/v1/admin.pyはこれまでmain.pyにinclude_routerされて
おらず、中身も固定値(total_users: 150等)を返すだけのモックだった。加えて
フロントエンド(AdminDashboard.tsx/AdminUsers.tsx)は、レート制限統計・
セキュリティログ・ログイン履歴・full_name等、現DBに一切存在しない情報を
前提に作り込まれていた(いわゆる「亡霊」パターンの一種で、UIだけが将来設計
のまま先行していたケース)。本Gateではマイグレーションを行わず、既存の
User/TravelPlan/OptimizationResultテーブルから実際に取得できる情報のみで
実装し、フロントエンド側も実データのみを表示するよう合わせて縮小する。
"""
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.models.models import OptimizationResult, TravelPlan, User

router = APIRouter(prefix="/admin", tags=["admin"])

ADMIN_TYPES = {"admin", "super_admin"}


def require_admin(current_user: User = Depends(get_current_active_user)) -> User:
    """管理者権限を要求する依存関数。管理者以外は403を返す。"""
    if current_user.user_type not in ADMIN_TYPES and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="管理者権限が必要です")
    return current_user


@router.get("/stats/system")
async def get_system_stats(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """システム統計(実データのみ)。レート制限/パフォーマンス/セキュリティ統計は
    現在のインフラで一切追跡していないため含めない。"""
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)

    total_users = db.query(func.count(User.id)).scalar() or 0
    active_users = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0  # noqa: E712
    verified_users = db.query(func.count(User.id)).filter(User.is_verified == True).scalar() or 0  # noqa: E712
    new_users_30d = db.query(func.count(User.id)).filter(User.created_at >= thirty_days_ago).scalar() or 0

    user_type_counts = {"guest": 0, "registered": 0, "premium": 0, "admin": 0}
    for user_type, count in db.query(User.user_type, func.count(User.id)).group_by(User.user_type).all():
        key = user_type if user_type in user_type_counts else "registered"
        user_type_counts[key] += count

    total_plans = db.query(func.count(TravelPlan.id)).scalar() or 0
    active_plans = db.query(func.count(TravelPlan.id)).filter(TravelPlan.status == "active").scalar() or 0
    completed_plans = db.query(func.count(TravelPlan.id)).filter(TravelPlan.status == "completed").scalar() or 0
    draft_plans = db.query(func.count(TravelPlan.id)).filter(TravelPlan.status == "draft").scalar() or 0

    duration_rows = (
        db.query(TravelPlan.start_date, TravelPlan.end_date)
        .filter(TravelPlan.start_date.isnot(None), TravelPlan.end_date.isnot(None))
        .all()
    )
    durations = [(end - start).days for start, end in duration_rows if end and start and (end - start).days >= 0]
    average_duration_days = round(sum(durations) / len(durations), 1) if durations else 0.0

    destination_rows = (
        db.query(TravelPlan.destination, func.count(TravelPlan.id).label("cnt"))
        .filter(TravelPlan.destination.isnot(None), TravelPlan.destination != "")
        .group_by(TravelPlan.destination)
        .order_by(func.count(TravelPlan.id).desc())
        .limit(5)
        .all()
    )
    popular_destinations = [{"destination": d, "count": c} for d, c in destination_rows]

    return {
        "users": {
            "total_users": total_users,
            "active_users": active_users,
            "verified_users": verified_users,
            "new_users_30d": new_users_30d,
            "user_types": user_type_counts,
        },
        "travel_plans": {
            "total_plans": total_plans,
            "active_plans": active_plans,
            "completed_plans": completed_plans,
            "draft_plans": draft_plans,
            "average_duration_days": average_duration_days,
            "popular_destinations": popular_destinations,
        },
        "timestamp": now.isoformat(),
    }


@router.get("/users")
async def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: Optional[str] = None,
    user_type: Optional[str] = None,
    status: Optional[str] = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
):
    """ユーザー一覧(検索・絞り込み・並び替え・ページネーション対応、実データのみ)"""
    query = db.query(User)

    if search:
        like = f"%{search}%"
        query = query.filter(or_(User.username.ilike(like), User.email.ilike(like)))

    if user_type:
        query = query.filter(User.user_type == user_type)

    if status == "active":
        query = query.filter(User.is_active == True)  # noqa: E712
    elif status == "inactive":
        query = query.filter(User.is_active == False)  # noqa: E712
    elif status == "verified":
        query = query.filter(User.is_verified == True)  # noqa: E712
    elif status == "unverified":
        query = query.filter(User.is_verified == False)  # noqa: E712

    sort_column_map = {"created_at": User.created_at, "username": User.username, "email": User.email}
    sort_column = sort_column_map.get(sort_by, User.created_at)
    query = query.order_by(sort_column.asc() if sort_order == "asc" else sort_column.desc())

    total_count = query.count()
    users = query.offset((page - 1) * page_size).limit(page_size).all()

    plan_counts = {}
    if users:
        rows = (
            db.query(TravelPlan.user_id, func.count(TravelPlan.id))
            .filter(TravelPlan.user_id.in_([u.id for u in users]))
            .group_by(TravelPlan.user_id)
            .all()
        )
        plan_counts = dict(rows)

    total_pages = math.ceil(total_count / page_size) if total_count else 0

    return {
        "users": [
            {
                "id": str(u.id),
                "username": u.username,
                "email": u.email,
                "user_type": u.user_type,
                "is_active": u.is_active,
                "is_verified": u.is_verified,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "travel_plans_count": plan_counts.get(u.id, 0),
            }
            for u in users
        ],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_count": total_count,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """ユーザー詳細(実データのみ。ログイン履歴・セキュリティログは追跡していないため含めない)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")

    total_plans = db.query(func.count(TravelPlan.id)).filter(TravelPlan.user_id == user.id).scalar() or 0
    completed_plans = (
        db.query(func.count(TravelPlan.id))
        .filter(TravelPlan.user_id == user.id, TravelPlan.status == "completed")
        .scalar()
        or 0
    )

    plan_ids = {str(pid) for (pid,) in db.query(TravelPlan.id).filter(TravelPlan.user_id == user.id).all()}
    optimization_usage = 0
    if plan_ids:
        for (data,) in db.query(OptimizationResult.original_data).all():
            if data and data.get("plan_id") in plan_ids:
                optimization_usage += 1

    account_age_days = (datetime.now(timezone.utc) - user.created_at).days if user.created_at else 0

    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "user_type": user.user_type,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "statistics": {
            "account_age_days": account_age_days,
            "total_plans": total_plans,
            "completed_plans": completed_plans,
            "optimization_usage": optimization_usage,
        },
    }


@router.post("/users/manage")
async def manage_users(
    payload: dict = Body(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """ユーザーのアカウント停止/復活/認証切り替え。
    注意: メール通知は実装しておらず、notify_users等の値は無視する
    (フロントエンドが送っても実際に通知は送信されない)。"""
    action = payload.get("action")
    user_ids = payload.get("user_ids", [])

    if action not in {"suspend", "unsuspend", "verify", "unverify"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不正な操作です")
    if not user_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="対象ユーザーが指定されていません")

    try:
        target_ids = [uuid.UUID(str(uid)) for uid in user_ids]
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不正なユーザーIDです")

    users = db.query(User).filter(User.id.in_(target_ids)).all()
    if not users:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="対象ユーザーが見つかりません")

    for u in users:
        if action == "suspend":
            u.is_active = False
        elif action == "unsuspend":
            u.is_active = True
        elif action == "verify":
            u.is_verified = True
        elif action == "unverify":
            u.is_verified = False

    db.commit()
    return {"success": True, "updated_count": len(users)}
