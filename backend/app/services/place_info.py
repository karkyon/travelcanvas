"""[Gate PlanSpotEdit] 予定(スポット)の場所の情報(住所・電話番号・種類・位置)を OpenStreetMap から読む。保存しない。

利用者が「インターネットから取得」を押した時(または予定を足す時に場所を選んだ時)の 1 回だけ、Nominatim へ送る。

利用の条件(Nominatim Usage Policy / OSMF の Attribution Guidelines・ODbL 1.0)を守るための決まり:
- 送り手を示す User-Agent を付ける(search_provider.HEADERS)
- 1 秒に 1 回を超えて送らない(このプロセスの中で 1.1 秒の間を空ける)。同じ問い合わせは 1 時間は保存した結果を使う
- 一括の取得・自動の繰り返しをしない(押した時の 1 回だけ。画面は確認してから入れる)
- 結果を見せる所に「© OpenStreetMap contributors」(ODbL)を出す(応答の attribution / license)
Google Places 等の有料・規約の厳しい提供元は使わない(追加の請求なし)。

返す値は「候補」。画面は利用者が確かめて「入れる」を押した時だけ予定へ入れる。読めない時は空(値を作らない)。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.services.search_provider import HEADERS, REQUEST_TIMEOUT, SearchProviderError, classify_error

logger = logging.getLogger(__name__)

BASE = "https://nominatim.openstreetmap.org"
ATTRIBUTION = "© OpenStreetMap contributors"
LICENSE = "ODbL 1.0"
LICENSE_URL = "https://www.openstreetmap.org/copyright"
MIN_INTERVAL = 1.1
CACHE_SECONDS = 3600
CACHE_MAX = 256

_lock = asyncio.Lock()
_last = {"at": 0.0}
_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

# OpenStreetMap の種類 → 予定の種類(EventCategory)
_DINING = {"restaurant", "cafe", "fast_food", "food_court", "bar", "pub", "ice_cream", "biergarten", "izakaya"}
_STAY = {"hotel", "guest_house", "hostel", "motel", "apartment", "chalet", "camp_site", "ryokan"}
_SHOP = {"marketplace", "mall", "department_store", "supermarket", "convenience", "gift", "souvenir"}
_MOVE = {"station", "halt", "bus_station", "ferry_terminal", "aerodrome", "terminal", "taxi", "parking"}
_ACT = {"theme_park", "zoo", "aquarium", "water_park", "sports_centre", "stadium", "cinema", "theatre", "spa",
        "golf_course", "swimming_pool", "public_bath"}
_SIGHT = {"place_of_worship", "shrine", "temple", "museum", "viewpoint", "attraction", "castle", "monument", "park",
          "garden"}


def event_category(cls: Optional[str], typ: Optional[str]) -> Optional[str]:
    c, t = (cls or "").lower(), (typ or "").lower()
    if t in _DINING:
        return "dining"
    if t in _STAY:
        return "accommodation"
    if c == "shop" or t in _SHOP:
        return "shopping"
    if t in _MOVE or c in ("railway", "aeroway", "public_transport"):
        return "transportation"
    if t in _ACT or c == "leisure":
        return "activity"
    if c in ("tourism", "historic") or t in _SIGHT:
        return "sightseeing"
    return None


def jp_address(item: Dict[str, Any]) -> Optional[str]:
    """日本の住所は Nominatim の表示名が「名前, 番地, 町, 市, 県, 郵便番号, 日本」の逆順なので、県から順に並べ直す。"""
    display = str(item.get("display_name") or "").strip()
    if not display:
        return None
    parts = [p.strip() for p in display.split(",") if p.strip()]
    raw_addr = item.get("address")
    addr: Dict[str, Any] = raw_addr if isinstance(raw_addr, dict) else {}
    country = str(addr.get("country_code") or "").lower()
    if country != "jp":
        return display
    name = str(item.get("name") or "").strip()
    if parts and parts[-1] in ("日本", "Japan"):
        parts = parts[:-1]
    postcode = None
    if parts and any(ch.isdigit() for ch in parts[-1]) and "-" in parts[-1] and len(parts[-1]) <= 9:
        postcode = parts[-1]
        parts = parts[:-1]
    if parts and name and parts[0] == name:
        parts = parts[1:]
    body = "".join(reversed(parts))
    if not body:
        return None
    return f"〒{postcode} {body}" if postcode else body


def _phone(extra: Dict[str, Any]) -> Optional[str]:
    raw = extra.get("phone") or extra.get("contact:phone")
    if not raw:
        return None
    first = str(raw).split(";")[0].strip()
    return first[:40] or None


def _row(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        lat = float(item["lat"]) if item.get("lat") is not None else None
        lon = float(item["lon"]) if item.get("lon") is not None else None
    except (TypeError, ValueError):
        lat = lon = None
    raw_extra = item.get("extratags")
    extra: Dict[str, Any] = raw_extra if isinstance(raw_extra, dict) else {}
    name = str(item.get("name") or "").strip() or str(item.get("display_name") or "").split(",")[0].strip()
    if not name and lat is None:
        return None
    osm_type, osm_id = item.get("osm_type"), item.get("osm_id")
    website = extra.get("website") or extra.get("contact:website")
    return {
        "name": name or None,
        "address": jp_address(item),
        "phone": _phone(extra),
        "website": str(website)[:2000] if website else None,
        "category": event_category(item.get("category") or item.get("class"), item.get("type")),
        "osm_type": item.get("type"),
        "latitude": lat,
        "longitude": lon,
        "source_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}" if osm_type and osm_id else None,
    }


def _key(kind: str, params: Dict[str, Any]) -> str:
    raw = kind + "|" + "|".join(f"{k}={params[k]}" for k in sorted(params))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _get(path: str, params: Dict[str, Any], client: Optional[httpx.AsyncClient]) -> Any:
    async with _lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last["at"])
        if wait > 0:
            await asyncio.sleep(wait)
        owns = client is None
        c = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
        try:
            resp = await c.get(f"{BASE}{path}", params=params, headers=HEADERS)
            resp.raise_for_status()
            return resp.json()
        finally:
            _last["at"] = time.monotonic()
            if owns:
                await c.aclose()


def reset() -> None:
    """試験用: 保存した結果と送った時刻を消す"""
    _cache.clear()
    _last["at"] = 0.0


async def lookup(name: Optional[str], latitude: Optional[float], longitude: Optional[float],
                 client: Optional[httpx.AsyncClient] = None) -> Tuple[List[Dict[str, Any]], bool]:
    """(候補, 保存した結果を使ったか)。名前があれば名前で(位置があれば近くを優先)、無ければ位置から読む。
    提供元が答えない時は SearchProviderError(0 件と区別する)。"""
    name = (name or "").strip()[:200]
    common = {"format": "jsonv2", "addressdetails": "1", "extratags": "1", "namedetails": "0", "accept-language": "ja"}
    if name:
        params: Dict[str, Any] = {**common, "q": name, "limit": "3"}
        if latitude is not None and longitude is not None:
            d = 0.3
            params["viewbox"] = f"{longitude - d:.4f},{latitude + d:.4f},{longitude + d:.4f},{latitude - d:.4f}"
            params["bounded"] = "0"
        path = "/search"
    elif latitude is not None and longitude is not None:
        params = {**common, "lat": f"{latitude:.6f}", "lon": f"{longitude:.6f}", "zoom": "18"}
        path = "/reverse"
    else:
        return [], False
    key = _key(path, params)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return [dict(r) for r in hit[1]], True
    try:
        data = await _get(path, params, client)
    except Exception as exc:  # noqa: BLE001
        err: SearchProviderError = classify_error(exc)
        logger.warning("Nominatim place info failed: %s code=%s status=%s", type(exc).__name__, err.code, err.status)
        raise err from exc
    items = data if isinstance(data, list) else ([data] if isinstance(data, dict) and not data.get("error") else [])
    rows = [r for r in (_row(i) for i in items if isinstance(i, dict)) if r]
    if len(_cache) >= CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + CACHE_SECONDS, rows)
    return rows, False
