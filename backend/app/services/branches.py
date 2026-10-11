"""[Gate P7] What-if・旅程ブランチ(FR-019)の純粋関数(DB非依存)。

用語:
- base(作成時点の本案): {"days": [{id, local_date, timezone_id, title}], "events": [EventItem...]}
- content(分岐案): EventItem のリスト。本案の予定から来たものは source_event_id を持ち、追加した予定は持たない。
  removed=True は「分岐案では外す」。note は想定による自動変更や利用者のメモ。
- ops(分岐案での変更): base→content の差分。update(変えた項目だけ)・remove・add。
- 採用: ops を「現在の本案」へ当てる三方向の取り込み。分岐後に本案でも同じ予定の同じ項目が変わっていれば
  競合として止める(黙って上書きしない)。

想定(scenario)ごとの自動変更は、利用者が確認・修正できる案として作るだけで、本案は変えない:
- delay  : 指定日の指定時刻以降の予定を N 分遅らせる(日付を越える予定は 23:59 に留め、注意を付ける)
- rain   : 屋外の可能性がある予定(観光・アクティビティ)に「雨天時は要検討」と注意を付ける(外さない)
- fatigue: 1日の予定数の上限を超える予定を「外す候補」にする(後ろから)
- absence / budget / custom: 予定はそのまま(想定のメモだけ持つ)
確定(ロック)した予定は自動変更しない。
"""
import re
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

ALGORITHM_VERSION = "branch-v1"
SCENARIOS = ("rain", "delay", "absence", "budget", "fatigue", "custom")
EDITABLE_FIELDS = ("day_id", "title", "event_type", "local_start_time", "is_all_day", "sort_order")
OUTDOOR_TYPES = {"sightseeing", "activity"}
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class BranchError(ValueError):
    pass


def valid_time(v: Optional[str]) -> bool:
    return v is None or bool(_TIME_RE.match(v))


def to_minutes(v: str) -> int:
    h, m = v.split(":")
    return int(h) * 60 + int(m)


