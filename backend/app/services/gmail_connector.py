"""[Gate Remaining-7] FR-011 Gmail の連携(読み取りだけ)。

- 利用者が自分の Google アカウントで許可した時だけ(OAuth 2.0・権限は openid email gmail.readonly)
- refresh token は ENCRYPTION_KEY で暗号化して持つ。外すと Google へ取り消しを送り、行を消す
- 取り込むのは利用者が押した時だけ(自動で読みに行かない)。予約らしいメールを最大 MAX_MESSAGES 通だけ読み、
  転送アドレスと同じ読み取り(候補)にする。確定は人が画面で行う。メールの本文は保存しない
- 同じメールは 2 回取り込まない(メールの ID の sha256 だけを持つ)
- 送り先は Google の固定の URL だけ。OAuth の state は署名つき・10 分で切れる(利用者に結び付く)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_payload, encrypt_payload, user_subject
from app.models.models import GmailConnection
from app.services import ext_http
from app.services import provider_secrets as ps

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
SCOPE = "openid email https://www.googleapis.com/auth/gmail.readonly"
STATE_TTL = 600
MAX_MESSAGES = 20
MAX_SEEN = 500
DEFAULT_DAYS = 30
QUERY_WORDS = ("予約", "予約確認", "ご予約", "搭乗", "eチケット", "booking", "reservation", "itinerary",
               "confirmation")
SLOT_ID, SLOT_SECRET = "google_oauth_client_id", "google_oauth_client_secret"


class GmailError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(code)
        self.code, self.message, self.status = code, message, status


def credentials(db: Session) -> Optional[Tuple[str, str]]:
    try:
        return ps.resolve(db, SLOT_ID), ps.resolve(db, SLOT_SECRET)
    except ps.SecretUnavailable:
        return None


def available(db: Session) -> bool:
    return credentials(db) is not None


def _key() -> bytes:
    return hashlib.sha256(f"tc-gmail-state:{settings.JWT_SECRET_KEY}".encode()).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_state(user_id: Any, plan_id: Optional[str], now: Optional[float] = None) -> str:
    body = json.dumps({"u": str(user_id), "p": plan_id, "e": int((now or time.time()) + STATE_TTL),
                       "n": uuid.uuid4().hex}, separators=(",", ":")).encode()
    sig = hmac.new(_key(), body, hashlib.sha256).digest()[:20]
    return f"{_b64(body)}.{_b64(sig)}"


def read_state(state: str, now: Optional[float] = None) -> Dict[str, Any]:
    try:
        raw, sig = state.split(".", 1)
        body = _unb64(raw)
        if not hmac.compare_digest(hmac.new(_key(), body, hashlib.sha256).digest()[:20], _unb64(sig)):
            raise ValueError("sig")
        data = json.loads(body)
        if int(data["e"]) < (now or time.time()):
            raise ValueError("expired")
        uuid.UUID(data["u"])
        return data
    except (ValueError, KeyError, TypeError):
        raise GmailError("invalid_state", "連携の手続きが切れたか、正しくありません。もう一度始めてください", 400)


def redirect_uri() -> str:
    origins = list(getattr(settings, "cors_allowed_origins", None) or [])
    base = (origins[0] if origins else "http://localhost:8001").rstrip("/")
    return f"{base}/api/v1/integrations/gmail/callback"


def authorize_url(db: Session, user_id: Any, plan_id: Optional[str]) -> str:
    creds = credentials(db)
    if creds is None:
        raise GmailError("gmail_unavailable", "この環境では Gmail の連携が設定されていません(管理者の設定が必要です)")
    params = {"client_id": creds[0], "redirect_uri": redirect_uri(), "response_type": "code", "scope": SCOPE,
              "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true",
              "state": make_state(user_id, plan_id)}
    return f"{AUTH_URL}?{urlencode(params)}"


def _email_from_id_token(id_token: Any) -> Optional[str]:
    """Google の token の応答(TLS で Google から直接受けた物)の id_token からメールを読む。署名の検査は token の
    交換の相手が Google であることで代える(画面の表示にだけ使い、認証には使わない)。"""
    try:
        payload = json.loads(_unb64(str(id_token).split(".")[1]))
        email = payload.get("email")
        return str(email)[:320] if email else None
    except (ValueError, IndexError, AttributeError):
        return None


def exchange_code(db: Session, user_id: Any, code: str) -> GmailConnection:
    creds = credentials(db)
    if creds is None:
        raise GmailError("gmail_unavailable", "この環境では Gmail の連携が設定されていません")
    try:
        body = ext_http.post_form("google_oauth", TOKEN_URL, {
            "code": code, "client_id": creds[0], "client_secret": creds[1], "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code"})
    except ext_http.Unavailable:
        raise GmailError("gmail_exchange_failed", "Google から許可を受け取れませんでした。もう一度試してください", 502)
    refresh = body.get("refresh_token") if isinstance(body, dict) else None
    granted = str((body or {}).get("scope") or "")
    if not refresh:
        raise GmailError("gmail_no_refresh_token", "Google から長く使える許可が届きませんでした。もう一度試してください", 502)
    if "gmail.readonly" not in granted:
        raise GmailError("gmail_scope_missing", "Gmail を読む許可がありませんでした(許可の画面で Gmail に印を付けてください)", 400)
    row = db.query(GmailConnection).filter(GmailConnection.user_id == user_id).first()
    if row is None:
        row = GmailConnection(user_id=user_id, refresh_token_ciphertext=b"", scope="")
        db.add(row)
    row.refresh_token_ciphertext = encrypt_payload(refresh.encode("utf-8"), user_subject(user_id))
    row.scope = granted[:200]
    row.google_email = _email_from_id_token(body.get("id_token"))
    row.last_error = None
    return row


def _access_token(db: Session, row: GmailConnection) -> str:
    creds = credentials(db)
    if creds is None:
        raise GmailError("gmail_unavailable", "この環境では Gmail の連携が設定されていません")
    refresh = decrypt_payload(row.refresh_token_ciphertext).decode("utf-8")
    try:
        body = ext_http.post_form("google_oauth", TOKEN_URL, {
            "client_id": creds[0], "client_secret": creds[1], "refresh_token": refresh,
            "grant_type": "refresh_token"})
    except ext_http.Unavailable as error:
        row.last_error = "token_" + error.code
        raise GmailError("gmail_token_failed", "Gmail の許可が使えませんでした。連携し直してください", 409)
    token = body.get("access_token") if isinstance(body, dict) else None
    if not token:
        raise GmailError("gmail_token_failed", "Gmail の許可が使えませんでした。連携し直してください", 409)
    return str(token)


def query(days: int) -> str:
    words = " OR ".join(QUERY_WORDS)
    return f"newer_than:{max(1, min(int(days), 180))}d ({words})"


def _seen_hash(message_id: str) -> str:
    return hashlib.sha256(f"gmail:{message_id}".encode()).hexdigest()[:32]


def fetch_new_messages(db: Session, row: GmailConnection, days: int = DEFAULT_DAYS) -> List[Tuple[str, bytes]]:
    """まだ取り込んでいない予約らしいメール(最大 MAX_MESSAGES 通)の生のメール。"""
    token = _access_token(db, row)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        listed = ext_http.get_json("gmail_api", GMAIL_URL, params={"q": query(days), "maxResults": MAX_MESSAGES},
                                   headers=headers, timeout=10.0)
    except ext_http.Unavailable as error:
        row.last_error = "list_" + error.code
        raise GmailError("gmail_read_failed", "Gmail を読めませんでした。しばらくしてから試してください", 502)
    seen = set(row.seen_message_hashes or [])
    out: List[Tuple[str, bytes]] = []
    for item in (listed.get("messages") or [])[:MAX_MESSAGES] if isinstance(listed, dict) else []:
        mid = str(item.get("id") or "") if isinstance(item, dict) else ""
        if not mid or not mid.isalnum() or _seen_hash(mid) in seen:
            continue
        try:
            msg = ext_http.get_json("gmail_api", f"{GMAIL_URL}/{mid}", params={"format": "raw"}, headers=headers,
                                    timeout=10.0)
            raw = _unb64(str(msg.get("raw") or ""))
        except (ext_http.Unavailable, ValueError):
            continue
        if raw:
            out.append((mid, raw))
    return out


def mark_seen(row: GmailConnection, message_ids: List[str]) -> None:
    seen = list(row.seen_message_hashes or [])
    for mid in message_ids:
        h = _seen_hash(mid)
        if h not in seen:
            seen.append(h)
    row.seen_message_hashes = seen[-MAX_SEEN:]


def revoke(db: Session, row: GmailConnection) -> None:
    """Google へ取り消しを送る(失敗しても行は消す。Google のアカウントの画面からも外せる)。"""
    try:
        refresh = decrypt_payload(row.refresh_token_ciphertext).decode("utf-8")
        ext_http.post_form("google_oauth", REVOKE_URL, {"token": refresh})
    except Exception:  # noqa: BLE001 - 取り消しの失敗で連携を残さない
        pass


def summary(db: Session, row: Optional[GmailConnection]) -> Dict[str, Any]:
    return {
        "available": available(db),
        "connected": row is not None,
        "google_email": row.google_email if row else None,
        "last_sync_at": row.last_sync_at.isoformat() if row and row.last_sync_at else None,
        "imported_count": row.imported_count if row else 0,
        "last_error": row.last_error if row else None,
        "scope": "gmail.readonly",
        "max_messages": MAX_MESSAGES,
    }
