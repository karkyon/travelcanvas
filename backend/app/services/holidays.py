"""[Gate Remaining-2] FR-008 祝日の暦の自動の取得。

- 日本(2020〜2099 年): 「国民の祝日に関する法律」の決まりで計算する(通信しない)。春分・秋分は天文の近似式
  (国立天文台が前年に公表する日と 2099 年まで一致する式)。振替休日・国民の休日も入れる
- 日本の外: Nager.Date の公開 API(無料・鍵は要らない)。送るのは年と国の記号だけ。1 日使い回す
- 取れない時は空(その国の祝日は手で営業の例外として入れる)
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List

from app.core.config import settings
from app.services import ext_http
from app.services.ext_http import Unavailable

NAME = "nager_date"
JP_FIRST, JP_LAST = 2020, 2099


def _nth_monday(year: int, month: int, n: int) -> date:
    d = date(year, month, 1)
    first = d + timedelta(days=(0 - d.weekday()) % 7)
    return first + timedelta(weeks=n - 1)


def _equinox(year: int, base: float) -> int:
    return int(base + 0.242194 * (year - 1980) - int((year - 1980) / 4))


def japan(year: int) -> Dict[date, str]:
    if not (JP_FIRST <= year <= JP_LAST):
        return {}
    h: Dict[date, str] = {
        date(year, 1, 1): "元日", _nth_monday(year, 1, 2): "成人の日", date(year, 2, 11): "建国記念の日",
        date(year, 2, 23): "天皇誕生日", date(year, 3, _equinox(year, 20.8431)): "春分の日",
        date(year, 4, 29): "昭和の日", date(year, 5, 3): "憲法記念日", date(year, 5, 4): "みどりの日",
        date(year, 5, 5): "こどもの日", _nth_monday(year, 9, 3): "敬老の日",
        date(year, 9, _equinox(year, 23.2488)): "秋分の日", date(year, 11, 3): "文化の日",
        date(year, 11, 23): "勤労感謝の日",
    }
    # 東京オリンピック・パラリンピックの年の特例(2020・2021)
    if year == 2020:
        h.update({date(2020, 7, 23): "海の日", date(2020, 7, 24): "スポーツの日", date(2020, 8, 10): "山の日"})
    elif year == 2021:
        h.update({date(2021, 7, 22): "海の日", date(2021, 7, 23): "スポーツの日", date(2021, 8, 8): "山の日"})
    else:
        h.update({_nth_monday(year, 7, 3): "海の日", date(year, 8, 11): "山の日",
                  _nth_monday(year, 10, 2): "スポーツの日"})
    # 国民の休日: 前後が祝日に挟まれた平日(日曜でない日)
    for d in sorted(h):
        mid = d + timedelta(days=1)
        if mid not in h and (mid + timedelta(days=1)) in h and mid.weekday() != 6:
            h[mid] = "国民の休日"
    # 振替休日: 祝日が日曜なら、その後の最初の祝日でない日
    for d in sorted(list(h)):
        if d.weekday() == 6:
            nxt = d + timedelta(days=1)
            while nxt in h:
                nxt += timedelta(days=1)
            h[nxt] = "振替休日"
    return dict(sorted(h.items()))


def _nager(country: str, year: int) -> Dict[date, str]:
    if not ext_http.allowed(NAME, "HOLIDAYS_ENABLED"):
        return {}
    root = (getattr(settings, "HOLIDAYS_API_URL", "") or "https://date.nager.at/api/v3").rstrip("/")

    def call() -> Dict[str, str]:
        body = ext_http.get_json(NAME, f"{root}/PublicHolidays/{year}/{country}")
        out: Dict[str, str] = {}
        for x in body if isinstance(body, list) else []:
            if not isinstance(x, dict) or x.get("global") is False:
                continue
            d = str(x.get("date") or "")
            name = str(x.get("localName") or x.get("name") or "")[:80]
            if len(d) == 10 and name:
                out[d] = name
        return out

    try:
        raw = ext_http.cached(NAME, f"{country}:{year}", 86400, call)
    except Unavailable:
        return {}
    out: Dict[date, str] = {}
    for k, v in raw.items():
        try:
            out[date.fromisoformat(k)] = v
        except ValueError:
            continue
    return out


def holidays(country: str, year: int) -> Dict[date, str]:
    country = (country or "").upper()[:2]
    if len(country) != 2 or not country.isalpha() or not (1900 <= year <= 2200):
        return {}
    if country == "JP":
        return japan(year)
    return _nager(country, year)


def between(country: str, start: date, end: date) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for y in range(start.year, end.year + 1):
        for d, name in holidays(country, y).items():
            if start <= d <= end:
                out.append({"date": d.isoformat(), "name": name})
    return out
