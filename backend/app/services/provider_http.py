"""[Gate ProviderConnect] 有料の提供元(OpenAI・Places API (New)・Routes API)へ送る HTTP の共通の口。

- 送り先は下の ALLOWED の固定の URL だけ(利用者の入力・設定で base_url を変えられない。SSRF を作らない)
- TLS の検証は常に有効。redirect は追わない(鍵の付いた要求を別の host へ送らない)
- プロセスの環境変数の proxy 設定・SDK の既定の環境変数(OPENAI_API_KEY など)を読まない(trust_env=False)
- 提供元の本文・URL・header はそのまま画面・ログ・監査へ出さない。``classify`` で固定のコードに直す
- 試験では ``set_transport`` で httpx の transport を差し替える(実の通信をしない)
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

TIMEOUT = httpx.Timeout(15.0, connect=5.0)

ALLOWED: Dict[str, str] = {
    "openai.responses": "https://api.openai.com/v1/responses",
    "google.places.search_text": "https://places.googleapis.com/v1/places:searchText",
    "google.routes.compute": "https://routes.googleapis.com/directions/v2:computeRoutes",
}

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
