"""[Gate P14] FR-054 Plan-to-Memory・FR-053 旅の達成指標の純粋関数(DB非依存)。

- 実績の提案(journey-v1): 到着・出発の時刻を、本人の位置の軌跡(予定の場所から半径150m以内にいた最初と最後の時刻)、
  無ければ予定に紐付けた記録(写真・メモ)の日時の最初と最後から提案する。提案は確定せず、利用者が使うか選ぶ(DOC-14 §4.4)。
- 予定と実績の差: 予定の開始時刻(日程のタイムゾーンの local_start_time)と、実際の到着の差(分)。
- 達成指標(CA-011): 分母が0の指標は None(「0%」と見せない)。順位・他人との比較は作らない。
"""
from datetime import date, datetime, time, timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.services.location_tracks import haversine_m

ALGORITHM_VERSION = "journey-v1"
NEAR_RADIUS_M = 150.0


def _tz(name: Optional[str]):
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def planned_start(local_date: date, local_start_time: Optional[str], tz_name: Optional[str]) -> Optional[datetime]:
    if not local_start_time:
        return None
    try:
        hh, mm = (int(x) for x in local_start_time.split(":")[:2])
        return datetime.combine(local_date, time(hh, mm), tzinfo=_tz(tz_name)).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def suggest_actual(event: Dict[str, Any], track_points: List[Dict[str, Any]],
                   memory_times: Iterable[datetime]) -> Optional[Dict[str, Any]]:
    """event: {latitude, longitude} / track_points: [{t(datetime), lat, lng}](本人の軌跡、時刻順)"""
    lat, lng = event.get("latitude"), event.get("longitude")
    if lat is not None and lng is not None and track_points:
        near = [p for p in track_points if haversine_m({"lat": lat, "lng": lng}, p) <= NEAR_RADIUS_M]
        if near:
            return {"actual_start_at": near[0]["t"], "actual_end_at": near[-1]["t"], "basis": "track",
                    "points": len(near)}
    times = sorted(_aware(t) for t in memory_times if t is not None)
    if times:
        return {"actual_start_at": times[0], "actual_end_at": times[-1], "basis": "memory", "points": len(times)}
    return None


def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 4) if den else None


def metrics(planned_event_ids: List[str], actuals: Dict[str, Dict[str, Any]], photo_event_ids: Iterable[str],
            memory_event_ids: Iterable[str], track_distance_m: Optional[float]) -> Dict[str, Any]:
    """actuals: event_id → {status, actual_start_at, actual_end_at}(予定が残っているものだけ)"""
    planned = len(planned_event_ids)
    visited = [e for e in planned_event_ids if actuals.get(e, {}).get("status") == "visited"]
    skipped = [e for e in planned_event_ids if actuals.get(e, {}).get("status") == "skipped"]
    photos = set(photo_event_ids)
    memories = set(memory_event_ids)
    stay = 0.0
    timed = 0
    for e in visited:
        a = actuals[e]
        if a.get("actual_start_at") and a.get("actual_end_at"):
            stay += (_aware(a["actual_end_at"]) - _aware(a["actual_start_at"])).total_seconds() / 60
            timed += 1
    return {
        "planned_events": planned,
        "visited": len(visited),
        "skipped": len(skipped),
        "unrecorded": planned - len(visited) - len(skipped),
        # 計画達成率: 予定のうち行ったもの / 訪問達成率: 記録した予定のうち行ったもの
        "plan_achievement_rate": _rate(len(visited), planned),
        "visit_rate": _rate(len(visited), len(visited) + len(skipped)),
        # 写真付き訪問率: 行った予定のうち写真があるもの / 記録完成率: 予定のうち行った・行かなかったを記録したもの
        "photo_visit_rate": _rate(sum(1 for e in visited if e in photos), len(visited)),
        "record_completion_rate": _rate(len(visited) + len(skipped), planned),
        "memory_events": sum(1 for e in planned_event_ids if e in memories),
        "stay_minutes": round(stay) if timed else None,
        "timed_visits": timed,
        "track_distance_m": track_distance_m,
        "algorithm_version": ALGORITHM_VERSION,
    }


def start_diff_minutes(planned: Optional[datetime], actual_start: Optional[datetime]) -> Optional[int]:
    if planned is None or actual_start is None:
        return None
    return round((_aware(actual_start) - planned).total_seconds() / 60)
