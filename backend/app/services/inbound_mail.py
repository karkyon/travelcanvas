"""[Gate Remaining-3] FR-011 予約メールの転送アドレス(<token>@INBOUND_MAIL_DOMAIN)と、届いたメールの読み取り。

- アドレスは旅行・人ごと。token は推測できない乱数(20 文字・base32)。DB には暗号文と sha256 だけを持つ
- 受信サービス(SendGrid Inbound Parse・Mailgun・Postfix の pipe 等)が POST /api/v1/inbound-mail へ転送する。
  合言葉(INBOUND_MAIL_SECRET)が合わない・設定が無い時は受け付けない
- 届いたメールは、アドレスの持ち主の操作として予約の読み取り(候補。暗号化)にする。確定は持ち主が画面で行う
  (自動で予約・旅程を作らない)。本文は保存しない。PDF の添付は文字を読む(1 通 3 個まで)
- 持ち主が旅行を編集できなくなった・アドレスを作り直した・1 日の上限を超えた時は読まない
"""
from __future__ import annotations

import base64
import email
import email.policy
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_payload, encrypt_payload, plan_subject
from app.models.models import InboundMailAddress

TOKEN_RE = re.compile(r"^[a-z2-7]{20}$")
MAX_PDFS = 3
MAX_MAIL_BYTES = 4 * 1024 * 1024


def configured() -> bool:
    return bool((settings.INBOUND_MAIL_DOMAIN or "").strip() and (settings.INBOUND_MAIL_SECRET or "").strip())


def domain() -> str:
    return (settings.INBOUND_MAIL_DOMAIN or "").strip().lower()


def secret_ok(given: Optional[str]) -> bool:
    expected = (settings.INBOUND_MAIL_SECRET or "").strip()
    return bool(expected and given) and hmac.compare_digest(expected.encode(), str(given).encode())


def _hash(token: str) -> str:
    return hashlib.sha256(("tc-inbound:" + token).encode()).hexdigest()


def new_token() -> str:
    return base64.b32encode(secrets.token_bytes(15)).decode().lower().rstrip("=")[:20]


def address_of(row: InboundMailAddress) -> Optional[str]:
    try:
        token = decrypt_payload(row.token_ciphertext).decode()
    except Exception:  # noqa: BLE001 - 鍵の破棄・復号できない時は出さない(作り直してもらう)
        return None
    return f"{token}@{domain()}" if domain() else None


def active(db: Session, plan_id: Any, user_id: Any) -> Optional[InboundMailAddress]:
    return (db.query(InboundMailAddress)
            .filter(InboundMailAddress.plan_id == plan_id, InboundMailAddress.user_id == user_id,
                    InboundMailAddress.revoked_at.is_(None))
            .order_by(InboundMailAddress.created_at.desc()).first())


def create(db: Session, plan_id: Any, user_id: Any) -> Tuple[InboundMailAddress, str]:
    """前のアドレスを止めて新しく作る(呼んだ側が commit)"""
    now = datetime.now(timezone.utc)
    for old in db.query(InboundMailAddress).filter(InboundMailAddress.plan_id == plan_id,
                                                   InboundMailAddress.user_id == user_id,
                                                   InboundMailAddress.revoked_at.is_(None)).all():
        old.revoked_at = now
    token = new_token()
    row = InboundMailAddress(plan_id=plan_id, user_id=user_id, token_hash=_hash(token),
                             token_ciphertext=encrypt_payload(token.encode(), plan_subject(plan_id)))
    db.add(row)
    db.flush()
    return row, token


def revoke(db: Session, plan_id: Any, user_id: Any) -> int:
    now = datetime.now(timezone.utc)
    n = 0
    for old in db.query(InboundMailAddress).filter(InboundMailAddress.plan_id == plan_id,
                                                   InboundMailAddress.user_id == user_id,
                                                   InboundMailAddress.revoked_at.is_(None)).all():
        old.revoked_at = now
        n += 1
    return n


def find(db: Session, token: str) -> Optional[InboundMailAddress]:
    token = (token or "").strip().lower()
    if not TOKEN_RE.match(token):
        return None
    return (db.query(InboundMailAddress)
            .filter(InboundMailAddress.token_hash == _hash(token), InboundMailAddress.revoked_at.is_(None)).first())


_ADDR = re.compile(r"([A-Za-z0-9._%+\-]+)@([A-Za-z0-9.\-]+)")


def tokens_in(recipients: List[str]) -> List[str]:
    """宛先の中の、このアプリのドメインの local part(token。+ の後ろは無視)"""
    d = domain()
    out: List[str] = []
    for r in recipients:
        for local, host in _ADDR.findall(r or ""):
            if d and host.lower() == d:
                tok = local.split("+", 1)[0].lower()
                if tok not in out:
                    out.append(tok)
    return out


def parse(raw: bytes) -> Tuple[EmailMessage, List[str]]:
    """生のメール → (メッセージ, 宛先の候補)。宛先は To・Cc・Delivered-To・X-Original-To・Envelope-To"""
    if len(raw) > MAX_MAIL_BYTES:
        raise ValueError("too_large")
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    rcpts: List[str] = []
    for h in ("to", "cc", "delivered-to", "x-original-to", "envelope-to", "x-forwarded-to"):
        for v in msg.get_all(h, []) or []:
            rcpts.append(str(v))
    return msg, rcpts


def pdf_attachments(msg: EmailMessage) -> List[bytes]:
    out: List[bytes] = []
    for part in msg.iter_attachments():
        ctype = part.get_content_type()
        name = (part.get_filename() or "").lower()
        if ctype == "application/pdf" or name.endswith(".pdf"):
            data = part.get_payload(decode=True)
            if isinstance(data, bytes) and data:
                out.append(data)
        if len(out) >= MAX_PDFS:
            break
    return out


def summary(db: Session, row: Optional[InboundMailAddress]) -> Dict[str, Any]:
    return {
        "configured": configured(),
        "address": address_of(row) if (row is not None and configured()) else None,
        "received_count": row.received_count if row is not None else 0,
        "last_received_at": row.last_received_at.isoformat() if row is not None and row.last_received_at else None,
        "created_at": row.created_at.isoformat() if row is not None and row.created_at else None,
        "daily_limit": int(settings.INBOUND_MAIL_DAILY_LIMIT),
    }
