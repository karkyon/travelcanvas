"""[Gate G3] SEC-F6 多要素認証の解除(端末と回復コードを両方なくした人)を二者で確認する。

1. 申請(``mfa-reset-request``): 管理者 A が対象・理由を記録する。対象の本人は申請できない。24時間で期限切れ。
2. 承認(``mfa-reset --request <ID> --approved-by``): 申請した人とは別の管理者 B が承認すると解除する
   (対象の全端末をログアウト、本人へ知らせ、監査に申請者・承認者・理由・対象を残す)。対象の本人は承認できない。
   管理者が1人しかいない環境だけ、申請した人が承認できる(``single_operator`` として監査に残す)。
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

REQUEST_HOURS = 24


class MfaResetError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Any) -> datetime:
    """時刻を UTC つきにする(申請の期限は必ずある列。値が無い時は今にして期限切れとして扱う)。"""
    if dt is None:
        return datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _user(db: Session, email: str):
    from app.models.models import User

    u = db.query(User).filter(User.email == email).first()
    if u is None:
        raise MfaResetError("その利用者は見つかりません")
    return u


def _admin(db: Session, email: str, role: str):
    from app.services import mfa

    u = _user(db, email)
    if not mfa.is_admin(u):
        raise MfaResetError("%sは管理者ではありません" % role)
    return u


def request_reset(db: Session, *, target_email: str, requested_by: str, reason: str,
                  now: Optional[datetime] = None) -> Dict[str, object]:
    from app.models.models import MfaResetRequest, UserMfa
    from app.services.audit_service import record_audit_event

    now = now or _now()
    reason = (reason or "").strip()
    if len(reason) < 4:
        raise MfaResetError("理由(本人確認の方法を含む)を4文字以上で書いてください")
    target = _user(db, target_email)
    requester = _admin(db, requested_by, "申請する人")
    if requester.id == target.id:
        raise MfaResetError("自分の多要素認証の解除は申請できません(別の管理者に頼む)")
    if db.query(UserMfa).filter(UserMfa.user_id == target.id).first() is None:
        raise MfaResetError("その利用者は多要素認証を設定していません")
    db.query(MfaResetRequest).filter(MfaResetRequest.target_user_id == target.id,
                                     MfaResetRequest.status == "pending").update(
        {MfaResetRequest.status: "cancelled", MfaResetRequest.decided_at: now}, synchronize_session=False)
    req: Any = MfaResetRequest(target_user_id=target.id, requested_by_user_id=requester.id, reason=reason[:200],
                               status="pending", expires_at=now + timedelta(hours=REQUEST_HOURS))
    db.add(req)
    db.commit()
    record_audit_event(action="mfa_reset_requested", resource_type="user", user_id=requester.id, resource_id=target.id,
                       details={"request_id": str(req.id), "reason": reason[:200], "expires_hours": REQUEST_HOURS})
    return {"ok": True, "request_id": str(req.id), "expires_at": _aware(req.expires_at).isoformat()}


def approve_reset(db: Session, *, request_id: str, approved_by: str,
                  now: Optional[datetime] = None) -> Dict[str, object]:
    import uuid

    from app.core.auth import auth_manager
    from app.models.models import MfaResetRequest, Notification, User, UserMfa
    from app.services import mfa
    from app.services.audit_service import record_audit_event

    now = now or _now()
    try:
        rid = uuid.UUID(str(request_id))
    except ValueError:
        raise MfaResetError("申請の ID が正しくありません")
    req: Any = db.query(MfaResetRequest).filter(MfaResetRequest.id == rid).with_for_update().first()
    if req is None or req.status != "pending":
        raise MfaResetError("承認を待っている申請がありません")
    if _aware(req.expires_at) <= now:
        req.status = "expired"
        req.decided_at = now
        db.commit()
        raise MfaResetError("申請の期限(%d時間)が切れています。申請し直してください" % REQUEST_HOURS)
    approver = _admin(db, approved_by, "承認する人")
    if approver.id == req.target_user_id:
        raise MfaResetError("自分の多要素認証の解除は承認できません")
    single = False
    if approver.id == req.requested_by_user_id:
        from sqlalchemy import or_

        cond = [User.user_type.in_(list(mfa.ADMIN_TYPES)), User.role == "admin"]
        if hasattr(User, "is_superuser"):
            cond.append(User.is_superuser.is_(True))
        admins = [u for u in db.query(User).filter(or_(*cond)).all() if mfa.is_admin(u)]
        if len(admins) > 1:
            raise MfaResetError("申請した人とは別の管理者が承認してください(二者の確認)")
        single = True
    target = db.query(User).filter(User.id == req.target_user_id).first()
    removed = db.query(UserMfa).filter(UserMfa.user_id == req.target_user_id).delete(synchronize_session=False)
    req.status = "approved"
    req.approved_by_user_id = approver.id
    req.decided_at = now
    req.single_operator = single
    db.add(Notification(user_id=req.target_user_id, type="security", title="多要素認証が解除されました",
                        message="管理者の確認(申請と承認)により、多要素認証を解除しました。全ての端末からログアウトしています。"
                                "心当たりが無い場合はすぐにパスワードを変更し、サポートへ連絡してください。"))
    db.commit()
    auth_manager.revoke_all_user_sessions(str(req.target_user_id), db)
    record_audit_event(action="mfa_reset_by_operator", resource_type="user", user_id=approver.id,
                       resource_id=req.target_user_id,
                       details={"request_id": str(req.id), "requested_by": str(req.requested_by_user_id),
                                "approved_by": str(approver.id), "reason": req.reason, "single_operator": single,
                                "sessions_revoked": True, "removed": bool(removed),
                                "target_exists": target is not None})
    return {"ok": True, "removed": bool(removed), "sessions_revoked": True, "single_operator": single}
