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

STUB_SUGGESTIONS = [{"name": "城崎温泉", "prefecture": "兵庫県", "reason": "模擬の提供元の案(実の AI ではありません)",
                     "highlights": "模擬の見どころ", "summary": "模擬の特色", "caution": "",
                     "spots": [{"name": "模擬の場所", "kind": "onsen", "note": "模擬"}],
                     "drive_minutes_min": 140, "drive_minutes_max": 170}]


def enabled() -> bool:
    return bool(getattr(settings, "PROVIDER_HTTP_STUB", False))


def _ev(m: Any) -> Any:
    return m if isinstance(m, str) else None


def _ai_answer(text: str) -> Dict[str, Any]:
    body = text.split("【相談の文章】", 1)[-1]
    first, *added = body.split("【追加】")
    ex = ti.extract(first, {})
    by = {i["key"]: i for i in ex["items"]}
    for extra in added:  # 追加で伝えた内容は、読み取れた項目だけ上書きする(変更の相談の模擬)
        for it in ti.extract(extra, {})["items"]:
            if it["source"] == "text":
                by[it["key"]] = it

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
                   "target": budget.get("target") or "undecided", "period": "undecided", "kind": "undecided",
                   "evidence": evid("budget")},
        "dates": {"status": dates.get("status") if dates.get("status") in ("fixed", "window") else "undecided",
                  "text": dates.get("text"), "evidence": evid("dates")},
        "preferences": list(by.get("preferences", {}).get("value") or []),
        "areas_mentioned": [a["name"] for a in ex["areas"] if a.get("source") == "user_input"]
        + [r["word"] for r in ex.get("regions", [])],
        "areas_suggested": STUB_SUGGESTIONS,
        "unknowns": ["模擬の提供元の答えです"],
        "other_wishes": ["何もしない時間がほしい"] if "何もしない" in body else [],
        "contradictions": ["日帰りと泊まりが食い違っています。どちらですか"] if "日帰り" in body and "泊" in body else [],
    }


def _turn_answer(text: str) -> Dict[str, Any]:
    """[Gate F07] 1ターンの模擬の答え(規則の読み取りの項目を set の操作にする。日帰りと泊まりは食い違い)。"""
    said = text.split("【最新の発言】", 1)[-1].strip()
    ops: list = []
    blank: Dict[str, Any] = {"field": None, "text_value": None, "number_value": None, "bool_value": None,
                             "target_id": None, "preference": None, "budget": None}
    conflict = "日帰り" in said and "泊" in said and "取り消" not in said
    conflicts = [{"about": "nights", "question": "日帰りと1泊が食い違っています。どちらですか"}] if conflict else []
    if "何もしない" in said:
        ops.append({**blank, "op": "add_note", "text_value": "何もしない時間がほしい", "evidence": "何もしない"})
    for it in ti.extract(said, {})["items"]:
        if it["source"] != "text" or not isinstance(it.get("evidence"), str):
            continue
        if conflict and it["key"] == "nights":
            continue  # 食い違いの項目は決めない
        if it["key"] in ("party_size", "nights"):
            ops.append({**blank, "op": "set", "field": it["key"], "number_value": it["value"],
                        "evidence": it["evidence"]})
        elif it["key"] == "origin":
            ops.append({**blank, "op": "set", "field": "origin", "text_value": it["value"], "evidence": it["evidence"]})
        elif it["key"] == "budget" and isinstance(it["value"], dict):
            b = it["value"]
            ops.append({**blank, "op": "add_budget", "evidence": it["evidence"],
                        "budget": {"min_yen": b.get("min"), "max_yen": b.get("max"), "unit": "undecided",
                                   "people": None, "target": b.get("target") or "undecided", "period": "undecided",
                                   "kind": "undecided"}})
    return {"operations": ops, "conflicts": conflicts, "questions": ["模擬の提供元の答えです"]}


def _openai(payload: Dict[str, Any]) -> httpx.Response:
    text = str(payload.get("input") or "")
    if payload.get("tools"):  # [Gate Remaining-7] AI の Web 検索の模擬(出典つき)
        return httpx.Response(200, json={"status": "completed", "output": [
            {"type": "web_search_call", "status": "completed"},
            {"type": "message", "content": [{
                "type": "output_text", "text": "模擬の調べた結果です(実在しません)",
                "annotations": [{"type": "url_citation", "url": "https://example.com/", "title": "模擬の出典"}]}]}],
            "usage": {"input_tokens": 5000, "output_tokens": 200}})
    if "E2E_TIMEOUT" in text:
        raise httpx.ReadTimeout("stub timeout")
    fmt = ((payload.get("text") or {}).get("format") or {}) if isinstance(payload.get("text"), dict) else {}
    if payload.get("text") and fmt.get("name") == "trip_areas":
        out = json.dumps({"areas": STUB_SUGGESTIONS}, ensure_ascii=False)
    elif payload.get("text") and fmt.get("name") == "trip_spots":
        out = json.dumps({"spots": [{"name": "模擬の神社", "kind": "shrine_temple", "note": "模擬の特色",
                                     "why": "模擬の理由"}]}, ensure_ascii=False)
    elif payload.get("text") and fmt.get("name") == "trip_turn":
        out = "{broken" if "E2E_BROKEN" in text else json.dumps(_turn_answer(text), ensure_ascii=False)
    elif payload.get("text"):
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
    return _get_handler(request)


# [Gate Remaining-7] FR-059 GET の模擬(場所の詳細・写真・静的な地図)。画像は 1×1 の PNG
_PNG_1x1 = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                         "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


def _get_handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url).split("?")[0]
    # 送り先は provider_http の許可の一覧から決める(有料の host をここに書かない)
    details = ph.ALLOWED_GET["google.places.details"].replace("{id}", "")
    static = ph.ALLOWED_GET["google.maps.static"]
    if url.startswith(details) and url.endswith("/media"):
        return httpx.Response(200, json={"name": url, "photoUri": "https://lh3.googleusercontent.com/stub-photo"})
    if url.startswith(details):
        pid = url.rsplit("/", 1)[-1]
        return httpx.Response(200, json={
            "id": pid, "displayName": {"text": "模擬の場所(実在しません)"}, "formattedAddress": "模擬の住所",
            "location": {"latitude": 35.01, "longitude": 135.0}, "googleMapsUri": "https://maps.google.com/?cid=1001",
            "businessStatus": "OPERATIONAL", "regularOpeningHours": {"weekdayDescriptions": ["月曜日: 9時00分～17時00分"]},
            "nationalPhoneNumber": "000-0000-0000", "websiteUri": "https://example.com/", "rating": 4.2,
            "userRatingCount": 10,
            "photos": [{"name": f"places/{pid}/photos/stubphoto0000001",
                        "authorAttributions": [{"displayName": "模擬の投稿者"}]}]})
    if url.startswith(static) or url.startswith("https://lh3.googleusercontent.com/"):
        return httpx.Response(200, headers={"content-type": "image/png"}, content=_PNG_1x1)
    return httpx.Response(404, json={"error": {"status": "NOT_FOUND"}})


def install() -> bool:
    """設定が真なら模擬の transport を入れる。本番・ステージングでは拒む(RuntimeError)。"""
    if not enabled():
        return False
    if settings.is_production:
        raise RuntimeError("PROVIDER_HTTP_STUB は本番・ステージングでは使えません")
    ph.set_transport(httpx.MockTransport(handler))
    return True
