"""[Gate Remaining-6] FR-003 パスワードの再設定(忘れた時)とメールの確認。DB の変更なし(署名つきの使い捨ての札)。

- POST /auth/password/forgot      {email}              : 再設定のメールを送る。登録の有無は答えない(いつも 202)。
                                                         メールの設定(SMTP)が無い環境は email_available=false を返す
- POST /auth/password/reset       {token, new_password}: 新しいパスワードにする。全ての端末からログアウトする
- POST /auth/email/verify/request                     : 自分のメールの確認のメールを送る(ログイン中)
- POST /auth/email/verify         {token}              : メールを確認済みにする

札(token)は HMAC-SHA256 の署名つき(JWT の鍵から用途ごとに導く)。中身は利用者の ID・用途・期限と、
パスワードの再設定ではパスワードのハッシュの指紋(1 回使うと、または他でパスワードを変えると使えなくなる)、
メールの確認ではメールの指紋(メールを変えると使えなくなる)。札そのものは保存しない・記録に残さない。
"""
import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth import get_current_active_user
from app.core.config import settings
from app.core.database import get_db
from app.models.models import EmailOutbox, User
from app.services import notify
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["authentication"])

RESET_TTL = 3600          # 1 時間
VERIFY_TTL = 3 * 86400    # 3 日


