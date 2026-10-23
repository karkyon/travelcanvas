"""[Gate S11] SEC-06 多要素認証(TOTP)。

管理者のアカウントは、パスワードが漏れただけで全利用者のデータ・アカウント停止の操作を奪われる。AI を使った
パスワードリスト攻撃(他のサイトで漏れたパスワードの大量試行)はパスワードだけでは止めきれないため、管理者には
認証アプリ(Google Authenticator・Microsoft Authenticator・1Password 等)の6桁のワンタイムパスワードを必須にする。
会員は任意で使える。

- TOTP(RFC 6238): HMAC-SHA1、30秒ごと、6桁。前後1区切り(±30秒)の時計のずれまで受け付ける。外部の
  ライブラリは使わない(標準ライブラリの hmac・hashlib・base64 だけ。依存を増やさず、監査の対象を増やさない)。
- 同じワンタイムパスワードは2回使えない: 最後に受け付けた区切り(last_used_step)以前の値は拒否する(リプレイ対策)。
- 秘密は ENCRYPTION_KEY で暗号化して保存する。回復コード(端末をなくした時の予備)は平文で保存せず、
  利用者ごとの塩と PBKDF2-SHA256 のハッシュだけを持つ(使った回復コードは一覧から消す)。
- ログインの2段目に渡す「確認待ちの合図(mfa_token)」は、利用者・用途を署名した5分だけ有効の JWT。
  1つの合図で作れるセッションは1つだけ(使った合図は回数制限の仕組みで使用済みにする)。
- セッション(UserSession.device_info の内部の値)に、多要素認証を通った時刻を残す。管理者の API はこの時刻が
  ADMIN_MFA_MAX_AGE_HOURS 以内のセッションだけを通す(app/api/v1/admin.py)。

秘密・ワンタイムパスワード・回復コードは、ログ・監査・例外のメッセージに出さない。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import jwt

from app.core.config import settings

TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_WINDOW = 1
SECRET_BYTES = 20
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_GROUP = 5
RECOVERY_PBKDF2_ITERATIONS = 60_000
MFA_TOKEN_TTL_SECONDS = 300
MFA_TOKEN_TYPE = "mfa_pending"
ISSUER = "TravelCanvas"

# UserSession.device_info の内部の値(セッション一覧の応答には出さない。app/api/v1/auth.py の _INTERNAL_DEVICE_INFO_KEYS)
SESSION_MFA_KEY = "_mfa_verified_at"

ADMIN_TYPES = {"admin", "super_admin"}

_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # 見間違えやすい i l o 0 1 を除く


class MfaError(Exception):
    """利用者に見せてよい理由(code)を持つ失敗。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# TOTP
# ---------------------------------------------------------------------------


def new_secret() -> str:
    """base32(= 認証アプリに手で入力できる形)の新しい秘密。"""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode("ascii").rstrip("=")


def _secret_bytes(secret_b32: str) -> bytes:
    cleaned = "".join(secret_b32.split()).upper()
    pad = "=" * (-len(cleaned) % 8)
    return base64.b32decode(cleaned + pad, casefold=True)


