"""[Gate G4] MAP-02 その日の実際の営業時間(例外の日 → 曜日の営業時間 → 前の日から続く深夜営業)。

- 例外の日(place_special_hours)があれば、その日はそれだけを使う(closed なら休み)。曜日の営業時間は使わない
- 無ければ曜日の営業時間(1日に3つまで)。前の日の「日をまたぐ」営業(18:00〜02:00 等)の、その日の部分も足す
- 最終入場(last_entry)・ラストオーダー(last_order)は、その区切りの開く時刻からの時刻(日をまたぐ時は次の日)
- 時刻は場所の地元の時刻("HH:MM")。日付は旅程の日の地元の日付
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Dict, Iterable, List, Optional

_WEEKDAY_JA = "月火水木金土日"


def parse_hm(value: Optional[str]) -> Optional[time]:
    if not value:
        return None
    try:
        hh, mm = value.split(":")
        h, m = int(hh), int(mm)
    except (ValueError, AttributeError):
        return None
    if h == 24 and m == 0:
        return time(23, 59, 59)
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return time(h, m)


@dataclass(frozen=True)
class Window:
    start: datetime          # 地元の時刻(naive)
    end: datetime
    last_entry: Optional[datetime]
    last_order: Optional[datetime]
    label: str               # 表示用("09:00〜18:00" 等)
    source: str              # weekly / special / overnight


@dataclass
class DayHours:
    local_date: date
    source: str              # special / weekly / unknown
    closed: bool = False
    windows: List[Window] = field(default_factory=list)
    note: Optional[str] = None


def _window(d: date, open_s: Optional[str], close_s: Optional[str], last_entry: Optional[str],
            last_order: Optional[str], source: str) -> Optional[Window]:
    o, c = parse_hm(open_s), parse_hm(close_s)
    if o is None or c is None:
        return None
    start = datetime.combine(d, o)
    end = datetime.combine(d, c)
    if end <= start:
        end += timedelta(days=1)  # 日をまたぐ

    def at(v: Optional[str]) -> Optional[datetime]:
        t = parse_hm(v)
        if t is None:
            return None
        dt = datetime.combine(d, t)
        if dt < start:
            dt += timedelta(days=1)
        return dt if dt <= end else None

    return Window(start, end, at(last_entry), at(last_order), "%s〜%s" % (open_s, close_s), source)


def day_hours(local_date: date, weekly: Iterable, special: Iterable) -> DayHours:
    """weekly: day_of_week・open_time・close_time・last_entry・last_order を持つ物(OpeningHours か同じ形)。
    special: local_date・kind・open_time・close_time・last_entry・last_order・note を持つ物。"""
    weekly = list(weekly)
    special = [s for s in special if getattr(s, "local_date", None) == local_date]
    if special:
        if any(s.kind == "closed" for s in special):
            return DayHours(local_date, "special", closed=True,
                            note=next((s.note for s in special if s.note), None))
        wins = [w for w in (_window(local_date, s.open_time, s.close_time, getattr(s, "last_entry", None),
                                    getattr(s, "last_order", None), "special") for s in special) if w]
        return DayHours(local_date, "special", windows=sorted(wins, key=lambda w: w.start),
                        note=next((s.note for s in special if s.note), None))
    if not weekly:
        return DayHours(local_date, "unknown")
    wd = local_date.weekday()
    today = [h for h in weekly if h.day_of_week == wd]
    wins = [w for w in (_window(local_date, h.open_time, h.close_time, getattr(h, "last_entry", None),
                                getattr(h, "last_order", None), "weekly") for h in today) if w]
    # 前の日から続く深夜営業(前の日に例外の日が無い時だけ)
    prev = local_date - timedelta(days=1)
    for h in [h for h in weekly if h.day_of_week == prev.weekday()]:
        w = _window(prev, h.open_time, h.close_time, getattr(h, "last_entry", None), getattr(h, "last_order", None),
                    "overnight")
        if w and w.end.date() == local_date:
            wins.append(w)
    if not wins:
        return DayHours(local_date, "weekly", closed=True)
    return DayHours(local_date, "weekly", windows=sorted(wins, key=lambda w: w.start))


def describe(dh: DayHours) -> str:
    if dh.source == "unknown":
        return "営業時間が分かりません"
    head = "%s(%s)" % (dh.local_date.strftime("%m/%d"), _WEEKDAY_JA[dh.local_date.weekday()])
    if dh.closed:
        return "%s は%s" % (head, "臨時休業" if dh.source == "special" else "定休日")
    return "%s %s" % (head, "・".join(w.label for w in dh.windows))


def to_json(dh: DayHours) -> Dict[str, object]:
    def hm(dt: Optional[datetime]) -> Optional[str]:
        return dt.strftime("%H:%M") if dt else None
    return {
        "date": dh.local_date.isoformat(), "source": dh.source, "closed": dh.closed, "note": dh.note,
        "windows": [{"open": hm(w.start), "close": hm(w.end), "crosses_midnight": w.end.date() > w.start.date(),
                     "last_entry": hm(w.last_entry), "last_order": hm(w.last_order), "source": w.source}
                    for w in dh.windows],
        "summary": describe(dh),
    }