def _key(purpose: str) -> bytes:
    return hashlib.sha256(f"tc-account:{purpose}:{settings.JWT_SECRET_KEY}".encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _fp(value: Optional[str]) -> str:
    return hashlib.sha256(("fp:" + (value or "")).encode()).hexdigest()[:16]


def make_token(purpose: str, user: User, ttl: int, now: Optional[float] = None) -> str:
    body = {"u": str(user.id), "p": purpose, "e": int((now or time.time()) + ttl),
            "f": _fp(user.hashed_password if purpose == "reset" else (user.email or "").lower())}
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(_key(purpose), raw, hashlib.sha256).digest()[:20]
    return f"{_b64(raw)}.{_b64(sig)}"


def read_token(db: Session, purpose: str, token: str, now: Optional[float] = None) -> User:
    bad = HTTPException(status_code=400, detail={"code": "invalid_token",
                                                 "message": "リンクが正しくないか、期限が切れています。もう一度やり直してください"})
    try:
        raw_s, sig_s = token.strip().split(".", 1)
        raw = _unb64(raw_s)
        if not hmac.compare_digest(hmac.new(_key(purpose), raw, hashlib.sha256).digest()[:20], _unb64(sig_s)):
            raise bad
        body: Dict[str, Any] = json.loads(raw)
        if body.get("p") != purpose or int(body.get("e", 0)) < (now or time.time()):
            raise bad
        user = db.query(User).filter(User.id == uuid.UUID(str(body["u"]))).first()
    except HTTPException:
        raise
    except (ValueError, KeyError, TypeError):
        raise bad
    if user is None or not user.is_active:
        raise bad
    expect = _fp(user.hashed_password if purpose == "reset" else (user.email or "").lower())
    if not hmac.compare_digest(expect, str(body.get("f", ""))):
        raise bad
    return user


def _origin(request: Request) -> str:
    allowed = [o.rstrip("/") for o in (settings.cors_allowed_origins or [])]
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin and origin in allowed:
        return origin
    return allowed[0] if allowed else "http://localhost:4173"


def _send(db: Session, user: User, kind: str, subject: str, lines: list) -> None:
    db.add(EmailOutbox(user_id=user.id, kind=kind, subject=subject[:200], body="\n".join(lines)))
    db.commit()


class ForgotIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(..., min_length=3, max_length=254)


@router.post("/password/forgot", status_code=202)
def forgot_password(body: ForgotIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    email = body.email.strip().lower()
    available = notify.email_available()
    if not check_rate_limit(f"pw_forgot_ip:{ip}", 10, 3600) or not check_rate_limit(f"pw_forgot:{email}", 3, 3600):
        raise HTTPException(status_code=429, detail={"code": "rate_limited",
                                                     "message": "回数が多すぎます。しばらくしてから試してください"})
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is not None and available and user.is_active and user.hashed_password and \
            not str(user.user_type or "").lower().endswith("guest"):
        link = f"{_origin(request)}/reset-password?token={make_token('reset', user, RESET_TTL)}"
        _send(db, user, "password_reset", "TravelCanvas: パスワードの再設定", [
            "パスワードの再設定の手続きを受け付けました。", "",
            "次のリンクを 1 時間以内に開き、新しいパスワードを決めてください(1 回だけ使えます):", link, "",
            "心当たりが無い時は、このメールを捨ててください(パスワードは変わりません)。"])
        record_audit_event(action="password_reset_requested", resource_type="user", user_id=user.id,
                           resource_id=user.id, details={})
    # 登録の有無は答えない(同じ応答)
    return {"accepted": True, "email_available": available,
            "message": ("登録のあるメールなら、再設定のリンクを送りました。届かない時は迷惑メールも確かめてください"
                        if available else "この環境ではメールを送れません。管理者に再設定を頼んでください")}


class ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(..., min_length=10, max_length=600)
    new_password: str = Field(..., min_length=1, max_length=256)


@router.post("/password/reset")
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    from app.api.v1 import auth as auth_api
    from app.core.auth import auth_manager

    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"pw_reset_ip:{ip}", 20, 3600):
        raise HTTPException(status_code=429, detail={"code": "rate_limited",
                                                     "message": "回数が多すぎます。しばらくしてから試してください"})
    user = read_token(db, "reset", body.token)
    auth_api._enforce_password_policy(body.new_password, email=user.email, username=user.username)
    user.hashed_password = auth_api.hash_password(body.new_password)
    db.commit()
    auth_manager.revoke_all_user_sessions(str(user.id), db)
    record_audit_event(action="password_reset_completed", resource_type="user", user_id=user.id,
                       resource_id=user.id, details={})
    return {"message": "パスワードを変えました。新しいパスワードでログインしてください(全ての端末からログアウトしました)"}


@router.post("/email/verify/request", status_code=202)
def request_email_verification(request: Request, db: Session = Depends(get_db),
                               current_user: User = Depends(get_current_active_user)):
    if not current_user.email:
        raise HTTPException(status_code=422, detail={"code": "no_email", "message": "メールが登録されていません"})
    if current_user.is_verified:
        return {"accepted": False, "verified": True, "email_available": notify.email_available(),
                "message": "メールは確認済みです"}
    if not notify.email_available():
        return {"accepted": False, "verified": False, "email_available": False,
                "message": "この環境ではメールを送れません"}
    if not check_rate_limit(f"email_verify:{current_user.id}", 3, 3600):
        raise HTTPException(status_code=429, detail={"code": "rate_limited",
                                                     "message": "回数が多すぎます。しばらくしてから試してください"})
    link = f"{_origin(request)}/verify-email?token={make_token('verify', current_user, VERIFY_TTL)}"
    _send(db, current_user, "email_verify", "TravelCanvas: メールの確認", [
        "TravelCanvas に登録したメールの確認です。", "", "次のリンクを 3 日以内に開いてください:", link])
    return {"accepted": True, "verified": False, "email_available": True,
            "message": "確認のメールを送りました"}


class VerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(..., min_length=10, max_length=600)


@router.post("/email/verify")
def verify_email(body: VerifyIn, db: Session = Depends(get_db)):
    user = read_token(db, "verify", body.token)
    if not user.is_verified:
        user.is_verified = True
        db.commit()
        record_audit_event(action="email_verified", resource_type="user", user_id=user.id, resource_id=user.id,
                           details={})
    return {"verified": True, "message": "メールを確認しました"}
