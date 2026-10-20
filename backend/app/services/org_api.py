"""[Gate B1] FR-042 API・Webhook(最小形)。

DOC-02 FR-042「外部事業者が旅行、イベント、場所、予約の限定操作を行える。OAuthスコープ、Webhook署名、レート制限、
監査を必須とする」、DOC-06 §16「timestamp、event_id、HMAC署名、secret rotation、再送、dead-letter、購読スコープ。
内部の秘密フィールドを標準payloadに含めない」、§17 レート。

- 認可: OAuth 2.0 client_credentials(RFC 6749 §4.4)。組織の管理者が API クライアントを作り、秘密は作成時に1回だけ返す
  (DB はハッシュだけ)。トークンは1時間の不透明なトークンで、DB はハッシュだけ。スコープは作成時の範囲から絞れる。
- 外部 API は組織の配布版(写し)だけを読める。個人の旅行・予約・メンバーの個人情報は読めない(読み取り専用)。
- Webhook: https だけ。localhost・内部のアドレス(IP の直書き・名前解決の結果)へは送らない(SSRF 対策)。本文は配布の ID・
  版・件数だけ。署名 `X-TravelCanvas-Signature: t=<unix>,v1=<HMAC-SHA256(secret, "<t>.<本文>")>`、`X-TravelCanvas-Event-Id`
  で受け手が重複を除ける。送信の記録を残し、失敗は再送できる。転送(リダイレクト)は追わない。
"""
import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_payload, encrypt_payload
from app.models.models import OrgApiClient, OrgApiToken, OrgWebhook, OrgWebhookDelivery

SCOPES = {
    "distributions:read": "配布する旅程(写し)の一覧と内容を読む",
    "acknowledgements:read": "配布の閲覧確認の件数を読む(誰が確認したかは含まない)",
}
EVENTS = {
    "distribution.published": "配布を始めた",
    "distribution.revised": "配布の版を上げた",
    "distribution.revoked": "配布をやめた",
    "distribution.acknowledged": "メンバーが最新版を確認した(件数だけ)",
}
TOKEN_TTL = timedelta(hours=1)
MAX_CLIENTS = 10
MAX_WEBHOOKS = 5
SEND_TIMEOUT = 5.0
MAX_ATTEMPTS = 5
SIGNATURE_HEADER = "X-TravelCanvas-Signature"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# ---------- API クライアント・トークン ----------

def clean_scopes(raw: Any, allowed: Optional[Iterable[str]] = None) -> List[str]:
    allowed_set = set(allowed) if allowed is not None else set(SCOPES)
    if isinstance(raw, str):
        raw = raw.split()
    if not isinstance(raw, list) or not raw or not all(isinstance(s, str) for s in raw):
        raise ValueError("invalid_scope")
    if any(s not in allowed_set for s in raw):
        raise ValueError("invalid_scope")
    return sorted(set(raw))


def new_client_credentials() -> Tuple[str, str]:
    return "tcc_" + secrets.token_hex(12), "tcs_" + secrets.token_urlsafe(32)


def verify_client(db: Session, client_id: str, client_secret: str) -> Optional[OrgApiClient]:
    if not client_id or not client_secret or len(client_id) > 40 or len(client_secret) > 100:
        return None
    client = db.query(OrgApiClient).filter(OrgApiClient.client_id == client_id).first()
    expected = client.secret_hash if client else sha256("not-a-client")
    ok = hmac.compare_digest(expected, sha256(client_secret))
    if not client or not ok or client.revoked_at is not None:
        return None
    return client


def issue_token(db: Session, client: OrgApiClient, scopes: List[str]) -> Tuple[str, OrgApiToken]:
    raw = "tcat_" + secrets.token_urlsafe(32)
    t = _now()
    # 期限切れのトークンは掃除する(このクライアントの分)
    db.query(OrgApiToken).filter(OrgApiToken.client_id == client.id, OrgApiToken.expires_at < t) \
        .delete(synchronize_session=False)
    tok = OrgApiToken(id=uuid.uuid4(), client_id=client.id, token_hash=sha256(raw), scopes=scopes,
                      expires_at=t + TOKEN_TTL)
    client.last_used_at = t
    db.add(tok)
    return raw, tok


def resolve_token(db: Session, raw: str) -> Optional[Tuple[OrgApiToken, OrgApiClient]]:
    if not raw or not raw.startswith("tcat_") or len(raw) > 100:
        return None
    tok = db.query(OrgApiToken).filter(OrgApiToken.token_hash == sha256(raw)).first()
    if not tok or tok.expires_at <= _now():
        return None
    client = db.query(OrgApiClient).filter(OrgApiClient.id == tok.client_id).first()
    if not client or client.revoked_at is not None:
        return None
    return tok, client


def revoke_client(db: Session, client: OrgApiClient) -> None:
    client.revoked_at = client.revoked_at or _now()
    db.query(OrgApiToken).filter(OrgApiToken.client_id == client.id).delete(synchronize_session=False)


# ---------- Webhook ----------