def totp_at(secret_b32: str, step: int, digits: int = TOTP_DIGITS) -> str:
    mac = hmac.new(_secret_bytes(secret_b32), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    value = (struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(value).zfill(digits)


def current_step(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // TOTP_PERIOD)


def normalize_code(code: Optional[str]) -> str:
    return "".join(ch for ch in str(code or "") if not ch.isspace() and ch != "-").lower()


def looks_like_totp(code: Optional[str]) -> bool:
    c = normalize_code(code)
    return len(c) == TOTP_DIGITS and c.isdigit()


def match_totp(secret_b32: str, code: Optional[str], *, last_used_step: Optional[int],
               now: Optional[float] = None) -> Optional[int]:
    """一致した区切り(step)を返す。一致しない・使用済みの区切りなら None。比較は時間一定。"""
    if not looks_like_totp(code):
        return None
    presented = normalize_code(code)
    base = current_step(now)
    found: Optional[int] = None
    for delta in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        step = base + delta
        if hmac.compare_digest(totp_at(secret_b32, step), presented) and found is None:
            found = step
    if found is None:
        return None
    if last_used_step is not None and found <= int(last_used_step):
        return None
    return found


def otpauth_uri(secret_b32: str, account: str) -> str:
    """認証アプリに読み込ませる URI(QR コードにする。端末内で作り、外部へ送らない)。"""
    label = quote(f"{ISSUER}:{account}", safe="")
    return (f"otpauth://totp/{label}?secret={secret_b32}&issuer={quote(ISSUER)}"
            f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD}")


# ---------------------------------------------------------------------------
# 暗号化・回復コード
# ---------------------------------------------------------------------------


def encrypt_secret(secret_b32: str) -> bytes:
    """[Gate G3] SEC-F6 MFA_KEY(版つき、データの暗号化の鍵とは別)があればそれで包む。無ければ ENCRYPTION_KEY。"""
    from app.core.crypto import encrypt_mfa

    return encrypt_mfa(secret_b32.encode("ascii"))


def decrypt_secret(ciphertext: bytes) -> str:
    from app.core.crypto import decrypt_payload

    return decrypt_payload(bytes(ciphertext)).decode("ascii")


def encryption_available() -> bool:
    try:
        from app.core.crypto import _get_fernet

        _get_fernet()
        return True
    except Exception:  # noqa: BLE001 - 未設定(EncryptionNotConfigured)を含む
        return False


def new_recovery_codes() -> List[str]:
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(RECOVERY_CODE_GROUP * 2))
        codes.append(f"{raw[:RECOVERY_CODE_GROUP]}-{raw[RECOVERY_CODE_GROUP:]}")
    return codes


def new_salt() -> str:
    return secrets.token_hex(16)


def hash_recovery_code(code: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", normalize_code(code).encode("utf-8"), bytes.fromhex(salt),
                                 RECOVERY_PBKDF2_ITERATIONS)
    return digest.hex()


def looks_like_recovery_code(code: Optional[str]) -> bool:
    c = normalize_code(code)
    return len(c) == RECOVERY_CODE_GROUP * 2 and all(ch in _RECOVERY_ALPHABET for ch in c)


def match_recovery_code(code: Optional[str], salt: str, hashes: List[str]) -> Optional[int]:
    """一致した回復コードの位置。ハッシュは1回だけ計算し、全件と時間一定で比べる。"""
    if not looks_like_recovery_code(code):
        return None
    presented = hash_recovery_code(str(code), salt)
    found = None
    for i, h in enumerate(hashes or []):
        if hmac.compare_digest(str(h), presented) and found is None:
            found = i
    return found


# ---------------------------------------------------------------------------
# 利用者・セッション
# ---------------------------------------------------------------------------


def is_admin(user) -> bool:
    if user is None:
        return False
    user_type = str(getattr(getattr(user, "user_type", None), "value", getattr(user, "user_type", None)) or "")
    return user_type in ADMIN_TYPES or bool(getattr(user, "is_superuser", False)) or \
        str(getattr(user, "role", "") or "") == "admin"


def get_record(db, user_id):
    from app.models.models import UserMfa

    return db.query(UserMfa).filter(UserMfa.user_id == user_id).first()


def enabled_record(db, user_id):
    rec = get_record(db, user_id)
    return rec if rec is not None and rec.confirmed_at is not None else None


def is_enabled(db, user_id) -> bool:
    return enabled_record(db, user_id) is not None


def session_verified_at(session) -> Optional[datetime]:
    info = getattr(session, "device_info", None) or {}
    raw = info.get(SESSION_MFA_KEY) if isinstance(info, dict) else None
    if not isinstance(raw, str):
        return None
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def mark_session_verified(db, session, now: Optional[datetime] = None) -> None:
    info = dict(session.device_info or {})
    info[SESSION_MFA_KEY] = (now or datetime.now(timezone.utc)).isoformat()
    session.device_info = info
    db.commit()


def admin_session_fresh(session, now: Optional[datetime] = None) -> bool:
    at = session_verified_at(session)
    if at is None:
        return False
    now = now or datetime.now(timezone.utc)
    max_age = timedelta(hours=float(getattr(settings, "ADMIN_MFA_MAX_AGE_HOURS", 12)))
    return timedelta(0) <= now - at <= max_age


def verify_second_factor(db, rec, code: Optional[str], *, allow_recovery: bool = True,
                         now: Optional[float] = None) -> str:
    """ワンタイムパスワード(または回復コード)を確かめ、使用済みにして commit する。

    呼び出し元は rec を SELECT … FOR UPDATE で取っておく(同じ値の同時送信を1つだけ通すため)。
    戻り値は "totp" / "recovery"。一致しなければ MfaError。"""
    secret = decrypt_secret(rec.totp_secret_ciphertext)
    step = match_totp(secret, code, last_used_step=rec.last_used_step, now=now)
    if step is not None:
        rec.last_used_step = step
        rec.updated_at = datetime.now(timezone.utc)
        db.commit()
        return "totp"
    if allow_recovery and rec.confirmed_at is not None:
        hashes = list(rec.recovery_code_hashes or [])
        idx = match_recovery_code(code, rec.recovery_salt, hashes)
        if idx is not None:
            hashes.pop(idx)
            rec.recovery_code_hashes = hashes
            rec.updated_at = datetime.now(timezone.utc)
            db.commit()
            return "recovery"
    db.commit()  # 行ロックを放す(変更は無い)
    raise MfaError("mfa_invalid_code", "確認コードが正しくないか、すでに使われています")


def locked_record(db, user_id):
    from app.models.models import UserMfa

    return db.query(UserMfa).filter(UserMfa.user_id == user_id).with_for_update().first()


# ---------------------------------------------------------------------------
# ログインの2段目に渡す合図(mfa_token)
# ---------------------------------------------------------------------------


def issue_mfa_token(user_id, *, now: Optional[datetime] = None) -> Tuple[str, str]:
    now = now or datetime.now(timezone.utc)
    jti = uuid.uuid4().hex
    payload = {
        "sub": str(user_id),
        "type": MFA_TOKEN_TYPE,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=MFA_TOKEN_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM), jti


def read_mfa_token(token: Optional[str]) -> Dict[str, Any]:
    """署名・期限・用途を確かめる。合わなければ MfaError(理由は利用者向けの1種類だけ)。"""
    try:
        payload = jwt.decode(str(token or ""), settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM],
                             options={"require": ["exp", "sub", "type", "jti"]})
    except jwt.PyJWTError:
        raise MfaError("mfa_token_invalid", "確認の期限が切れました。もう一度ログインしてください")
    if payload.get("type") != MFA_TOKEN_TYPE:
        raise MfaError("mfa_token_invalid", "確認の期限が切れました。もう一度ログインしてください")
    try:
        payload["sub"] = str(uuid.UUID(str(payload["sub"])))
    except ValueError:
        raise MfaError("mfa_token_invalid", "確認の期限が切れました。もう一度ログインしてください")
    return payload
