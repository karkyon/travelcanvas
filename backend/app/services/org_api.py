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

[Gate G2] FR-042 の残り(API-01・API-02):
- 書き込み: スコープ distributions:write で配布の題名・お知らせの変更(If-Match)・改訂・停止。Idempotency-Key が必須
  (同じキーの再送は同じ応答。中身の違う再送は 422)。個人の旅行・予約は外部から書き換えられない。
- 秘密の切り替え: API クライアントの秘密・Webhook の署名の鍵を作り直す。猶予(既定24時間、0〜168時間)の間は前の秘密でも
  トークンを取れ、Webhook は新旧の両方で署名する(`v1=<新>,v1=<旧>`)。猶予を待たずに前の秘密を失効できる。
- 自動の再送: 失敗した送信は 1・5・30分・2・6時間後に送り直す(合計 MAX_ATTEMPTS 回)。上限に達したら dead
  (dead-letter。手で送り直せる)。受け手が 410 Gone を返したら Webhook を止める。本文に schema_version を入れる。
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
    "distributions:write": "配布の題名・お知らせの変更、改訂(元の旅行から写し直す)、停止(個人の旅行・予約は書き換えない)",
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
MAX_ATTEMPTS = 6
SIGNATURE_HEADER = "X-TravelCanvas-Signature"
SCHEMA_VERSION = 1
# [Gate G2] 自動の再送の間隔(1回目の失敗の後から順に)。合計 MAX_ATTEMPTS 回送ったら dead
RETRY_DELAYS = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2),
                timedelta(hours=6))
DEFAULT_GRACE_HOURS = 24
MAX_GRACE_HOURS = 168
IDEMPOTENCY_TTL = timedelta(days=1)


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


