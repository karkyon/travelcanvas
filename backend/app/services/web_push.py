"""[Gate TDay-Push] 端末への通知(Web Push)。外部の有料サービスは使わない。

ブラウザの標準の仕組み(Push API)で、ブラウザの会社の配信の窓口(Google・Mozilla・Apple・Microsoft)へ送る。
窓口は無料。送る中身は端末の鍵で暗号化する(RFC 8291 / RFC 8188 aes128gcm)ので、窓口には読めない。
送り手の証明は VAPID(RFC 8292、ES256 の署名)。

- 送り手の鍵(VAPID)は .env の VAPID_PRIVATE_KEY(URL 安全な base64 の 32 バイト)。空なら JWT_SECRET_KEY から
  導出する(CHALLENGE_SECRET_KEY と同じ考え方)。鍵が替わると端末の購読は無効になり、画面を開いた時に取り直す。
- 端末の購読(送り先の URL と端末の鍵)は users.preferences["web_push"] に ENCRYPTION_KEY で暗号化して置く
  (DB の変更なし。consents と同じ置き場所)。1人 MAX_SUBSCRIPTIONS 台まで(古いものから外す)。
- 送り先の URL はブラウザの会社の窓口だけを受け付ける(任意の宛先へ送らせない。SSRF の対策)。
- 窓口が 404・410 を返した購読は外す(端末で通知をやめた・アプリを消した)。
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

logger = logging.getLogger("travelcanvas.push")

PREF_KEY = "web_push"
MAX_SUBSCRIPTIONS = 5
RECORD_SIZE = 4096
MAX_PAYLOAD = 3000
KINDS = ("depart", "rain", "morning", "crew")
DEFAULT_KINDS: Dict[str, bool] = {k: True for k in KINDS}
# ブラウザの会社の配信の窓口(この名前か、その下の名前だけ)
PUSH_HOSTS = ("fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com",
              "notify.windows.com")
_CURVE_ORDER = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)


class PushError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ---- base64(URL 安全・詰め物なし) --------------------------------------------------------------------------

def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_decode(text: str) -> bytes:
    s = str(text or "").strip().replace("+", "-").replace("/", "_").rstrip("=")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ---- 送り手の鍵(VAPID) -------------------------------------------------------------------------------------

def enabled() -> bool:
    return bool(getattr(settings, "WEB_PUSH_ENABLED", True)) and _private_key() is not None


def _private_key() -> Optional[ec.EllipticCurvePrivateKey]:
    raw = (getattr(settings, "VAPID_PRIVATE_KEY", "") or "").strip()
    try:
        if raw:
            value = int.from_bytes(b64u_decode(raw), "big")
        else:
            secret = (getattr(settings, "JWT_SECRET_KEY", "") or "").encode("utf-8")
            if not secret:
                return None
            okm = HKDF(algorithm=hashes.SHA256(), length=48, salt=b"travelcanvas",
                       info=b"travelcanvas web push vapid v1").derive(secret)
            value = int.from_bytes(okm, "big") % (_CURVE_ORDER - 1) + 1
        if not 0 < value < _CURVE_ORDER:
            return None
        return ec.derive_private_key(value, ec.SECP256R1())
    except (ValueError, TypeError):
        logger.warning("web_push: VAPID_PRIVATE_KEY を読めません(URL 安全な base64 の 32 バイト)")
        return None


def public_key() -> Optional[str]:
    """画面へ渡す送り手の公開鍵(applicationServerKey)。使えなければ None"""
    key = _private_key()
    if key is None:
        return None
    return b64u(key.public_key().public_bytes(serialization.Encoding.X962,
                                              serialization.PublicFormat.UncompressedPoint))


def key_tag() -> str:
    """購読がどの送り手の鍵で作られたかの印(鍵が替わったら購読を取り直す)"""
    return hashlib.sha256((public_key() or "").encode("ascii")).hexdigest()[:12]


def subject() -> str:
    sub = (getattr(settings, "VAPID_SUBJECT", "") or "").strip()
    if sub.startswith(("mailto:", "https://")):
        return sub
    sender = (getattr(settings, "EMAIL_FROM", "") or "").strip()
    if "@" in sender and " " not in sender:
        return "mailto:" + sender.strip("<>")
    return "mailto:travelcanvas@example.com"


def vapid_header(endpoint: str, now: Optional[float] = None) -> str:
    key = _private_key()
    if key is None:
        raise PushError("push_unavailable", "端末への通知は使えません(送り手の鍵がありません)")
    parts = urlsplit(endpoint)
    claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int((now or time.time()) + 12 * 3600),
              "sub": subject()}
    token = jwt.encode(claims, key, algorithm="ES256", headers={"typ": "JWT"})
    return f"vapid t={token}, k={public_key()}"


# ---- 中身の暗号化(RFC 8291) ---------------------------------------------------------------------------------

def encrypt(payload: bytes, p256dh: str, auth: str, *, salt: Optional[bytes] = None,
            server_key: Optional[ec.EllipticCurvePrivateKey] = None) -> bytes:
    """aes128gcm の本文(見出し: salt 16・rs 4・鍵の長さ 1・送り手の一時の公開鍵 65 + 暗号文)"""
    ua_public = b64u_decode(p256dh)
    auth_secret = b64u_decode(auth)
    if len(ua_public) != 65 or ua_public[0] != 4 or len(auth_secret) != 16:
        raise PushError("invalid_subscription", "端末の鍵の形が正しくありません")
    if len(payload) > MAX_PAYLOAD:
        raise PushError("payload_too_large", "通知の中身が長すぎます")
    as_private = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = as_private.public_key().public_bytes(serialization.Encoding.X962,
                                                     serialization.PublicFormat.UncompressedPoint)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = as_private.exchange(ec.ECDH(), ua_key)
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret,
               info=b"WebPush: info\x00" + ua_public + as_public).derive(shared)
    salt = salt or os.urandom(16)
    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt,
               info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt,
                 info=b"Content-Encoding: nonce\x00").derive(ikm)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)  # 最後の記録の区切り(詰め物なし)
    return salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public + body


# ---- 端末の購読(users.preferences["web_push"]) --------------------------------------------------------------

def check_endpoint(endpoint: str) -> str:
    url = str(endpoint or "").strip()
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if (parts.scheme != "https" or not host or parts.port not in (None, 443) or parts.username or parts.password
            or len(url) > 1024):
        raise PushError("invalid_endpoint", "通知の送り先が正しくありません")
    if not any(host == h or host.endswith("." + h) for h in PUSH_HOSTS):
        raise PushError("invalid_endpoint", "ブラウザの通知の窓口以外へは送りません")
    return url


def _sub_id(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:20]


def _state(user) -> Dict[str, Any]:
    raw = (user.preferences or {}).get(PREF_KEY) if isinstance(user.preferences, dict) else None
    return raw if isinstance(raw, dict) else {}


def _save(user, state: Dict[str, Any]) -> None:
    prefs = dict(user.preferences or {}) if isinstance(user.preferences, dict) else {}
    prefs[PREF_KEY] = state
    user.preferences = prefs


def kinds_of(user) -> Dict[str, bool]:
    stored = _state(user).get("kinds")
    stored = stored if isinstance(stored, dict) else {}
    return {k: bool(stored.get(k, DEFAULT_KINDS[k])) for k in KINDS}


def set_kinds(user, changes: Dict[str, bool]) -> Dict[str, bool]:
    state = dict(_state(user))
    kinds = kinds_of(user)
    for k, v in changes.items():
        if k in KINDS and v is not None:
            kinds[k] = bool(v)
    state["kinds"] = kinds
    _save(user, state)
    return kinds


def _encrypt_sub(data: Dict[str, str]) -> str:
    from app.core import crypto

    return crypto.encrypt_payload(json.dumps(data, separators=(",", ":")).encode("utf-8")).decode("ascii")


def _decrypt_sub(token: str) -> Optional[Dict[str, str]]:
    from app.core import crypto

    try:
        data = json.loads(crypto.decrypt_payload(token.encode("ascii")).decode("utf-8"))
    except Exception:  # noqa: BLE001 - 読めない購読は無かったことにする(鍵の切り替えの後など)
        return None
    return data if isinstance(data, dict) else None


def subscriptions(user) -> List[Dict[str, Any]]:
    """[{id, endpoint, p256dh, auth, label, at, key}](読めない物は除く)"""
    out = []
    for row in _state(user).get("subs") or []:
        if not isinstance(row, dict) or not isinstance(row.get("c"), str):
            continue
        data = _decrypt_sub(row["c"])
        if not data or not data.get("endpoint"):
            continue
        out.append({"id": row.get("id"), "endpoint": data["endpoint"], "p256dh": data.get("p256dh", ""),
                    "auth": data.get("auth", ""), "label": row.get("label"), "at": row.get("at"),
                    "key": row.get("key")})
    return out


def summary(user) -> List[Dict[str, Any]]:
    """画面へ出す購読の一覧(送り先・鍵は出さない)"""
    tag = key_tag()
    return [{"id": r.get("id"), "label": r.get("label"), "at": r.get("at"), "current_key": r.get("key") == tag}
            for r in (_state(user).get("subs") or []) if isinstance(r, dict)]


def add_subscription(user, endpoint: str, p256dh: str, auth: str, label: Optional[str] = None,
                     now: Optional[datetime] = None) -> str:
    url = check_endpoint(endpoint)
    ua = b64u_decode(p256dh)
    au = b64u_decode(auth)
    if len(ua) != 65 or ua[0] != 4 or len(au) != 16:
        raise PushError("invalid_subscription", "端末の鍵の形が正しくありません")
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua)
    except ValueError:
        raise PushError("invalid_subscription", "端末の鍵の形が正しくありません") from None
    sid = _sub_id(url)
    state = dict(_state(user))
    subs = [r for r in (state.get("subs") or []) if isinstance(r, dict) and r.get("id") != sid]
    subs.append({"id": sid, "c": _encrypt_sub({"endpoint": url, "p256dh": b64u(ua), "auth": b64u(au)}),
                 "label": (label or "").strip()[:40] or None,
                 "at": (now or datetime.now(timezone.utc)).isoformat(), "key": key_tag()})
    state["subs"] = subs[-MAX_SUBSCRIPTIONS:]
    if "kinds" not in state:
        state["kinds"] = dict(DEFAULT_KINDS)
    _save(user, state)
    return sid


def remove_subscriptions(user, ids: List[str]) -> int:
    drop = {str(i) for i in ids if i}
    state = dict(_state(user))
    before = [r for r in (state.get("subs") or []) if isinstance(r, dict)]
    after = [r for r in before if r.get("id") not in drop]
    state["subs"] = after
    _save(user, state)
    return len(before) - len(after)


def remove_endpoint(user, endpoint: str) -> int:
    return remove_subscriptions(user, [_sub_id(str(endpoint or "").strip())])


# ---- 送る -----------------------------------------------------------------------------------------------------

Sender = Callable[[str, Dict[str, str], bytes], int]


def _http_send(url: str, headers: Dict[str, str], body: bytes) -> int:
    with httpx.Client(timeout=10.0, follow_redirects=False) as client:
        return client.post(url, headers=headers, content=body).status_code


def message(title: str, body: str, url: str, tag: str, kind: str) -> Dict[str, Any]:
    return {"title": title[:80], "body": body[:240], "url": url, "tag": tag[:64], "kind": kind}


def send_to_user(user, msg: Dict[str, Any], *, urgency: str = "normal", ttl: int = 1800,
                 send: Optional[Sender] = None) -> Dict[str, int]:
    """この人の全ての端末へ送る。窓口が 404・410 を返した購読は外す(呼んだ側が commit する)。"""
    result = {"sent": 0, "removed": 0, "failed": 0}
    if not enabled():
        return result
    sender = send or _http_send
    payload = json.dumps(msg, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    gone: List[str] = []
    tag = key_tag()
    for sub in subscriptions(user):
        if sub.get("key") != tag:
            continue  # 前の送り手の鍵の購読(画面を開いた時に取り直す)
        try:
            url = check_endpoint(sub["endpoint"])
            body = encrypt(payload, sub["p256dh"], sub["auth"])
            headers = {"Authorization": vapid_header(url), "TTL": str(int(ttl)), "Urgency": urgency,
                       "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
                       "Topic": hashlib.sha256(str(msg.get("tag", "")).encode("utf-8")).hexdigest()[:32]}
            status = sender(url, headers, body)
        except PushError:
            gone.append(str(sub.get("id")))
            continue
        except Exception as e:  # noqa: BLE001 - 1台の失敗で他の端末・他の人を止めない
            logger.warning("web_push: 送れませんでした(%s)", type(e).__name__)
            result["failed"] += 1
            continue
        if status in (200, 201, 202):
            result["sent"] += 1
        elif status in (404, 410):
            gone.append(str(sub.get("id")))
        else:
            logger.warning("web_push: 窓口の応答 %s", status)
            result["failed"] += 1
    if gone:
        result["removed"] = remove_subscriptions(user, gone)
    return result
