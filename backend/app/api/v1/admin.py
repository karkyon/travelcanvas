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
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import AuthResult, get_current_active_user, get_current_user
from app.models.models import AuditLog, OptimizationResult, TravelPlan, User, UserSession
from app.services import mfa
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/admin", tags=["admin"])

# [Gate A2] 一覧の検索の LIKE の特殊文字(%・_・\)を文字として扱う
_LIKE_ESCAPE = str.maketrans({"%": "\\%", "_": "\\_", "\\": "\\\\"})


def _like(term: str) -> str:
    return f"%{term.translate(_LIKE_ESCAPE)}%"


def mask_ip(ip: Optional[str]) -> Optional[str]:
    """[Gate A2] 監査ログの接続元は、運用者にも末尾を伏せて見せる(IPv4 は最後の区切り、IPv6 は前の3区切りだけ)。"""
    if not ip:
        return None
    if ":" in ip:
        parts = [p for p in ip.split(":") if p]
        return ":".join(parts[:3]) + "::x" if parts else "::x"
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3] + ["x"])
    return "x"


def _audit_admin(request: Request, admin: User, action: str, resource_id=None, details=None) -> None:
    """[Gate A2] 管理者が利用者の情報を見た・変えたことを残す(検索語・メールアドレスは残さない)。"""
    record_audit_event(action=action, resource_type="admin", user_id=admin.id, resource_id=resource_id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255], details=details or {})


ADMIN_TYPES = mfa.ADMIN_TYPES


def _current_session(db: Session, auth) -> Optional[UserSession]:
    sid = getattr(getattr(auth, "token_data", None), "session_id", None) or getattr(auth, "session_id", None)
    if not sid:
        return None
    try:
        return db.query(UserSession).filter(UserSession.id == uuid.UUID(str(sid)),
                                            UserSession.is_active.is_(True)).first()
    except ValueError:
        return None