def _blocked_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved
            or addr.is_unspecified or (addr.version == 6 and addr.ipv4_mapped is not None
                                       and _blocked_ip(str(addr.ipv4_mapped))))


def check_url(url: Any) -> str:
    """登録時の検査。https だけ・資格情報なし・localhost/内部の IP の直書きなし。"""
    if not isinstance(url, str) or len(url) > 2000 or any(ord(c) < 33 for c in url):
        raise ValueError("invalid_url")
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("invalid_url")
    host = parts.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
        raise ValueError("blocked_host")
    try:
        ipaddress.ip_address(host)
        if _blocked_ip(host):
            raise ValueError("blocked_host")
    except ValueError as e:
        if str(e) == "blocked_host":
            raise
    try:
        parts.port
    except ValueError:
        raise ValueError("invalid_url")
    return url


def resolves_to_public(host: str, port: int) -> bool:
    """送信の直前に名前解決し、内部のアドレスになる宛先へは送らない。"""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    return bool(infos) and not any(_blocked_ip(i[4][0]) for i in infos)


def clean_events(raw: Any) -> List[str]:
    if not isinstance(raw, list) or not raw or not all(isinstance(e, str) and e in EVENTS for e in raw):
        raise ValueError("invalid_events")
    return sorted(set(raw))


def new_webhook_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


def seal_secret(secret: str) -> bytes:
    return encrypt_payload(secret.encode("utf-8"))


def sign(secret: str, timestamp: int, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify_signature(secret: str, header: str, body: bytes, tolerance: int = 300, now: Optional[int] = None) -> bool:
    """受け手の検証の見本(試験と文書で使う)。"""
    try:
        fields = dict(p.split("=", 1) for p in header.split(","))
        ts = int(fields["t"])
    except (ValueError, KeyError):
        return False
    if abs((now or int(time.time())) - ts) > tolerance:
        return False
    return hmac.compare_digest(sign(secret, ts, body), f"t={ts},v1={fields.get('v1', '')}")


def enqueue(db: Session, org_id, event_type: str, data: Dict[str, Any]) -> List[uuid.UUID]:
    """購読している Webhook ごとに送信の記録を作る(送るのは deliver)。"""
    hooks = db.query(OrgWebhook).filter(OrgWebhook.organization_id == org_id, OrgWebhook.revoked_at.is_(None)).all()
    ids = []
    for h in hooks:
        if event_type != "ping" and event_type not in (h.events or []):
            continue
        event_id = uuid.uuid4()
        payload = {"id": str(event_id), "type": event_type, "created_at": _now().isoformat(),
                   "organization_id": str(org_id), "data": data}
        d = OrgWebhookDelivery(id=uuid.uuid4(), webhook_id=h.id, event_id=event_id, event_type=event_type,
                               payload=payload, status="pending")
        db.add(d)
        ids.append(d.id)
    db.flush()
    return ids


def _post(url: str, body: bytes, headers: Dict[str, str]) -> int:
    import httpx
    with httpx.Client(timeout=SEND_TIMEOUT, follow_redirects=False) as client:
        return client.post(url, content=body, headers=headers).status_code


def deliver(db: Session, delivery: OrgWebhookDelivery) -> OrgWebhookDelivery:
    hook = db.query(OrgWebhook).filter(OrgWebhook.id == delivery.webhook_id).first()
    delivery.attempts = (delivery.attempts or 0) + 1
    if not hook or hook.revoked_at is not None:
        delivery.status, delivery.last_error = "failed", "webhook_revoked"
        return delivery
    parts = urlsplit(hook.url)
    if not resolves_to_public(parts.hostname or "", parts.port or 443):
        delivery.status, delivery.last_error, delivery.last_status_code = "failed", "blocked_host", None
        return delivery
    body = json.dumps(delivery.payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    secret = decrypt_payload(hook.secret_ciphertext).decode("utf-8")
    ts = int(time.time())
    headers = {
        "Content-Type": "application/json", "User-Agent": "TravelCanvas-Webhook/1",
        SIGNATURE_HEADER: sign(secret, ts, body), "X-TravelCanvas-Event": delivery.event_type,
        "X-TravelCanvas-Event-Id": str(delivery.event_id),
    }
    try:
        code = _post(hook.url, body, headers)
    except Exception as e:  # noqa: BLE001 - 失敗の種類だけを残す(URL・本文は残さない)
        delivery.status, delivery.last_status_code = "failed", None
        delivery.last_error = type(e).__name__[:40]
        return delivery
    delivery.last_status_code = code
    if 200 <= code < 300:
        delivery.status, delivery.delivered_at, delivery.last_error = "delivered", _now(), None
    else:
        delivery.status, delivery.last_error = "failed", "http_status"
    return delivery


@contextmanager
def open_session():
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def deliver_pending(ids: List[uuid.UUID]) -> None:
    """要求の応答の後で送る(BackgroundTasks)。"""
    if not ids:
        return
    with open_session() as db:
        for d in db.query(OrgWebhookDelivery).filter(OrgWebhookDelivery.id.in_(ids)).all():
            if d.status == "pending":
                deliver(db, d)
        db.commit()
