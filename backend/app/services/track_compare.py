"""[Gate Remaining-7] FR-054 予定の経路と GPS の軌跡の比べ(本人の軌跡だけ。保存しない・計算するだけ)。

- 予定の経路: 軌跡のある日の、場所のある予定を日・並び順につないだ線(直線。道の形ではない)
- 予定ごと: 軌跡がいちばん近づいた距離・その時刻・半径(予定の種類ごと)の中に入ったか
- 経路からの外れ: 軌跡の点から予定の線までの距離(OFF_ROUTE_M を超えた点の割合・最大)
- 寄り道: 予定の場所から離れた所で 10 分以上留まった所(中心は 3 桁に丸める)
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services import location_tracks as lt
from app.services import visit_assessment as va

ALGORITHM_VERSION = "track-compare-v1"
OFF_ROUTE_M = 1000.0
STOP_RADIUS_M = 150.0
STOP_MIN_SECONDS = 600
STOP_FAR_FROM_PLAN_M = 500.0
MAX_ACCURACY_M = 100.0


def _xy(lat: float, lng: float, lat0: float) -> Tuple[float, float]:
    """平面への近似(数十 km の範囲の距離の比べに使う)。"""
    k = math.pi / 180 * lt.EARTH_RADIUS_M
    return lng * k * math.cos(math.radians(lat0)), lat * k


def _point_segment_m(p: Tuple[float, float], a: Tuple[float, float], b: Tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _parse(t: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except ValueError:
        return None


def compare(planned: Sequence[Dict[str, Any]], points: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """planned: [{event_id, title, event_type, date, planned_time, latitude, longitude}](並び順)。
    points: 軌跡の点 [{t, lat, lng, acc}]。"""
    pts = [p for p in sorted(points, key=lambda x: x["t"]) if (p.get("acc") or 0) <= MAX_ACCURACY_M]
    out_events: List[Dict[str, Any]] = []
    for ev in planned:
        target = {"lat": ev["latitude"], "lng": ev["longitude"]}
        radius = va.radius_for(ev.get("event_type"))
        best: Optional[Tuple[float, Dict[str, Any]]] = None
        for p in pts:
            d = lt.haversine_m(p, target)
            if best is None or d < best[0]:
                best = (d, p)
        out_events.append({
            "event_id": ev["event_id"], "title": ev["title"], "date": ev["date"],
            "planned_time": ev.get("planned_time"),
            "radius_m": radius,
            "nearest_m": round(best[0]) if best else None,
            "nearest_at": best[1]["t"] if best else None,
            "reached": bool(best and best[0] <= radius),
        })
    planned_m = 0.0
    for i in range(1, len(planned)):
        if planned[i]["date"] == planned[i - 1]["date"]:
            planned_m += lt.haversine_m({"lat": planned[i - 1]["latitude"], "lng": planned[i - 1]["longitude"]},
                                        {"lat": planned[i]["latitude"], "lng": planned[i]["longitude"]})
    # 経路からの外れ(同じ日の予定の線)
    deviations: List[float] = []
    if planned and pts:
        lat0 = planned[0]["latitude"]
        segs: List[Tuple[Tuple[float, float], Tuple[float, float]]] = []
        for i in range(len(planned)):
            a = _xy(planned[i]["latitude"], planned[i]["longitude"], lat0)
            if i + 1 < len(planned) and planned[i + 1]["date"] == planned[i]["date"]:
                segs.append((a, _xy(planned[i + 1]["latitude"], planned[i + 1]["longitude"], lat0)))
            else:
                segs.append((a, a))
        for p in pts:
            xy = _xy(p["lat"], p["lng"], lat0)
            deviations.append(min(_point_segment_m(xy, a, b) for a, b in segs))
    off = [d for d in deviations if d > OFF_ROUTE_M]
    # 寄り道(予定の場所から離れて留まった所)
    stops: List[Dict[str, Any]] = []
    i = 0
    while i < len(pts):
        j = i
        while j + 1 < len(pts) and lt.haversine_m(pts[i], pts[j + 1]) <= STOP_RADIUS_M:
            j += 1
        t0, t1 = _parse(pts[i]["t"]), _parse(pts[j]["t"])
        if t0 and t1 and (t1 - t0).total_seconds() >= STOP_MIN_SECONDS:
            center = {"lat": sum(p["lat"] for p in pts[i:j + 1]) / (j - i + 1),
                      "lng": sum(p["lng"] for p in pts[i:j + 1]) / (j - i + 1)}
            far = all(lt.haversine_m(center, {"lat": e["latitude"], "lng": e["longitude"]}) > STOP_FAR_FROM_PLAN_M
                      for e in planned)
            if far:
                stops.append({"from": pts[i]["t"], "to": pts[j]["t"],
                              "minutes": round((t1 - t0).total_seconds() / 60),
                              "latitude": round(center["lat"], 3), "longitude": round(center["lng"], 3)})
            i = j + 1
            continue
        i += 1
    reached = sum(1 for e in out_events if e["reached"])
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "events": out_events,
        "summary": {
            "planned_count": len(out_events), "reached_count": reached,
            "skipped": [e["title"] for e in out_events if not e["reached"]],
            "planned_distance_km": round(planned_m / 1000, 2),
            "actual_distance_km": round(lt.distance_m(pts) / 1000, 2),
            "points": len(pts),
            "off_route_ratio": round(len(off) / len(deviations), 2) if deviations else None,
            "max_deviation_m": round(max(deviations)) if deviations else None,
            "off_route_threshold_m": OFF_ROUTE_M,
        },
        "unplanned_stops": stops[:20],
        "planned_route": [{"event_id": e["event_id"], "title": e["title"], "date": e["date"],
                           "latitude": e["latitude"], "longitude": e["longitude"]} for e in planned],
    }
