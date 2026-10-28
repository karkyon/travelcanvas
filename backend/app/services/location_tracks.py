"""[Gate P13] FR-038 任意の位置軌跡の純粋関数(DB非依存)。

- 旅行の期間: 日程(日ごとのIANAタイムゾーン)の最初の日の0時〜最後の日の24時。日程が無ければ旅行の開始日・終了日。
- 精度(precision)で座標を丸めてから保存する: high=小数5桁(約1m)、standard=4桁(約11m)、low=3桁(約110m)。
- 送られた点の検査: 時刻は軌跡の記録期間内(開始の5分前〜停止・自動停止まで)、緯度経度の範囲、精度(accuracy)2km以内。
  検査に通らない点は保存せず、理由ごとの件数だけを返す(座標をエラーへ載せない)。
"""
import json
import math
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

PRECISION_DECIMALS = {"high": 5, "standard": 4, "low": 3}
# [Gate L5] areas_only = 生の座標は端末だけ。集計した訪問地域(0.1度の区画)と滞在時間だけを同期する(CA-013)
MODES = ("device_only", "areas_only", "synced")
TRIP_MODES = ("off",) + MODES
AREA_STEP = 0.1                # 区画の大きさ(度)。Atlas の region と同じ
MAX_CELLS_PER_REQUEST = 200
MAX_CELLS_PER_TRACK = 5000
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
    def in_range(p: Dict[str, Any]) -> bool:
        t = _parse_time(p.get("t"))
        return t is not None and start <= t <= end

    keep = [p for p in points if not in_range(p)]
    return keep, len(points) - len(keep)


# ---------------------------------------------------------------------------
# [Gate L5] 訪問地域(区画)と、端末の記録の観測値
# ---------------------------------------------------------------------------

_CELL_RE = re.compile(r"^0\.1:(-?\d{1,2}\.\d):(-?\d{1,3}\.\d)$")
SAMPLING_INT_FIELDS = ("expected_samples", "kept_samples", "missed_samples", "manual_points", "max_gap_seconds")
SAMPLING_TIERS = ("moving_fast", "moving", "stationary", "low_power")
MAX_SAMPLING_COUNT = 10_000_000


def valid_cell_key(key: Any) -> bool:
    """区画の印(南西の角。0.1度の格子の上にあること)。端末が作る形は Atlas の cell_key と同じ。"""
    if not isinstance(key, str):
        return False
    m = _CELL_RE.match(key)
    if not m:
        return False
    lat, lng = float(m.group(1)), float(m.group(2))
    return -90.0 <= lat < 90.0 and -180.0 <= lng < 180.0


def cell_center(key: str) -> Tuple[float, float]:
    _step, lat, lng = key.split(":")
    return round(float(lat) + AREA_STEP / 2, 2), round(float(lng) + AREA_STEP / 2, 2)


def clean_cells(raw: List[Dict[str, Any]], window_start: datetime,
                window_end: datetime) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """送られた区画を検査する。(受け付ける区画, 拒否の理由ごとの件数)。座標・区画の値はエラーへ載せない。"""
    accepted: Dict[str, Dict[str, Any]] = {}
    rejected: Dict[str, int] = {}

    def reject(code: str) -> None:
        rejected[code] = rejected.get(code, 0) + 1

    for c in raw:
        if not isinstance(c, dict) or not valid_cell_key(c.get("key")):
            reject("invalid")
            continue
        first, last = _parse_time(c.get("first_at")), _parse_time(c.get("last_at"))
        dwell, samples = c.get("dwell_seconds"), c.get("samples")
        if first is None or last is None or last < first:
            reject("invalid")
            continue
        if not (isinstance(dwell, int) and not isinstance(dwell, bool) and dwell >= 0
                and isinstance(samples, int) and not isinstance(samples, bool) and samples >= 0):
            reject("invalid")
            continue
        if first < window_start - START_TOLERANCE or last > window_end:
            reject("outside_period")
            continue
        span = int((last - first).total_seconds())
        if dwell > span + 60 or samples > MAX_POINTS_PER_TRACK:
            reject("invalid")
            continue
        prev = accepted.get(c["key"])
        if prev:
            prev["first_at"] = min(prev["first_at"], first)
            prev["last_at"] = max(prev["last_at"], last)
            prev["dwell_seconds"] = max(prev["dwell_seconds"], dwell)
            prev["samples"] = max(prev["samples"], samples)
        else:
            accepted[c["key"]] = {"key": c["key"], "first_at": first, "last_at": last, "dwell_seconds": dwell,
                                  "samples": samples}
    return sorted(accepted.values(), key=lambda x: x["first_at"]), rejected


def area_state(dwell_seconds: int) -> str:
    """Atlas の状態: 30分以上=STAYED、10分以上=VISITED、それ未満=PASS_THROUGH(通過)。"""
    if dwell_seconds >= 30 * 60:
        return "STAYED"
    if dwell_seconds >= 10 * 60:
        return "VISITED"
    return "PASS_THROUGH"


def clean_sampling(raw: Dict[str, Any]) -> Dict[str, Any]:
    """端末の記録の観測値(FR-056 CA-014: 電池の消費と欠測率)。数値だけを受け付け、座標を含められない形にする。"""
    if not isinstance(raw, dict):
        raise TrackInputError("invalid_field", "観測値の形が不正です")
    out: Dict[str, Any] = {}
    for k in ("battery_start", "battery_end"):
        v = raw.get(k)
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1:
                raise TrackInputError("invalid_field", "電池の残量は 0〜1 の値です")
            out[k] = round(float(v), 3)
    if raw.get("charging_seen") is not None:
        if not isinstance(raw["charging_seen"], bool):
            raise TrackInputError("invalid_field", "charging_seen は真偽値です")
        out["charging_seen"] = raw["charging_seen"]
    for k in SAMPLING_INT_FIELDS:
        v = raw.get(k, 0)
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_SAMPLING_COUNT:
            raise TrackInputError("invalid_field", "件数・秒数は 0 以上の整数です")
        out[k] = v
    tiers = raw.get("tier_seconds") or {}
    if not isinstance(tiers, dict) or any(t not in SAMPLING_TIERS for t in tiers):
        raise TrackInputError("invalid_field", "取得の間隔の内訳の種類が不正です")
    clean_tiers = {}
    for t, v in tiers.items():
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_SAMPLING_COUNT:
            raise TrackInputError("invalid_field", "取得の間隔の内訳は 0 以上の整数(秒)です")
        clean_tiers[t] = v
    out["tier_seconds"] = clean_tiers
    extra = set(raw) - set(out) - {"tier_seconds"} - set(SAMPLING_INT_FIELDS) - {"charging_seen"}
    if extra:
        raise TrackInputError("invalid_field", "受け付けない項目があります")
    out["missed_ratio"] = (round(out["missed_samples"] / out["expected_samples"], 4)
                           if out["expected_samples"] else None)
    if "battery_start" in out and "battery_end" in out and not out.get("charging_seen"):
        out["battery_used"] = round(max(0.0, out["battery_start"] - out["battery_end"]), 3)
    else:
        out["battery_used"] = None
    return out
