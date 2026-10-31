"""[Gate ProviderConnect] 有料の提供元の adapter(実装の正本)。

ここに載っている提供元・操作だけが「実装済み」。運用コンソールの一覧(admin_ops.ADAPTERS_IMPLEMENTED)はここから作る。

送る順(業務の操作): 旅行の権限 → 会員のクラス(cost_guard)→ 提供元の停止 → 入力の上限・価格 → 費用の予約
→ ``provider_secrets.resolve_for_send``(有効な版・確認済み・期限内・設定が同じ)→ 送信 → 応答の検証 → 原価の確定。
- 鍵は SDK の環境変数ではなく header へ明示で渡す。鍵の値は応答・ログ・監査に出さない
- 時間切れ(届いたか分からない)は予約を解放せず、見込みの額で確定する(課金されていないと決め付けない)
- 401/403 など鍵の拒否は鍵の状態へ記録し(次の送信を止める)、予約は解放する
- ページの表示・保存・起動では送らない(呼ぶのは利用者・管理者の明示の操作の API だけ)
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import TravelPlan, User
from app.services import cost_guard as cg
from app.services import provider_http as ph
from app.services import provider_secrets as ps

logger = logging.getLogger(__name__)

ADAPTER_VERSION = "2026-11-01.1"

PLACES_FIELD_MASK = ("places.id,places.displayName,places.formattedAddress,places.location,"
                     "places.googleMapsUri")
PLACES_VERIFY_FIELD_MASK = "places.id"
ROUTES_FIELD_MASK = "routes.duration,routes.distanceMeters"
ROUTE_MODES = {"driving": "DRIVE", "walking": "WALK", "bicycling": "BICYCLE", "transit": "TRANSIT"}

AI_MAX_PROMPT_CHARS = 2000
AI_MAX_OUTPUT_TOKENS = 1500
AI_INSTRUCTIONS = ("あなたは日本語の旅行計画の相談役です。利用者の条件に沿って、候補と理由を短く箇条書きで示してください。"
                   "営業時間・料金・空き状況は確かめていないため、断定せず『要確認』と書いてください。")
PLACES_MAX_RESULTS = 5

# 提供元 → 扱う操作(実装済みの正本)
ADAPTERS: Dict[str, Dict[str, Any]] = {
    "openai": {"operations": ["ai.generate"], "label": "OpenAI · Responses API"},
    "google_places": {"operations": ["places.search"], "label": "Places API (New) · Text Search"},
    "google_routes": {"operations": ["routes.element"], "label": "Routes API · computeRoutes"},
}
# 鍵の slot → 確認する (提供元, 操作)
SLOT_CHECKS: Dict[str, List[Tuple[str, str]]] = {
    "openai_api_key": [("openai", "ai.generate")],
    "google_maps_server_key": [("google_places", "places.search"), ("google_routes", "routes.element")],
}


class ProviderRejected(Exception):
    """提供元が鍵・権限・課金の理由で断った(固定のコード)。予約は解放する。"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def openai_model() -> str:
    return (getattr(settings, "OPENAI_MODEL", None) or "gpt-5-nano").strip()


def config_hash(slot: str) -> str:
    """確認した設定(送り先・モデル・field mask・adapter の版)。変わったら以前の確認は使えない。"""
    spec = {"slot": slot, "adapter": ADAPTER_VERSION, "endpoints": ph.ALLOWED,
            "model": openai_model() if slot == "openai_api_key" else None,
            "places_mask": PLACES_FIELD_MASK, "places_verify_mask": PLACES_VERIFY_FIELD_MASK,
            "routes_mask": ROUTES_FIELD_MASK}
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode("utf-8")).hexdigest()


def ready(db: Session, provider: str, operation: str) -> bool:
    """利用者に「接続済み」と見せてよいか(鍵が確認済み・期限内・この設定)。adapter 以外(Fake)は登録だけで真。"""
    if provider not in ADAPTERS:
        return True
    try:
        ps.resolve_for_send(db, provider, operation)
        return True
    except ps.SecretUnavailable:
        return False


