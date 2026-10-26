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

[Gate G7] MEM-03 の一部(memory-replan-v2):
- 同行者の属性: 過去の旅行ごとに、子ども連れ・高齢の同行者・1人か複数か(移動の既定の party と参加者の数)を付け、
  この旅行と同じ属性の旅行だけで傾向が出せる時はそちらを使う(basis=same_party)。出せなければ全ての旅行(basis=all)
- 移動手段の傾向(slow_transport): 同じ移動手段の区間の後で、着くのが平均10分以上遅れる(3件以上)。
  提案(適用できる): この旅行のその手段の区間の「前の余裕」を平均の分だけ足す(120分まで。1つの変更セットで元に戻せる)
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

ALGORITHM_VERSION = "memory-replan-v2"
MIN_STAY_SAMPLES = 2
MIN_STAY_DIFF = 15
MIN_LATE_SAMPLES = 3
MIN_LATE_MINUTES = 10
MIN_SKIP_SAMPLES = 2
SKIP_RATE = 0.5
MIN_TRANSPORT_SAMPLES = 3
MIN_TRANSPORT_DELAY = 10
MAX_BUFFER = 120
MODE_LABEL = {"walking": "徒歩", "driving": "車", "train": "鉄道", "bus": "バス", "ferry": "船", "flight": "飛行機",
              "bicycle": "自転車", "taxi": "タクシー", "mixed": "複合"}


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


def same_party(a: Optional[Dict[str, Any]], b: Optional[Dict[str, Any]]) -> bool:
    if not a or not b:
        return False
    return all(a.get(k) == b.get(k) for k in ("with_children", "with_seniors", "group"))


def party_label(party: Optional[Dict[str, Any]]) -> str:
    if not party:
        return ""
    who = [w for w, on in (("子ども連れ", party.get("with_children")), ("高齢の方と一緒", party.get("with_seniors"))) if on]
    who.append("1人" if party.get("group") == "solo" else "複数人")
    return "・".join(who)


