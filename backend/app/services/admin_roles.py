"""
[Gate A2] FR-040 管理者の権限の付与・取り消し(運用者がサーバーの中でだけ行う。画面・API からは付けられない)。

    docker compose exec -T backend python scripts/security_incident.py grant-admin \
        --email a@example.com --yes --reason "…"
    docker compose exec -T backend python scripts/security_incident.py revoke-admin \
        --email a@example.com --yes --reason "…"

- 付与: user_type を admin にする。管理者の API は多要素認証が必須のため(S11)、付与された人は次に管理者の画面を開いた時に
  多要素認証の設定を求められる。付与の時点でその人の全端末をログアウトさせる(権限の変わる前のトークンを残さない)。
- 取り消し: user_type を registered に戻し、is_superuser・role の管理者も外す。その人の全端末をログアウトさせる。
- 監査に残すのは対象の ID・理由だけ(メールアドレスは残さない)。
"""
from __future__ import annotations

from typing import Dict

from sqlalchemy.orm import Session

from app.models.models import User, UserSession
from app.services import mfa
from app.services.audit_service import record_audit_event


class AdminRoleError(Exception):
    pass


def _find(db: Session, email: str) -> User:
    email = (email or "").strip()
    user = db.query(User).filter(User.email == email.lower()).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise AdminRoleError("その利用者は見つかりません")
    return user


def _revoke(db: Session, user: User) -> int:
    return db.query(UserSession).filter(UserSession.user_id == user.id, UserSession.is_active.is_(True)).update(
        {UserSession.is_active: False}, synchronize_session=False)


def grant_admin(db: Session, email: str, reason: str = "") -> Dict[str, object]:
    user = _find(db, email)
    if str(getattr(user.user_type, "value", user.user_type) or "") == "guest" or not user.is_active:
        raise AdminRoleError("ゲスト・停止中の利用者は管理者にできません")
    already = mfa.is_admin(user)
    user.user_type = "admin"
    revoked = _revoke(db, user)
    db.commit()
    record_audit_event(action="admin_role_granted", resource_type="user", user_id=None, resource_id=user.id,
                       details={"reason": (reason or "")[:200], "already_admin": already, "sessions_revoked": revoked})
    return {"ok": True, "already_admin": already, "sessions_revoked": int(revoked),
            "mfa_enabled": mfa.is_enabled(db, user.id)}


def revoke_admin(db: Session, email: str, reason: str = "") -> Dict[str, object]:
    user = _find(db, email)
    was = mfa.is_admin(user)
    user.user_type = "registered"
    user.is_superuser = False
    if str(user.role or "") == "admin":
        user.role = "user"
    revoked = _revoke(db, user)
    db.commit()
    record_audit_event(action="admin_role_revoked", resource_type="user", user_id=None, resource_id=user.id,
                       details={"reason": (reason or "")[:200], "was_admin": was, "sessions_revoked": revoked})
    return {"ok": True, "was_admin": was, "sessions_revoked": int(revoked)}
