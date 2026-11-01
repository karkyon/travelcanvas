"""[Gate ConsultAI] 旅行相談の AI の読み取り・方面の案(OpenAI Responses の構造化の出力)。

順(送る前に全て確かめる): 相談の持ち主・期限 → AI の利用の同意 → 会員のクラス・1相談 50円・回数(cost_guard の予約)
→ 提供元の停止 → 確認済みの鍵(provider_secrets.resolve_for_send)→ 送信 → 応答の検証 → 原価の確定。

- AI の答えは「AI の読み取り · 未確認」。利用者が確かめた行だけを条件に使う(画面の側の決まり)
- 文章の中の該当の語(evidence)は、相談の文章に実際にある時だけ示す(無い語を根拠として出さない)
- 営業時間・料金・混み具合・運転時間は AI に作らせない(指示と schema に持たない)。方面の案は「AI の案 · 未確認」
- 相談の文章・AI の結果は保存しない。ログ・監査には件数・操作・結果の分類だけを残す
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import TripConsultSession, User
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import trip_intent as ti

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 3000
MAX_OUTPUT_TOKENS = 1200
MAX_SUGGESTIONS = 5
EXTRACTOR = "openai_responses"

INSTRUCTIONS = (
    "あなたは日本語の旅行相談の受付です。利用者の文章(と画面で入力した項目)から、旅行の条件を JSON Schema の形で取り出してください。"
    "書かれていないことは null・空の配列にし、推測で埋めないでください。"
    "evidence には、根拠になった利用者の文章の一部を、そのままの文字で 30 文字以内で書いてください(無ければ null)。"
    "areas_mentioned は利用者が書いた行き先・方面の名前だけです。"
    "areas_suggested は、条件に合いそうな日本の方面の案を最大 5 つ、名前と理由(60 文字以内)で書いてください。"
    "営業時間・料金・空室・混雑・所要時間・距離の数値は書かないでください(確かめていないため)。"
    "人の名前・連絡先・住所の番地などの個人の情報は出力しないでください。"
    "unknowns には、旅行を考えるのにまだ決まっていない大事なこと(例: 日付、予算)を短く書いてください。"
)


def _nullable(kind: str, **extra: Any) -> Dict[str, Any]:
    return {"type": [kind, "null"], **extra}


def _ev() -> Dict[str, Any]:
    return _nullable("string")


def _obj(props: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


PREF_KEYS = list(ti.PREFERENCES)

SCHEMA: Dict[str, Any] = _obj({
    "origin": _obj({"value": _nullable("string"), "evidence": _ev()}),
    "party_size": _obj({"value": _nullable("integer"), "evidence": _ev()}),
    "nights": _obj({"value": _nullable("integer"), "evidence": _ev()}),
    "transport": _obj({"mode": {"type": ["string", "null"], "enum": ["car", "public", None]},
                       "highway": _nullable("boolean"), "evidence": _ev()}),
    "one_way_hours": _obj({"value": _nullable("number"), "evidence": _ev()}),
    "room": _obj({"value": {"type": ["string", "null"], "enum": ["same_room", "multiple_rooms", None]},
                  "evidence": _ev()}),
    "budget": _obj({"min_yen": _nullable("integer"), "max_yen": _nullable("integer"),
                    "scope": {"type": ["string", "null"], "enum": ["total", "per_person", None]}, "evidence": _ev()}),
    "dates": _obj({"status": {"type": "string", "enum": ["fixed", "window", "undecided"]},
                   "text": _nullable("string"), "evidence": _ev()}),
    "preferences": {"type": "array", "items": {"type": "string", "enum": PREF_KEYS}},
    "areas_mentioned": {"type": "array", "items": {"type": "string"}},
    "areas_suggested": {"type": "array", "items": _obj({"name": {"type": "string"}, "reason": {"type": "string"}})},
    "unknowns": {"type": "array", "items": {"type": "string"}},
})
TEXT_FORMAT: Dict[str, Any] = {"type": "json_schema", "name": "trip_intent", "schema": SCHEMA, "strict": True}

_FIELD_LABEL = {
    "origin": "出発地", "travel_window": "時期", "date_status": "日付の扱い", "start_date": "出発日",
    "party_size": "人数", "nights": "泊数", "transport": "移動", "highway": "高速道路", "one_way_strength": "片道の扱い",
    "room": "部屋", "budget_scope": "予算の範囲", "preferences": "過ごし方",
}


class ConsultAIError(Exception):
    def __init__(self, code: str, status: int, message: str):
        super().__init__(code)
        self.code, self.status, self.message = code, status, message


def input_text(text: str, fields: Dict[str, Any]) -> str:
    """AI へ渡す文章(相談の文章と、画面の入力の項目の要約)。アカウントの情報は含めない。"""
    lines = [f"{_FIELD_LABEL[k]}: {v}" for k, v in fields.items() if k in _FIELD_LABEL and v not in (None, "", [])]
    head = "【画面で入力した項目】\n" + "\n".join(lines) + "\n\n" if lines else ""
    return f"{head}【相談の文章】\n{text.strip()}"


def reserve_units(text_for_ai: str) -> Dict[str, int]:
    """予約の量(多めに見積もる)。日本語は 1文字 ≒ 1〜2 token、指示と schema は約 2,500 token。"""
    return {"input_tokens": min(len(text_for_ai) * 2 + 3000, 10000), "output_tokens": MAX_OUTPUT_TOKENS}


# ===================================================================== 応答の検証

def parse_output(body: Any) -> Optional[Dict[str, Any]]:
    """構造化の出力を読む。未完了・拒否・JSON でない時は None(呼出側は「AI の応答を読めなかった」にする)。"""
    if not isinstance(body, dict) or body.get("status") not in (None, "completed"):
        return None
    for item in body.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "refusal":
                return None
    raw = pc._openai_text(body)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _in_text(norm_text: str, quote: Any) -> Optional[str]:
    if not isinstance(quote, str):
        return None
    q = ti.normalize(quote).strip().strip("「」\"'")
    if 1 <= len(q) <= 60 and q in norm_text:
        return q[:40]
    return None


def _str(v: Any, limit: int) -> Optional[str]:
    if not isinstance(v, str):
        return None
    v = " ".join(v.split()).strip()
    return v[:limit] if v else None


def _int(v: Any, lo: int, hi: int) -> Optional[int]:
    if isinstance(v, bool) or not isinstance(v, int):
        return None
    return v if lo <= v <= hi else None


def ai_fields(data: Dict[str, Any], norm_text: str) -> Tuple[Dict[str, Any], Dict[str, Optional[str]]]:
    """AI の答えを、規則の読み取りと同じ画面の項目(fields)の形にする。値の範囲の外は捨てる。(fields, evidence)"""
    f: Dict[str, Any] = {}
    ev: Dict[str, Optional[str]] = {}

    def part(name: str) -> Dict[str, Any]:
        v = data.get(name)
        return v if isinstance(v, dict) else {}

    origin = _str(part("origin").get("value"), 40)
    if origin:
        f["origin"], ev["origin"] = origin, _in_text(norm_text, part("origin").get("evidence"))
    party = _int(part("party_size").get("value"), 1, 30)
    if party is not None:
        f["party_size"], ev["party_size"] = party, _in_text(norm_text, part("party_size").get("evidence"))
    nights = _int(part("nights").get("value"), 0, 14)
    if nights is not None:
        f["nights"], ev["nights"] = nights, _in_text(norm_text, part("nights").get("evidence"))
    tr = part("transport")
    if tr.get("mode") in ("car", "public"):
        f["transport"] = tr["mode"]
        f["highway"] = bool(tr.get("highway")) if tr["mode"] == "car" else False
        ev["transport"] = _in_text(norm_text, tr.get("evidence"))
    hours = part("one_way_hours").get("value")
    if isinstance(hours, (int, float)) and not isinstance(hours, bool) and 0.5 <= float(hours) <= 24:
        f["one_way_hours"] = round(float(hours) * 2) / 2
        ev["one_way"] = _in_text(norm_text, part("one_way_hours").get("evidence"))
    room = part("room").get("value")
    if room in ("same_room", "multiple_rooms"):
        f["room"], ev["room"] = room, _in_text(norm_text, part("room").get("evidence"))
    b = part("budget")
    lo, hi = _int(b.get("min_yen"), 0, 10_000_000), _int(b.get("max_yen"), 0, 10_000_000)
    if lo is not None or hi is not None:
        lo = lo if lo is not None else hi
        hi = hi if hi is not None else lo
        assert lo is not None and hi is not None
        f["_budget"] = {"min": min(lo, hi), "max": max(lo, hi),
                        "scope": b.get("scope") if b.get("scope") in ("total", "per_person") else None}
        ev["budget"] = _in_text(norm_text, b.get("evidence"))
    d = part("dates")
    if d.get("status") in ("fixed", "window"):
        text = _str(d.get("text"), 60)
        if text:
            f["travel_window"], f["date_status"] = text, d["status"]
            ev["dates"] = _in_text(norm_text, d.get("evidence"))
    prefs = [p for p in (data.get("preferences") or []) if p in ti.PREFERENCES]
    if prefs:
        f["preferences"] = list(dict.fromkeys(prefs))
        ev["preferences"] = None
    return f, ev


def _budget_item(b: Dict[str, Any], evidence: Optional[str]) -> Dict[str, Any]:
    lo, hi = int(b["min"]), int(b["max"])
    man = (lambda y: f"{y / 10000:g}万円")
    disp = f"{man(lo)}〜{man(hi)}" if lo != hi else man(lo)
    q = {"id": "budget_scope", "text": f"{disp}は、全員の合計(1部屋・1泊)ですか、1人あたりですか",
         "options": [{"value": "total", "label": "全員の合計"}, {"value": "per_person", "label": "1人あたり"}],
         "suggested": b.get("scope"),
         "hint": "宿を探す時の条件になります。税・食事の有無は宿を照会する時に確かめます"}
    return ti._item("budget", "宿泊費の目安", {"min": lo, "max": hi, "scope": None}, disp, "ai", "preferred",
                    evidence, q)


AI_KEYS = {
    "origin": ("origin",), "party_size": ("party_size",), "nights": ("nights",),
    "transport": ("transport", "highway"), "one_way": ("one_way_hours",), "room": ("room",),
    "dates": ("travel_window", "date_status"), "preferences": ("preferences",),
}


def merge(text: str, user_fields: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
    """規則の読み取り(あなたの入力を優先)の上に、AI の読み取りを「AI · 未確認」として重ねる。"""
    base = ti.extract(text, user_fields)
    norm = ti.normalize(text)
    fields, ev = ai_fields(data, norm)
    items: List[Dict[str, Any]] = []
    for it in base["items"]:
        key = it["key"]
        if it["source"] == "user_input" or (it.get("question") or {}).get("id") == "party_size":
            items.append(it)  # あなたの入力・入力欄と文章の食い違い(選んでもらう)はそのまま
            continue
        if key == "budget" and "_budget" in fields:
            items.append(_budget_item(fields["_budget"], ev.get("budget")))
            continue
        names = AI_KEYS.get(key)
        if not names or not any(n in fields for n in names):
            items.append(it)
            continue
        sub = {n: fields[n] for n in names if n in fields}
        if key == "one_way" and user_fields.get("one_way_strength"):
            sub["one_way_strength"] = user_fields["one_way_strength"]
        built = next((x for x in ti.extract("", sub)["items"] if x["key"] == key), None)
        if built is None:
            items.append(it)
            continue
        built["source"] = "ai"
        built["evidence"] = ev.get(key)
        if key not in ("one_way", "budget", "preferences"):
            built["strength"] = "undecided"
        items.append(built)
    mentioned = [a for a in (_str(x, 15) for x in (data.get("areas_mentioned") or [])) if a and a in norm]
    area_names = list(dict.fromkeys([a["name"] for a in base["areas"]] + mentioned))[:ti.MAX_AREAS]
    areas: List[Dict[str, Any]] = [{"name": a, "source": "user_input"} for a in area_names]
    suggested: List[Dict[str, Any]] = []
    for s in data.get("areas_suggested") or []:
        if not isinstance(s, dict):
            continue
        name, reason = _str(s.get("name"), 20), _str(s.get("reason"), 80)
        if name and name not in area_names and all(x["name"] != name for x in suggested):
            suggested.append({"name": name, "reason": reason or "", "source": "ai_suggested"})
        if len(suggested) >= MAX_SUGGESTIONS:
            break
    unknowns = [u for u in (_str(x, 60) for x in (data.get("unknowns") or [])) if u][:5]
    nights = next((x["value"] for x in items if x["key"] == "nights" and isinstance(x["value"], int)), None)
    return {"items": items, "areas": areas, "suggested_areas": suggested, "unknowns": unknowns, "nights": nights,
            "extractor": EXTRACTOR, "ai_connected": True}


# ===================================================================== 送る

def extract(db: Session, session: TripConsultSession, caller: User, text: str, user_fields: Dict[str, Any],
            idempotency_key: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """AI で読み取る。断る時は cost_guard / provider_secrets / provider_calls の例外(何も送っていない)。"""
    clean = text.strip()
    if len(clean) > MAX_TEXT_CHARS:
        raise ConsultAIError("input_too_long", 422, f"AI へ送る文章は {MAX_TEXT_CHARS} 文字までです")
    if not clean:
        raise ConsultAIError("invalid_input", 422, "AI に読み取らせる文章を入力してください")
    prompt = input_text(clean, {k: v for k, v in user_fields.items() if k != "areas"})

    def call(units: Dict[str, int]) -> cg.ProviderResult:
        resp = pc.send(db, "openai", "ai.generate",
                       lambda key: pc._openai_request(key, prompt, MAX_OUTPUT_TOKENS, INSTRUCTIONS, TEXT_FORMAT))
        used = pc._openai_usage(resp.body)
        data = parse_output(resp.body)
        # 読めない応答でも、提供元は token を使った(使った分で確定する)
        return cg.ProviderResult(units=used, payload=data, model=pc.openai_model(),
                                 result_code="ok" if data is not None else "malformed")

    data, usage = cg.run(db, None, caller, "ai.generate", "openai", reserve_units(prompt), idempotency_key, call,
                         consult_id=session.id)
    if data is None:
        raise ConsultAIError("ai_output_invalid", 502,
                             "AI の応答を読めませんでした(使った分は枠に数えました)。文章は消えていません。"
                             "AI を使わずに読み取ることもできます")
    result = merge(clean, user_fields, data)
    result["model"] = pc.openai_model()
    return result, usage