def register_all() -> None:
    """起動時に実装済みの adapter を cost_guard の登録へ入れる(送るのは明示の操作の時だけ)。"""
    for name, spec in ADAPTERS.items():
        cg.register_provider(name, list(spec["operations"]))
    cg.set_ready_check(ready)


# ===================================================================== 要求の組み立てと応答の読み取り

def _openai_request(key: str, text: str, max_output_tokens: int) -> ph.ProviderResponse:
    return ph.post_json("openai.responses",
                        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                        {"model": openai_model(), "instructions": AI_INSTRUCTIONS, "input": text,
                         "max_output_tokens": max_output_tokens, "store": False})


def _openai_text(body: Any) -> str:
    parts: List[str] = []
    for item in (body.get("output") or []) if isinstance(body, dict) else []:
        if isinstance(item, dict) and item.get("type") == "message":
            for content in item.get("content") or []:
                if isinstance(content, dict) and content.get("type") == "output_text":
                    parts.append(str(content.get("text") or ""))
    return "\n".join(p for p in parts if p).strip()


def _openai_usage(body: Any) -> Dict[str, int]:
    usage = body.get("usage") if isinstance(body, dict) else None
    usage = usage if isinstance(usage, dict) else {}

    def num(name: str) -> int:
        value = usage.get(name)
        return int(value) if isinstance(value, int) and value >= 0 else 0
    return {"input_tokens": num("input_tokens"), "output_tokens": num("output_tokens")}


