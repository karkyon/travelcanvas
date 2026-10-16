"""[Gate P17] FR-057 Memory Replan の純粋関数(DB非依存)。

過去の旅行の予定と実績(P14 event_actuals)から傾向を見つけ、次の旅行への提案を作る(memory-replan-v1)。
- 予定の滞在時間: 同じ日の次の予定の開始までの時間(local_start_time どうしの差)。どちらかの時刻が無ければ使わない
- 実際の滞在時間: 実績の到着から出発まで
- 傾向(根拠の件数・旅行・例を必ず付ける。件数が足りなければ出さない):
  * stay_longer / stay_shorter: 同じ種類の予定で、実際の滞在が予定より平均15分以上長い/短い(2件以上)
  * late_arrival: 予定の開始より平均10分以上遅れて着く(3件以上)
  * often_skipped: 同じ種類の予定の半分以上に「行かなかった」(2件以上)
- 提案(適用できるのは stay_longer だけ): 対象の旅行で、その種類の予定の後に続く同じ日の予定を平均の分だけ後ろへずらす。
  確定(ロック)・予約付き・時刻なしの予定は動かさず、日をまたぐ(24時を超える)ずらしは作らない。
  ほかの傾向は助言だけ(旅程を変えない)。提案は利用者が適用するまで旅程を変えない(CA-015)。
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

ALGORITHM_VERSION = "memory-replan-v1"
MIN_STAY_SAMPLES = 2
MIN_STAY_DIFF = 15
MIN_LATE_SAMPLES = 3
MIN_LATE_MINUTES = 10
MIN_SKIP_SAMPLES = 2
SKIP_RATE = 0.5


def _minutes(hhmm: Optional[str]) -> Optional[int]:
    if not hhmm:
        return None
    try:
        h, m = (int(x) for x in hhmm.split(":")[:2])
    except (ValueError, TypeError):
        return None
    return h * 60 + m if 0 <= h < 24 and 0 <= m < 60 else None


def _hhmm(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def planned_minutes(day_events: List[Dict[str, Any]]) -> Dict[str, int]:
    """同じ日の予定(local_start_time付き)から、次の予定の開始までの分。event_id → 分"""
    timed = sorted((e for e in day_events if _minutes(e.get("local_start_time")) is not None),
                   key=lambda e: (_minutes(e["local_start_time"]), e.get("sort_order") or 0, str(e["id"])))
    out = {}
    for a, b in zip(timed, timed[1:]):
        d = _minutes(b["local_start_time"]) - _minutes(a["local_start_time"])
        if d > 0:
            out[str(a["id"])] = d
    return out


def _round5(v: float) -> int:
    return int(5 * round(v / 5))


def insights(samples: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """samples: {plan_id, plan_title, event_type, title, status, planned_minutes, actual_minutes, start_diff}"""
    out: List[Dict[str, Any]] = []
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for s in samples:
        by_type.setdefault(s["event_type"] or "other", []).append(s)

    for etype, ss in sorted(by_type.items()):
        stays = [s for s in ss if s["status"] == "visited" and s.get("planned_minutes") and s.get("actual_minutes")]
        if len(stays) >= MIN_STAY_SAMPLES:
            diff = sum(s["actual_minutes"] - s["planned_minutes"] for s in stays) / len(stays)
            if abs(diff) >= MIN_STAY_DIFF:
                out.append({
                    "kind": "stay_longer" if diff > 0 else "stay_shorter", "event_type": etype,
                    "minutes": _round5(abs(diff)), "samples": len(stays),
                    "plans": sorted({s["plan_title"] for s in stays}),
                    "examples": [s["title"] for s in stays[:3]], "applicable": diff > 0,
                })
        recorded = [s for s in ss if s["status"] in ("visited", "skipped")]
        skipped = [s for s in recorded if s["status"] == "skipped"]
        if len(recorded) >= MIN_SKIP_SAMPLES and len(skipped) / len(recorded) >= SKIP_RATE:
            out.append({
                "kind": "often_skipped", "event_type": etype, "minutes": None, "samples": len(recorded),
                "skipped": len(skipped), "plans": sorted({s["plan_title"] for s in recorded}),
                "examples": [s["title"] for s in skipped[:3]], "applicable": False,
            })
    late = [s for s in samples if s["status"] == "visited" and s.get("start_diff") is not None]
    if len(late) >= MIN_LATE_SAMPLES:
        avg = sum(s["start_diff"] for s in late) / len(late)
        if avg >= MIN_LATE_MINUTES:
            out.append({
                "kind": "late_arrival", "event_type": None, "minutes": _round5(avg), "samples": len(late),
                "plans": sorted({s["plan_title"] for s in late}), "examples": [s["title"] for s in late[:3]],
                "applicable": False,
            })
    return out


def proposals(insight_list: List[Dict[str, Any]], days: List[Dict[str, Any]],
              blocked_event_ids: Set[str]) -> List[Dict[str, Any]]:
    """days: [{id, local_date, events:[{id, title, event_type, local_start_time, locked, sort_order}]}]
    blocked_event_ids: 予約と紐付いた予定(動かさない)"""
    out = []
    for ins in insight_list:
        if ins["kind"] != "stay_longer":
            continue
        shift = ins["minutes"]
        changes: List[Dict[str, Any]] = []
        kept: List[Dict[str, Any]] = []
        moved: Set[str] = set()
        for d in days:
            evs = sorted((e for e in d["events"] if _minutes(e.get("local_start_time")) is not None),
                         key=lambda e: (_minutes(e["local_start_time"]), e.get("sort_order") or 0, str(e["id"])))
            for i, e in enumerate(evs):
                if (e.get("event_type") or "other") != ins["event_type"]:
                    continue
                for f in evs[i + 1:]:
                    fid = str(f["id"])
                    if fid in moved:
                        continue
                    reason = None
                    if f.get("locked"):
                        reason = "locked"
                    elif fid in blocked_event_ids:
                        reason = "has_reservation"
                    elif _minutes(f["local_start_time"]) + shift >= 24 * 60:
                        reason = "next_day"
                    if reason:
                        if all(k["event_id"] != fid for k in kept):
                            kept.append({"event_id": fid, "title": f["title"], "reason": reason})
                        # 動かせない予定より後ろは、順番が入れ替わらないよう動かさない
                        break
                    moved.add(fid)
                    changes.append({"event_id": fid, "title": f["title"], "day_id": str(d["id"]),
                                    "from": f["local_start_time"],
                                    "to": _hhmm(_minutes(f["local_start_time"]) + shift)})
        if not changes:
            continue
        key = json.dumps([ins["kind"], ins["event_type"], shift, changes], sort_keys=True, ensure_ascii=False)
        out.append({"id": hashlib.sha256(key.encode()).hexdigest()[:16], "kind": ins["kind"],
                    "event_type": ins["event_type"], "minutes": shift, "changes": changes, "kept": kept})
    return out


def fingerprint(days: List[Dict[str, Any]], blocked_event_ids: Iterable[str],
                insight_list: List[Dict[str, Any]]) -> str:
    def ev_row(e: Dict[str, Any]) -> List[Any]:
        return [str(e["id"]), e.get("local_start_time"), e.get("event_type"), bool(e.get("locked"))]

    data = {
        "days": [[str(d["id"]), [ev_row(e) for e in sorted(d["events"], key=lambda x: str(x["id"]))]]
                 for d in sorted(days, key=lambda x: str(x["id"]))],
        "blocked": sorted(str(x) for x in blocked_event_ids),
        "insights": [[i["kind"], i["event_type"], i["minutes"]] for i in insight_list],
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:24]


def sample_rows(days: List[Dict[str, Any]], actuals: Dict[str, Dict[str, Any]], plan_id: str, plan_title: str,
                planned_start) -> List[Dict[str, Any]]:
    """1つの旅行の予定と実績から傾向の材料を作る。planned_start(day, event) → 予定の開始(UTC)|None"""
    rows = []
    for d in days:
        pm = planned_minutes(d["events"])
        for e in d["events"]:
            a = actuals.get(str(e["id"]))
            if not a:
                continue
            actual = None
            diff = None
            if a.get("actual_start_at") and a.get("actual_end_at"):
                actual = round((_aware(a["actual_end_at"]) - _aware(a["actual_start_at"])).total_seconds() / 60)
            ps = planned_start(d, e)
            if ps is not None and a.get("actual_start_at"):
                diff = round((_aware(a["actual_start_at"]) - ps).total_seconds() / 60)
            rows.append({"plan_id": plan_id, "plan_title": plan_title, "event_type": e.get("event_type") or "other",
                         "title": e["title"], "status": a["status"], "planned_minutes": pm.get(str(e["id"])),
                         "actual_minutes": actual, "start_diff": diff})
    return rows
