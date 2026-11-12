"""[Gate PlanB-Weather] 天気の予報の自動取得(Open-Meteo の日ごとの予報。鍵は要らない・無料)。

- 送るもの: その日の予定の場所の真ん中の座標を 0.1 度(約 10km)に丸めた値と日付だけ(予定の名前・利用者は送らない)
- 予報は今日から 16 日先まで。範囲の外・座標の無い日・失敗は「予報なし」(None)で、画面は手で知らせを入れられる
- 雨の目安: 降水確率の最大 60% 以上か、降水量 5mm 以上。雷・強い雨の天気コードも雨に数える
- 同じ(丸めた座標・日付)の結果は WEATHER_CACHE_SECONDS(既定 1 時間)使い回す
- CI の模擬(PROVIDER_HTTP_STUB)・WEATHER_FORECAST_ENABLED=false の時は外へ送らない
- 試験は set_transport で httpx.MockTransport に差し替える
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"
TIMEOUT = httpx.Timeout(6.0)
MAX_DAYS_AHEAD = 15
RAIN_PROBABILITY = 60
RAIN_MM = 5.0
# WMO の天気コード → 表示
CODE_LABEL = {0: "晴れ", 1: "晴れ", 2: "くもり時々晴れ", 3: "くもり", 45: "霧", 48: "霧", 51: "霧雨", 53: "霧雨", 55: "霧雨",
              56: "着氷性の霧雨", 57: "着氷性の霧雨", 61: "雨", 63: "雨", 65: "強い雨", 66: "着氷性の雨", 67: "着氷性の雨",
              71: "雪", 73: "雪", 75: "強い雪", 77: "雪", 80: "にわか雨", 81: "にわか雨", 82: "激しいにわか雨",
              85: "にわか雪", 86: "にわか雪", 95: "雷雨", 96: "雷雨(ひょう)", 99: "雷雨(ひょう)"}
RAIN_CODES = {61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99}

_transport: Optional[httpx.BaseTransport] = None
_cache: Dict[Tuple[float, float, str], Tuple[float, Optional[Dict[str, Any]]]] = {}
_lock = threading.Lock()


def set_transport(transport: Optional[httpx.BaseTransport]) -> None:
    """試験用: 外へ送らずに応答を差し替える(None で元に戻す)。差し替えの時は使い回しも消す"""
    global _transport
    _transport = transport
    with _lock:
        _cache.clear()


def enabled() -> bool:
    if getattr(settings, "PROVIDER_HTTP_STUB", False) and _transport is None:
        return False
    return bool(getattr(settings, "WEATHER_FORECAST_ENABLED", True))


def _round(v: float) -> float:
    return round(float(v) * 10) / 10


def judge(prob: Optional[int], mm: Optional[float], code: Optional[int]) -> bool:
    return bool((prob is not None and prob >= RAIN_PROBABILITY) or (mm is not None and mm >= RAIN_MM)
                or (code is not None and code in RAIN_CODES and (prob is None or prob >= 40)))


def _fetch(lat: float, lng: float, day: date, tz: str) -> Optional[Dict[str, Any]]:
    params: Dict[str, Any] = {
        "latitude": lat, "longitude": lng, "timezone": tz or "Asia/Tokyo",
        "daily": "weather_code,precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min",
        "start_date": day.isoformat(), "end_date": day.isoformat(),
    }
    with httpx.Client(timeout=TIMEOUT, transport=_transport, headers={"User-Agent": USER_AGENT}) as client:
        r = client.get(URL, params=params)
        r.raise_for_status()
        body = r.json()
    daily = body.get("daily") or {}

    def first(name: str) -> Any:
        v = daily.get(name)
        return v[0] if isinstance(v, list) and v else None

    code = first("weather_code")
    prob = first("precipitation_probability_max")
    mm = first("precipitation_sum")
    code_i = int(code) if isinstance(code, (int, float)) else None
    prob_i = int(prob) if isinstance(prob, (int, float)) else None
    mm_f = float(mm) if isinstance(mm, (int, float)) else None
    tmax, tmin = first("temperature_2m_max"), first("temperature_2m_min")
    return {
        "date": day.isoformat(), "weather_code": code_i, "label": CODE_LABEL.get(code_i or -1, "不明"),
        "precipitation_probability": prob_i, "precipitation_mm": mm_f,
        "temp_max": float(tmax) if isinstance(tmax, (int, float)) else None,
        "temp_min": float(tmin) if isinstance(tmin, (int, float)) else None,
        "rainy": judge(prob_i, mm_f, code_i), "source": "Open-Meteo",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def forecast(lat: Optional[float], lng: Optional[float], day: date, tz: str, today: Optional[date] = None
             ) -> Optional[Dict[str, Any]]:
    """その日・その場所の予報。範囲の外・座標なし・失敗・無効の時は None"""
    if lat is None or lng is None or not enabled():
        return None
    today = today or datetime.now(timezone.utc).date()
    if not (today <= day <= date.fromordinal(today.toordinal() + MAX_DAYS_AHEAD)):
        return None
    key = (_round(lat), _round(lng), day.isoformat())
    ttl = int(getattr(settings, "WEATHER_CACHE_SECONDS", 3600) or 0)
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        result = _fetch(key[0], key[1], day, tz)
    except (httpx.HTTPError, ValueError, TypeError) as error:
        logger.info("weather forecast unavailable (%s)", type(error).__name__)
        result = None
    with _lock:
        if ttl:
            # 失敗は 5 分だけ覚える(提供元へ送り続けない・長く「予報なし」にしない)
            _cache[key] = (now if result is not None else now - max(ttl - 300, 0), result)
    return result


def center(points: List[Tuple[float, float]]) -> Optional[Tuple[float, float]]:
    if not points:
        return None
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
