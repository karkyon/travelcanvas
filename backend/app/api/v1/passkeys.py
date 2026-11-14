"""[Gate Remaining-7] FR-003 passkey(パスワード無しのログイン。WebAuthn)。

- GET    /auth/passkeys                     : 自分の passkey の一覧(名前・作った日・最後に使った日)
- POST   /auth/passkeys/register/options   : 登録の問題(challenge)。ログインしている登録ユーザーだけ
- POST   /auth/passkeys/register            : 端末が作った公開鍵を確かめて保存する(本人の確認 UV を求める)
- DELETE /auth/passkeys/{id}                : passkey を消す
- POST   /auth/passkeys/login/options       : ログインの問題(端末に入っている passkey を選ぶ形。メールは聞かない)
- POST   /auth/passkeys/login               : 署名を確かめてログインする(多要素認証を満たした扱い: 端末の所持 + 本人の確認)

- 問題(challenge)は 32 byte の乱数。サーバーは保存せず、署名つきの state(5 分・1 回だけ)に入れて返す
- RP ID は画面の origin(CORS の 1 つ目)の host。WEBAUTHN_RP_ID で変えられる。origin は CORS の許可の一覧
- 署名の回数(sign count)が戻ったら複製の疑いとして断る(0 のままの端末は許す)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import auth as auth_api
from app.core.auth import get_current_active_user
from app.core.config import settings
from app.core.database import get_db
from app.models.models import User, WebauthnCredential
from app.services import challenge as chal
from app.services.audit_service import record_audit_event
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/passkeys", tags=["authentication"])

STATE_TTL = 300
MAX_PASSKEYS = 10
RP_NAME = "TravelCanvas"


def _bad(code: str, message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def origins() -> List[str]:
    return [o.rstrip("/") for o in (getattr(settings, "cors_allowed_origins", None) or []) if o]


def rp_id() -> str:
    configured = (getattr(settings, "WEBAUTHN_RP_ID", None) or "").strip()
    if configured:
        return configured
    first = origins()[0] if origins() else "http://localhost"
    return urlsplit(first).hostname or "localhost"


def _key() -> bytes:
    return hashlib.sha256(f"tc-passkey:{settings.JWT_SECRET_KEY}".encode()).digest()


def _make_state(purpose: str, challenge_bytes: bytes, user_id: Optional[Any]) -> str:
    body = json.dumps({"p": purpose, "c": _b64(challenge_bytes), "u": str(user_id) if user_id else None,
                       "e": int(time.time()) + STATE_TTL, "n": uuid.uuid4().hex}, separators=(",", ":")).encode()
    return f"{_b64(body)}.{_b64(hmac.new(_key(), body, hashlib.sha256).digest()[:20])}"


def _read_state(state: str, purpose: str, user_id: Optional[Any] = None) -> bytes:
    try:
        raw, sig = state.split(".", 1)
        body = _unb64(raw)
        if not hmac.compare_digest(hmac.new(_key(), body, hashlib.sha256).digest()[:20], _unb64(sig)):
            raise ValueError("sig")
        data = json.loads(body)
        if data["p"] != purpose or int(data["e"]) < time.time():
            raise ValueError("purpose")
        if user_id is not None and data["u"] != str(user_id):
            raise ValueError("user")
        if not chal._mark_used("pk:" + data["n"], int(data["e"])):  # noqa: SLF001 - 1 回だけ使える
            raise ValueError("used")
        return _unb64(data["c"])
    except (ValueError, KeyError, TypeError):
        raise _bad("passkey_state_invalid", "手続きの期限が切れたか、正しくありません。もう一度試してください")


def _view(c: WebauthnCredential) -> Dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "created_at": c.created_at.isoformat() if c.created_at else None,
            "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None, "backed_up": bool(c.backed_up)}


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: str = Field(..., max_length=1000)
    credential: Dict[str, Any]
    name: str = Field("passkey", min_length=1, max_length=60)


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: str = Field(..., max_length=1000)
    credential: Dict[str, Any]


@router.get("")
def list_passkeys(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    rows = (db.query(WebauthnCredential).filter(WebauthnCredential.user_id == current_user.id)
            .order_by(WebauthnCredential.created_at).all())
    return {"passkeys": [_view(c) for c in rows], "rp_id": rp_id()}


@router.post("/register/options")
def register_options(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    import webauthn
    from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
                                          ResidentKeyRequirement, UserVerificationRequirement)

    if current_user.user_type == "guest" or not current_user.email:
        raise _bad("passkey_guest", "ゲストのままでは passkey を作れません(アカウントを作ってください)", 403)
    existing = db.query(WebauthnCredential).filter(WebauthnCredential.user_id == current_user.id).all()
    if len(existing) >= MAX_PASSKEYS:
        raise _bad("passkey_limit", f"passkey は {MAX_PASSKEYS} 個までです(使わない物を消してください)", 409)
    challenge_bytes = secrets.token_bytes(32)
    options = webauthn.generate_registration_options(
        rp_id=rp_id(), rp_name=RP_NAME, user_id=current_user.id.bytes, user_name=current_user.email,
        user_display_name=current_user.username or current_user.email, challenge=challenge_bytes,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=_unb64(c.credential_id)) for c in existing])
    return {"options": json.loads(webauthn.options_to_json(options)),
            "state": _make_state("register", challenge_bytes, current_user.id)}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_active_user)):
    import webauthn
    from webauthn.helpers.exceptions import InvalidRegistrationResponse

    if current_user.user_type == "guest":
        raise _bad("passkey_guest", "ゲストのままでは passkey を作れません", 403)
    expected = _read_state(body.state, "register", current_user.id)
    try:
        verified = webauthn.verify_registration_response(
            credential=body.credential, expected_challenge=expected, expected_rp_id=rp_id(),
            expected_origin=origins() or ["http://localhost"], require_user_verification=True)
    except (InvalidRegistrationResponse, ValueError, KeyError, TypeError):
        raise _bad("passkey_invalid", "passkey を確かめられませんでした。もう一度試してください")
    cred_id = _b64(verified.credential_id)
    if db.query(WebauthnCredential).filter(WebauthnCredential.credential_id == cred_id).first() is not None:
        raise _bad("passkey_exists", "この passkey は登録済みです", 409)
    row = WebauthnCredential(id=uuid.uuid4(), user_id=current_user.id, credential_id=cred_id,
                             public_key=verified.credential_public_key, sign_count=verified.sign_count,
                             transports=(body.credential.get("response") or {}).get("transports"),
                             name=body.name.strip()[:60] or "passkey",
                             backed_up=bool(getattr(verified, "credential_backed_up", False)))
    db.add(row)
    db.commit()
    record_audit_event(action="passkey_registered", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, ip_address=request.client.host if request.client else None,
                       details={"passkey_id": str(row.id)})
    return _view(row)


@router.delete("/{passkey_id}")
def delete_passkey(passkey_id: str, request: Request, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_active_user)):
    try:
        pid = uuid.UUID(passkey_id)
    except ValueError:
        raise _bad("passkey_not_found", "passkey が見つかりません", 404)
    row = db.query(WebauthnCredential).filter(WebauthnCredential.id == pid,
                                              WebauthnCredential.user_id == current_user.id).first()
    if row is None:
        raise _bad("passkey_not_found", "passkey が見つかりません", 404)
    db.delete(row)
    db.commit()
    record_audit_event(action="passkey_deleted", resource_type="user", user_id=current_user.id,
                       resource_id=current_user.id, ip_address=request.client.host if request.client else None,
                       details={"passkey_id": passkey_id})
    return {"deleted": True}


@router.post("/login/options")
def login_options(request: Request):
    import webauthn
    from webauthn.helpers.structs import UserVerificationRequirement

    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"passkey_opts:{ip}", 30, 600):
        raise _bad("too_many_requests", "回数が多すぎます。しばらく待ってください", 429)
    challenge_bytes = secrets.token_bytes(32)
    options = webauthn.generate_authentication_options(
        rp_id=rp_id(), challenge=challenge_bytes, user_verification=UserVerificationRequirement.REQUIRED)
    return {"options": json.loads(webauthn.options_to_json(options)),
            "state": _make_state("login", challenge_bytes, None)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    import webauthn
    from webauthn.helpers.exceptions import InvalidAuthenticationResponse

    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login_ip:{ip}", settings.RATE_LIMIT_AUTH, 60):
        raise _bad("too_many_requests", "ログインの試行が多すぎます。しばらく待ってください", 429)
    expected = _read_state(body.state, "login")
    raw_id = str(body.credential.get("rawId") or body.credential.get("id") or "")
    row = (db.query(WebauthnCredential).filter(WebauthnCredential.credential_id == raw_id.rstrip("="))
           .with_for_update().first())
    user = db.query(User).filter(User.id == row.user_id).first() if row is not None else None
    if row is None or user is None or not user.is_active:
        record_audit_event(action="login_failed", resource_type="user", user_id=user.id if user else None,
                           ip_address=ip, details={"via": "passkey", "reason": "unknown_credential"})
        raise _bad("passkey_unknown", "この passkey は登録されていません", 401)
    try:
        verified = webauthn.verify_authentication_response(
            credential=body.credential, expected_challenge=expected, expected_rp_id=rp_id(),
            expected_origin=origins() or ["http://localhost"], credential_public_key=row.public_key,
            credential_current_sign_count=int(row.sign_count or 0), require_user_verification=True)
    except (InvalidAuthenticationResponse, ValueError, KeyError, TypeError):
        record_audit_event(action="login_failed", resource_type="user", user_id=user.id, ip_address=ip,
                           details={"via": "passkey", "reason": "invalid_signature"})
        raise _bad("passkey_invalid", "passkey を確かめられませんでした", 401)
    row.sign_count = int(verified.new_sign_count)
    row.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return auth_api.complete_login(db, user, request, response, mfa_verified=True, mfa_method="passkey")
