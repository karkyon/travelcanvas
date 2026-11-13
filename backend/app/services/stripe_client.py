"""[Gate Remaining-4] FR-058 Stripe の呼び出し(テストモードだけ)。SDK は使わず REST(form)で送る。

- 鍵は運用コンソールで登録した stripe_secret_key(sk_test_ で始まるものだけ。本番の鍵 sk_live_ は送らずに断る)と、
  Webhook の署名の鍵 stripe_webhook_secret(whsec_)。無い時は NotConfigured(画面は「決済の設定が無い」)
- 送るのは商品の名前・金額・期間・メタデータ(利用者の ID・旅行の ID・支払いの ID)だけ。カードの番号は Stripe の
  画面(Checkout)で入れてもらい、このアプリは受け取らない
- Webhook の署名(Stripe-Signature: t=…,v1=…)は HMAC-SHA256 で確かめ、5 分より古いものは断る
- 試験は set_transport で httpx.MockTransport に差し替える
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import provider_secrets as ps

API = "https://api.stripe.com/v1"
TOLERANCE_SECONDS = 300
_transport: Optional[httpx.BaseTransport] = None


class NotConfigured(Exception):
    def __init__(self, code: str = "not_configured"):
        super().__init__(code)
        self.code = code


class StripeError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def set_transport(transport: Optional[httpx.BaseTransport]) -> None:
    global _transport
    _transport = transport


def _root() -> str:
    return (getattr(settings, "STRIPE_API_URL", "") or API).rstrip("/")


def secret_key(db: Session) -> str:
    try:
        key = ps.resolve(db, "stripe_secret_key")
    except ps.SecretUnavailable:
        raise NotConfigured("not_configured")
    if not key.startswith(("sk_test_", "rk_test_")):
        # 利用者の決定(2026-11-13): テストモードだけ。本番の鍵では送らない(誤って本当に請求しない)
        raise NotConfigured("live_key_refused")
    return key


def webhook_secret(db: Session) -> str:
    try:
        key = ps.resolve(db, "stripe_webhook_secret")
    except ps.SecretUnavailable:
        raise NotConfigured("webhook_not_configured")
    return key


def configured(db: Session) -> bool:
    try:
        secret_key(db)
        return True
    except NotConfigured:
        return False


def flatten(data: Dict[str, Any], prefix: str = "") -> List[Tuple[str, str]]:
    """{"a": {"b": 1}, "c": [{"d": 2}]} → [("a[b]", "1"), ("c[0][d]", "2")](Stripe の form の書き方)"""
    out: List[Tuple[str, str]] = []
    for k, v in data.items():
        key = f"{prefix}[{k}]" if prefix else str(k)
        if v is None:
            continue
        if isinstance(v, dict):
            out.extend(flatten(v, key))
        elif isinstance(v, (list, tuple)):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    out.extend(flatten(item, f"{key}[{i}]"))
                else:
                    out.append((f"{key}[{i}]", str(item)))
        elif isinstance(v, bool):
            out.append((key, "true" if v else "false"))
        else:
            out.append((key, str(v)))
    return out


def call(db: Session, method: str, path: str, data: Optional[Dict[str, Any]] = None,
         idempotency_key: Optional[str] = None) -> Dict[str, Any]:
    key = secret_key(db)
    headers = {"Authorization": f"Bearer {key}", "Stripe-Version": "2024-06-20"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    try:
        with httpx.Client(timeout=httpx.Timeout(15.0), transport=_transport) as client:
            form: Any = flatten(data or {})
            if method == "GET":
                r = client.request(method, f"{_root()}{path}", params=form, headers=headers)
            else:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
                r = client.request(method, f"{_root()}{path}", content=urlencode(form).encode("ascii"), headers=headers)
    except httpx.HTTPError:
        raise StripeError(503, "stripe_unreachable", "決済の提供元に届きませんでした。しばらくしてからもう一度")
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 400:
        err = (body or {}).get("error") or {}
        raise StripeError(r.status_code, str(err.get("code") or err.get("type") or "stripe_error"),
                          "決済の提供元が受け付けませんでした")
    return body


def verify_signature(payload: bytes, header: Optional[str], secret: str, now: Optional[float] = None) -> Dict[str, Any]:
    """署名を確かめてイベントを返す。違う・古い時は ValueError"""
    if not header:
        raise ValueError("no_signature")
    parts: Dict[str, List[str]] = {}
    for item in header.split(","):
        k, _, v = item.strip().partition("=")
        parts.setdefault(k, []).append(v)
    try:
        ts = int(parts.get("t", ["0"])[0])
    except ValueError:
        raise ValueError("bad_timestamp")
    if abs((now or time.time()) - ts) > TOLERANCE_SECONDS:
        raise ValueError("too_old")
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in parts.get("v1", [])):
        raise ValueError("bad_signature")
    event = json.loads(payload.decode("utf-8"))
    if not isinstance(event, dict) or "type" not in event or "id" not in event:
        raise ValueError("bad_event")
    return event


def sign(payload: bytes, secret: str, ts: Optional[int] = None) -> str:
    """試験用: 署名の見出しを作る"""
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"
