"""
[Gate PlaceFinderArea] 予定の追加の「名前で検索」: 言葉とジャンルで、この旅行の範囲か経路の近くの場所を探す(保存しない)。

- 範囲(scope)
  - area: この旅行の範囲。予定の位置の真ん中と、いちばん遠い予定までの距離 + 3km(5〜40km)。予定に位置が無ければ目的地(地名)の周り 15km
  - route: 経路の近く。予定を順につないだ線(日をまたいでも順に)の 5km 以内。線が長い時は 15km ごとに区切って探す
  - all: 範囲で絞らない(全国)
- 提供元: Yahoo!ローカルサーチ(鍵がある時。日本の店・施設に強い)・ホットペッパーグルメ(食事のジャンル・鍵がある時)・
  OpenStreetMap(Nominatim。鍵が無くても動く)。どれも結果を保存しない。写真・口コミ・評価は写さない
- 範囲の外の候補は出さない(全国の時を除く)。範囲の真ん中・経路からの距離が近い順
"""
from __future__ import annotations

import asyncio
import math
from typing import Any, Awaitable, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.models.models import TravelDay, TravelEvent, TravelPlan
from app.services import place_info
from app.services import place_lookup as pl
from app.services.search_provider import SearchProviderError

# code: (表示の名前, 探す言葉, 予定の種類)
GENRES: Dict[str, Tuple[str, str, Optional[str]]] = {
    "all": ("すべて", "", None),
    "cafe": ("カフェ", "カフェ", "dining"),
    "meal": ("食事・ランチ", "レストラン", "dining"),
    "japanese": ("和食・郷土料理", "和食", "dining"),
    "ramen": ("ラーメン・麺", "ラーメン", "dining"),
    "sweets": ("スイーツ・甘味", "スイーツ", "dining"),
    "izakaya": ("居酒屋・夜ごはん", "居酒屋", "dining"),
    "sightseeing": ("観光名所", "観光", "sightseeing"),
    "shrine": ("神社・寺", "神社", "sightseeing"),
    "view": ("景色・展望", "展望台", "sightseeing"),
    "onsen": ("温泉", "温泉", "activity"),
    "activity": ("体験・遊び", "体験", "activity"),
    "souvenir": ("買い物・土産", "土産", "shopping"),
    "michinoeki": ("道の駅", "道の駅", "shopping"),
    "hotel": ("宿", "ホテル", "accommodation"),
}
SCOPES = ("area", "route", "all")
ROUTE_KM = 5.0
STEP_KM = 15.0
MAX_POINTS = 5
CATEGORY_LABEL = {"dining": "食事", "sightseeing": "観光", "shopping": "買い物", "accommodation": "宿", "activity": "体験",
                  "transportation": "交通"}


def km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    d = pl.distance_m(a[0], a[1], b[0], b[1])
    return d / 1000 if d != math.inf else math.inf


