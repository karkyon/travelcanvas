"""[Gate P10] FR-031 安全な再計画・FR-030 外部状況(アラート)の純粋関数(DB非依存)。

用語:
- アラート: 遅延・運休/欠航・休業/中止・天候のような「旅程に影響する出来事」。利用者の報告、または登録済み経路の
  運行状態(realtime_status)から作る。情報源(source)・取得時刻(observed_at)・確度(confidence)を必ず持つ。
- base: 再計画を作った時点の本案。{"days": [...], "events": [EventItem...]}。EventItem は branches.event_item の形に
  fixed(確定済み、または予約と紐付く=守る予定)・related(予約・移動・文書などと紐付く=外せない予定)・
  has_reservation を加えたもの。
- 案A/B: 本案を変えずに作る代わりの予定(branches の content と同じ形)。承認されるまで本案は変えない。

想定(アラートの種類)ごとの案:
- delay / cancellation(遅延・運休): 影響を受ける予定を「遅れの分だけ後ろへ」。
    A(shift_later) : 影響を受ける予定と、同じ日のそれ以降の予定を遅れの分だけずらす。守る予定(確定・予約)は動かさず、
                     守る予定の開始に重なる予定・日付を越える予定は外す(外せない予定は残して注意を付ける)。
                     守る予定より後ろの予定は元の時刻のまま。
    B(keep_times)  : 影響を受ける予定だけを遅らせ、それに重なる後ろの予定を外して、残りは元の時刻を守る。
- closure(休業・中止): A(remove) その予定を外す / B(move_next_day) 翌日の同じ時刻へ移す(翌日が無ければ使えない)。
- weather(雨天・警報): 指定日の屋外の予定(観光・アクティビティ)を A(remove) 外す / B(move_next_day) 翌日へ移す。
守る予定は、どの案でも時刻・日を変えず外さない。影響する場合は注意(warnings)として示す。
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services import branches as br

ALGORITHM_VERSION = "replan-v1"
ALERT_KINDS = ("delay", "cancellation", "closure", "weather")
ALERT_SOURCES = ("user_report", "route_status")
CONFIDENCE_LEVELS = ("confirmed", "reported")
ALERT_STATUSES = ("active", "resolved", "dismissed")
STALE_AFTER = timedelta(hours=3)
OUTDOOR_TYPES = br.OUTDOOR_TYPES
DAY_LAST_MINUTE = 23 * 60 + 59

KIND_LABELS = {"delay": "遅延", "cancellation": "運休・欠航", "closure": "休業・中止", "weather": "雨天・警報"}


class ReplanError(ValueError):
    pass


def is_stale(observed_at: Optional[datetime], now: datetime) -> bool:
    """取得から一定時間(3時間)が過ぎた情報か。古い値を現在値のように見せないために使う。"""
    if observed_at is None:
        return True
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    return now - observed_at > STALE_AFTER


def validate_alert(kind: str, event_id: Optional[str], day_id: Optional[str], delay_minutes: Optional[int],
                   base: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """アラートの入力を検証し、(event_id, day_id) を返す。event_id があれば day_id はその予定の日になる。"""
    if kind not in ALERT_KINDS:
        raise ReplanError(f"種類は {list(ALERT_KINDS)} のいずれかです")
    events = {e["source_event_id"]: e for e in base["events"]}
    day_ids = {d["id"] for d in base["days"]}
    if kind in ("delay", "cancellation", "closure"):
        if not event_id:
            raise ReplanError("影響を受ける予定を選んでください")
        if event_id not in events:
            raise ReplanError("影響を受ける予定が見つかりません")
        day_id = events[event_id]["day_id"]
    if kind in ("delay", "cancellation"):
        if not isinstance(delay_minutes, int) or not 15 <= delay_minutes <= 720:
            raise ReplanError("遅れの見込みは15〜720分で指定してください")
        if not events[event_id]["local_start_time"] or events[event_id]["is_all_day"]:
            raise ReplanError("時刻のない予定は遅延の再計画に使えません(予定に時刻を入れてください)")
    elif delay_minutes is not None:
        raise ReplanError("遅れの見込みは遅延・運休の時だけ指定できます")
    if kind == "weather":
        if not day_id or day_id not in day_ids:
            raise ReplanError("影響を受ける日を選んでください")
        if event_id is not None and event_id not in events:
            raise ReplanError("影響を受ける予定が見つかりません")
    return event_id, day_id


# ===================================================================== 案の生成

def _copy(base: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for e in base["events"]:
        item = {k: e[k] for k in ("key", "source_event_id", "day_id", "title", "event_type", "local_start_time",
                                  "is_all_day", "sort_order", "locked", "removed", "note")}
        out.append(item)
    return out


def _flags(base: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {e["source_event_id"]: e for e in base["events"]}


def _timed_on_day(content: List[Dict[str, Any]], day_id: str) -> List[Dict[str, Any]]:
    items = [e for e in content if e["day_id"] == day_id and e["local_start_time"] and not e["is_all_day"]]
    items.sort(key=lambda e: (br.to_minutes(e["local_start_time"]), e["sort_order"], e["key"]))
    return items


def _next_day(base: Dict[str, Any], day_id: str) -> Optional[Dict[str, Any]]:
    days = sorted(base["days"], key=lambda d: d["local_date"])
    for i, d in enumerate(days):
        if d["id"] == day_id:
            return days[i + 1] if i + 1 < len(days) else None
    return None


def _remove_or_keep(item: Dict[str, Any], flags: Dict[str, Any], reason: str, warnings: List[str]) -> None:
    """外す。予約・移動・文書などと紐付く予定は外さず、注意を付けて残す(紐付けを失わせない)。"""
    if flags["related"]:
        item["note"] = f"{reason}が、予約・移動・文書と紐付いているため外していません(要確認)"
        warnings.append(f"「{item['title']}」は紐付けがあるため外していません。内容を確認してください")
        return
    item["removed"] = True
    item["note"] = reason


def _shift(item: Dict[str, Any], minutes: int) -> Optional[int]:
    """時刻を遅らせる。日付を越える場合は None(動かさない)。"""
    shifted = br.to_minutes(item["local_start_time"]) + minutes
    if shifted > DAY_LAST_MINUTE:
        return None
    return shifted


def _delay_shift_later(base, alert, flags) -> Dict[str, Any]:
    content = _copy(base)
    warnings: List[str] = []
    minutes = alert["delay_minutes"]
    target_id = alert["event_id"]
    day_items = _timed_on_day(content, alert["day_id"])
    start_index = next(i for i, e in enumerate(day_items) if e["source_event_id"] == target_id)
    for e in day_items[start_index:]:
        f = flags[e["source_event_id"]]
        if f["fixed"]:
            if e["source_event_id"] == target_id:
                warnings.append(f"「{e['title']}」は確定済み・予約付きのため時刻を変えていません。"
                                f"約{minutes}分遅れる見込みを予約先へ連絡してください")
                e["note"] = "確定済み・予約付きのため動かしていません(遅れを連絡してください)"
                continue
            # 守る予定に達したら、それより後ろは元の時刻のまま
            break
        shifted = _shift(e, minutes)
        next_fixed = next((x for x in day_items[day_items.index(e) + 1:] if flags[x["source_event_id"]]["fixed"]),
                          None)
        if shifted is not None and next_fixed is not None and shifted >= br.to_minutes(next_fixed["local_start_time"]):
            _remove_or_keep(e, f, f"遅れの分ずらすと「{next_fixed['title']}」(守る予定)に重なるため外しました",
                            warnings)
            continue
        if shifted is None:
            _remove_or_keep(e, f, f"{minutes}分ずらすと日付を越えるため外しました", warnings)
            continue
        e["note"] = f"{e['local_start_time']}から{minutes}分遅らせました"
        e["local_start_time"] = br.from_minutes(shifted)
    return {"content": content, "warnings": warnings}


def _delay_keep_times(base, alert, flags) -> Dict[str, Any]:
    content = _copy(base)
    warnings: List[str] = []
    minutes = alert["delay_minutes"]
    target_id = alert["event_id"]
    day_items = _timed_on_day(content, alert["day_id"])
    idx = next(i for i, e in enumerate(day_items) if e["source_event_id"] == target_id)
    target = day_items[idx]
    original_start = br.to_minutes(target["local_start_time"])
    following = day_items[idx + 1:]
    # 影響を受ける予定の予定時間(次の予定までの間隔。無ければ60分とみなす)
    duration = (br.to_minutes(following[0]["local_start_time"]) - original_start) if following else 60
    if flags[target_id]["fixed"]:
        warnings.append(f"「{target['title']}」は確定済み・予約付きのため時刻を変えていません。"
                        f"約{minutes}分遅れる見込みを予約先へ連絡してください")
        target["note"] = "確定済み・予約付きのため動かしていません(遅れを連絡してください)"
        new_start = original_start + minutes
    else:
        shifted = _shift(target, minutes)
        if shifted is None:
            _remove_or_keep(target, flags[target_id], f"{minutes}分遅らせると日付を越えるため外しました", warnings)
            return {"content": content, "warnings": warnings}
        target["note"] = f"{target['local_start_time']}から{minutes}分遅らせました"
        target["local_start_time"] = br.from_minutes(shifted)
        new_start = shifted
    new_end = new_start + max(duration, 0)
    for e in following:
        start = br.to_minutes(e["local_start_time"])
        if start >= new_end:
            break
        f = flags[e["source_event_id"]]
        if f["fixed"]:
            warnings.append(f"「{e['title']}」(守る予定)の開始までに前の予定が終わらない可能性があります")
            continue
        _remove_or_keep(e, f, "遅れた予定と時間が重なるため外しました(後ろの予定は元の時刻のまま)", warnings)
    return {"content": content, "warnings": warnings}


def _targets_for(base, alert) -> List[str]:
    if alert["kind"] == "closure":
        return [alert["event_id"]]
    # weather: 指定日の屋外の予定(予定が指定されていればその予定だけ)
    if alert.get("event_id"):
        return [alert["event_id"]]
    return [e["source_event_id"] for e in base["events"]
            if e["day_id"] == alert["day_id"] and e["event_type"] in OUTDOOR_TYPES]


def _remove_targets(base, alert, flags) -> Dict[str, Any]:
    content = _copy(base)
    warnings: List[str] = []
    reason = "休業・中止のため外しました" if alert["kind"] == "closure" else "雨天・警報のため屋外の予定を外しました"
    targets = set(_targets_for(base, alert))
    for e in content:
        if e["source_event_id"] not in targets:
            continue
        if flags[e["source_event_id"]]["fixed"]:
            warnings.append(f"「{e['title']}」は確定済み・予約付きのため外していません。予約先へ確認してください")
            e["note"] = "確定済み・予約付きのため動かしていません(予約先へ確認してください)"
            continue
        _remove_or_keep(e, flags[e["source_event_id"]], reason, warnings)
    return {"content": content, "warnings": warnings}


def _move_targets_next_day(base, alert, flags) -> Dict[str, Any]:
    nxt = _next_day(base, alert["day_id"])
    if nxt is None:
        return {"content": _copy(base), "warnings": [], "unavailable_reason": "翌日の日程がないため使えません"}
    content = _copy(base)
    warnings: List[str] = []
    targets = set(_targets_for(base, alert))
    last_order = max([e["sort_order"] for e in content if e["day_id"] == nxt["id"]] or [-1])
    moved = 0
    for e in content:
        if e["source_event_id"] not in targets:
            continue
        if flags[e["source_event_id"]]["fixed"]:
            warnings.append(f"「{e['title']}」は確定済み・予約付きのため移していません。予約先へ確認してください")
            e["note"] = "確定済み・予約付きのため動かしていません(予約先へ確認してください)"
            continue
        last_order += 1
        e["day_id"] = nxt["id"]
        e["sort_order"] = last_order
        e["note"] = f"{nxt['local_date']}の同じ時刻へ移しました"
        moved += 1
        clash = [x for x in content if x["day_id"] == nxt["id"] and x is not e and not x["removed"]
                 and x["local_start_time"] and x["local_start_time"] == e["local_start_time"]]
        if clash:
            warnings.append(f"「{e['title']}」は{nxt['local_date']}の「{clash[0]['title']}」と同じ時刻です。時刻を調整してください")
    if moved == 0:
        return {"content": content, "warnings": warnings, "unavailable_reason": "移せる予定がありません"}
    return {"content": content, "warnings": warnings}


STRATEGIES = {
    "shift_later": ("後ろの予定をずらす", "影響を受けた予定と、その後の予定を遅れの分だけ後ろへずらします。守る予定は動かしません"),
    "keep_times": ("後ろの予定の時刻を守る", "影響を受けた予定だけを遅らせ、重なる予定を外して、その後は元の時刻を守ります"),
    "remove": ("予定を外す", "影響を受ける予定を外します。守る予定は外しません"),
    "move_next_day": ("翌日へ移す", "影響を受ける予定を翌日の同じ時刻へ移します。守る予定は動かしません"),
}


def generate_candidates(alert: Dict[str, Any], base: Dict[str, Any]) -> List[Dict[str, Any]]:
    """案A/Bを作る(本案は変えない)。各案は id・strategy・label・description・available・content・warnings を持つ。"""
    flags = _flags(base)
    if alert["kind"] in ("delay", "cancellation"):
        plans = [("A", "shift_later", _delay_shift_later), ("B", "keep_times", _delay_keep_times)]
    else:
        plans = [("A", "remove", _remove_targets), ("B", "move_next_day", _move_targets_next_day)]
    out = []
    for cid, strategy, fn in plans:
        result = fn(base, alert, flags)
        label, description = STRATEGIES[strategy]
        unavailable = result.get("unavailable_reason")
        out.append({
            "id": cid, "strategy": strategy, "label": label, "description": description,
            "available": unavailable is None, "unavailable_reason": unavailable,
            "content": result["content"], "warnings": result["warnings"],
        })
    return out


# ===================================================================== 案の比較(指標)

def evaluate(base: Dict[str, Any], candidate: Dict[str, Any], affected_day_ids: Sequence[str]) -> Dict[str, Any]:
    """案の比較に使う値: 変わる予定(前後の時刻・日)、失う予定、守る予定、最大の遅れ、日の終わりの変化。"""
    flags = _flags(base)
    days = {d["id"]: d for d in base["days"]}
    content = candidate["content"]
    ops = br.compute_ops(base, content)
    changes: List[Dict[str, Any]] = []
    lost: List[Dict[str, Any]] = []
    max_delay = 0
    for o in ops:
        if o["op"] == "remove":
            lost.append({"event_id": o["event_id"], "title": o["title"]})
            continue
        if o["op"] != "update":
            continue
        b = flags[o["event_id"]]
        after_time = o["fields"].get("local_start_time", b["local_start_time"])
        after_day = o["fields"].get("day_id", b["day_id"])
        changes.append({
            "event_id": o["event_id"], "title": o["title"],
            "before_time": b["local_start_time"], "after_time": after_time,
            "before_date": days[b["day_id"]]["local_date"], "after_date": days[after_day]["local_date"],
        })
        if after_day == b["day_id"] and b["local_start_time"] and after_time:
            max_delay = max(max_delay, br.to_minutes(after_time) - br.to_minutes(b["local_start_time"]))
    protected = [
        {"event_id": e["source_event_id"], "title": e["title"], "local_start_time": e["local_start_time"],
         "has_reservation": e["has_reservation"]}
        for e in base["events"] if e["fixed"] and e["day_id"] in affected_day_ids
    ]

    def day_end(items) -> Optional[int]:
        times = [br.to_minutes(e["local_start_time"]) for e in items
                 if e["day_id"] in affected_day_ids and not e.get("removed") and e["local_start_time"]
                 and not e["is_all_day"]]
        return max(times) if times else None

    before_end, after_end = day_end(base["events"]), day_end(content)
    end_shift = (after_end - before_end) if before_end is not None and after_end is not None else None
    return {
        "ops": ops,
        "changes": changes,
        "lost": lost,
        "protected": protected,
        "metrics": {
            "changed_count": len(changes), "lost_count": len(lost), "protected_count": len(protected),
            "max_delay_minutes": max_delay, "day_end_shift_minutes": end_shift,
        },
    }
