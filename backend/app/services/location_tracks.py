"""[Gate P13] FR-038 任意の位置軌跡の純粋関数(DB非依存)。

- 旅行の期間: 日程(日ごとのIANAタイムゾーン)の最初の日の0時〜最後の日の24時。日程が無ければ旅行の開始日・終了日。
- 精度(precision)で座標を丸めてから保存する: high=小数5桁(約1m)、standard=4桁(約11m)、low=3桁(約110m)。
- 送られた点の検査: 時刻は軌跡の記録期間内(開始の5分前〜停止・自動停止まで)、緯度経度の範囲、精度(accuracy)2km以内。
  検査に通らない点は保存せず、理由ごとの件数だけを返す(座標をエラーへ載せない)。
"""
import json
import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

PRECISION_DECIMALS = {"high": 5, "standard": 4, "low": 3}
MODES = ("device_only", "synced")
MAX_POINTS_PER_REQUEST = 500
MAX_POINTS_PER_TRACK = 20000
MAX_ACCURACY_M = 2000.0
START_TOLERANCE = timedelta(minutes=5)
EARTH_RADIUS_M = 6371008.8


class TrackInputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _tz(name: Optional[str]):
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def trip_window(days: Iterable[Tuple[date, Optional[str]]], plan_start: Optional[datetime],
                plan_end: Optional[datetime]) -> Optional[Tuple[datetime, datetime]]:
    """旅行の期間(UTC)。日程が無く旅行の日付も無ければ None。"""
    ds = sorted(days, key=lambda d: d[0])
    if ds:
        first, last = ds[0], ds[-1]
        start = datetime.combine(first[0], time(0, 0), tzinfo=_tz(first[1]))
        end = datetime.combine(last[0] + timedelta(days=1), time(0, 0), tzinfo=_tz(last[1]))
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    if plan_start and plan_end:
        s = plan_start if plan_start.tzinfo else plan_start.replace(tzinfo=timezone.utc)
        e = plan_end if plan_end.tzinfo else plan_end.replace(tzinfo=timezone.utc)
        return s.astimezone(timezone.utc), (e + timedelta(days=1)).astimezone(timezone.utc)
    return None


def _parse_time(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        dt = v
    elif isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def clean_points(raw: List[Dict[str, Any]], precision: str, window_start: datetime,
                 window_end: datetime) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """(保存する点[時刻順], 拒否の理由ごとの件数)。点は {t, lat, lng, acc} の形に整える。"""
    decimals = PRECISION_DECIMALS[precision]
    accepted: List[Dict[str, Any]] = []
    rejected: Dict[str, int] = {}

    def reject(code: str) -> None:
        rejected[code] = rejected.get(code, 0) + 1

    for p in raw:
        if not isinstance(p, dict):
            reject("invalid")
            continue
        t = _parse_time(p.get("recorded_at"))
        lat, lng = _num(p.get("latitude")), _num(p.get("longitude"))
        acc = p.get("accuracy_m")
        acc_v = _num(acc) if acc is not None else None
        if t is None or lat is None or lng is None or not -90 <= lat <= 90 or not -180 <= lng <= 180:
            reject("invalid")
            continue
        if acc is not None and (acc_v is None or acc_v < 0):
            reject("invalid")
            continue
        if acc_v is not None and acc_v > MAX_ACCURACY_M:
            reject("low_accuracy")
            continue
        if t < window_start - START_TOLERANCE or t > window_end:
            reject("outside_period")
            continue
        accepted.append({"t": t.isoformat(), "lat": round(lat, decimals), "lng": round(lng, decimals),
                         "acc": round(acc_v, 1) if acc_v is not None else None})
    accepted.sort(key=lambda x: x["t"])
    return accepted, rejected


def encode(points: List[Dict[str, Any]]) -> bytes:
    return json.dumps(points, separators=(",", ":")).encode("utf-8")


def decode(blob: bytes) -> List[Dict[str, Any]]:
    data = json.loads(blob.decode("utf-8"))
    return data if isinstance(data, list) else []


def haversine_m(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def distance_m(points: List[Dict[str, Any]]) -> float:
    pts = sorted(points, key=lambda x: x["t"])
    return round(sum(haversine_m(pts[i - 1], pts[i]) for i in range(1, len(pts))), 1)


def split_range(points: List[Dict[str, Any]], start: datetime, end: datetime) -> Tuple[List[Dict[str, Any]], int]:
    """[start, end] の点を除いた残りと、除いた件数。"""
    keep = [p for p in points if not (start <= _parse_time(p["t"]) <= end)]
    return keep, len(points) - len(keep)
