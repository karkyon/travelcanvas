"""[FR-061] 日帰りモード: ルートの計算と、ルートの近くの寄り道の候補(詳細設計 DD-2026-11-22-01 §4.3〜4.5)。

ルートの提供元は順に試す: Google Routes(鍵が確認済み・利用枠が残っている時)→ OSRM(設定がある時)→ 直線。
- Google の field mask は計算の用途だけの ROUTES_LINE_FIELD_MASK(provider_calls)。1 回の計算 = routes.element 2 単位(行き・帰り)
- 出発地は小数 2 桁(約 1km)に丸めて保存する。今いる場所そのものは保存しない
- 近くの候補は保存しない。同じ条件の結果は 10 分だけサーバーの中に置く
"""
from __future__ import annotations

import asyncio
import math
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.models.models import DayTripRoute, Spot, TravelPlan, User
from app.services import genre_map, osrm_router, wishes
from app.services import place_finder as pf
from app.services import place_lookup as pl
from app.services import preference_profile as pp
from app.services.search_provider import SearchProviderError

ROADS = ("highway", "local", "avoid_tolls", "auto")
WIDTHS_M = (300, 1000, 3000, 5000)
ORDERS = ("personal", "route", "detour")
LEGS = ("out", "back")
MAX_LINE_POINTS = 2000
SIMPLIFY_TOL_M = 30.0
MAX_POLYLINE_BYTES = 200_000
MAX_SAMPLES = 10
MERGE_M = 150.0
LOCAL_KMH = 30.0
HIGHWAY_KMH = 40.0
HIGHWAY_EXIT_MIN = 15
STRAIGHT_KMH = 40.0
DEFAULT_BACK = "16:30"
CACHE_SECONDS = 600
STAY_MIN = {"cafe": 40, "michinoeki": 30, "shrine": 30, "onsen": 90, "meal": 60, "japanese": 60, "ramen": 40,
            "sweets": 30, "izakaya": 90, "view": 30, "sightseeing": 45, "activity": 60, "souvenir": 30, "hotel": 30}

Point = Tuple[float, float]


class DayTripError(Exception):
    def __init__(self, code: str, status: int, message: str):
        super().__init__(code)
        self.code, self.status, self.message = code, status, message


# ===================================================================== 線(polyline)

def encode_polyline(points: Sequence[Point]) -> str:
    """Google の encoded polyline(精度 1e-5)"""
    out: List[str] = []
    prev = (0, 0)
    for lat, lng in points:
        cur = (int(round(lat * 1e5)), int(round(lng * 1e5)))
        for v in (cur[0] - prev[0], cur[1] - prev[1]):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev = cur
    return "".join(out)


def decode_polyline(text: str) -> List[Point]:
    points: List[Point] = []
    idx = lat = lng = 0
    n = len(text or "")
    try:
        while idx < n:
            vals = []
            for _ in range(2):
                shift = result = 0
                while True:
                    b = ord(text[idx]) - 63
                    idx += 1
                    result |= (b & 0x1F) << shift
                    shift += 5
                    if b < 0x20:
                        break
                vals.append(~(result >> 1) if result & 1 else result >> 1)
            lat += vals[0]
            lng += vals[1]
            points.append((lat / 1e5, lng / 1e5))
    except IndexError:
        return points
    return points


def _xy(p: Point, lat0: float) -> Tuple[float, float]:
    return (p[1] * 111320.0 * math.cos(math.radians(lat0)), p[0] * 110540.0)


def _seg_dist_m(p: Point, a: Point, b: Point) -> float:
    lat0 = (a[0] + b[0]) / 2
    (px, py), (ax, ay), (bx, by) = _xy(p, lat0), _xy(a, lat0), _xy(b, lat0)
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points: List[Point], tol_m: float = SIMPLIFY_TOL_M) -> List[Point]:
    """Douglas–Peucker(点が MAX_LINE_POINTS を超える時だけ使う)"""
    if len(points) <= 2:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, at = -1.0, -1
        for k in range(i + 1, j):
            d = _seg_dist_m(points[k], points[i], points[j])
            if d > best:
                best, at = d, k
        if at >= 0 and best > tol_m:
            keep[at] = True
            stack.extend([(i, at), (at, j)])
    return [p for p, k in zip(points, keep) if k]


