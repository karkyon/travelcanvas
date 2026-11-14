"""[Gate ProviderConnect] 有料の提供元(OpenAI・Places API (New)・Routes API)へ送る HTTP の共通の口。

- 送り先は下の ALLOWED の固定の URL だけ(利用者の入力・設定で base_url を変えられない。SSRF を作らない)
- TLS の検証は常に有効。redirect は追わない(鍵の付いた要求を別の host へ送らない)
- プロセスの環境変数の proxy 設定・SDK の既定の環境変数(OPENAI_API_KEY など)を読まない(trust_env=False)
- 提供元の本文・URL・header はそのまま画面・ログ・監査へ出さない。``classify`` で固定のコードに直す
- 試験では ``set_transport`` で httpx の transport を差し替える(実の通信をしない)
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

TIMEOUT = httpx.Timeout(15.0, connect=5.0)

ALLOWED: Dict[str, str] = {
    "openai.responses": "https://api.openai.com/v1/responses",
    "google.places.search_text": "https://places.googleapis.com/v1/places:searchText",
    "google.routes.compute": "https://routes.googleapis.com/directions/v2:computeRoutes",
}

# [Gate Remaining-7] FR-059 GET の送り先(場所の詳細・写真・静的な地図)。{…} の部分は形を確かめた値だけを入れる
ALLOWED_GET: Dict[str, str] = {
    "google.places.details": "https://places.googleapis.com/v1/places/{id}",
    "google.places.photo": "https://places.googleapis.com/v1/{name}/media",
    "google.maps.static": "https://maps.googleapis.com/maps/api/staticmap",
}
_PLACE_ID = re.compile(r"^[A-Za-z0-9_\-]{10,300}$")
_PHOTO_NAME = re.compile(r"^places/[A-Za-z0-9_\-]{10,300}/photos/[A-Za-z0-9_\-]{10,600}$")
# 写真の本体の置き場所(写真の名前から得た URL だけ。鍵は付けない)
PHOTO_HOST_SUFFIX = ".googleusercontent.com"
MAX_IMAGE_BYTES = 4 * 1024 * 1024

_transport: Optional[httpx.BaseTransport] = None


def set_transport(transport: Optional[httpx.BaseTransport]) -> None:
    """試験だけで使う(実の通信の代わりに httpx.MockTransport)。None で元に戻す。"""
    global _transport
    _transport = transport


class ProviderNetworkError(Exception):
    """届かなかった・時間切れ・TLS の失敗。提供元が受け取ったかは分からない(課金の有無も分からない)。"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class ProviderResponse:
    status: int
    body: Any  # JSON(読めない時は None)


def post_json(endpoint: str, headers: Dict[str, str], payload: Dict[str, Any]) -> ProviderResponse:
    url = ALLOWED.get(endpoint)
    if url is None:
        raise ValueError("endpoint_not_allowed")
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False, trust_env=False, verify=True,
                          transport=_transport) as client:
            resp = client.post(url, headers=headers, content=json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    except httpx.TimeoutException:
        raise ProviderNetworkError("provider_timeout")
    except httpx.HTTPError:
        raise ProviderNetworkError("provider_unreachable")
    try:
        body = resp.json()
    except ValueError:
        body = None
    return ProviderResponse(status=resp.status_code, body=body)


def get_url(endpoint: str, *, place_id: Optional[str] = None, photo_name: Optional[str] = None) -> str:
    template = ALLOWED_GET.get(endpoint)
    if template is None:
        raise ValueError("endpoint_not_allowed")
    if "{id}" in template:
        if not place_id or not _PLACE_ID.match(place_id):
            raise ValueError("invalid_place_id")
        return template.replace("{id}", place_id)
    if "{name}" in template:
        if not photo_name or not _PHOTO_NAME.match(photo_name):
            raise ValueError("invalid_photo_name")
        return template.replace("{name}", photo_name)
    return template


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, trust_env=False, verify=True, transport=_transport)


def get_json(endpoint: str, headers: Dict[str, str], params: Dict[str, Any], *, place_id: Optional[str] = None,
             photo_name: Optional[str] = None) -> ProviderResponse:
    """[Gate Remaining-7] GET で JSON を受け取る(場所の詳細・写真の URL)。"""
    url = get_url(endpoint, place_id=place_id, photo_name=photo_name)
    try:
        with _client() as client:
            resp = client.get(url, headers=headers, params=params)
    except httpx.TimeoutException:
        raise ProviderNetworkError("provider_timeout")
    except httpx.HTTPError:
        raise ProviderNetworkError("provider_unreachable")
    try:
        body = resp.json()
    except ValueError:
        body = None
    return ProviderResponse(status=resp.status_code, body=body)


@dataclass
class ImageResponse:
    status: int
    content_type: Optional[str]
    content: bytes
    body: Any = None  # 失敗の時の JSON(分類に使う)


def get_image(endpoint: str, headers: Dict[str, str], params: Dict[str, Any]) -> ImageResponse:
    """[Gate Remaining-7] 静的な地図の画像(PNG)。鍵は params で送る(Static Maps の仕様)。"""
    url = get_url(endpoint)
    return _read_image(url, headers, params)


