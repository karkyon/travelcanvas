"""[Gate F07] 旅行相談の会話の1ターン(追加・訂正・削除・取消・矛盾)を、今の条件の状態への「変更案」として読む。

以前の追加の相談は、最初の文章の後ろに追加を足した全文を毎回 AI へ送り直し(全文の再送・上限で黙って切る)、
読み取った全体を前の結果と比べていた。ここでは AI へ送るのは:
  1. 最新の発言(1ターン。1,000 文字まで)
  2. 今の条件の状態(値・確認の状態・ID だけ。根拠の文・過去の発言は送らない)
だけにし、AI は許した形の「操作」の一覧だけを返す(JSON Schema strict)。サーバーは次を確かめてから変更案にする:
  - 根拠(evidence)が最新の発言の中に実際にあること(無い語を根拠にした操作は捨てる)
  - 対象の ID が状態にあること(予算・その他の希望・方面)、値の型と範囲
  - 同じ項目に食い違う値を同じターンで出したら、片方に決めず「食い違い」にする(例: 日帰りにしたい・必ず1泊)
  - 未言及の項目は変えない(null で既存の値を消さない。消すのは明示の clear・remove だけ)
変更の適用はしない(状態はサーバーに保存しない。画面が確かめた行は変更案として示し、採用するまで変えない)。
発言・状態・AI の答えはログ・監査に残さない(件数と分類だけ)。
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import TripConsultSession, User
from app.services import consult_ai as ca
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import trip_intent as ti

logger = logging.getLogger(__name__)

MAX_UTTERANCE_CHARS = 1000
MAX_OUTPUT_TOKENS = 1000
MAX_BUDGETS = 6
MAX_OPERATIONS = 12
FIELDS = ("origin", "party_size", "nights", "transport", "highway", "one_way_hours", "room", "dates")
OPS = ("set", "clear", "add_preference", "remove_preference", "add_note", "remove_note", "add_budget",
       "update_budget", "remove_budget", "area_candidate", "area_decide", "area_remove")
BUDGET_UNITS = ("total", "per_person", "undecided")
BUDGET_KEYS = ("id", "min_yen", "max_yen", "unit", "people", "target", "period", "kind", "confirmed")

INSTRUCTIONS = (
    "あなたは日本語の旅行相談の受付です。【今の条件】は既に整理した旅行の条件、【最新の発言】は利用者の今回の発言です。"
    "最新の発言が今の条件をどう変えるかだけを、operations の操作として返してください。発言に無いことは返さないでください。"
    "set は項目の値を決める・変える、clear は利用者が明示に取り消した項目を未定へ戻す(言及していない項目に使わない)。"
    "add_preference / remove_preference は過ごし方の希望、add_note / remove_note はその他の希望(remove は target_id)。"
    "予算は add_budget(新しい予算)・update_budget(target_id の予算を直す)・remove_budget。予算は額の範囲・"
    "unit(total=全員の合計・per_person=1人あたり)・people(何人分か。書かれていなければ null)・target(何の費用か)・"
    "period・kind(cap=上限・guide=目安)を分け、書かれていないものは undecided にしてください。人数が変わっても、"
    "予算の額・何人分かを勝手に計算し直さないでください。"
    "方面は area_candidate(候補)・area_decide(決めた)・area_remove(外す)。候補として挙げただけの方面を決めたことにしないでください。"
    "evidence には、根拠になった最新の発言の一部を、そのままの文字で 30 文字以内で書いてください。"
    "同じ項目について食い違う希望(例: 日帰りにしたい、でも必ず1泊)は、片方を選ばず conflicts に書き、その項目の操作は返さないでください。"
    "両立する希望(例: 静かな所と市場)は食い違いではありません。"
    "questions には、決めるのに足りない大事なことを短い問いで最大 2 つ書いてください。"
    "営業時間・料金・混雑・所要時間・距離の数値は書かず、人の名前・連絡先などの個人の情報は出力しないでください。"
)


def _n(kind: Any) -> Dict[str, Any]:
    return {"type": [kind, "null"]} if isinstance(kind, str) else kind


_BUDGET = ca._obj({
    "min_yen": _n("integer"), "max_yen": _n("integer"),
    "unit": {"type": "string", "enum": list(BUDGET_UNITS)}, "people": _n("integer"),
    "target": {"type": "string", "enum": list(ti.BUDGET_TARGETS)},
    "period": {"type": "string", "enum": list(ti.BUDGET_PERIODS)},
    "kind": {"type": "string", "enum": list(ti.BUDGET_KINDS)},
})
SCHEMA: Dict[str, Any] = ca._obj({
    "operations": {"type": "array", "items": ca._obj({
        "op": {"type": "string", "enum": list(OPS)},
        "field": {"type": ["string", "null"], "enum": list(FIELDS) + [None]},
        "text_value": _n("string"), "number_value": _n("number"), "bool_value": _n("boolean"),
        "target_id": _n("string"),
        "preference": {"type": ["string", "null"], "enum": list(ti.PREFERENCES) + [None]},
        "budget": {"anyOf": [_BUDGET, {"type": "null"}]},
        "evidence": _n("string"),
    })},
    "conflicts": {"type": "array", "items": ca._obj({"about": {"type": "string"}, "question": {"type": "string"}})},
    "questions": {"type": "array", "items": {"type": "string"}},
})
TEXT_FORMAT: Dict[str, Any] = {"type": "json_schema", "name": "trip_turn", "schema": SCHEMA, "strict": True}


class TurnError(Exception):
    def __init__(self, code: str, status: int, message: str):
        super().__init__(code)
        self.code, self.status, self.message = code, status, message


# ===================================================================== 状態(画面が持つ。サーバーは保存しない)

def clean_state(raw: Any) -> Dict[str, Any]:
    """画面から受け取った状態を、決まった形・大きさにする(知らないキー・長い文字は捨てる)。"""
    st = raw if isinstance(raw, dict) else {}
    fields: Dict[str, Any] = {}
    for f in FIELDS:
        item = (st.get("fields") or {}).get(f) if isinstance(st.get("fields"), dict) else None
        if isinstance(item, dict):
            fields[f] = {"value": _field_value(f, item.get("value")), "confirmed": bool(item.get("confirmed"))}
    budgets = []
    for b in (st.get("budgets") or [])[:MAX_BUDGETS]:
        if not isinstance(b, dict) or not isinstance(b.get("id"), str):
            continue
        budgets.append({"id": b["id"][:40], "confirmed": bool(b.get("confirmed")), **_budget_value(b)})
    notes = [{"id": n["id"][:40], "text": ca._str(n.get("text"), 100) or "", "confirmed": bool(n.get("confirmed"))}
             for n in (st.get("notes") or [])[:ti.MAX_NOTES] if isinstance(n, dict) and isinstance(n.get("id"), str)]
    areas = [{"name": ca._str(a.get("name"), 20) or "",
              "status": "decided" if a.get("status") == "decided" else "candidate"}
             for a in (st.get("areas") or [])[:ti.MAX_AREAS] if isinstance(a, dict)]
    prefs = [p for p in (st.get("preferences") or []) if p in ti.PREFERENCES][:10]
    rev = st.get("revision")
    return {"revision": rev if isinstance(rev, int) and not isinstance(rev, bool) and rev >= 0 else 0,
            "fields": fields, "budgets": budgets, "notes": [n for n in notes if n["text"]],
            "areas": [a for a in areas if a["name"]], "preferences": list(dict.fromkeys(prefs))}


def _field_value(field: str, v: Any) -> Any:
    if field in ("party_size",):
        return ca._int(v, 1, 30)
    if field == "nights":
        return ca._int(v, 0, 14)
    if field == "one_way_hours":
        return round(float(v) * 2) / 2 if isinstance(v, (int, float)) and not isinstance(v, bool) and 0.5 <= v <= 24 \
            else None
    if field == "transport":
        return v if v in ("car", "public") else None
    if field == "highway":
        return v if isinstance(v, bool) else None
    if field == "room":
        return v if v in ("same_room", "multiple_rooms") else None
    if field in ("origin",):
        return ca._str(v, 40)
    if field == "dates":
        return ca._str(v, 60)
    return None


def _budget_value(b: Dict[str, Any]) -> Dict[str, Any]:
    lo, hi = ca._int(b.get("min_yen"), 0, 10_000_000), ca._int(b.get("max_yen"), 0, 10_000_000)
    if lo is not None and hi is not None and lo > hi:
        lo, hi = hi, lo
    return {"min_yen": lo, "max_yen": hi,
            "unit": b.get("unit") if b.get("unit") in BUDGET_UNITS else "undecided",
            "people": ca._int(b.get("people"), 1, 30),
            "target": b.get("target") if b.get("target") in ti.BUDGET_TARGETS else "undecided",
            "period": b.get("period") if b.get("period") in ti.BUDGET_PERIODS else "undecided",
            "kind": b.get("kind") if b.get("kind") in ti.BUDGET_KINDS else "undecided"}


def state_for_ai(state: Dict[str, Any]) -> str:
    """AI へ送る今の条件(値・確認の状態・ID だけ。根拠の文・過去の発言は送らない)。"""
    compact = {
        "fields": {f: {"value": v["value"], "confirmed": v["confirmed"]} for f, v in state["fields"].items()
                   if v["value"] is not None},
        "budgets": [{k: b[k] for k in BUDGET_KEYS} for b in state["budgets"]],
        "preferences": state["preferences"],
        "notes": [{"id": n["id"], "text": n["text"]} for n in state["notes"]],
        "areas": state["areas"],
    }
    return json.dumps(compact, ensure_ascii=False, separators=(",", ":"))


def prompt_of(state: Dict[str, Any], utterance: str) -> str:
    return f"【今の条件】\n{state_for_ai(state)}\n\n【最新の発言】\n{utterance.strip()}"


def reserve_units(prompt: str) -> Dict[str, int]:
    """予約の量(多めに)。指示と schema は約 2,000 token。"""
    return {"input_tokens": min(len(prompt) * 2 + 2500, 10000), "output_tokens": MAX_OUTPUT_TOKENS}


# ===================================================================== 応答の検証 → 変更案

def changes_of(data: Dict[str, Any], state: Dict[str, Any], utterance: str) -> Dict[str, Any]:
    """AI の操作を検証して変更案にする。根拠の無い・対象の無い・型の違う操作は捨てる(dropped に数える)。"""
    norm = ti.normalize(utterance)
    changes: List[Dict[str, Any]] = []
    conflicts: List[Dict[str, str]] = []
    dropped = 0
    budget_ids = {b["id"]: b for b in state["budgets"]}
    note_ids = {n["id"]: n for n in state["notes"]}
    area_names = {a["name"]: a for a in state["areas"]}
    per_field: Dict[str, List[Dict[str, Any]]] = {}
    said: Dict[str, List[Tuple[Any, str]]] = {}  # 同じターンで項目に言った値(変わらない値も含む。食い違いの判定)
    new_budgets = 0
    for op in (data.get("operations") or [])[:MAX_OPERATIONS]:
        if not isinstance(op, dict) or op.get("op") not in OPS:
            dropped += 1
            continue
        kind = op["op"]
        evidence = ca._in_text(norm, op.get("evidence"))
        if evidence is None:
            dropped += 1  # 最新の発言に無い語を根拠にした操作は使わない
            continue
        change: Optional[Dict[str, Any]] = None
        if kind in ("set", "clear"):
            field = op.get("field")
            if field not in FIELDS:
                dropped += 1
                continue
            before = state["fields"].get(field, {"value": None, "confirmed": False})
            if kind == "set":
                raw = {"origin": op.get("text_value"), "dates": op.get("text_value"),
                       "transport": op.get("text_value"), "room": op.get("text_value"),
                       "highway": op.get("bool_value")}.get(field, op.get("number_value"))
                value = _field_value(field, int(raw) if field in ("party_size", "nights") and isinstance(raw, float)
                                     and raw.is_integer() else raw)
                if value is None:
                    dropped += 1
                    continue
                said.setdefault(field, []).append((value, evidence))
                if value == before["value"]:
                    continue  # 変わらない
            else:
                if before["value"] is None:
                    continue  # 未定のものを未定へ(変えない)
                value = None
            change = {"op": kind, "field": field, "before": before["value"], "after": value,
                      "needs_confirmation": bool(before["confirmed"])}
            per_field.setdefault(field, []).append(change)
        elif kind in ("add_preference", "remove_preference"):
            pref = op.get("preference")
            if pref not in ti.PREFERENCES:
                dropped += 1
                continue
            has = pref in state["preferences"]
            if (kind == "add_preference") == has:
                continue
            change = {"op": kind, "preference": pref, "label": ti.PREFERENCES[pref], "needs_confirmation": has}
        elif kind == "add_note":
            text = ca._str(op.get("text_value"), 100)
            if not text:
                dropped += 1
                continue
            change = {"op": kind, "after": text, "needs_confirmation": False}
        elif kind == "remove_note":
            target = note_ids.get(str(op.get("target_id") or ""))
            if target is None:
                dropped += 1
                continue
            change = {"op": kind, "target_id": target["id"], "before": target["text"],
                      "needs_confirmation": target["confirmed"]}
        elif kind in ("add_budget", "update_budget"):
            b = op.get("budget") if isinstance(op.get("budget"), dict) else None
            if b is None:
                dropped += 1
                continue
            value = _budget_value(b)
            if value["min_yen"] is None and value["max_yen"] is None and kind == "add_budget":
                dropped += 1
                continue
            if kind == "update_budget":
                target = budget_ids.get(str(op.get("target_id") or ""))
                if target is None:
                    dropped += 1
                    continue
                before_b = {k: target[k] for k in value}
                merged = {k: (value[k] if value[k] not in (None, "undecided") else before_b[k]) for k in value}
                if merged == before_b:
                    continue
                change = {"op": kind, "target_id": target["id"], "before": before_b, "after": merged,
                          "needs_confirmation": target["confirmed"]}
            else:
                if len(state["budgets"]) + new_budgets >= MAX_BUDGETS:
                    dropped += 1
                    continue
                new_budgets += 1
                change = {"op": kind, "target_id": f"b-{uuid.uuid4().hex[:8]}", "after": value,
                          "needs_confirmation": False}
        elif kind == "remove_budget":
            target = budget_ids.get(str(op.get("target_id") or ""))
            if target is None:
                dropped += 1
                continue
            change = {"op": kind, "target_id": target["id"], "before": {k: target[k] for k in _budget_value({})},
                      "needs_confirmation": target["confirmed"]}
        else:  # 方面
            name = ca._str(op.get("text_value"), 20)
            if not name or (name not in norm and name not in area_names):
                dropped += 1
                continue
            current = area_names.get(name)
            if kind == "area_remove" and current is None:
                continue
            if kind == "area_candidate" and current is not None:
                continue
            if kind == "area_decide" and current is not None and current["status"] == "decided":
                continue
            change = {"op": kind, "area": name, "before": current["status"] if current else None,
                      "needs_confirmation": kind == "area_remove"}
        if change is not None:
            change["evidence"] = evidence
            change["id"] = f"c{len(changes) + 1}"
            changes.append(change)
    # 同じ項目に食い違う値(日帰り・必ず1泊 など)を同じターンで出したら、どちらにも決めず食い違いにする
    for field, pairs in said.items():
        values = {json.dumps(v, ensure_ascii=False) for v, _e in pairs}
        if len(values) > 1:
            changes = [c for c in changes if c not in per_field.get(field, [])]
            conflicts.append({"about": field, "question": "「%s」と「%s」が食い違っています。どちらにしますか"
                              % (pairs[0][1], pairs[1][1])})
    for c in data.get("conflicts") or []:
        if isinstance(c, dict):
            q = ca._str(c.get("question"), 80)
            if q:
                conflicts.append({"about": ca._str(c.get("about"), 30) or "", "question": q})
    questions = [q for q in (ca._str(x, 80) for x in (data.get("questions") or [])) if q][:2]
    for i, c in enumerate(changes, start=1):
        c["id"] = f"c{i}"
    return {"changes": changes, "conflicts": conflicts[:5], "questions": questions, "dropped": dropped}


# ===================================================================== 送る

def read_turn(db: Session, session: TripConsultSession, caller: User, utterance: str, raw_state: Any,
              idempotency_key: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """1ターンを AI で読む(AI の 1回の要求。同じ相談の回数・50円の枠で予約・確定する)。"""
    text = (utterance or "").strip()
    if not text:
        raise TurnError("invalid_input", 422, "伝えることを入力してください")
    if len(text) > MAX_UTTERANCE_CHARS:
        raise TurnError("input_too_long", 422, f"1回に伝える文章は {MAX_UTTERANCE_CHARS} 文字までです(分けて伝えてください)")
    state = clean_state(raw_state)
    prompt = prompt_of(state, text)

    def call(units: Dict[str, int]) -> cg.ProviderResult:
        resp = pc.send(db, "openai", "ai.generate",
                       lambda key: pc._openai_request(key, prompt, MAX_OUTPUT_TOKENS, INSTRUCTIONS, TEXT_FORMAT))
        used = pc._openai_usage(resp.body)
        data = ca.parse_output(resp.body)
        return cg.ProviderResult(units=used, payload=data, model=pc.openai_model(),
                                 result_code="ok" if data is not None else "malformed")

    data, usage = cg.run(db, None, caller, "ai.generate", "openai", reserve_units(prompt), idempotency_key, call,
                         consult_id=session.id,
                         fingerprint=pc.fingerprint("openai", "consult.turn", str(session.id), prompt))
    if data is None:
        raise TurnError("ai_output_invalid", 502, "AI の応答を読めませんでした(使った分は枠に数えました)。伝えた文章は消えていません")
    result = changes_of(data, state, text)
    result.update({"revision": state["revision"] + 1, "base_revision": state["revision"], "model": pc.openai_model(),
                   "extractor": "openai_responses_turn"})
    return result, usage
