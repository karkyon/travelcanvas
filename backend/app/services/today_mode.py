"""[Gate L1b] FR-029当日モード(NOW/NEXT)の時刻計算。

GET /plans/{plan_id}/today (app/api/v1/plans.py get_today) から呼ばれる純粋関数群。
DBアクセスを持たないため、現在時刻・タイムゾーン・日跨ぎの境界条件を
固定した時刻で試験できる(utcnowをmonkeypatchする)。

Gate L1からの修正点:
- 画面(planStore)から作成・編集した予定は local_start_time("HH:MM")のみを
  持ち start_at はnullのままである。Gate L1は start_at が無い予定を除外して
  いたため、UIで作った予定がNOW/NEXTに一度も出なかった。本モジュールでは
  TravelDay.local_date + local_start_time を TravelDay.timezone_id(IANA)の
  現地時刻として解釈した「実効開始時刻」を用いる(DBへの書き戻し・
  migrationは行わない)。
- end_at未設定の予定は「開始以降ずっとNOW」扱いだったため、朝の予定が
  夜までNOWに残り続けていた。end_at未設定の予定は、同じ日の次の予定の
  開始時刻まで(次が無ければ現地の日付が変わるまで)をNOWの範囲とする。
- 前日から続く予定(夜行便・夜行列車等、end_atが明示され現在も継続中)は
  NOWの候補に含める。NEXTは従来どおり「今日」の予定のみ(翌日へは跨がない)。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, List, Optional, Sequence
from zoneinfo import ZoneInfo

_LOCAL_TIME_RE = re.compile(r"^\s*([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*$")


def utcnow() -> datetime:
    """現在時刻(UTC、tz-aware)。テストではmonkeypatchで固定する。"""
    return datetime.now(timezone.utc)


def zone_for(timezone_id: Optional[str]):
    """IANAタイムゾーン名をtzinfoへ変換する。不正・未設定はUTCとして扱う。"""
    if not timezone_id:
        return timezone.utc
    try:
        return ZoneInfo(timezone_id)
    except Exception:
        return timezone.utc


def parse_local_time(value: Optional[str]) -> Optional[time]:
    """"HH:MM"(または"HH:MM:SS")を解釈する。範囲外・形式不正はNone。"""
    if not value:
        return None
    m = _LOCAL_TIME_RE.match(value)
    if not m:
        return None
    return time(int(m.group(1)), int(m.group(2)))


def local_day_bounds(local_date: date, timezone_id: Optional[str]) -> tuple[datetime, datetime]:
    """現地日付の開始・終了(翌日0時)をUTCで返す。"""
    tz = zone_for(timezone_id)
    start = datetime.combine(local_date, time(0, 0), tzinfo=tz)
    end = datetime.combine(local_date + timedelta(days=1), time(0, 0), tzinfo=tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def effective_start(event, day) -> tuple[Optional[datetime], Optional[str]]:
    """予定の実効開始時刻(UTC)と、その出所("start_at" | "local_start_time")。

    start_atがあればそれを優先する。無ければ day.local_date + local_start_time を
    day.timezone_id の現地時刻として解釈する。終日予定・時刻未設定はNone。
    """
    if event.start_at is not None:
        start = event.start_at
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        return start.astimezone(timezone.utc), "start_at"
    if getattr(event, "is_all_day", False):
        return None, None
    t = parse_local_time(event.local_start_time)
    if t is None:
        return None, None
    local = datetime.combine(day.local_date, t, tzinfo=zone_for(day.timezone_id))
    return local.astimezone(timezone.utc), "local_start_time"


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass
class TimedEvent:
    event: object
    start: datetime
    end: Optional[datetime]  # 明示されたend_at(UTC)。未設定はNone
    time_source: str
    is_today: bool


@dataclass
class TodaySelection:
    today_days: List[object]
    today_date: Optional[date]
    timezone_id: Optional[str]
    day_end_at: Optional[datetime]
    events: List[TimedEvent]
    now_event: Optional[TimedEvent]
    next_event: Optional[TimedEvent]
    minutes_until_next: Optional[int]


def _day_sort_key(day):
    return (day.local_date, day.sort_order or 0, str(day.id))


def select_today(days: Iterable[object], now_utc: datetime) -> TodaySelection:
    """当日の日程・NOW・NEXTを決める。

    - 「今日」は各TravelDay.timezone_idの現地日付で判定する(旅行先の時差を
      跨ぐプランで単一タイムゾーンを前提にしない)。同じ日が複数あれば
      それらの予定をまとめて扱い、代表はlocal_date・sort_order順の先頭。
    - NOW: 実効開始<=現在<実効終了。実効終了はend_at、未設定なら同じ日の
      次の予定の開始、それも無ければ現地の翌日0時。複数該当時は最も遅く
      始まった予定(現在に最も近いもの)。前日の予定はend_atが明示され
      現在も継続中のものだけが候補になる。
    - NEXT: 今日の予定のうち実効開始>現在で最も早いもの。
    """
    now_utc = _aware(now_utc)
    days = sorted(days, key=_day_sort_key)

    today_days = []
    yesterday_days = []
    for day in days:
        local_today = now_utc.astimezone(zone_for(day.timezone_id)).date()
        if day.local_date == local_today:
            today_days.append(day)
        elif day.local_date == local_today - timedelta(days=1):
            yesterday_days.append(day)

    timed: List[TimedEvent] = []
    for day in yesterday_days:
        for e in day.events:
            start, source = effective_start(e, day)
            end = _aware(e.end_at)
            if start is not None and end is not None and start <= now_utc < end:
                timed.append(TimedEvent(e, start, end, source, is_today=False))
    for day in today_days:
        for e in day.events:
            start, source = effective_start(e, day)
            if start is not None:
                timed.append(TimedEvent(e, start, _aware(e.end_at), source, is_today=True))

    timed.sort(key=lambda t: (t.start, getattr(t.event, "sort_order", 0) or 0, str(t.event.id)))

    if today_days:
        rep = today_days[0]
        today_date = rep.local_date
        timezone_id = rep.timezone_id
        day_end_at = local_day_bounds(rep.local_date, rep.timezone_id)[1]
    else:
        today_date = None
        timezone_id = None
        day_end_at = None

    today_timed = [t for t in timed if t.is_today]

    def implicit_end(t: TimedEvent) -> Optional[datetime]:
        if t.end is not None:
            return t.end
        later = [o.start for o in today_timed if o.start > t.start]
        if later:
            return min(later)
        return day_end_at

    now_event = None
    for t in timed:
        end = implicit_end(t)
        if t.start <= now_utc and (end is None or now_utc < end):
            if now_event is None or t.start >= now_event.start:
                now_event = t

    next_event = None
    minutes_until_next = None
    for t in today_timed:
        if t.start > now_utc:
            next_event = t
            minutes_until_next = int((t.start - now_utc).total_seconds() // 60)
            break

    return TodaySelection(
        today_days=today_days, today_date=today_date, timezone_id=timezone_id,
        day_end_at=day_end_at, events=timed, now_event=now_event, next_event=next_event,
        minutes_until_next=minutes_until_next,
    )


_STATUS_RANK = {"cancelled": 3, "delayed": 2, "unknown": 1, "on_time": 0}


def aggregate_realtime_status(statuses: Sequence[str]) -> str:
    """経路の各区間のrealtime_statusを1つにまとめる。

    運休(cancelled) > 遅延(delayed) > 不明(unknown) > 定刻(on_time)の順で
    最も悪いものを採る。区間が無い場合は不明。「定刻」はすべての区間が
    定刻と確認できた場合に限る(不明が混ざれば不明)。
    """
    if not statuses:
        return "unknown"
    worst = max(statuses, key=lambda s: _STATUS_RANK.get(s, 1))
    return worst if worst in _STATUS_RANK else "unknown"