def _places_request(key: str, query: str, mask: str, max_results: int,
                    lat: Optional[float] = None, lng: Optional[float] = None) -> ph.ProviderResponse:
    payload: Dict[str, Any] = {"textQuery": query, "languageCode": "ja", "regionCode": "JP", "pageSize": max_results}
    if lat is not None and lng is not None:
        payload["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 20000.0}}
    return ph.post_json("google.places.search_text",
                        {"X-Goog-Api-Key": key, "X-Goog-FieldMask": mask, "Content-Type": "application/json"},
                        payload)


def _places_items(body: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for place in (body.get("places") or []) if isinstance(body, dict) else []:
        if not isinstance(place, dict):
            continue
        raw_location = place.get("location")
        location: Dict[str, Any] = raw_location if isinstance(raw_location, dict) else {}
        name = place.get("displayName")
        out.append({
            "provider": "google_places", "place_id": str(place.get("id") or ""),
            "name": str(name.get("text") if isinstance(name, dict) else name or ""),
            "address": place.get("formattedAddress"), "latitude": location.get("latitude"),
            "longitude": location.get("longitude"), "maps_uri": place.get("googleMapsUri"),
        })
    return out[:PLACES_MAX_RESULTS]


def _routes_request(key: str, origin: Tuple[float, float], dest: Tuple[float, float],
                    mode: str) -> ph.ProviderResponse:
    travel = ROUTE_MODES[mode]
    payload: Dict[str, Any] = {
        "origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
        "destination": {"location": {"latLng": {"latitude": dest[0], "longitude": dest[1]}}},
        "travelMode": travel, "languageCode": "ja", "units": "METRIC",
    }
    if travel == "DRIVE":
        payload["routingPreference"] = "TRAFFIC_UNAWARE"
    return ph.post_json("google.routes.compute",
                        {"X-Goog-Api-Key": key, "X-Goog-FieldMask": ROUTES_FIELD_MASK,
                         "Content-Type": "application/json"}, payload)


def _route_summary(body: Any) -> Optional[Dict[str, Any]]:
    routes = body.get("routes") if isinstance(body, dict) else None
    if not routes or not isinstance(routes[0], dict):
        return None
    route = routes[0]
    seconds = str(route.get("duration") or "").rstrip("s")
    try:
        minutes = round(float(seconds) / 60.0, 1)
    except ValueError:
        minutes = None
    meters = route.get("distanceMeters")
    km = round(float(meters) / 1000.0, 2) if isinstance(meters, (int, float)) else None
    return {"duration_minutes": minutes, "distance_km": km}


# ===================================================================== 確認(管理者の明示の操作)で使う最小の要求

def verify_request(provider: str, key: str) -> ph.ProviderResponse:
    if provider == "openai":
        return _openai_request(key, "確認のため「OK」とだけ答えてください。", 16)
    if provider == "google_places":
        return _places_request(key, "東京駅", PLACES_VERIFY_FIELD_MASK, 1)
    if provider == "google_routes":
        return _routes_request(key, (35.6812, 139.7671), (35.6896, 139.7006), "driving")
    raise ValueError("unsupported_provider")


VERIFY_UNITS: Dict[str, Dict[str, int]] = {
    "ai.generate": {"input_tokens": 200, "output_tokens": 16},
    "places.search": {"requests": 1},
    "routes.element": {"elements": 1},
}


# ===================================================================== 業務の操作(利用者の明示の操作)

def _send(db: Session, provider: str, operation: str, request: Callable[[str], ph.ProviderResponse]
          ) -> ph.ProviderResponse:
    key, version = ps.resolve_for_send(db, provider, operation)
    try:
        resp = request(key)
    except ph.ProviderNetworkError as error:
        if error.code == "provider_timeout":
            raise cg.ProviderAmbiguousError(error.code)
        raise cg.ProviderTransientError(error.code, retry_safe=False)
    code = ph.classify(provider, resp.status, resp.body)
    if code == "accepted":
        return resp
    if ph.auth_of(code) == "rejected":
        ps.record_send_rejection(db, provider, operation, version, code)
        raise ProviderRejected(code)
    raise cg.ProviderTransientError(code, retry_safe=False)


def ai_suggest(db: Session, plan: TravelPlan, caller: User, prompt: str, idempotency_key: str
               ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    text = prompt.strip()
    reserve_input = min(len(text) * 2 + 400, 10000)  # 日本語は 1文字 ≒ 1〜2 token。多めに予約する

    def call(units: Dict[str, int]) -> cg.ProviderResult:
        resp = _send(db, "openai", "ai.generate", lambda key: _openai_request(key, text, AI_MAX_OUTPUT_TOKENS))
        used = _openai_usage(resp.body)
        out = _openai_text(resp.body)
        return cg.ProviderResult(units=used, payload={"text": out, "model": openai_model()}, model=openai_model())

    return cg.run(db, plan, caller, "ai.generate", "openai",
                  {"input_tokens": reserve_input, "output_tokens": AI_MAX_OUTPUT_TOKENS}, idempotency_key, call)


def places_search(db: Session, plan: TravelPlan, caller: User, query: str, lat: Optional[float],
                  lng: Optional[float], idempotency_key: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    def call(units: Dict[str, int]) -> cg.ProviderResult:
        resp = _send(db, "google_places", "places.search",
                     lambda key: _places_request(key, query, PLACES_FIELD_MASK, PLACES_MAX_RESULTS, lat, lng))
        return cg.ProviderResult(units={"requests": 1}, payload=_places_items(resp.body))

    return cg.run(db, plan, caller, "places.search", "google_places", {"requests": 1}, idempotency_key, call)


def route_between(db: Session, plan: TravelPlan, caller: User, origin: Tuple[float, float],
                  dest: Tuple[float, float], mode: str, idempotency_key: str
                  ) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    def call(units: Dict[str, int]) -> cg.ProviderResult:
        resp = _send(db, "google_routes", "routes.element", lambda key: _routes_request(key, origin, dest, mode))
        return cg.ProviderResult(units={"elements": 1}, payload=_route_summary(resp.body))

    return cg.run(db, plan, caller, "routes.element", "google_routes", {"elements": 1}, idempotency_key, call)
