"""[Gate Remaining-7] FR-002 ゲストを既存のアカウントへまとめる(POST /auth/guest/merge)。

ゲストのまま旅行を作った人が、既にアカウントを持っていた時に使う。既存のアカウントのメール・パスワード
(多要素認証を設定していれば確認コードも)で本人を確かめ、ゲストの全ての持ち物を移してから、既存のアカウントで
ログインした状態にする。ゲストの行は無効にし、セッションを全て失効させる。
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.api.v1 import auth as auth_api
from app.core.auth import auth_manager, get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.api.v1.auth import verify_password
from app.models.models import User
from app.services import challenge, guest_merge, mfa
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(tags=["authentication"])


class GuestMergeRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)
    mfa_code: Optional[str] = Field(None, max_length=40)


def _bad(code: str, message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


@router.post("/guest/merge")
async def merge_guest_into_account(payload: GuestMergeRequest, request: Request, response: Response,
                                   current_user: User = Depends(get_current_user_or_guest),
                                   db: Session = Depends(get_db)):
    if current_user.user_type != "guest":
        raise _bad("not_guest", "この操作はゲストのままの時だけ使えます")
    challenge.require(request, "login")
    ip = request.client.host if request.client else "unknown"
    email = str(payload.email)
    if not check_rate_limit(f"login_ip:{ip}", settings.RATE_LIMIT_AUTH, 60) or \
            not check_rate_limit(f"login_email:{email}", settings.RATE_LIMIT_AUTH, 60):
        raise _bad("too_many_requests", "試行回数が上限に達しました。しばらく待ってから試してください", 429)
    target = db.query(User).filter(User.email == email).first()
    if target is None or not target.hashed_password or not verify_password(payload.password, target.hashed_password):
        record_audit_event(action="login_failed", resource_type="user", user_id=target.id if target else None,
                           ip_address=ip, details={"email": email, "via": "guest_merge"})
        raise _bad("invalid_credentials", "メールアドレスまたはパスワードが正しくありません", 401)
    if not target.is_active or target.user_type == "guest" or target.id == current_user.id:
        raise _bad("account_inactive", "このアカウントにはまとめられません", 401)
    if mfa.is_enabled(db, target.id):
        if not payload.mfa_code:
            raise _bad("mfa_required", "このアカウントは確認コード(認証アプリ)が要ります", 401)
        rec = mfa.locked_record(db, target.id)
        try:
            method = mfa.verify_second_factor(db, rec, payload.mfa_code)
        except mfa.MfaError as error:
            raise _bad(error.code, error.message, 401)
    else:
        method = None

    guest = db.query(User).filter(User.id == current_user.id).with_for_update().first()
    if guest is None or guest.user_type != "guest" or not guest.is_active:
        raise _bad("not_guest", "ゲストのセッションが見つかりません")
    result = guest_merge.merge(db, guest.id, target.id)
    guest.is_active = False
    db.commit()
    auth_manager.revoke_all_user_sessions(str(guest.id), db)
    record_audit_event(action="guest_merged", resource_type="user", user_id=target.id, resource_id=target.id,
                       ip_address=ip, details={"guest_id": str(guest.id), "moved_total": result["moved_total"],
                                               "kept_total": result["kept_total"]})
    token = auth_api.complete_login(db, target, request, response, mfa_verified=method is not None,
                                    mfa_method=method)
    body = token.model_dump() if hasattr(token, "model_dump") else dict(token)
    body["merge"] = {"moved_total": result["moved_total"], "kept_total": result["kept_total"],
                     "moved": result["moved"], "kept": result["kept"]}
    return body