def from_minutes(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


def event_item(e) -> Dict[str, Any]:
    """TravelEvent → 分岐案の予定(比較・採用に使う項目と表示用の項目)。"""
    return {
        "key": str(e.id),
        "source_event_id": str(e.id),
        "day_id": str(e.day_id),
        "title": e.title,
        "event_type": e.event_type,
        "local_start_time": e.local_start_time,
        "is_all_day": bool(e.is_all_day),
        "sort_order": int(e.sort_order or 0),
        "locked": bool(e.locked),
        "removed": False,
        "note": None,
    }


# ===================================================================== 想定による自動変更

def apply_scenario(scenario: str, assumptions: Dict[str, Any], base: Dict[str, Any]) -> List[Dict[str, Any]]:
    days = {d["id"]: d for d in base["days"]}
    content = [dict(e) for e in base["events"]]
    if scenario == "delay":
        day_id = assumptions.get("day_id")
        if day_id not in days:
            raise BranchError("遅延を想定する日を選んでください")
        minutes = assumptions.get("minutes")
        if not isinstance(minutes, int) or not 15 <= minutes <= 720:
            raise BranchError("遅延は15〜720分で指定してください")
        after = assumptions.get("after") or "00:00"
        if not valid_time(after):
            raise BranchError("遅延が始まる時刻はHH:MMで指定してください")
        for e in content:
            if e["day_id"] != day_id or not e["local_start_time"] or e["is_all_day"]:
                continue
            if to_minutes(e["local_start_time"]) < to_minutes(after):
                continue
            if e["locked"]:
                e["note"] = "確定済みのため自動では動かしていません(遅延の影響を確認してください)"
                continue
            shifted = to_minutes(e["local_start_time"]) + minutes
            if shifted > 23 * 60 + 59:
                e["local_start_time"] = "23:59"
                e["note"] = f"{minutes}分遅らせると日付を越えるため23:59にしました(要調整)"
            else:
                e["note"] = f"{e['local_start_time']}から{minutes}分遅らせました"
                e["local_start_time"] = from_minutes(shifted)
    elif scenario == "rain":
        for e in content:
            if e["event_type"] in OUTDOOR_TYPES:
                e["note"] = "屋外の可能性があります。雨天時は屋内の代わりを検討してください"
    elif scenario == "fatigue":
        limit = assumptions.get("max_events_per_day")
        if not isinstance(limit, int) or not 1 <= limit <= 10:
            raise BranchError("1日の予定数の上限は1〜10で指定してください")
        by_day: Dict[str, List[Dict[str, Any]]] = {}
        for e in content:
            by_day.setdefault(e["day_id"], []).append(e)
        for items in by_day.values():
            items.sort(key=lambda x: x["sort_order"])
            movable = [e for e in items if not e["locked"]]
            excess = len(items) - limit
            for e in reversed(movable):
                if excess <= 0:
                    break
                e["removed"] = True
                e["note"] = f"1日{limit}件までに抑えるため外す候補にしました"
                excess -= 1
    return content


# ===================================================================== 分岐案の検証・差分

def validate_content(items: Sequence[Dict[str, Any]], base: Dict[str, Any]) -> List[Dict[str, Any]]:
    day_ids = {d["id"] for d in base["days"]}
    base_ids = {e["source_event_id"] for e in base["events"]}
    seen: Set[str] = set()
    out = []
    for i, raw in enumerate(items):
        src = raw.get("source_event_id")
        if src is not None and src not in base_ids:
            raise BranchError(f"{i + 1}件目: 分岐の元にない予定です")
        if src is not None and src in seen:
            raise BranchError(f"{i + 1}件目: 同じ予定が重複しています")
        if src is not None:
            seen.add(src)
        if raw.get("day_id") not in day_ids:
            raise BranchError(f"{i + 1}件目: 日程が正しくありません")
        title = (raw.get("title") or "").strip()
        if not 1 <= len(title) <= 200:
            raise BranchError(f"{i + 1}件目: 予定名は1〜200文字で入力してください")
        if not valid_time(raw.get("local_start_time")):
            raise BranchError(f"{i + 1}件目: 時刻はHH:MMで入力してください")
        etype = (raw.get("event_type") or "activity").strip()[:50] or "activity"
        note = raw.get("note")
        if note is not None and len(note) > 500:
            raise BranchError(f"{i + 1}件目: メモは500文字までです")
        out.append({
            "key": raw.get("key") or (src or f"new-{uuid.uuid4().hex[:12]}"),
            "source_event_id": src,
            "day_id": raw["day_id"],
            "title": title,
            "event_type": etype,
            "local_start_time": raw.get("local_start_time") or None,
            "is_all_day": bool(raw.get("is_all_day")),
            "sort_order": int(raw.get("sort_order") or 0),
            "locked": bool(next((e["locked"] for e in base["events"] if e["source_event_id"] == src), False)),
            "removed": bool(raw.get("removed")) if src is not None else False,
            "note": note,
        })
    missing = base_ids - seen
    if missing:
        raise BranchError("分岐の元の予定が欠けています(外す場合は「外す」にしてください)")
    return out


def compute_ops(base: Dict[str, Any], content: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    base_by_id = {e["source_event_id"]: e for e in base["events"]}
    ops: List[Dict[str, Any]] = []
    for item in content:
        src = item.get("source_event_id")
        if src is None:
            ops.append({"op": "add", "key": item["key"], "fields": {f: item[f] for f in EDITABLE_FIELDS}})
            continue
        b = base_by_id[src]
        if item.get("removed"):
            ops.append({"op": "remove", "event_id": src, "title": b["title"]})
            continue
        changed = {f: item[f] for f in EDITABLE_FIELDS if item[f] != b[f]}
        if changed:
            ops.append({"op": "update", "event_id": src, "title": b["title"], "fields": changed,
                        "before": {f: b[f] for f in changed}})
    return ops


def summarize(ops: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "added": sum(1 for o in ops if o["op"] == "add"),
        "removed": sum(1 for o in ops if o["op"] == "remove"),
        "updated": sum(1 for o in ops if o["op"] == "update"),
        "time_changed": sum(1 for o in ops if o["op"] == "update" and "local_start_time" in o["fields"]),
    }


def find_conflicts(ops: Sequence[Dict[str, Any]], base: Dict[str, Any], current: Dict[str, Dict[str, Any]],
                   current_day_ids: Set[str], related: Set[str]) -> List[Dict[str, Any]]:
    """採用できない理由の一覧(副作用なし)。current は現在の本案の予定(event_item の形)。"""
    base_by_id = {e["source_event_id"]: e for e in base["events"]}
    conflicts: List[Dict[str, Any]] = []
    for o in ops:
        if o["op"] == "add":
            if o["fields"]["day_id"] not in current_day_ids:
                conflicts.append({"op": "add", "key": o["key"], "reason": "day_missing"})
            continue
        eid = o["event_id"]
        cur = current.get(eid)
        b = base_by_id[eid]
        if cur is None:
            if o["op"] == "update":
                conflicts.append({"op": "update", "event_id": eid, "title": b["title"], "reason": "deleted_in_plan"})
            continue
        if cur["locked"]:
            conflicts.append({"op": o["op"], "event_id": eid, "title": b["title"], "reason": "locked"})
            continue
        if o["op"] == "update":
            fields = [f for f in o["fields"] if cur[f] != b[f] and cur[f] != o["fields"][f]]
            if fields:
                conflicts.append({"op": "update", "event_id": eid, "title": b["title"],
                                  "reason": "changed_in_plan", "fields": fields})
            if "day_id" in o["fields"] and o["fields"]["day_id"] not in current_day_ids:
                conflicts.append({"op": "update", "event_id": eid, "title": b["title"], "reason": "day_missing"})
        else:  # remove
            if any(cur[f] != b[f] for f in EDITABLE_FIELDS):
                conflicts.append({"op": "remove", "event_id": eid, "title": b["title"],
                                  "reason": "changed_in_plan", "fields": [f for f in EDITABLE_FIELDS
                                                                          if cur[f] != b[f]]})
            elif eid in related:
                conflicts.append({"op": "remove", "event_id": eid, "title": b["title"], "reason": "has_relations"})
    return conflicts


def day_counts(base: Dict[str, Any], content: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """日ごとの予定数(本案→分岐案)。比較表示用。"""
    base_counts: Dict[str, int] = {}
    for e in base["events"]:
        base_counts[e["day_id"]] = base_counts.get(e["day_id"], 0) + 1
    branch_counts: Dict[str, int] = {}
    for e in content:
        if not e.get("removed"):
            branch_counts[e["day_id"]] = branch_counts.get(e["day_id"], 0) + 1
    return [{"day_id": d["id"], "local_date": d["local_date"], "plan": base_counts.get(d["id"], 0),
             "branch": branch_counts.get(d["id"], 0)} for d in base["days"]]


def assumptions_ok(scenario: str, assumptions: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    note = assumptions.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 500):
        return False, "想定のメモは500文字までです"
    allowed = {"note", "day_id", "after", "minutes", "max_events_per_day", "budget_cut_percent", "absent_member"}
    extra = set(assumptions) - allowed
    if extra:
        return False, f"想定に不明な項目があります: {sorted(extra)}"
    if scenario == "budget" and "budget_cut_percent" in assumptions:
        v = assumptions["budget_cut_percent"]
        if not isinstance(v, int) or not 1 <= v <= 90:
            return False, "予算の削減率は1〜90%で指定してください"
    if "absent_member" in assumptions and (not isinstance(assumptions["absent_member"], str)
                                           or len(assumptions["absent_member"]) > 100):
        return False, "欠席する人は100文字までで入力してください"
    return True, None