def require_admin(
    request: Request,
    current_user: User = Depends(get_current_active_user),
    auth=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """管理者権限を要求する依存関数。管理者以外は403を返す。

    [Gate S11] SEC-06 管理者は多要素認証(TOTP)が必須。設定していない(mfa_enrollment_required)、
    このセッションで ADMIN_MFA_MAX_AGE_HOURS 以内に確認コードを通していない(mfa_step_up_required)時も 403。
    パスワードだけが漏れても、管理者の API(全利用者の一覧・アカウント停止・監査ログ)には届かない。"""
    if not mfa.is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="管理者権限が必要です")
    if not settings.ADMIN_MFA_REQUIRED:
        return current_user
    if not mfa.is_enabled(db, current_user.id):
        record_audit_event(action="admin_mfa_required", resource_type="user", user_id=current_user.id,
                           resource_id=current_user.id, ip_address=request.client.host if request.client else None,
                           details={"reason": "not_enrolled"})
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "mfa_enrollment_required",
            "message": "管理者の画面を使うには、設定 → セキュリティで多要素認証(認証アプリ)を有効にしてください",
        })
    session = _current_session(db, auth) if isinstance(auth, AuthResult) else None
    if session is None or str(session.user_id) != str(current_user.id) or not mfa.admin_session_fresh(session):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={
            "code": "mfa_step_up_required",
            "message": "管理者の画面を使うには、認証アプリの確認コードを入力してください",
        })
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

    # [Gate B-012] 論理削除済みプランは統計に含めない
    live = TravelPlan.deleted_at.is_(None)
    total_plans = db.query(func.count(TravelPlan.id)).filter(live).scalar() or 0
    active_plans = db.query(func.count(TravelPlan.id)).filter(live, TravelPlan.status == "active").scalar() or 0
    completed_plans = db.query(func.count(TravelPlan.id)).filter(live, TravelPlan.status == "completed").scalar() or 0
    draft_plans = db.query(func.count(TravelPlan.id)).filter(live, TravelPlan.status == "draft").scalar() or 0

    duration_rows = (
        db.query(TravelPlan.start_date, TravelPlan.end_date)
        .filter(live, TravelPlan.start_date.isnot(None), TravelPlan.end_date.isnot(None))
        .all()
    )
    durations = [(end - start).days for start, end in duration_rows if end and start and (end - start).days >= 0]
    average_duration_days = round(sum(durations) / len(durations), 1) if durations else 0.0

    destination_rows = (
        db.query(TravelPlan.destination, func.count(TravelPlan.id).label("cnt"))
        .filter(live, TravelPlan.destination.isnot(None), TravelPlan.destination != "")
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
    request: Request,
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
        term = search.strip()[:100]
        try:
            # [Gate A2] 利用者の ID でも探せる(ゲストは名前・メールアドレスを持たない。問い合わせは ID で来ることがある)
            query = query.filter(User.id == uuid.UUID(term))
        except ValueError:
            like = _like(term)
            query = query.filter(or_(User.username.ilike(like, escape="\\"), User.email.ilike(like, escape="\\")))

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

    sort_column_map: Dict[str, Any] = {"created_at": User.created_at, "username": User.username, "email": User.email}
    sort_column = sort_column_map.get(sort_by, User.created_at)
    query = query.order_by(sort_column.asc() if sort_order == "asc" else sort_column.desc())

    total_count = query.count()
    users = query.offset((page - 1) * page_size).limit(page_size).all()

    plan_counts: Dict[Any, int] = {}
    if users:
        rows = (
            db.query(TravelPlan.user_id, func.count(TravelPlan.id))
            .filter(TravelPlan.user_id.in_([u.id for u in users]), TravelPlan.deleted_at.is_(None))
            .group_by(TravelPlan.user_id)
            .all()
        )
        plan_counts = {uid: int(n) for uid, n in rows}

    total_pages = math.ceil(total_count / page_size) if total_count else 0
    _audit_admin(request, admin, "admin_users_listed",
                 details={"page": page, "searched": bool(search), "result_count": len(users)})

    return {
        "users": [
            {
                "id": str(u.id),
                "username": u.username,
                "email": u.email,
                "user_type": u.user_type,
                "is_active": u.is_active,
                "is_verified": u.is_verified,
                "is_admin": mfa.is_admin(u),
                "is_self": u.id == admin.id,
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
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """ユーザー詳細(実データのみ。ログイン履歴・セキュリティログは追跡していないため含めない)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ユーザーが見つかりません")

    total_plans = (
        db.query(func.count(TravelPlan.id))
        .filter(TravelPlan.user_id == user.id, TravelPlan.deleted_at.is_(None))
        .scalar()
        or 0
    )
    completed_plans = (
        db.query(func.count(TravelPlan.id))
        .filter(TravelPlan.user_id == user.id, TravelPlan.deleted_at.is_(None), TravelPlan.status == "completed")
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
    _audit_admin(request, admin, "admin_user_viewed", resource_id=user.id)

    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "user_type": user.user_type,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "is_admin": mfa.is_admin(user),
        "is_self": user.id == admin.id,
        "mfa_enabled": mfa.is_enabled(db, user.id),
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
    request: Request,
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

    if len(target_ids) > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="一度に操作できるのは100人までです")
    users = db.query(User).filter(User.id.in_(target_ids)).all()
    if not users:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="対象ユーザーが見つかりません")
    # [Gate A2] 自分自身・ほかの管理者は画面から停止・認証の切り替えをしない(締め出し・乗っ取った管理者による
    # 管理者の停止を防ぐ)。管理者の権限は運用者が scripts/security_incident.py で変える
    if any(u.id == admin.id for u in users):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": "self_target", "message": "自分自身のアカウントはこの画面から操作できません"})
    if any(mfa.is_admin(u) for u in users):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": "admin_target", "message": "ほかの管理者はこの画面から操作できません(運用の手順で権限を外してから)"})

    revoked = 0
    for u in users:
        if action == "suspend":
            u.is_active = False
            # [Gate A2] 停止した人の端末をすぐログアウトさせる(発行済みのトークンを残さない)
            revoked += db.query(UserSession).filter(
                UserSession.user_id == u.id, UserSession.is_active.is_(True)).update(
                {UserSession.is_active: False}, synchronize_session=False)
        elif action == "unsuspend":
            u.is_active = True
        elif action == "verify":
            u.is_verified = True
        elif action == "unverify":
            u.is_verified = False

    db.commit()

    # [Gate R2-7] 監査ログ: 管理者によるユーザーアカウント操作
    # (アカウント停止/復活/認証状態変更)は最も監査要求が強い操作の一つ
    # のため、対象ユーザーごとに1行ずつ記録する。
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")[:255]
    for u in users:
        record_audit_event(
            action=f"admin_user_{action}",
            resource_type="user",
            user_id=admin.id,
            resource_id=u.id,
            ip_address=client_ip,
            user_agent=user_agent,
            details={"target_user_id": str(u.id)},
        )

    return {"success": True, "updated_count": len(users), "sessions_revoked": int(revoked)}


@router.get("/audit-logs")
async def list_audit_logs(
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    user_id: Optional[str] = None,
    resource_id: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
):
    """監査ログ一覧(Gate R2-7、DOC-11監査要件に対応)。

    list_usersと同じdictベースの応答形式に合わせる(既存フロントエンド
    AdminDashboard.tsxの他エンドポイントとの一貫性のため、schemas.AuditLog
    は流用しない)。
    """
    query = db.query(AuditLog)

    if action:
        query = query.filter(AuditLog.action == action)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if user_id:
        try:
            query = query.filter(AuditLog.user_id == uuid.UUID(user_id))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不正なuser_idです")
    # [Gate A2] 対象(利用者・旅行等)・期間での絞り込み
    if resource_id:
        try:
            query = query.filter(AuditLog.resource_id == uuid.UUID(resource_id))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不正なresource_idです")
    if since:
        query = query.filter(AuditLog.created_at >= since)
    if until:
        query = query.filter(AuditLog.created_at < until)

    total_count = query.count()
    logs = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    total_pages = math.ceil(total_count / page_size) if total_count else 0
    actions = [a for (a,) in db.query(AuditLog.action).distinct().order_by(AuditLog.action).limit(300).all() if a]
    _audit_admin(request, admin, "admin_audit_logs_viewed",
                 details={"page": page,
                          "filtered": bool(action or resource_type or user_id or resource_id or since or until)})

    return {
        "actions": actions,
        "audit_logs": [
            {
                "id": str(log.id),
                "user_id": str(log.user_id) if log.user_id else None,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": str(log.resource_id) if log.resource_id else None,
                # [Gate A2] 接続元は末尾を伏せる。端末の種類は先頭だけ
                "ip_address": mask_ip(log.ip_address),
                "user_agent": (log.user_agent or "")[:120] or None,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
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


# ===== [Gate G4] FC-097 濫用への対応(公開の共有への通報・自動の検知・失効)

@router.get("/abuse")
async def list_abuse_reports(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = Query(default="open", alias="status", pattern="^(open|dismissed|actioned|all)$"),
):
    """通報と自動の検知の一覧(app/services/abuse.py)。旅行の中身は出さない(題名・所有者の ID・共有の状態だけ)。"""
    from app.services import abuse

    return abuse.list_reports(db, None if status_filter == "all" else status_filter)


@router.post("/abuse/{report_id}/action")
async def act_on_abuse_report(
    report_id: uuid.UUID,
    request: Request,
    payload: dict = Body(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """対応: dismiss(却下)・revoke_share(共有を失効させ、所有者に知らせる)・restore_share(濫用の対応で止めた共有を戻す)。"""
    from app.services import abuse

    action = payload.get("action")
    note = payload.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 500):
        raise HTTPException(status_code=422, detail="noteは500文字までの文字列です")
    try:
        r = abuse.act(db, report_id, admin, str(action or ""), note)
    except abuse.AbuseActionError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": str(e)})
    record_audit_event(action="admin_abuse_" + str(action), resource_type="abuse_report", user_id=admin.id,
                       resource_id=r.id, ip_address=request.client.host if request.client else None,
                       details={"reason": r.reason, "share_id": str(r.share_id) if r.share_id else None})
    return {"id": str(r.id), "status": r.status, "message": "対応を記録しました"}


# ===== [Gate G8] FR-004・O02 定期の処理が続いて動いているか(最後の成功・続けての失敗・遅れ)

@router.get("/ops/jobs")
async def admin_ops_jobs(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """定期の処理ごとの最後の実行・最後の成功・状態(ok / overdue / failing / never)。中身は件数だけ。"""
    from app.ops import job_runs

    jobs = job_runs.status(db)
    return {"jobs": jobs, "attention": [j["job"] for j in jobs if j["state"] in ("overdue", "failing")]}


# ===== [Gate G5] BILL-02 使用量の確認と上限の上書き(理由つき。監査に残す)

@router.get("/usage")
async def admin_usage(
    subject_type: str = Query(..., pattern="^(user|org)$"),
    subject_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.services import usage

    return usage.summary(db, subject_type, subject_id)


@router.put("/usage/override")
async def admin_usage_override(
    request: Request,
    payload: dict = Body(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """今月の上限を上書きする(limit=null で既定に戻す)。理由(reason)は上書きの時に必須。"""
    from app.services import usage

    subject_type, metric = payload.get("subject_type"), payload.get("metric")
    if subject_type not in usage.SUBJECTS or metric not in usage.METRICS:
        raise HTTPException(status_code=422, detail={"code": "invalid_usage_key",
                                                     "message": "subject_type・metric の値が正しくありません"})
    try:
        subject_id = uuid.UUID(str(payload.get("subject_id")))
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "invalid_usage_key",
                                                     "message": "subject_id が正しくありません"})
    limit = payload.get("limit")
    reason = payload.get("reason")
    valid_int = isinstance(limit, int) and not isinstance(limit, bool)
    if limit is not None and (not valid_int or not 0 <= limit <= usage.MAX_LIMIT):
        raise HTTPException(status_code=422, detail={"code": "invalid_usage_limit",
                                                     "message": "上限は0以上の整数か、既定に戻す null です"})
    if limit is not None and (not isinstance(reason, str) or not reason.strip() or len(reason) > 200):
        raise HTTPException(status_code=422, detail={"code": "usage_reason_required",
                                                     "message": "上書きの理由を200文字までで入力してください"})
    usage.set_override(db, subject_type, subject_id, metric, limit, str(reason).strip() if limit is not None else None,
                       admin.id)
    db.commit()
    record_audit_event(action="admin_usage_override", resource_type=subject_type, user_id=admin.id,
                       resource_id=subject_id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255],
                       details={"metric": metric, "limit": limit})
    return usage.summary(db, subject_type, subject_id)