def fetch_photo(uri: str) -> ImageResponse:
    """写真の URL(Places が返した googleusercontent の https)から画像を取る。他の host は取らない。鍵は送らない。"""
    from urllib.parse import urlsplit

    parts = urlsplit(uri or "")
    host_ok = (parts.hostname or "").endswith(PHOTO_HOST_SUFFIX)
    if parts.scheme != "https" or not host_ok or parts.port not in (None, 443):
        raise ValueError("photo_host_not_allowed")
    return _read_image(uri, {}, {})


def _read_image(url: str, headers: Dict[str, str], params: Dict[str, Any]) -> ImageResponse:
    try:
        with _client() as client:
            with client.stream("GET", url, headers=headers, params=params) as resp:
                kind = (resp.headers.get("content-type") or "").split(";")[0].strip().lower() or None
                data = bytearray()
                for chunk in resp.iter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_IMAGE_BYTES:
                        raise ProviderNetworkError("image_too_large")
    except httpx.TimeoutException:
        raise ProviderNetworkError("provider_timeout")
    except httpx.HTTPError:
        raise ProviderNetworkError("provider_unreachable")
    body = None
    if not (kind or "").startswith("image/"):
        try:
            body = json.loads(bytes(data).decode("utf-8"))
        except ValueError:
            body = None
    return ImageResponse(status=resp.status_code, content_type=kind, content=bytes(data), body=body)


# ===================================================================== 応答の分類(固定のコード)

# auth: accepted(鍵は認められ、この操作も通った)/ rejected(鍵が無効・権限・API 未有効・送信元の制限・課金)/
# inconclusive(混雑・一時障害・判定できない。鍵が有効とも無効とも言わない)
RESULTS: Dict[str, Dict[str, str]] = {
    "accepted": {"auth": "accepted", "label": "利用可能(この操作で確認)"},
    "invalid_key": {"auth": "rejected", "label": "キー無効"},
    "permission_denied": {"auth": "rejected", "label": "権限不足(この操作は許可されていない)"},
    "api_not_enabled": {"auth": "rejected", "label": "API が有効になっていない"},
    "source_restricted": {"auth": "rejected", "label": "送信元(IP・referrer)の制限で拒否"},
    "billing_required": {"auth": "rejected", "label": "課金設定の確認が必要"},
    "insufficient_balance": {"auth": "rejected", "label": "残高・利用枠が足りない"},
    "model_not_available": {"auth": "rejected", "label": "このモデルは使えない"},
    "bad_request": {"auth": "inconclusive", "label": "要求の形が受け付けられない(鍵の判定はできない)"},
    "rate_limited": {"auth": "inconclusive", "label": "混雑(後で確認)"},
    "provider_unavailable": {"auth": "inconclusive", "label": "提供元の障害(未判定)"},
    "provider_timeout": {"auth": "inconclusive", "label": "時間切れ(未判定)"},
    "provider_unreachable": {"auth": "inconclusive", "label": "接続先へ到達できず未判定"},
    "unexpected_response": {"auth": "inconclusive", "label": "想定外の応答(未判定)"},
}


def _google_reasons(body: Any) -> set:
    reasons = set()
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        if isinstance(error.get("status"), str):
            reasons.add(error["status"])
        for item in error.get("details") or []:
            if isinstance(item, dict) and isinstance(item.get("reason"), str):
                reasons.add(item["reason"])
        message = str(error.get("message") or "")
        if "API key not valid" in message:
            reasons.add("API_KEY_INVALID")
    return reasons


def _openai_code(body: Any) -> str:
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        return str(error.get("code") or error.get("type") or "")
    return ""


def classify(provider: str, status: int, body: Any) -> str:
    """提供元の HTTP の応答を固定のコードへ。本文の文字列は返さない。"""
    if 200 <= status < 300:
        return "accepted"
    if status >= 500:
        return "provider_unavailable"
    if provider == "openai":
        code = _openai_code(body)
        if status == 401:
            return "invalid_key"
        if status == 403:
            return "permission_denied"
        if status == 404 or code == "model_not_found":
            return "model_not_available"
        if status == 429:
            return "insufficient_balance" if code in ("insufficient_quota", "billing_hard_limit_reached") \
                else "rate_limited"
        if status == 400:
            return "bad_request"
        return "unexpected_response"
    reasons = _google_reasons(body)
    if "API_KEY_INVALID" in reasons or status == 401:
        return "invalid_key"
    if reasons & {"API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED",
                  "API_KEY_IOS_APP_BLOCKED"}:
        return "source_restricted"
    if reasons & {"SERVICE_DISABLED", "API_KEY_SERVICE_BLOCKED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}:
        return "api_not_enabled"
    if "BILLING_DISABLED" in reasons:
        return "billing_required"
    if status == 429 or "RESOURCE_EXHAUSTED" in reasons:
        return "rate_limited"
    if status == 403:
        return "permission_denied"
    if status == 400:
        return "bad_request"
    return "unexpected_response"


def auth_of(code: str) -> str:
    return RESULTS.get(code, RESULTS["unexpected_response"])["auth"]


def label_of(code: str) -> str:
    return RESULTS.get(code, RESULTS["unexpected_response"])["label"]