def _previous_active(expires_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    return expires_at is not None and expires_at > (now or _now())


def verify_client(db: Session, client_id: str, client_secret: str) -> Optional[OrgApiClient]:
    if not client_id or not client_secret or len(client_id) > 40 or len(client_secret) > 100:
        return None
    client = db.query(OrgApiClient).filter(OrgApiClient.client_id == client_id).first()
    given = sha256(client_secret)
    expected = client.secret_hash if client else sha256("not-a-client")
    ok = hmac.compare_digest(expected, given)
    # [Gate G2] 切り替えの猶予の間は前の秘密も通す(どちらも比べて、時間で区別できないようにする)
    previous = (client.previous_secret_hash if client and client.previous_secret_hash else sha256("no-previous"))
    ok_previous = hmac.compare_digest(previous, given) and bool(
        client and client.previous_secret_hash and _previous_active(client.previous_secret_expires_at))
    if not client or not (ok or ok_previous) or client.revoked_at is not None:
        return None
    return client


def clean_grace_hours(raw: Any) -> int:
    if raw is None:
        return DEFAULT_GRACE_HOURS
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0 or raw > MAX_GRACE_HOURS:
        raise ValueError("invalid_grace")
    return raw


def rotate_client_secret(client: OrgApiClient, grace_hours: int) -> str:
    """新しい秘密を作る(1回だけ返す)。前の秘密は grace_hours の間だけ通す(0 ならすぐ失効)。"""
    _cid, secret = new_client_credentials()
    t = _now()
    if grace_hours > 0:
        client.previous_secret_hash = client.secret_hash
        client.previous_secret_expires_at = t + timedelta(hours=grace_hours)
    else:
        client.previous_secret_hash, client.previous_secret_expires_at = None, None
    client.secret_hash = sha256(secret)
    client.secret_version = (client.secret_version or 1) + 1
    client.secret_rotated_at = t
    return secret


def retire_previous_client_secret(db: Session, client: OrgApiClient, revoke_tokens: bool = False) -> int:
    """猶予を待たずに前の秘密を失効する。revoke_tokens なら発行済みのトークンも消す(件数を返す)。"""
    client.previous_secret_hash, client.previous_secret_expires_at = None, None
    if not revoke_tokens:
        return 0
    return db.query(OrgApiToken).filter(OrgApiToken.client_id == client.id).delete(synchronize_session=False)


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


def _mac(secret: str, timestamp: int, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + body, hashlib.sha256).hexdigest()


def sign(secret: str, timestamp: int, body: bytes, previous: Optional[str] = None) -> str:
    """[Gate G2] 切り替えの猶予の間は前の鍵の署名も並べる(`t=..,v1=<新>,v1=<旧>`。受け手はどれかが合えば受け付ける)。"""
    out = f"t={timestamp},v1={_mac(secret, timestamp, body)}"
    if previous:
        out += f",v1={_mac(previous, timestamp, body)}"
    return out


def verify_signature(secret: str, header: str, body: bytes, tolerance: int = 300, now: Optional[int] = None) -> bool:
    """受け手の検証の見本(試験と文書で使う)。v1 が複数あれば、どれかが合えば受け付ける。時刻のずれで再送(replay)を拒む。"""
    ts: Optional[int] = None
    sigs: List[str] = []
    try:
        for part in header.split(","):
            k, v = part.split("=", 1)
            if k == "t":
                ts = int(v)
            elif k == "v1":
                sigs.append(v)
    except ValueError:
        return False
    if ts is None or not sigs or abs((now or int(time.time())) - ts) > tolerance:
        return False
    expected = _mac(secret, ts, body)
    return any(hmac.compare_digest(expected, s) for s in sigs)


def rotate_webhook_secret(hook: OrgWebhook, grace_hours: int) -> str:
    secret = new_webhook_secret()
    if grace_hours > 0:
        hook.previous_secret_ciphertext = hook.secret_ciphertext
        hook.previous_secret_expires_at = _now() + timedelta(hours=grace_hours)
    else:
        hook.previous_secret_ciphertext, hook.previous_secret_expires_at = None, None
    hook.secret_ciphertext = seal_secret(secret)
    hook.secret_version = (hook.secret_version or 1) + 1
    return secret


def retire_previous_webhook_secret(hook: OrgWebhook) -> None:
    hook.previous_secret_ciphertext, hook.previous_secret_expires_at = None, None


def enqueue(db: Session, org_id, event_type: str, data: Dict[str, Any]) -> List[uuid.UUID]:
    """購読している Webhook ごとに送信の記録を作る(送るのは deliver)。"""
    hooks = db.query(OrgWebhook).filter(OrgWebhook.organization_id == org_id, OrgWebhook.revoked_at.is_(None)).all()
    ids = []
    for h in hooks:
        if event_type != "ping" and event_type not in (h.events or []):
            continue
        event_id = uuid.uuid4()
        payload = {"id": str(event_id), "type": event_type, "created_at": _now().isoformat(),
                   "schema_version": SCHEMA_VERSION, "organization_id": str(org_id), "data": data}
        d = OrgWebhookDelivery(id=uuid.uuid4(), webhook_id=h.id, event_id=event_id, event_type=event_type,
                               payload=payload, status="pending", next_attempt_at=_now())
        db.add(d)
        ids.append(d.id)
    db.flush()
    return ids


def _post(url: str, body: bytes, headers: Dict[str, str]) -> int:
    import httpx
    with httpx.Client(timeout=SEND_TIMEOUT, follow_redirects=False) as client:
        return client.post(url, content=body, headers=headers).status_code


def _schedule_retry(delivery: OrgWebhookDelivery, retryable: bool = True) -> None:
    """[Gate G2] 失敗した送信の次の時刻。上限に達した(または送り直しても届かない理由の)時は dead にする。"""
    n = delivery.attempts or 0
    if not retryable or n >= MAX_ATTEMPTS:
        delivery.status, delivery.next_attempt_at = "dead", None
        return
    delivery.status = "failed"
    delivery.next_attempt_at = _now() + RETRY_DELAYS[min(n - 1, len(RETRY_DELAYS) - 1)]


def deliver(db: Session, delivery: OrgWebhookDelivery) -> OrgWebhookDelivery:
    hook = db.query(OrgWebhook).filter(OrgWebhook.id == delivery.webhook_id).first()
    delivery.attempts = (delivery.attempts or 0) + 1
    if not hook or hook.revoked_at is not None:
        delivery.last_error = "webhook_revoked"
        _schedule_retry(delivery, retryable=False)
        return delivery
    parts = urlsplit(hook.url)
    if not resolves_to_public(parts.hostname or "", parts.port or 443):
        delivery.last_error, delivery.last_status_code = "blocked_host", None
        _schedule_retry(delivery)
        return delivery
    body = json.dumps(delivery.payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    secret = decrypt_payload(hook.secret_ciphertext).decode("utf-8")
    previous = None
    if hook.previous_secret_ciphertext and _previous_active(hook.previous_secret_expires_at):
        previous = decrypt_payload(hook.previous_secret_ciphertext).decode("utf-8")
    ts = int(time.time())
    headers = {
        "Content-Type": "application/json", "User-Agent": "TravelCanvas-Webhook/1",
        SIGNATURE_HEADER: sign(secret, ts, body, previous), "X-TravelCanvas-Event": delivery.event_type,
        "X-TravelCanvas-Event-Id": str(delivery.event_id),
    }
    try:
        code = _post(hook.url, body, headers)
    except Exception as e:  # noqa: BLE001 - 失敗の種類だけを残す(URL・本文は残さない)
        delivery.last_status_code = None
        delivery.last_error = type(e).__name__[:40]
        _schedule_retry(delivery)
        return delivery
    delivery.last_status_code = code
    if 200 <= code < 300:
        delivery.status, delivery.delivered_at, delivery.last_error = "delivered", _now(), None
        delivery.next_attempt_at = None
    elif code == 410:
        # 受け手が「もう要らない」と答えた: この Webhook を止める(以後は送らない)
        delivery.last_error = "gone"
        hook.revoked_at = hook.revoked_at or _now()
        hook.disabled_reason = "receiver_gone"
        _schedule_retry(delivery, retryable=False)
    else:
        delivery.last_error = "http_status"
        _schedule_retry(delivery)
    return delivery


def retry_due(db: Session, now: Optional[datetime] = None, limit: int = 100) -> Dict[str, int]:
    """[Gate G2] 時刻の来た失敗の送信を送り直す(定期実行: tcops.py schedule の webhook-retry)。件数だけを返す。"""
    t = now or _now()
    rows = (db.query(OrgWebhookDelivery)
            .filter(OrgWebhookDelivery.status.in_(("pending", "failed")),
                    OrgWebhookDelivery.next_attempt_at.isnot(None), OrgWebhookDelivery.next_attempt_at <= t)
            .order_by(OrgWebhookDelivery.next_attempt_at).limit(limit).with_for_update(skip_locked=True).all())
    out = {"attempted": 0, "delivered": 0, "failed": 0, "dead": 0}
    for d in rows:
        deliver(db, d)
        out["attempted"] += 1
        out[d.status if d.status in out else "failed"] += 1
    db.commit()
    return out


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


# ---------- 外部 API の書き込みの Idempotency-Key ----------

def payload_hash(body: Any) -> str:
    return sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str))


def idempotency_lookup(db: Session, client: OrgApiClient, key: str, route: str, body_hash: str):
    """同じキーの記録。中身(経路・本文)が違えば ValueError("idempotency_key_reused")。"""
    from app.models.models import OrgApiIdempotency

    db.query(OrgApiIdempotency).filter(OrgApiIdempotency.expires_at < _now()).delete(synchronize_session=False)
    rec = db.query(OrgApiIdempotency).filter(OrgApiIdempotency.client_id == client.id,
                                             OrgApiIdempotency.key == key).first()
    if rec and (rec.route != route or rec.payload_hash != body_hash):
        raise ValueError("idempotency_key_reused")
    return rec


def idempotency_store(db: Session, client: OrgApiClient, key: str, route: str, body_hash: str, status: int,
                      body: Dict[str, Any]) -> None:
    from app.models.models import OrgApiIdempotency

    db.add(OrgApiIdempotency(id=uuid.uuid4(), client_id=client.id, key=key, route=route, payload_hash=body_hash,
                             response_status=status, response_json=body, expires_at=_now() + IDEMPOTENCY_TTL))