def insights(samples: List[Dict[str, Any]], party: Optional[Dict[str, Any]] = None,
             transport: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """[Gate G7] 同じ属性の旅行で傾向が出せればそちらを優先する(basis)。transport は移動手段の傾向の材料。"""
    every = _insights(samples)
    for i in every:
        i["basis"] = "all"
    if party is not None:
        same = _insights([s for s in samples if same_party(s.get("party"), party)])
        by_key = {(i["kind"], i["event_type"]): i for i in same}
        merged = []
        for i in every:
            alt = by_key.pop((i["kind"], i["event_type"]), None)
            if alt is not None:
                alt["basis"] = "same_party"
                alt["party_label"] = party_label(party)
                merged.append(alt)
            else:
                merged.append(i)
        for alt in by_key.values():
            alt["basis"] = "same_party"
            alt["party_label"] = party_label(party)
            merged.append(alt)
        every = merged
    if transport:
        every.extend(transport_insights(transport, party))
    return every


def transport_insights(rows: List[Dict[str, Any]], party: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """rows: {plan_title, mode, delay(分), label, party}。同じ属性の旅行で件数が足りればそちらを使う。"""
    out: List[Dict[str, Any]] = []
    modes = sorted({r["mode"] for r in rows})
    for mode in modes:
        all_rows = [r for r in rows if r["mode"] == mode]
        same_rows = [r for r in all_rows if same_party(r.get("party"), party)] if party is not None else []
        for basis, use in (("same_party", same_rows), ("all", all_rows)):
            if len(use) < MIN_TRANSPORT_SAMPLES:
                continue
            avg = sum(r["delay"] for r in use) / len(use)
            if avg < MIN_TRANSPORT_DELAY:
                break  # 同じ属性で遅れていなければ、全体の値で上書きしない
            item = {"kind": "slow_transport", "event_type": None, "mode": mode,
                    "mode_label": MODE_LABEL.get(mode, mode), "minutes": _round5(avg), "samples": len(use),
                    "plans": sorted({r["plan_title"] for r in use}), "examples": [r["label"] for r in use[:3]],
                    "applicable": True, "basis": basis}
            if basis == "same_party":
                item["party_label"] = party_label(party)
            out.append(item)
            break
    return out


def transport_proposals(insight_list: List[Dict[str, Any]], segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """segments: この旅行の区間 {id, mode, status, buffer_before_minutes, label}。前の余裕を足す提案。"""
    out = []
    for ins in insight_list:
        if ins["kind"] != "slow_transport":
            continue
        changes = []
        for sg in sorted(segments, key=lambda x: str(x["id"])):
            if sg["mode"] != ins["mode"] or sg.get("status") == "cancelled":
                continue
            before = int(sg.get("buffer_before_minutes") or 0)
            after = min(before + ins["minutes"], MAX_BUFFER)
            if after == before:
                continue
            changes.append({"segment_id": str(sg["id"]), "label": sg["label"], "from": before, "to": after})
        if not changes:
            continue
        key = json.dumps([ins["kind"], ins["mode"], ins["minutes"], changes], sort_keys=True, ensure_ascii=False)
        out.append({"id": hashlib.sha256(key.encode()).hexdigest()[:16], "kind": ins["kind"], "event_type": None,
                    "mode": ins["mode"], "minutes": ins["minutes"], "changes": changes, "kept": [],
                    "target": "segment"})
    return out


def transport_rows(days: List[Dict[str, Any]], actuals: Dict[str, Dict[str, Any]], segments: List[Dict[str, Any]],
                   plan_title: str, party: Optional[Dict[str, Any]], planned_start) -> List[Dict[str, Any]]:
    """過去の旅行の区間ごとに、着いた予定の遅れ(実際の到着 − 予定の開始)。"""
    by_event = {}
    for d in days:
        for e in d["events"]:
            by_event[str(e["id"])] = (d, e)
    rows = []
    for sg in segments:
        if sg.get("status") == "cancelled" or not sg.get("to_event_id"):
            continue
        hit = by_event.get(str(sg["to_event_id"]))
        a = actuals.get(str(sg["to_event_id"]))
        if hit is None or not a or a.get("status") != "visited" or not a.get("actual_start_at"):
            continue
        ps = planned_start(hit[0], hit[1])
        if ps is None:
            continue
        delay = round((_aware(a["actual_start_at"]) - ps).total_seconds() / 60)
        rows.append({"plan_title": plan_title, "mode": sg["mode"], "delay": delay, "party": party,
                     "label": f"{MODE_LABEL.get(sg['mode'], sg['mode'])} → {hit[1]['title']}"})
    return rows


def _insights(samples: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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
                insight_list: List[Dict[str, Any]], segments: Optional[List[Dict[str, Any]]] = None) -> str:
    def ev_row(e: Dict[str, Any]) -> List[Any]:
        return [str(e["id"]), e.get("local_start_time"), e.get("event_type"), bool(e.get("locked"))]

    data = {
        "days": [[str(d["id"]), [ev_row(e) for e in sorted(d["events"], key=lambda x: str(x["id"]))]]
                 for d in sorted(days, key=lambda x: str(x["id"]))],
        "blocked": sorted(str(x) for x in blocked_event_ids),
        "insights": [[i["kind"], i["event_type"], i["minutes"]] + ([i["mode"]] if i.get("mode") else [])
                     for i in insight_list],
    }
    if segments:
        data["segments"] = [[str(sg["id"]), sg["mode"], int(sg.get("buffer_before_minutes") or 0)]
                            for sg in sorted(segments, key=lambda x: str(x["id"]))]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:24]


def sample_rows(days: List[Dict[str, Any]], actuals: Dict[str, Dict[str, Any]], plan_id: str, plan_title: str,
                planned_start, party: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
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
                         "actual_minutes": actual, "start_diff": diff, "party": party})
    return rows
