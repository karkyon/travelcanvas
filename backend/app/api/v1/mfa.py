"""[Gate S11] SEC-06 多要素認証(TOTP)の API(/api/v1/auth/mfa/*)。

    GET    /auth/mfa                    状態(設定済みか・回復コードの残り・このセッションが確認済みか・管理者に必須か)
    POST   /auth/mfa/setup              設定の開始(現在のパスワードで再認証)。秘密と otpauth URI を返す(1回だけ)
    POST   /auth/mfa/enable             認証アプリの確認コードで登録を確かめて有効にする。回復コードを返す(1回だけ)
    POST   /auth/mfa/disable            無効にする(パスワード + 確認コード)。ほかの端末はログアウトさせる
    POST   /auth/mfa/recovery-codes     回復コードを作り直す(パスワード + 確認コード)。古い回復コードは使えなくなる
    POST   /auth/mfa/step-up            ログイン中のこのセッションを確認済みにする(管理者の画面に入る前など)
    POST   /auth/mfa/verify             ログインの2段目(公開: POST /auth/login が返した mfa_token + 確認コード)

設計は app/services/mfa.py と docs/adr/ADR-admin-mfa.md。秘密・確認コード・回復コードはログ・監査に出さない。
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1.auth import TokenResponse, complete_login, verify_password
from app.core.auth import AuthResult, auth_manager, get_current_active_user, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.models import Notification, User, UserMfa, UserSession
from app.services import mfa, threat_guard
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/mfa", tags=["authentication"])
logger = logging.getLogger("travelcanvas.auth")

NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


class MfaStatus(BaseModel):
    enabled: bool
    pending: bool
    confirmed_at: Optional[datetime] = None
    recovery_codes_remaining: int
    is_admin: bool
    required: bool
    session_verified: bool
    session_verified_at: Optional[datetime] = None


class PasswordOnly(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(..., min_length=1, max_length=200)


class CodeOnly(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(..., min_length=1, max_length=32)


class PasswordAndCode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(..., min_length=1, max_length=200)
    code: str = Field(..., min_length=1, max_length=32)


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mfa_token: str = Field(..., min_length=10, max_length=2000)
    code: str = Field(..., min_length=1, max_length=32)


class SetupResponse(BaseModel):
    secret: str
    otpauth_uri: str
    digits: int
    period: int
    algorithm: str


class RecoveryCodesResponse(BaseModel):
    recovery_codes: List[str]


def _error(status_code: int, code: str, message: str, headers=None) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=headers)


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _session_for(db: Session, auth: AuthResult) -> Optional[UserSession]:
    sid = getattr(getattr(auth, "token_data", None), "session_id", None) or getattr(auth, "session_id", None)
    if not sid:
        return None
    try:
        return db.query(UserSession).filter(UserSession.id == uuid.UUID(str(sid))).first()
    except ValueError:
        return None


def _member(auth) -> User:
    user = auth.user if isinstance(auth, AuthResult) else auth
    if user is None or getattr(auth, "is_guest", False):
        raise _error(403, "members_only", "この機能は会員のみ利用できます")
    return user


def member_auth(auth=Depends(get_current_user)):
    """会員のログイン(セッションも見るため AuthResult のまま返す)。本文の検査より先に 401/403 にする。"""
    if isinstance(auth, AuthResult) and not auth.is_authenticated:
        raise _error(401, "not_authenticated", "認証が必要です")
    _member(auth)
    return auth


def _limit(key: str, limit: int, window: int) -> None:
    if not check_rate_limit(key, limit, window):
        raise _error(429, "rate_limited", "試行回数が上限に達しました。しばらく待ってから再試行してください。",
                     headers={"Retry-After": str(window)})


def _reauth(request: Request, user: User, password: str, purpose: str) -> None:
    _limit(f"mfa_reauth:{user.id}", settings.RATE_LIMIT_AUTH, 60)
    if not user.hashed_password or not verify_password(password, user.hashed_password):
        record_audit_event(action="reauth_failed", resource_type="user", user_id=user.id, resource_id=user.id,
                           ip_address=_ip(request), details={"purpose": purpose})
        threat_guard.signal(request, "mfa_failed")
        raise _error(400, "wrong_password", "現在のパスワードが正しくありません")


def _check_code(db: Session, request: Request, user: User, rec: UserMfa, code: str, purpose: str,
                allow_recovery: bool = True) -> str:
    _limit(f"mfa_code:{user.id}", settings.RATE_LIMIT_MFA, 900)
    try:
        method = mfa.verify_second_factor(db, rec, code, allow_recovery=allow_recovery)
    except mfa.MfaError as error:
        record_audit_event(action="mfa_failed", resource_type="user", user_id=user.id, resource_id=user.id,
                           ip_address=_ip(request), details={"purpose": purpose})
        threat_guard.signal(request, "mfa_failed")
        raise _error(400, error.code, error.message)
    if method == "recovery":
        record_audit_event(action="mfa_recovery_code_used", resource_type="user", user_id=user.id,
                           resource_id=user.id, ip_address=_ip(request),
                           details={"purpose": purpose, "remaining": len(rec.recovery_code_hashes or [])})
        _notify(db, user, "mfa_recovery_code_used", "回復コードが使われました",
                "多要素認証の回復コードが1つ使われました。心当たりが無い場合は、すぐにパスワードを変更し、"
                "設定 → セキュリティで回復コードを作り直してください。")
    return method


def _notify(db: Session, user: User, kind: str, title: str, message: str) -> None:
    """本人への通知(乗っ取りに早く気付けるように)。失敗しても本来の操作は止めない。"""
    try:
        db.add(Notification(id=uuid.uuid4(), user_id=user.id, type=kind, title=title, message=message))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def _status(db: Session, user: User, session: Optional[UserSession]) -> MfaStatus:
    rec = mfa.get_record(db, user.id)
    enabled = rec is not None and rec.confirmed_at is not None
    verified_at = mfa.session_verified_at(session) if session is not None else None
    admin = mfa.is_admin(user)
    return MfaStatus(
        enabled=enabled,
        pending=rec is not None and rec.confirmed_at is None,
        confirmed_at=rec.confirmed_at if enabled else None,
        recovery_codes_remaining=len(rec.recovery_code_hashes or []) if enabled else 0,
        is_admin=admin,
        required=admin and bool(settings.ADMIN_MFA_REQUIRED),
        session_verified=bool(enabled and session is not None and (
            mfa.admin_session_fresh(session) if admin else verified_at is not None)),
        session_verified_at=verified_at if enabled else None,
    )


@router.get("", response_model=MfaStatus)
def get_mfa_status(response: Response, auth=Depends(member_auth), db: Session = Depends(get_db)):
    user = _member(auth)
    response.headers.update(NO_STORE)
    return _status(db, user, _session_for(db, auth))


@router.post("/setup", response_model=SetupResponse)
def setup_mfa(payload: PasswordOnly, request: Request, response: Response,
              current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    _reauth(request, current_user, payload.current_password, "mfa_setup")
    if not mfa.encryption_available():
        raise _error(503, "encryption_not_configured", "多要素認証の秘密を保存する暗号化が設定されていません"
                     "(サーバー側の ENCRYPTION_KEY 未設定)")
    rec = mfa.locked_record(db, current_user.id)
    if rec is not None and rec.confirmed_at is not None:
        db.commit()  # 行ロックを放す(変更は無い)
        raise _error(409, "mfa_already_enabled", "多要素認証はすでに有効です。設定し直す場合は、いったん無効にしてください")
    secret = mfa.new_secret()
    now = datetime.now(timezone.utc)
    if rec is None:
        rec = UserMfa(user_id=current_user.id, method="totp", totp_secret_ciphertext=mfa.encrypt_secret(secret),
                      recovery_code_hashes=[], recovery_salt=mfa.new_salt())
        db.add(rec)
    else:
        rec.totp_secret_ciphertext = mfa.encrypt_secret(secret)
        rec.last_used_step = None
        rec.recovery_code_hashes = []
        rec.updated_at = now
    db.commit()
    record_audit_event(action="mfa_setup_started", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, ip_address=_ip(request))
    response.headers.update(NO_STORE)
    account = current_user.email or current_user.username or str(current_user.id)
    return SetupResponse(secret=secret, otpauth_uri=mfa.otpauth_uri(secret, account), digits=mfa.TOTP_DIGITS,
                         period=mfa.TOTP_PERIOD, algorithm="SHA1")


@router.post("/enable", response_model=RecoveryCodesResponse)
def enable_mfa(payload: CodeOnly, request: Request, response: Response, auth=Depends(member_auth),
               db: Session = Depends(get_db)):
    current_user = _member(auth)
    rec = mfa.locked_record(db, current_user.id)
    if rec is None:
        db.commit()  # 行ロックを放す(変更は無い)
        raise _error(409, "mfa_setup_required", "先に多要素認証の設定を始めてください")
    if rec.confirmed_at is not None:
        db.commit()  # 行ロックを放す(変更は無い)
        raise _error(409, "mfa_already_enabled", "多要素認証はすでに有効です")
    _check_code(db, request, current_user, rec, payload.code, "mfa_enable", allow_recovery=False)
    codes = mfa.new_recovery_codes()
    rec = mfa.locked_record(db, current_user.id)
    rec.recovery_salt = mfa.new_salt()
    rec.recovery_code_hashes = [mfa.hash_recovery_code(c, rec.recovery_salt) for c in codes]
    rec.confirmed_at = datetime.now(timezone.utc)
    rec.updated_at = rec.confirmed_at
    db.commit()
    session = _session_for(db, auth)
    if session is not None:
        mfa.mark_session_verified(db, session)
    record_audit_event(action="mfa_enabled", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, ip_address=_ip(request))
    _notify(db, current_user, "mfa_enabled", "多要素認証を有効にしました",
            "今後のログインでは、パスワードのあとに認証アプリの確認コードが必要です。心当たりが無い場合は、"
            "すぐにパスワードを変更してください。")
    response.headers.update(NO_STORE)
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post("/disable")
def disable_mfa(payload: PasswordAndCode, request: Request, auth=Depends(member_auth),
                db: Session = Depends(get_db)):
    current_user = _member(auth)
    _reauth(request, current_user, payload.current_password, "mfa_disable")
    rec = mfa.locked_record(db, current_user.id)
    if rec is None or rec.confirmed_at is None:
        if rec is not None:
            db.delete(rec)
            db.commit()
        else:
            db.commit()  # 行ロックを放す(変更は無い)
        return {"enabled": False}
    _check_code(db, request, current_user, rec, payload.code, "mfa_disable")
    rec = mfa.locked_record(db, current_user.id)
    db.delete(rec)
    db.commit()
    session = _session_for(db, auth)
    auth_manager.revoke_all_user_sessions(str(current_user.id), db,
                                          except_session_id=str(session.id) if session is not None else None)
    record_audit_event(action="mfa_disabled", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, ip_address=_ip(request),
                       details={"other_sessions_revoked": True})
    _notify(db, current_user, "mfa_disabled", "多要素認証を無効にしました",
            "ほかの端末はログアウトしました。心当たりが無い場合は、すぐにパスワードを変更し、多要素認証を"
            "設定し直してください。")
    return {"enabled": False}


@router.post("/recovery-codes", response_model=RecoveryCodesResponse)
def regenerate_recovery_codes(payload: PasswordAndCode, request: Request, response: Response,
                              current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)):
    _reauth(request, current_user, payload.current_password, "mfa_recovery_codes")
    rec = mfa.locked_record(db, current_user.id)
    if rec is None or rec.confirmed_at is None:
        db.commit()  # 行ロックを放す(変更は無い)
        raise _error(409, "mfa_not_enabled", "多要素認証が有効ではありません")
    _check_code(db, request, current_user, rec, payload.code, "mfa_recovery_codes", allow_recovery=False)
    codes = mfa.new_recovery_codes()
    rec = mfa.locked_record(db, current_user.id)
    rec.recovery_salt = mfa.new_salt()
    rec.recovery_code_hashes = [mfa.hash_recovery_code(c, rec.recovery_salt) for c in codes]
    rec.updated_at = datetime.now(timezone.utc)
    db.commit()
    record_audit_event(action="mfa_recovery_codes_regenerated", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, ip_address=_ip(request))
    response.headers.update(NO_STORE)
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post("/step-up", response_model=MfaStatus)
def step_up(payload: CodeOnly, request: Request, response: Response, auth=Depends(member_auth),
            db: Session = Depends(get_db)):
    current_user = _member(auth)
    session = _session_for(db, auth)
    if session is None:
        raise _error(401, "session_required", "セッションが無効です。再度ログインしてください。")
    rec = mfa.locked_record(db, current_user.id)
    if rec is None or rec.confirmed_at is None:
        db.commit()  # 行ロックを放す(変更は無い)
        raise _error(409, "mfa_not_enabled", "多要素認証が有効ではありません")
    method = _check_code(db, request, current_user, rec, payload.code, "step_up")
    session = _session_for(db, auth)
    if session is None:
        raise _error(401, "session_required", "セッションが無効です。再度ログインしてください。")
    mfa.mark_session_verified(db, session)
    record_audit_event(action="mfa_step_up", resource_type="session", user_id=current_user.id,
                       resource_id=session.id, ip_address=_ip(request), details={"method": method})
    response.headers.update(NO_STORE)
    return _status(db, current_user, session)


@router.post("/verify", response_model=TokenResponse)
def verify_login(payload: VerifyRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """ログインの2段目。合図(mfa_token)は5分だけ有効で、成功は1つの合図につき1回だけ。"""
    client_ip = _ip(request)
    _limit(f"mfa_verify_ip:{client_ip}", settings.RATE_LIMIT_MFA * 3, 900)
    try:
        claims = mfa.read_mfa_token(payload.mfa_token)
    except mfa.MfaError as error:
        threat_guard.signal(request, "mfa_failed")
        raise _error(401, error.code, error.message)
    jti = str(claims["jti"])
    _limit(f"mfa_token_tries:{jti}", 5, mfa.MFA_TOKEN_TTL_SECONDS)
    user = db.query(User).filter(User.id == uuid.UUID(claims["sub"])).first()
    if user is None or not user.is_active:
        raise _error(401, "mfa_token_invalid", "確認の期限が切れました。もう一度ログインしてください")
    rec = mfa.locked_record(db, user.id)
    if rec is None or rec.confirmed_at is None:
        db.commit()  # 行ロックを放す(変更は無い)
        raise _error(401, "mfa_token_invalid", "確認の期限が切れました。もう一度ログインしてください")
    method = _check_code(db, request, user, rec, payload.code, "login")
    # 同じ合図で2つ目のセッションを作らせない(回数制限の仕組みで「使用済み」を共有する)
    if not check_rate_limit(f"mfa_token_used:{jti}", 1, mfa.MFA_TOKEN_TTL_SECONDS + 60):
        raise _error(401, "mfa_token_invalid", "確認の期限が切れました。もう一度ログインしてください")
    response.headers.update(NO_STORE)
    return complete_login(db, user, request, response, mfa_verified=True, mfa_method=method)
