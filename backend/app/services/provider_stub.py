"""[Gate ConsultAI] 試験用の模擬の提供元(CI の E2E だけ。設定 PROVIDER_HTTP_STUB)。

外への送信(provider_http)の transport をアプリの中の決まった応答に差し替える。実の API へは送らず、課金も無い。
- 本番・ステージング(settings.is_production)では有効にできない(起動時に拒む)
- 画面・API には「模擬」と示す(実の API の成功と誤認させない)
- AI の読み取りの模擬は、規則の読み取り(trip_intent.extract)の結果を AI の schema の形にして返す(決まった答え)。
  文章に「E2E_TIMEOUT」があれば時間切れ、「E2E_BROKEN」があれば JSON でない答えを返す(失敗の経路の試験)
"""
from __future__ import annotations

import json
from typing import Any, Dict

import httpx

from app.core.config import settings
from app.services import provider_http as ph
from app.services import trip_intent as ti

STUB_SUGGESTIONS = [{"name": "城崎温泉", "reason": "模擬の提供元の案(実の AI ではありません)"}]


def enabled() -> bool:
    return bool(getattr(settings, "PROVIDER_HTTP_STUB", False))


def _ev(m: Any) -> Any:
    return m if isinstance(m, str) else None


def _ai_answer(text: str) -> Dict[str, Any]:
    body = text.split("【相談の文章】", 1)[-1]
    ex = ti.extract(body, {})
    by = {i["key"]: i for i in ex["items"]}

    def val(key: str) -> Any:
        it = by.get(key)
        return it["value"] if it and it["source"] == "text" else None

    def evid(key: str) -> Any:
        it = by.get(key)
        return _ev(it["evidence"]) if it and it["source"] == "text" else None
    tr = val("transport") or {}
    budget = val("budget") or {}
    dates = by.get("dates", {}).get("value") or {}
    return {
        "origin": {"value": val("origin"), "evidence": evid("origin")},
        "party_size": {"value": val("party_size"), "evidence": evid("party_size")},
        "nights": {"value": val("nights"), "evidence": evid("nights")},
        "transport": {"mode": tr.get("mode"), "highway": tr.get("highway"), "evidence": evid("transport")},
        "one_way_hours": {"value": val("one_way"), "evidence": evid("one_way")},
        "room": {"value": val("room"), "evidence": evid("room")},
        "budget": {"min_yen": budget.get("min"), "max_yen": budget.get("max"), "scope": None,
                   "evidence": evid("budget")},
        "dates": {"status": dates.get("status") if dates.get("status") in ("fixed", "window") else "undecided",
                  "text": dates.get("text"), "evidence": evid("dates")},
        "preferences": list(by.get("preferences", {}).get("value") or []),
        "areas_mentioned": [a["name"] for a in ex["areas"]],
        "areas_suggested": STUB_SUGGESTIONS,
        "unknowns": ["模擬の提供元の答えです"],
    }


def _openai(payload: Dict[str, Any]) -> httpx.Response:
    text = str(payload.get("input") or "")
    if "E2E_TIMEOUT" in text:
        raise httpx.ReadTimeout("stub timeout")
    if payload.get("text"):
        out = "{broken" if "E2E_BROKEN" in text else json.dumps(_ai_answer(text), ensure_ascii=False)
    else:
        out = "OK(模擬)"
    return httpx.Response(200, json={"status": "completed", "output": [
        {"type": "message", "content": [{"type": "output_text", "text": out}]}],
        "usage": {"input_tokens": min(len(text) * 2 + 800, 9000), "output_tokens": 300}})


def handler(request: httpx.Request) -> httpx.Response:
    try:
        payload = json.loads(request.content or b"{}")
    except ValueError:
        payload = {}
    # 送り先は provider_http の許可の一覧から決める(有料の host をここに書かない)
    endpoint = next((name for name, url in ph.ALLOWED.items() if str(request.url) == url), None)
    if endpoint == "openai.responses":
        return _openai(payload)
    if endpoint == "google.places.search_text":
        q = str(payload.get("textQuery") or "")
        return httpx.Response(200, json={"places": [
            {"id": f"stub-{i}", "displayName": {"text": f"{q[:20]}(模擬の場所 {i})"},
             "formattedAddress": "模擬の住所(実在しません)", "location": {"latitude": 35.0 + i / 100, "longitude": 135.0},
             "googleMapsUri": f"https://maps.google.com/?cid={1000 + i}"}
            for i in (1, 2)][:int(payload.get("pageSize") or 2)]})
    if endpoint == "google.routes.compute":
        return httpx.Response(200, json={"routes": [{"duration": "9000s", "distanceMeters": 180000}]})
    return httpx.Response(404, json={"error": {"status": "NOT_FOUND"}})


def install() -> bool:
    """設定が真なら模擬の transport を入れる。本番・ステージングでは拒む(RuntimeError)。"""
    if not enabled():
        return False
    if settings.is_production:
        raise RuntimeError("PROVIDER_HTTP_STUB は本番・ステージングでは使えません")
    ph.set_transport(httpx.MockTransport(handler))
    return True