def thin_line(points: List[Point]) -> List[Point]:
    return simplify(points) if len(points) > MAX_LINE_POINTS else points


def km_between(a: Point, b: Point) -> float:
    return wishes.distance_m(a[0], a[1], b[0], b[1]) / 1000.0


def line_km(points: Sequence[Point]) -> float:
    return sum(km_between(a, b) for a, b in zip(points, points[1:]))


def locate_on_line(points: Sequence[Point], p: Point) -> Tuple[float, float]:
    """(線からの最短の距離 km, その位置までの線の長さ at_km)。区間は線の全部(_seg_km と同じ近似)"""
    if len(points) == 1:
        return km_between(points[0], p), 0.0
    best_off, best_at, run = math.inf, 0.0, 0.0
    for a, b in zip(points, points[1:]):
        seg = km_between(a, b)
        off = pf._seg_km(p, a, b)
        if off < best_off:
            lat0 = (a[0] + b[0]) / 2
            (px, py), (ax, ay), (bx, by) = _xy(p, lat0), _xy(a, lat0), _xy(b, lat0)
            dx, dy = bx - ax, by - ay
            t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            best_off, best_at = off, run + seg * t
        run += seg
    return best_off, best_at


def sample_points(points: Sequence[Point], width_m: int) -> List[Point]:
    """探す点: 幅が 1km 以下なら 8km ごと、3km 以上なら 15km ごと(最大 10 点。始めと終わりを含む)"""
    step = 8.0 if width_m <= 1000 else 15.0
    total = line_km(points)
    if not points:
        return []
    if total <= step:
        return [points[len(points) // 2]]
    n = min(MAX_SAMPLES, int(total // step) + 1)
    targets = [total * (i + 0.5) / n for i in range(n)]
    out: List[Point] = []
    run, ti = 0.0, 0
    for a, b in zip(points, points[1:]):
        seg = km_between(a, b)
        while ti < len(targets) and run + seg >= targets[ti]:
            t = 0.0 if seg == 0 else (targets[ti] - run) / seg
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            ti += 1
        run += seg
    return out[:MAX_SAMPLES]


def detour_minutes(off_km: float, road: str, exit_km: Optional[float] = None) -> Tuple[int, bool]:
    """寄り道の時間(往復 + 3 分)。高速は近い IC・SA/PA からの距離で 40km/h。IC が分からない時は +約 15 分の札"""
    if road == "highway":
        if exit_km is not None:
            return int(round(exit_km * 2 / HIGHWAY_KMH * 60 + 3)), False
        return int(round(off_km * 2 / HIGHWAY_KMH * 60 + 3)) + HIGHWAY_EXIT_MIN, True
    return int(round(off_km * 2 / LOCAL_KMH * 60 + 3)), False


def round_origin(lat: float, lng: float) -> Point:
    return round(float(lat), 2), round(float(lng), 2)


def _hhmm_add(hhmm: str, seconds: int) -> str:
    h, m = (int(x) for x in hhmm.split(":"))
    t = (h * 60 + m + int(round(seconds / 60))) % (24 * 60)
    return f"{t // 60:02d}:{t % 60:02d}"


# ===================================================================== ルートの計算

def _straight(origin: Point, dest: Point) -> Dict[str, Any]:
    d = km_between(origin, dest)
    return {"provider": "straight", "points": [origin, dest], "distance_m": int(round(d * 1000)),
            "duration_s": int(round(d / STRAIGHT_KMH * 3600)), "toll_jpy": None}


async def _osrm(origin: Point, dest: Point) -> Optional[Dict[str, Any]]:
    if not osrm_router.enabled("car"):
        return None
    got = (await osrm_router.route_many([("car", origin, dest)]))[0]
    if not got:
        return None
    pts = [(float(a), float(b)) for a, b in got["coordinates"]]
    return {"provider": "osrm", "points": pts,
            "distance_m": int(round((got.get("distance_km") or line_km(pts)) * 1000)),
            "duration_s": int(round((got.get("duration_minutes") or 0) * 60)) or None, "toll_jpy": None}


def _google(db: Session, plan: TravelPlan, caller: User, origin: Point, dest: Point, road: str, depart: Optional[str],
            idem: str) -> Optional[Dict[str, Any]]:
    from app.services import cost_guard as cg
    from app.services import provider_calls as pc

    if not pc.ready(db, "google_routes", "routes.element"):
        return None
    try:
        summary, _usage = pc.route_line(db, plan, caller, origin, dest, road, depart, idem)
    except (cg.CostGuardError, pc.ProviderRejected, cg.ProviderTransientError, cg.ProviderAmbiguousError):
        return None
    if not summary or not summary.get("polyline"):
        return None
    pts = decode_polyline(summary["polyline"])
    if len(pts) < 2:
        return None
    return {"provider": "google", "points": pts, "distance_m": summary.get("distance_m"),
            "duration_s": summary.get("duration_s"), "toll_jpy": summary.get("toll_jpy")}


async def compute_leg(db: Session, plan: TravelPlan, caller: User, origin: Point, dest: Point, road: str,
                      depart: Optional[str], idem: str) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []
    from starlette.concurrency import run_in_threadpool

    got = await run_in_threadpool(_google, db, plan, caller, origin, dest, road, depart, idem)
    if got is None:
        got = await _osrm(origin, dest)
        if got is not None and road in ("local", "avoid_tolls", "highway"):
            warnings.append("road_preference_ignored")  # OSRM は道の使い方を選べない(速い道)
    if got is None:
        got = _straight(origin, dest)
        warnings.append("straight_line")
    got["points"] = thin_line(got["points"])
    return got, warnings


def _depart_iso(plan: TravelPlan, hhmm: str) -> Optional[str]:
    if not plan.start_date:
        return None
    from datetime import tzinfo
    from zoneinfo import ZoneInfo

    tz: tzinfo
    try:
        tz = ZoneInfo(getattr(plan, "timezone", None) or "Asia/Tokyo")
    except Exception:  # noqa: BLE001 - 時刻帯が分からない時は日本の時刻
        tz = timezone(timedelta(hours=9))
    h, m = (int(x) for x in hhmm.split(":"))
    day = plan.start_date if not isinstance(plan.start_date, datetime) else plan.start_date.date()
    local = datetime(day.year, day.month, day.day, h, m, tzinfo=tz)
    if local < datetime.now(timezone.utc):
        return None  # 過去の出発の時刻は Google が断る(混み具合は見ないので、時刻なしで計算する)
    return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _row(db: Session, plan_id: Any, leg: str) -> Optional[DayTripRoute]:
    return db.query(DayTripRoute).filter(DayTripRoute.plan_id == plan_id, DayTripRoute.leg == leg).first()


def leg_view(r: DayTripRoute) -> Dict[str, Any]:
    return {"leg": r.leg, "origin": {"label": r.origin_label, "lat": r.origin_lat, "lng": r.origin_lng},
            "destination": {"label": r.dest_label, "lat": r.dest_lat, "lng": r.dest_lng, "spot_id": r.dest_spot_id},
            "road": r.road, "depart_at": r.depart_at, "home_by": r.home_by, "polyline": r.polyline,
            "distance_m": r.distance_m, "duration_s": r.duration_s, "toll_jpy": r.toll_jpy, "provider": r.provider,
            "arrive_at": _hhmm_add(r.depart_at, r.duration_s or 0) if r.depart_at else None,
            "computed_at": r.computed_at, "revision": r.revision}


def require_day_trip(plan: TravelPlan) -> None:
    if getattr(plan, "trip_style", None) != "day_trip":
        raise DayTripError("day_trip_not_day_trip", 409, "日帰りの旅行ではありません")


async def compute_route(db: Session, plan: TravelPlan, caller: User, body: Dict[str, Any], idem: str) -> Dict[str, Any]:
    """行きと帰りを計算して保存する(行き = 出発地 → 目的地、帰り = 目的地 → 出発地)"""
    require_day_trip(plan)
    o = body["origin"]
    d = body["destination"]
    if d.get("lat") is None or d.get("lng") is None:
        raise DayTripError("day_trip_dest_unlocated", 422, "目的地の位置が分かりません。候補から選び直してください")
    origin = round_origin(o["lat"], o["lng"])
    dest = (float(d["lat"]), float(d["lng"]))
    road, depart, home_by = body["road"], body["depart_at"], body.get("home_by")
    if home_by and home_by <= depart:
        raise DayTripError("day_trip_time_order", 422, "家に着きたい時刻は出発の後にしてください")
    out, w1 = await compute_leg(db, plan, caller, origin, dest, road, _depart_iso(plan, depart), f"{idem}:out")
    # 帰りの出発: 家に着きたい時刻から逆算(無ければ 16:30)
    back, w2 = await compute_leg(db, plan, caller, dest, origin, road, None, f"{idem}:back")
    back_depart = _hhmm_add(home_by, -int(back["duration_s"])) if home_by and back.get("duration_s") else DEFAULT_BACK
    spot_id = d.get("spot_id")
    if spot_id is not None:
        sp = db.query(Spot).filter(Spot.id == spot_id, Spot.created_by == caller.id).first()
        spot_id = sp.id if sp else None
    now = datetime.now(timezone.utc)
    # 出発地は利用者の今いる場所になりうるので、丸めた値と地名(「〇〇市のあたり」)だけを持つ
    for leg, got, a, b, a_label, b_label, dep in (
            ("out", out, origin, dest, o["label"], d["label"], depart),
            ("back", back, dest, origin, d["label"], o["label"], back_depart)):
        poly = encode_polyline(got["points"])
        if len(poly) > MAX_POLYLINE_BYTES:
            poly = encode_polyline(simplify(got["points"], SIMPLIFY_TOL_M * 4))
        row = _row(db, plan.id, leg)
        if row is None:
            row = DayTripRoute(plan_id=plan.id, leg=leg, revision=0)
            db.add(row)
        row.origin_label, (row.origin_lat, row.origin_lng) = (a_label or "")[:120], a
        row.dest_label, (row.dest_lat, row.dest_lng) = (b_label or "")[:200], b
        row.dest_spot_id = spot_id if leg == "out" else None
        row.road, row.depart_at, row.home_by = road, dep, home_by
        row.polyline, row.distance_m, row.duration_s = poly, got.get("distance_m"), got.get("duration_s")
        row.toll_jpy, row.provider, row.computed_at = got.get("toll_jpy"), got["provider"], now
        row.revision = (row.revision or 0) + 1
    db.commit()
    _cache_clear(plan.id)
    legs = {leg: leg_view(r) for leg in LEGS for r in [_row(db, plan.id, leg)] if r is not None}
    return {"routes": legs, "provider": out["provider"], "warnings": sorted(set(w1 + w2))}


async def compare(db: Session, plan: TravelPlan, caller: User, roads: List[str], idem: str) -> Dict[str, Any]:
    """道の使い方の比べ(保存しない)。行きの出発地・目的地で計算する"""
    require_day_trip(plan)
    r = _row(db, plan.id, "out")
    if r is None:
        raise DayTripError("day_trip_route_missing", 409, "先にルートを計算してください")
    options = []
    for road in roads:
        got, warns = await compute_leg(db, plan, caller, (r.origin_lat, r.origin_lng), (r.dest_lat, r.dest_lng), road,
                                       _depart_iso(plan, r.depart_at), f"{idem}:{road}")
        options.append({"road": road, "duration_s": got.get("duration_s"), "distance_m": got.get("distance_m"),
                        "toll_jpy": got.get("toll_jpy"), "polyline": encode_polyline(got["points"]),
                        "provider": got["provider"], "warnings": warns})
    return {"options": options}


def get_view(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    legs = {leg: leg_view(r) for leg in LEGS for r in [_row(db, plan.id, leg)] if r is not None}
    return {"trip_style": getattr(plan, "trip_style", None), "routes": legs}


# ===================================================================== ルートの近くの候補

_cache: "OrderedDict[Tuple[Any, ...], Tuple[float, Dict[str, Any]]]" = OrderedDict()
_lock = threading.Lock()


def _cache_clear(plan_id: Any) -> None:
    with _lock:
        for k in [k for k in _cache if k[0] == str(plan_id)]:
            _cache.pop(k, None)


async def _search(text: str, cat: Optional[str], at: Point, dist_km: float, keys: Dict[str, Optional[str]],
                  record: pl.Recorder, failures: List[str], sem: asyncio.Semaphore) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    async with sem:
        async with pl._client() as client:
            tasks = []
            if keys[pl.SLOT_YAHOO]:
                tasks.append(pl._call("yahoo_local", pf._yahoo(client, keys[pl.SLOT_YAHOO] or "", text, at, dist_km),
                                      record, failures))
            if keys[pl.SLOT_HOTPEPPER] and cat in (None, "dining"):
                tasks.append(pl._call("hotpepper", pf._hotpepper(client, keys[pl.SLOT_HOTPEPPER] or "", text, at),
                                      record, failures))
            for res in await asyncio.gather(*tasks):
                rows.extend(res or [])
    return rows


async def along(db: Session, plan: TravelPlan, user: User, leg: str, genres: List[str], width_m: int, order: str,
                record: pl.Recorder) -> Dict[str, Any]:
    require_day_trip(plan)
    r = _row(db, plan.id, leg)
    if r is None or not r.polyline:
        raise DayTripError("day_trip_route_missing", 409, "先にルートを計算してください")
    genres = [g for g in genres if g in pf.GENRES] or ["all"]
    key = (str(plan.id), str(user.id), leg, tuple(sorted(genres)), width_m, order, r.revision)
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return {**hit[1], "cached": True}
    line = decode_polyline(r.polyline)
    total = line_km(line) or 0.001
    width_km = width_m / 1000.0
    samples = sample_points(line, width_m)
    step = 8.0 if width_m <= 1000 else 15.0
    dist_km = min(20.0, width_km + step / 2)
    keys = pl.keys(db)
    failures: List[str] = []
    sem = asyncio.Semaphore(4)
    jobs = []
    for g in genres:
        _label, word, cat = pf.GENRES[g]
        for at in samples:
            jobs.append((g, _search(word or "観光", cat, at, dist_km, keys, record, failures, sem)))
    exits: List[Point] = []
    if r.road == "highway" and keys[pl.SLOT_YAHOO]:
        for at in samples:
            jobs.append(("_exit", _search("サービスエリア", None, at, dist_km, keys, record, failures, sem)))
    found = await asyncio.gather(*(j for _, j in jobs))
    rows: List[Dict[str, Any]] = []
    for (g, _), res in zip(jobs, found):
        for x in res or []:
            if g == "_exit":
                if x.get("latitude") is not None:
                    exits.append((x["latitude"], x["longitude"]))
            else:
                rows.append({**x, "_genre": g})
    if not rows and not (keys[pl.SLOT_YAHOO] or keys[pl.SLOT_HOTPEPPER]):
        # 鍵が無い時は OpenStreetMap(点ごと。多くて 3 か所)
        for g in genres[:2]:
            word = pf.GENRES[g][1] or "観光"
            for at in samples[:3]:
                try:
                    got = await pf._osm(word, at)
                    record("openstreetmap", "ok" if got else "empty")
                    rows.extend({**x, "_genre": g} for x in got)
                except SearchProviderError as err:
                    record("openstreetmap", err.code)
                    failures.append("openstreetmap")
                    break
    prof = pp.profile(db, user)
    mine = [s for s in db.query(Spot).filter(Spot.created_by == user.id).all()
            if s.latitude is not None and s.longitude is not None]
    results: List[Dict[str, Any]] = []
    for x in rows:
        if x.get("latitude") is None or x.get("longitude") is None or not x.get("name"):
            continue
        p = (float(x["latitude"]), float(x["longitude"]))
        off, at_km = locate_on_line(line, p)
        if off * 1000 > width_m:
            continue
        nk = wishes.normalize_name(x["name"])
        same = next((y for y in results if wishes.normalize_name(y["name"]) == nk
                     and wishes.distance_m(y["lat"], y["lng"], p[0], p[1]) <= MERGE_M), None)
        if same is not None:
            for prov in x.get("providers") or [x.get("provider")]:
                if prov and prov not in same["providers"]:
                    same["providers"].append(prov)
            continue
        exit_km = min((km_between(p, e) for e in exits), default=None) if r.road == "highway" else None
        minutes, exit_unknown = detour_minutes(off, r.road, exit_km)
        genre_code = genre_map.to_genre(x.get("category"), " ".join(str(v or "") for v in (x.get("genre"), x["name"])))
        if x["_genre"] != "all":
            genre_code = x["_genre"] if genre_code is None or genre_code not in genres else genre_code
        saved = next((s for s in mine if wishes.normalize_name(s.name) == nk
                      and wishes.distance_m(float(s.latitude or 0), float(s.longitude or 0), p[0], p[1]) <= MERGE_M),
                     None)
        results.append({"name": str(x["name"])[:200], "genre": genre_code,
                        "genre_label": genre_map.label(genre_code) or x.get("genre"),
                        "lat": p[0], "lng": p[1], "address": x.get("address"), "off_m": int(round(off * 1000)),
                        "at_km": round(at_km, 1), "detour_min": None if r.provider == "straight" else minutes,
                        "exit_unknown": exit_unknown and r.provider != "straight",
                        "providers": list(x.get("providers") or [x.get("provider")]),
                        "saved_spot_id": saved.id if saved else None, "rating": x.get("rating"),
                        "stay_min": STAY_MIN.get(genre_code or "", 30)})
    for x in results:
        pref = prof.weights.get(x["genre"] or "", 0.0) if prof.enabled else 0.0
        det = x["detour_min"] if x["detour_min"] is not None else 15
        along_term = (1 - min(1.0, x["at_km"] / total)) if leg == "out" else 0.0
        x["score"] = round(0.5 * pref + 0.3 * (1 - min(1.0, det / 30.0)) + 0.2 * along_term, 4)
        reasons = []
        g = x["genre"]
        if prof.enabled and g and prof.went.get(g, 0) >= 2:
            reasons.append(f"よく行く: {genre_map.label(g)}({prof.went[g]} 回)")
        if prof.enabled and g and prof.again.get(g):
            reasons.append(f"また行きたいに{genre_map.label(g)}")
        if x["saved_spot_id"]:
            reasons.append("保存した場所")
        if isinstance(x.get("rating"), (int, float)) and x["rating"] >= 4.0:
            reasons.append("評判の店")
        x["reasons"] = reasons[:3]
        x.pop("rating", None)
    if order == "route":
        results.sort(key=lambda x: x["at_km"])
    elif order == "detour":
        results.sort(key=lambda x: (x["detour_min"] if x["detour_min"] is not None else 999, x["at_km"]))
    else:
        results.sort(key=lambda x: (-x["score"], x["at_km"]))
    wishes_near: List[Dict[str, Any]] = []
    for s in mine:
        off, at_km = locate_on_line(line, (float(s.latitude or 0), float(s.longitude or 0)))
        if off * 1000 <= width_m:
            wishes_near.append({"spot_id": s.id, "name": s.name, "lat": s.latitude, "lng": s.longitude,
                                "off_m": int(round(off * 1000)), "at_km": round(at_km, 1),
                                "wish_kind": s.wish_kind or "next"})
    wishes_near.sort(key=lambda w: float(w["at_km"]))
    used = sorted({p for x in results for p in x["providers"] if p in pl.SOURCES}, key=list(pl.SOURCES).index)
    out = {"region_label": f"{r.origin_label}から{r.dest_label}への線の近く", "width_m": width_m, "leg": leg,
           "total_km": round(total, 1), "results": results[:60], "wishes_near": wishes_near[:30],
           "profile_line": prof.line(), "personalized": prof.enabled,
           "source": [{"provider": p, **pl.SOURCES[p]} for p in used],
           "keyed_providers": [p for p, ok in (("yahoo_local", bool(keys[pl.SLOT_YAHOO])),
                                               ("hotpepper", bool(keys[pl.SLOT_HOTPEPPER]))) if ok],
           "failed_providers": sorted(set(failures)), "straight": r.provider == "straight", "cached": False}
    with _lock:
        _cache[key] = (now, out)
        while len(_cache) > 200:
            _cache.popitem(last=False)
    return out
