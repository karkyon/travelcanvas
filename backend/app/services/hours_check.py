"""[Gate G11] 予定ごとの営業時間の照合(docs/ux/G11_UIUX全範囲_実装仕様.md §2.3・§3.2、UIX-M07)。

旅程の画面の予定のカードに、その日の実際の営業時間(app/services/place_hours.py: 例外の日 → 曜日 → 前の日から続く深夜営業)と
予定の到着・滞在を照らした結果を出す。判定の入力は実行可能性の検証(feasibility.load_snapshot)と同じ。

status:
- ok           : 営業時間内(閉店・最終入場まで NEAR_MINUTES 分以上ある)
- near_close   : 閉店・最終入場まで NEAR_MINUTES 分未満
- last_entry   : 最終入場より後に着く
- last_order   : 飲食で、ラストオーダーより後に着く
- closes_during: 滞在の途中で閉まる(終わりが分からなければ既定の滞在の見積もり。見積もりの時は estimated=True)
- closed       : 休業日・開く前・閉まった後に着く
- unknown      : 場所が無い・開始の時刻が無い・営業時間が登録されていない・出典が古い(stale)
推定で「問題なし」にしない(古い出典は ok を出さず unknown)。予定は変えない(提案は既存の再計画・最適化)。
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.services import feasibility as fz
from app.services import place_hours

NEAR_MINUTES = 30
STALE_DAYS = 90


@dataclass
class EventHours:
    event_id: str
    place_id: Optional[str]
    status: str
    reason: str
    local_date: Optional[str] = None
    window_label: Optional[str] = None
    windows: List[str] = field(default_factory=list)
    hours_source: Optional[str] = None  # special / weekly / unknown
    last_entry: Optional[str] = None
    last_order: Optional[str] = None
    closes_at: Optional[str] = None
    minutes_to_close: Optional[int] = None
    estimated: bool = False
    stale: bool = False
    source: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


def _hm(dt: Optional[datetime]) -> Optional[str]:
    return dt.strftime("%H:%M") if dt is not None else None


def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def is_stale(source: Optional[Dict[str, Any]], now: datetime) -> bool:
    """出典の取得から STALE_DAYS 日を超えたか。取得の日時が分からなければ古くない扱い(手で登録した営業時間)"""
    at = _parse_iso((source or {}).get("retrieved_at"))
    return at is not None and now - at > timedelta(days=STALE_DAYS)


def check_event(e: Any, snap: Any, rules: Any, source: Optional[Dict[str, Any]], now: datetime) -> EventHours:
    out = EventHours(event_id=str(e.id), place_id=str(e.place_id) if e.place_id else None, status="unknown",
                     reason="no_place", source=source)
    if e.place_id is None:
        return out
    if e.start is None or e.is_all_day:
        out.reason = "no_time"
        return out
    local_start = fz._local(e.start, e.day).replace(tzinfo=None)
    out.local_date = local_start.date().isoformat()
    weekly = snap.opening_hours.get(e.place_id) or []
    special = snap.special_hours.get(e.place_id) or []
    dh = place_hours.day_hours(local_start.date(), weekly, special)
    out.hours_source = dh.source
    out.windows = [w.label for w in dh.windows]
    if dh.source == "unknown":
        out.reason = "no_hours"
        return out
    out.stale = is_stale(source, now)
    if dh.closed or not dh.windows:
        out.status, out.reason = "closed", ("closed_special" if dh.source == "special" else "closed_day")
        return out
    win = next((w for w in dh.windows if w.start <= local_start < w.end), None)
    if win is None:
        before = any(local_start < w.start for w in dh.windows)
        out.status, out.reason = "closed", ("before_open" if before else "after_close")
        return out
    out.window_label, out.closes_at = win.label, _hm(win.end)
    out.last_entry, out.last_order = _hm(win.last_entry), _hm(win.last_order)
    end = e.end
    if end is None:
        est = fz._estimated_end(e, rules)
        if est is not None:
            end, out.estimated = est, True
    local_end = fz._local(end, e.day).replace(tzinfo=None) if end is not None else None
    if win.last_entry is not None and local_start > win.last_entry:
        out.status, out.reason = "last_entry", "after_last_entry"
    elif win.last_order is not None and e.event_type == "dining" and local_start > win.last_order:
        out.status, out.reason = "last_order", "after_last_order"
    elif local_end is not None and local_end > win.end:
        out.status, out.reason = "closes_during", "closes_during_stay"
    else:
        limit = win.last_entry if win.last_entry is not None else win.end
        if e.event_type == "dining" and win.last_order is not None:
            limit = win.last_order
        minutes = int((limit - local_start).total_seconds() // 60)
        out.minutes_to_close = minutes
        out.status, out.reason = ("near_close", "near_close") if minutes < NEAR_MINUTES else ("ok", "within_hours")
    if out.stale and out.status == "ok":
        out.status, out.reason = "unknown", "stale_source"
    return out


def check_day(snap: Any, day_id: Any, rules: Any, sources: Dict[Any, Optional[Dict[str, Any]]],
              now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    events = sorted((e for e in snap.events if e.day.id == day_id), key=lambda e: (e.sort_order, str(e.id)))
    return [check_event(e, snap, rules, sources.get(e.place_id) if e.place_id else None, now).to_dict()
            for e in events]
