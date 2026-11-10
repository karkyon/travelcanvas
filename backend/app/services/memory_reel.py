"""
[Gate MemoryReel] 旅の思い出リール。

行った旅の写真を、撮った順に数秒ごとに流す(ホームの段・全画面)ための材料を作る。

- 写真: 見られる人の写真だけ(自分の写真と、メンバーに公開された写真)。旅行記に入れない写真(include_in_journal=False)は出さない
- 位置: 写真の一覧と同じ規則(本人以外には、本人が公開を選び、守る範囲の外の位置だけ)。経路の地図はこの位置だけで描く
- 多すぎる時は、旅の始めから終わりまで均等に間引く(最大 MAX_SLIDES 枚)
- 写真が無い旅は、予定の名前(最大 MAX_FALLBACK 件)を表紙の絵の上に流す
- 旅の並び(reel_rank): ○年前の今日・この頃 > 同じ季節(去年より前)> 最近。札の文(reel_badge)も作る
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypeVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

T = TypeVar("T")

MAX_SLIDES = 40
MAX_FALLBACK = 8
MAX_BODY = 120
MAX_QUOTE = 80

_SEASONS = {12: "冬", 1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春", 6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋", 11: "秋"}


def sample_even(items: Sequence[T], n: int = MAX_SLIDES) -> List[T]:
    """順番を保ったまま、始めから終わりまで均等に n 個を選ぶ(最初と最後は必ず入れる)。"""
    if n <= 0:
        return []
    if len(items) <= n:
        return list(items)
    if n == 1:
        return [items[0]]
    step = (len(items) - 1) / (n - 1)
    return [items[round(i * step)] for i in range(n)]


def clip(text: Optional[str], limit: int) -> Optional[str]:
    """前後の空白を除き、長ければ limit 文字で「…」。空なら None。"""
    if not text:
        return None
    s = " ".join(text.split())
    if not s:
        return None
    return s if len(s) <= limit else s[: limit - 1] + "…"


def local_at(at: Optional[datetime], tz: Optional[str]) -> Optional[str]:
    """撮った時刻を旅先の時刻で "YYYY-MM-DDTHH:MM" に。時刻帯が分からなければ UTC。"""
    if at is None:
        return None
    try:
        zone = ZoneInfo(tz) if tz else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    if at.tzinfo is None:
        at = at.replace(tzinfo=ZoneInfo("UTC"))
    return at.astimezone(zone).strftime("%Y-%m-%dT%H:%M")


def _same_day_in(year: int, d: date) -> date:
    try:
        return d.replace(year=year)
    except ValueError:  # 2/29 → その年の 2/28
        return d.replace(year=year, day=28)


def reel_rank(start: Optional[date], end: Optional[date], today: date) -> Tuple[int, str]:
    """旅の並びの組(小さいほど先)と札の文。

    0: ○年前の今日(旅の期間に今日が入る)/ ○年前のこの頃(前後 3 日)
    1: 同じ季節で 1 年以上前(○年前の秋)
    2: それ以外(最近の旅・○か月前の旅・○年前の旅)
    """
    if start is None:
        return 3, "行った旅"
    end = end or start
    years = today.year - start.year
    if years >= 1:
        t = _same_day_in(start.year, today)
        if start <= t <= end:
            return 0, f"{years}年前の今日"
        if start - timedelta(days=3) <= t <= end + timedelta(days=3):
            return 0, f"{years}年前のこの頃"
        if _SEASONS[start.month] == _SEASONS[today.month]:
            return 1, f"{years}年前の{_SEASONS[start.month]}"
    days = (today - end).days
    if days < 31:
        return 2, "最近の旅"
    if days < 365:
        return 2, f"{days // 30}か月前の旅"
    return 2, f"{max(1, years)}年前の旅"


def order_trips(trips: Sequence[Dict[str, Any]], today: date) -> List[Dict[str, Any]]:
    """行った旅を思い出リールの順に並べ、各旅に reel_badge を付ける(元の dict は変えない)。

    同じ組の中は、旅の終わりが新しい順。"""
    def parse(v: Any) -> Optional[date]:
        if not v:
            return None
        return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])

    ranked = []
    for i, t in enumerate(trips):
        s, e = parse(t.get("start_date")), parse(t.get("end_date"))
        group, badge = reel_rank(s, e, today)
        key_end = (e or s or date.min).toordinal()
        ranked.append((group, -key_end, i, {**t, "reel_badge": badge}))
    ranked.sort(key=lambda r: (r[0], r[1], r[2]))
    return [r[3] for r in ranked]