def _seg_km(p: Tuple[float, float], a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """点 p と線分 a-b の距離(km。狭い範囲なので平面で近似)"""
    lat0 = math.radians((a[0] + b[0]) / 2)
    ax, ay = a[1] * math.cos(lat0), a[0]
    bx, by = b[1] * math.cos(lat0), b[0]
    px, py = p[1] * math.cos(lat0), p[0]
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    q = (ay + t * dy, (ax + t * dx) / math.cos(lat0))
    return km(p, q)


def plan_points(db: Session, plan: TravelPlan) -> List[Tuple[float, float]]:
    """予定の位置を、日の順・並びの順に(エリアの中の予定も含む)"""
    rows = (db.query(TravelEvent.latitude, TravelEvent.longitude)
            .join(TravelDay, TravelDay.id == TravelEvent.day_id)
            .filter(TravelEvent.plan_id == plan.id, TravelEvent.latitude.isnot(None), TravelEvent.longitude.isnot(None))
            .order_by(TravelDay.local_date, TravelEvent.sort_order).limit(300).all())
    return [(float(r[0]), float(r[1])) for r in rows]


def region_of(points: List[Tuple[float, float]], scope: str,
              area: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """探す範囲。点が無く目的地も分からなければ None(全国で探す)"""
    if scope == "all":
        return None
    if scope == "route" and len(points) >= 2:
        samples: List[Tuple[float, float]] = []
        for a, b in zip(points, points[1:]):
            n = max(1, math.ceil(km(a, b) / STEP_KM))
            samples += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n)]
        samples.append(points[-1])
        m = min(MAX_POINTS, len(samples))
        idx = sorted({round(i * (len(samples) - 1) / max(1, m - 1)) for i in range(m)})
        query = [samples[i] for i in idx]
        # 探す点の間も覆うように、点の周りを広めに探し(最大 20km)、経路の線から 5km 以内だけ残す
        total = sum(km(a, b) for a, b in zip(points, points[1:]))
        spacing = total / max(1, len(query) - 1)
        return {"scope": "route", "line": points, "query_points": query, "radius_km": ROUTE_KM,
                "query_km": min(20.0, max(ROUTE_KM, spacing / 2 + ROUTE_KM)),
                "label": f"経路の近く({int(ROUTE_KM)}km 以内)"}
    if points:
        c = (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
        far = max(km(c, p) for p in points)
        r = min(40.0, max(5.0, far + 3))
        return {"scope": "area", "center": c, "query_points": [c], "radius_km": round(r, 1),
                "label": f"この旅行の範囲(予定の真ん中から {round(r)}km 以内)"}
    if area and area.get("latitude") is not None:
        c = (float(area["latitude"]), float(area["longitude"]))
        return {"scope": "area", "center": c, "query_points": [c], "radius_km": 15.0,
                "label": f"この旅行の範囲({area.get('label') or '目的地'}から 15km 以内)"}
    return None


def distance_in(region: Optional[Dict[str, Any]], lat: Optional[float], lng: Optional[float]) -> Optional[float]:
    """範囲の真ん中(経路の時は経路の線)からの距離(km)。位置が分からなければ None"""
    if region is None or lat is None or lng is None:
        return None
    p = (lat, lng)
    if region["scope"] == "route":
        line = region["line"]
        return min(_seg_km(p, a, b) for a, b in zip(line, line[1:]))
    return km(p, region["center"])


async def _yahoo(client: httpx.AsyncClient, appid: str, text: str, at: Optional[Tuple[float, float]],
                 dist_km: float) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {"appid": appid, "query": text, "output": "json", "results": "20", "detail": "full"}
    if at is not None:
        dist = str(max(1, min(20, int(math.ceil(dist_km)))))
        params.update({"lat": f"{at[0]:.6f}", "lon": f"{at[1]:.6f}", "dist": dist, "sort": "hybrid"})
    else:
        params["sort"] = "match"
    data = await pl._json(client, pl.YAHOO_LOCAL, params)
    rows: List[Dict[str, Any]] = []
    for f in (data or {}).get("Feature") or []:
        if not isinstance(f, dict):
            continue
        prop = f.get("Property") or {}
        la, lo = pl._yahoo_coords(f)
        genres = [str(g.get("Name") or "") for g in prop.get("Genre") or [] if isinstance(g, dict) and g.get("Name")]
        rows.append({"name": str(f.get("Name") or "").strip(),
                     "address": pl.with_postal(prop.get("Address"), None),
                     "latitude": la, "longitude": lo, "category": pl.category_from_text(" ".join(genres)),
                     "genre": genres[0] if genres else None, "provider": "yahoo_local"})
    return [r for r in rows if r["name"]]


async def _hotpepper(client: httpx.AsyncClient, key: str, text: str,
                     at: Optional[Tuple[float, float]]) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {"key": key, "keyword": text[:100], "format": "json", "count": "20"}
    if at is not None:
        params.update({"lat": f"{at[0]:.6f}", "lng": f"{at[1]:.6f}", "range": "5"})
    data = await pl._json(client, pl.HOTPEPPER, params)
    rows = []
    for shop in ((data or {}).get("results") or {}).get("shop") or []:
        if not isinstance(shop, dict):
            continue
        la: Optional[float] = None
        lo: Optional[float] = None
        try:
            la, lo = float(shop["lat"]), float(shop["lng"])
        except (KeyError, TypeError, ValueError):
            pass
        genre = (shop.get("genre") or {}).get("name") if isinstance(shop.get("genre"), dict) else None
        rows.append({"name": str(shop.get("name") or "").strip(), "address": shop.get("address"), "latitude": la,
                     "longitude": lo, "category": "dining", "genre": genre, "provider": "hotpepper"})
    return [r for r in rows if r["name"]]


async def _osm(text: str, at: Optional[Tuple[float, float]]) -> List[Dict[str, Any]]:
    rows, _cached = await (place_info.lookup(text, at[0], at[1], span=0.3, bounded=True) if at is not None
                           else place_info.lookup(text, None, None))
    return [{"name": str(r.get("name") or "").strip(), "address": r.get("address"), "latitude": r.get("latitude"),
             "longitude": r.get("longitude"), "category": r.get("category"), "genre": None, "provider": "openstreetmap"}
            for r in rows if r.get("name")]


def _dedupe(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        same = next((x for x in out if pl.name_score(x["name"], r["name"]) >= 0.8
                     and pl.distance_m(x["latitude"], x["longitude"], r["latitude"], r["longitude"]) <= 300), None)
        if same is None:
            out.append({**r, "providers": [r["provider"]]})
            continue
        if r["provider"] not in same["providers"]:
            same["providers"].append(r["provider"])
        for k in ("address", "genre", "category", "latitude", "longitude"):
            if not same.get(k) and r.get(k):
                same[k] = r[k]
    return out


async def find(db: Session, plan: TravelPlan, query: str, genre: str, scope: str,
               record: pl.Recorder, points: Optional[List[Tuple[float, float]]] = None) -> Dict[str, Any]:
    """points を渡すと、旅行全体ではなくその点(例: 1 日の案の予定)の範囲で探す([Gate PlanB-Indoor])"""
    label, word, cat = GENRES[genre]
    text = " ".join(x for x in (query.strip(), word) if x)[:120]
    points = points if points else plan_points(db, plan)
    area = None
    if not points and scope != "all":
        area = await pl.trip_area(plan.destination, plan.title, record)
    region = region_of(points, scope, area)
    at_list: List[Optional[Tuple[float, float]]] = list(region["query_points"]) if region else [None]
    k = pl.keys(db)
    failures: List[str] = []
    rows: List[Dict[str, Any]] = []
    async with pl._client() as client:
        tasks: List[Tuple[str, Awaitable[Any]]] = []
        for at in at_list:
            dist = (region.get("query_km") or region["radius_km"]) if region else 20.0
            if k[pl.SLOT_YAHOO]:
                tasks.append(("yahoo_local", _yahoo(client, k[pl.SLOT_YAHOO] or "", text, at, dist)))
            if k[pl.SLOT_HOTPEPPER] and cat in (None, "dining"):
                tasks.append(("hotpepper", _hotpepper(client, k[pl.SLOT_HOTPEPPER] or "", text, at)))
        results = await asyncio.gather(*(pl._call(n, t, record, failures) for n, t in tasks))
        for res in results:
            rows.extend(res or [])
    if not rows:
        # 鍵が無い・見つからない時は OpenStreetMap(範囲の点ごと。多くて 3 か所)
        for at in at_list[:3]:
            try:
                found = await _osm(text, at)
                record("openstreetmap", "ok" if found else "empty")
                rows.extend(found)
            except SearchProviderError as err:
                record("openstreetmap", err.code)
                failures.append("openstreetmap")
                break
    out = []
    for r in _dedupe(rows):
        d = distance_in(region, r.get("latitude"), r.get("longitude"))
        if region is not None:
            limit = region["radius_km"] + (0 if region["scope"] == "route" else 2)
            if d is None or d > limit:
                continue
        if cat and r.get("category") and r["category"] != cat and genre != "all" and r["provider"] != "hotpepper":
            # ジャンルを選んだ時、種類がはっきり違う物(「温泉」で温泉の名前の店など)は後ろへ
            r["off_genre"] = True
        r["distance_km"] = round(d, 1) if d is not None else None
        r["genre_label"] = r.get("genre") or CATEGORY_LABEL.get(r.get("category") or "", None)
        out.append(r)
    out.sort(key=lambda r: (bool(r.get("off_genre")), r["distance_km"] if r["distance_km"] is not None else 9999))
    used = sorted({p for r in out for p in r["providers"]}, key=list(pl.SOURCES).index)
    return {
        "query": text, "genre": genre, "genre_label": label, "scope": region["scope"] if region else "all",
        "region": ({"label": region["label"], "radius_km": region["radius_km"]} if region else
                   {"label": "全国(範囲で絞らない)" if scope == "all" else "全国(予定に位置が無く、目的地も分からないため)",
                    "radius_km": None}),
        "candidates": out[:30],
        "sources": [{"provider": p, **pl.SOURCES[p]} for p in used],
        "keyed_providers": [p for p, ok in (("yahoo_local", bool(k[pl.SLOT_YAHOO])),
                                            ("hotpepper", bool(k[pl.SLOT_HOTPEPPER]))) if ok],
        "failed_providers": failures,
    }
