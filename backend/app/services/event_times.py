"""[Gate G7] FR-005 予定の時刻(日をまたぐ予定・終了時刻)の純粋関数。

画面で作る予定は開始を local_start_time("HH:MM"、その日の現地時刻)で持ち、start_at は空のことが多い。
終了は end_at(UTC)だけを正本にし、画面には「その日の現地時刻(local_end_time)と何日後か(end_day_offset)」で見せる。

- 終了の入力: local_end_time + end_day_offset(0〜2)。offset を省くと、終了が開始以前なら翌日(1)とみなす(夜行・深夜まで)
- 開始より後でない終了・72時間を超える予定は 422(日をまたぐ予定は、開始の日の予定として持つ)
- 日程を移したら、start_at・end_at も日数の差だけずらす(所要時間を保つ)
- 開始の時刻だけを変えたら、終了も同じだけずらす(所要時間を保つ。最適化・分岐・思い出からの提案の適用も同じ)
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional, Tuple

from app.services.today_mode import parse_local_time, zone_for

MAX_EVENT_HOURS = 72
MAX_DAY_OFFSET = 2


class EventTimeError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _aware(dt: Any) -> Optional[datetime]:
    """ORM の列の値(datetime か None)をそのまま受ける。"""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _aware_req(dt: Any) -> datetime:
    out = _aware(dt)
    if out is None:
        raise ValueError("日時がありません")
    return out


def local_dt(local_date: date, hhmm: Any, timezone_id: Any, offset_days: int = 0) -> datetime:
    t = parse_local_time(hhmm)
    if t is None:
        raise EventTimeError("invalid_time", "時刻はHH:MMで入力してください")
    d = local_date + timedelta(days=offset_days)
    return datetime.combine(d, time(t.hour, t.minute), tzinfo=zone_for(timezone_id)).astimezone(timezone.utc)


def effective_start(start_at: Any, local_start_time: Any, is_all_day: bool,
                    local_date: Any, timezone_id: Any) -> Optional[datetime]:
    """引数は ORM の列の値をそのまま受ける(start_at: datetime か None、local_date: date、他は文字列か None)。"""
    if start_at is not None:
        return _aware(start_at)
    if is_all_day or not parse_local_time(local_start_time):
        return None
    return local_dt(local_date, local_start_time or "", timezone_id)


def end_from_local(local_date: Any, timezone_id: Any, local_end_time: Any,
                   end_day_offset: Optional[int], start: Optional[datetime]) -> Tuple[datetime, int]:
    """(終了 UTC, 使った日数の差)。offset が None なら、開始以前の時刻は翌日とみなす。"""
    if end_day_offset is not None and not 0 <= end_day_offset <= MAX_DAY_OFFSET:
        raise EventTimeError("invalid_end_day_offset", f"終了は開始の日から{MAX_DAY_OFFSET}日後までです")
    offset = end_day_offset if end_day_offset is not None else 0
    end = local_dt(local_date, local_end_time, timezone_id, offset)
    if end_day_offset is None and start is not None and end <= start:
        offset = 1
        end = local_dt(local_date, local_end_time, timezone_id, offset)
    return end, offset


def end_fields(end_at: Any, local_date: Any, timezone_id: Any) -> Tuple[Optional[str], Optional[int]]:
    """end_at → (その日の現地時刻 "HH:MM", 開始の日から何日後か)。"""
    end = _aware(end_at)
    if end is None or local_date is None:
        return None, None
    local = end.astimezone(zone_for(timezone_id))
    return local.strftime("%H:%M"), (local.date() - local_date).days


def check_range(start: Optional[datetime], end: Optional[datetime]) -> None:
    if start is None or end is None:
        return
    if end <= start:
        raise EventTimeError("invalid_time_range", "終了時刻は開始時刻より後にしてください(日をまたぐ時は「翌日」を選んでください)")
    if end - start > timedelta(hours=MAX_EVENT_HOURS):
        raise EventTimeError("event_too_long", f"1つの予定は{MAX_EVENT_HOURS}時間までです(長い滞在は日ごとに分けてください)")


def shift_dates(event: Any, old_date: Any, new_date: Any) -> None:
    """日程を移した時に start_at・end_at を日数の差だけずらす。"""
    delta = new_date - old_date
    if not delta:
        return
    if event.start_at is not None:
        event.start_at = _aware_req(event.start_at) + delta
    if event.end_at is not None:
        event.end_at = _aware_req(event.end_at) + delta


def shift_end_with_start(event: Any, local_date: Any, timezone_id: Any, old_time: Any, new_time: Any) -> None:
    """start_at の無い予定で開始の時刻(local_start_time)だけを変えた時、end_at を同じだけずらす。"""
    if event.start_at is not None or event.end_at is None:
        return
    if not parse_local_time(old_time) or not parse_local_time(new_time):
        return
    before = local_dt(local_date, old_time or "", timezone_id)
    after = local_dt(local_date, new_time or "", timezone_id)
    event.end_at = _aware_req(event.end_at) + (after - before)
