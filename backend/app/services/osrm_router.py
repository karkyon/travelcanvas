"""[Gate RoadRoute] 地図に引く「道に沿った経路」(OSRM。無料・鍵は要らない・自分の server で動かす)。

- 送り先は設定の OSRM_CAR_URL(車)・OSRM_FOOT_URL(歩き)だけ(利用者の入力で送り先を変えられない。SSRF を作らない)。
  docker compose --profile osrm の osrm-car・osrm-foot(scripts/ops/osrm_prepare.sh で準備する)を想定する
- 送るのは2点の座標だけ(予定の名前・利用者は送らない。自分の server なので外へは出ない)
- 移動手段 → 道の種類: 歩き・自転車 → foot、車・タクシー・バス・高速バス・複合 → car。
  電車・新幹線・飛行機・船・ヘリは道を引かない(直線。線路・航路を道で代わりに描かない)
- 設定が空・届かない・時間切れ・道が見つからない時は None(画面は直線の点線のまま。架空の道を作らない)
- 同じ(種類・座標を 5 桁に丸めた2点)の結果は OSRM_CACHE_SECONDS(既定 1 日)使い回す。失敗は 5 分だけ覚える
- CI の模擬(PROVIDER_HTTP_STUB)の時は送らない。試験は set_transport で httpx.MockTransport に差し替える
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

PROVIDER_NAME = "osrm"
MAX_POINTS = 400  # 1区間の線の点の上限(多い時は間引く。地図の表示に十分)
MAX_CACHE = 2000
FAIL_REMEMBER_SECONDS = 300

FOOT_MODES = frozenset({"walking", "bicycle"})
CAR_MODES = frozenset({"driving", "taxi", "bus", "express_bus", "mixed"})

_transport: Optional[httpx.AsyncBaseTransport] = None
_cache: "OrderedDict[Tuple[str, float, float, float, float], Tuple[float, Optional[Dict[str, Any]]]]" = OrderedDict()
_lock = threading.Lock()


def set_transport(transport: Optional[httpx.AsyncBaseTransport]) -> None:
    """試験用: 外へ送らずに応答を差し替える(None で元に戻す)。差し替えの時は使い回しも消す"""
    global _transport
    _transport = transport
    with _lock:
        _cache.clear()


def profile_for(mode: str) -> Optional[str]:
    """移動手段 → 道の種類(foot / car)。道を引かない手段は None"""
    if mode in FOOT_MODES:
        return "foot"
    if mode in CAR_MODES:
        return "car"
    return None


def _base_url(profile: str) -> str:
    name = "OSRM_FOOT_URL" if profile == "foot" else "OSRM_CAR_URL"
    url = (getattr(settings, name, "") or "").strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        return ""
    return url


def enabled(profile: Optional[str] = None) -> bool:
    if getattr(settings, "PROVIDER_HTTP_STUB", False) and _transport is None:
        return False
    if profile is None:
        return bool(_base_url("car") or _base_url("foot"))
    return bool(_base_url(profile))


def _thin(points: List[List[float]]) -> List[List[float]]:
    if len(points) <= MAX_POINTS:
        return points
    step = (len(points) - 1) / (MAX_POINTS - 1)
    out = [points[round(i * step)] for i in range(MAX_POINTS - 1)]
    out.append(points[-1])
    return out


async def _fetch(client: httpx.AsyncClient, profile: str, a: Tuple[float, float], b: Tuple[float, float]
                 ) -> Optional[Dict[str, Any]]:
    base = _base_url(profile)
    # osrm-routed は URL の profile 名を見ない(1つの server が1つの種類を持つ)。慣例どおり driving/foot を書く
    url = f"{base}/route/v1/{'foot' if profile == 'foot' else 'driving'}/{a[1]:.6f},{a[0]:.6f};{b[1]:.6f},{b[0]:.6f}"
    r = await client.get(url, params={"overview": "full", "geometries": "geojson", "steps": "false"})
    if r.status_code != 200:
        return None
    body = r.json()
    if not isinstance(body, dict) or body.get("code") != "Ok":
        return None
    routes = body.get("routes") or []
    if not routes:
        return None
    route = routes[0]
    coords = ((route.get("geometry") or {}).get("coordinates")) or []
    points = [[float(c[1]), float(c[0])] for c in coords
              if isinstance(c, (list, tuple)) and len(c) >= 2 and all(isinstance(v, (int, float)) for v in c[:2])]
    if len(points) < 2:
        return None
    distance = route.get("distance")
    duration = route.get("duration")
    return {
        "coordinates": _thin(points),
        "distance_km": round(float(distance) / 1000, 2) if isinstance(distance, (int, float)) else None,
        "duration_minutes": round(float(duration) / 60, 1) if isinstance(duration, (int, float)) else None,
    }


def _key(profile: str, a: Tuple[float, float], b: Tuple[float, float]):
    return (profile, round(a[0], 5), round(a[1], 5), round(b[0], 5), round(b[1], 5))


async def route_many(requests: List[Tuple[str, Tuple[float, float], Tuple[float, float]]]
                     ) -> List[Optional[Dict[str, Any]]]:
    """(道の種類・出発・到着)の並び → 道の経路(または None)の並び。順序は入力と同じ"""
    ttl = int(getattr(settings, "OSRM_CACHE_SECONDS", 86400) or 0)
    timeout = float(getattr(settings, "OSRM_TIMEOUT_SECONDS", 4.0) or 4.0)
    now = time.time()
    results: List[Optional[Dict[str, Any]]] = [None] * len(requests)
    todo: List[int] = []
    with _lock:
        for i, (profile, a, b) in enumerate(requests):
            if not enabled(profile):
                continue
            hit = _cache.get(_key(profile, a, b))
            if hit and now - hit[0] < ttl:
                results[i] = hit[1]
                _cache.move_to_end(_key(profile, a, b))
            else:
                todo.append(i)
    if not todo:
        return results
    sem = asyncio.Semaphore(4)
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(2.0, timeout)), follow_redirects=False,
                                 trust_env=False, transport=_transport) as client:
        async def one(i: int) -> None:
            profile, a, b = requests[i]
            async with sem:
                try:
                    results[i] = await _fetch(client, profile, a, b)
                except (httpx.HTTPError, ValueError, TypeError) as error:
                    logger.info("osrm route unavailable (%s)", type(error).__name__)
                    results[i] = None
        await asyncio.gather(*(one(i) for i in todo))
    with _lock:
        for i in todo:
            if not ttl:
                break
            profile, a, b = requests[i]
            res = results[i]
            stamp = now if res is not None else now - max(ttl - FAIL_REMEMBER_SECONDS, 0)
            _cache[_key(profile, a, b)] = (stamp, res)
            _cache.move_to_end(_key(profile, a, b))
        while len(_cache) > MAX_CACHE:
            _cache.popitem(last=False)
    return results
