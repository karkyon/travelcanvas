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
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.services import dining
from app.services.search_provider import HEADERS, REQUEST_TIMEOUT, SearchProviderError, classify_error

logger = logging.getLogger(__name__)

BASE = "https://nominatim.openstreetmap.org"
ATTRIBUTION = "© OpenStreetMap contributors"
LICENSE = "ODbL 1.0"
LICENSE_URL = "https://www.openstreetmap.org/copyright"
MIN_INTERVAL = 1.1
CACHE_SECONDS = 3600
CACHE_MAX = 256

_WIKIDATA = re.compile(r"^Q[1-9][0-9]{0,11}$")
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


_ADDR_KEYS = {"province", "state", "city", "town", "village", "municipality", "administrative", "county",
              "city_district", "quarter", "suburb", "hamlet", "neighbourhood", "house_number", "postcode", "country",
              "country_code", "ISO3166-2-lvl4", "ISO3166-2-lvl3"}
_TOWN_NUMBER = re.compile(r"^[0-9０-９]+(?:[-‐−][0-9０-９]+)*$")


def jp_address_parts(addr: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """[Gate PlaceTripArea] Nominatim の address(項目ごと)から 都道府県・市区町村・町名・番地 を取り出す。
    道路の名前(「国道42号」など)・施設の名前・郵便番号は住所に入れない(番地と取り違える・推定の郵便番号が多い)"""
    pref = str(addr.get("province") or addr.get("state") or "").strip()
    if not pref:
        return None
    city = str(addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or "").strip()
    if not city:
        adm = str(addr.get("administrative") or "").strip()
        city = adm if adm.endswith(("市", "区", "町", "村")) else ""
    county = str(addr.get("county") or "").strip()
    if county and city and not city.startswith(county) and not city.endswith("市"):
        city = county + city
    ward = str(addr.get("city_district") or "").strip()
    if ward.endswith("区") and ward not in city:
        city += ward
    quarter = str(addr.get("quarter") or addr.get("suburb") or addr.get("hamlet") or "").strip()
    hood = str(addr.get("neighbourhood") or "").strip()
    # 丁目(neighbourhood)は町名(quarter)で始まる時だけ同じ町の丁目とみなす。違う時は別の町の名前が混ざっている
    town = hood if hood and (not quarter or hood.startswith(quarter)) and hood.endswith("丁目") else (quarter or "")
    number = str(addr.get("house_number") or "").strip()
    number = number if town and _TOWN_NUMBER.match(number) else ""
    return {"pref": pref, "city": city, "town": town, "number": number}


def jp_address(item: Dict[str, Any]) -> Optional[str]:
    """日本の住所(都道府県から)。項目ごとの address があればそこから作り、無ければ表示名を県から順に並べ直す。
    [Gate PlaceTripArea] OpenStreetMap の郵便番号は付けない(近くの値を推定した物が多く、違う番号になる)"""
    display = str(item.get("display_name") or "").strip()
    raw_addr = item.get("address")
    addr: Dict[str, Any] = raw_addr if isinstance(raw_addr, dict) else {}
    country = str(addr.get("country_code") or "").lower()
    if country != "jp":
        return display or None
    parts = jp_address_parts(addr)
    if parts and not parts["town"] and display:
        # 項目ごとの住所に町名が無い時(公園など)は、表示名にだけある町名(「兼六町」など)を使う。
        # 道路・施設の名前・郵便番号は表示名にもあるので、項目ごとの住所で道路などと分かる物は除く
        skip = {str(v) for kk, v in addr.items() if kk not in _ADDR_KEYS}
        skip.add(str(item.get("name") or ""))
        pieces = [p.strip() for p in display.split(",") if p.strip()]
        known = {parts["pref"], parts["city"], str(addr.get("county") or ""), str(addr.get("postcode") or ""),
                 str(addr.get("house_number") or ""), "日本", "Japan"}
        towns = [p for p in pieces if p not in skip and p not in known and not re.search(r"\d", p)]
        if len(towns) == 1:
            parts["town"] = towns[0]
    if parts:
        return "".join(parts[k] for k in ("pref", "city", "town", "number")) or None
    if not display:
        return None
    pieces = [p.strip() for p in display.split(",") if p.strip()]
    name = str(item.get("name") or "").strip()
    if pieces and pieces[-1] in ("日本", "Japan"):
        pieces = pieces[:-1]
    if pieces and any(ch.isdigit() for ch in pieces[-1]) and "-" in pieces[-1] and len(pieces[-1]) <= 9:
        pieces = pieces[:-1]
    if pieces and name and pieces[0] == name:
        pieces = pieces[1:]
    body = "".join(reversed(pieces))
    return body or None


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
    category = event_category(item.get("category") or item.get("class"), item.get("type"))
    # [Gate PlaceTripArea] OpenStreetMap の駅は「鳥羽」のように「駅」が付かない。名前の照合と表示のため付ける
    kind = str(item.get("category") or item.get("class") or "")
    if name and str(item.get("type") or "") in ("station", "halt") and kind in ("railway", "public_transport") \
            and not name.endswith("駅"):
        name += "駅"
    # [Gate SpotInfo] 食事の場所の情報(ジャンル・営業時間・支払い・予約など)と、写真の手がかり(Commons のファイル・Wikidata)
    details = dining.from_osm_tags(extra, item.get("type")) if category == "dining" else {}
    commons = str(extra.get("wikimedia_commons") or "").strip()
    wikidata = str(extra.get("wikidata") or "").strip()
    return {
        "name": name or None,
        "address": jp_address(item),
        "phone": _phone(extra),
        "website": str(website)[:2000] if website else None,
        "category": category,
        "osm_type": item.get("type"),
        "latitude": lat,
        "longitude": lon,
        "source_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}" if osm_type and osm_id else None,
        "dining": details or None,
        "photo_file": commons if commons.startswith("File:") and len(commons) <= 240 else None,
        "wikidata": wikidata if _WIKIDATA.match(wikidata) else None,
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
    _area_cache.clear()
    _last["at"] = 0.0


async def lookup(name: Optional[str], latitude: Optional[float], longitude: Optional[float],
                 client: Optional[httpx.AsyncClient] = None, span: float = 0.3,
                 bounded: bool = False) -> Tuple[List[Dict[str, Any]], bool]:
    """(候補, 保存した結果を使ったか)。名前があれば名前で(位置があれば近くを優先)、無ければ位置から読む。
    span は近くを優先する範囲(度)。[Gate PlaceTripArea] 日本の中だけで探す(countrycodes=jp)。
    提供元が答えない時は SearchProviderError(0 件と区別する)。"""
    name = (name or "").strip()[:200]
    common = {"format": "jsonv2", "addressdetails": "1", "extratags": "1", "namedetails": "0", "accept-language": "ja"}
    if name:
        params: Dict[str, Any] = {**common, "q": name, "limit": "5", "countrycodes": "jp"}
        if latitude is not None and longitude is not None:
            d = span
            params["viewbox"] = f"{longitude - d:.4f},{latitude + d:.4f},{longitude + d:.4f},{latitude - d:.4f}"
            params["bounded"] = "1" if bounded else "0"
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


# [Gate PlaceTripArea] 旅行の目的地(「三重県鳥羽市」「鳥羽」「金沢」など)の位置と都道府県。
# 市町村・駅・地名を先に選ぶ(同じ名前の道路・トンネルより)。結果は 1 日覚えておく(同じ目的地で何度も送らない)
AREA_SECONDS = 86400
_AREA_RANK = {"city": 0, "town": 0, "village": 0, "municipality": 0, "county": 1, "province": 2, "state": 2,
              "railway": 3, "suburb": 4, "quarter": 4, "neighbourhood": 5, "hamlet": 5, "island": 5}
_area_cache: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}


async def search_area(text: str, client: Optional[httpx.AsyncClient] = None) -> Tuple[Optional[Dict[str, Any]], bool]:
    """(目的地の {latitude, longitude, prefecture, label, kind}, 保存した結果を使ったか)。見つからない時は None"""
    q = (text or "").strip()[:120]
    if not q:
        return None, False
    hit = _area_cache.get(q)
    if hit and hit[0] > time.monotonic():
        return (dict(hit[1]) if hit[1] else None), True
    params = {"format": "jsonv2", "addressdetails": "1", "accept-language": "ja", "countrycodes": "jp", "limit": "5",
              "q": q}
    try:
        data = await _get("/search", params, client)
    except Exception as exc:  # noqa: BLE001
        err: SearchProviderError = classify_error(exc)
        logger.warning("Nominatim area failed: %s code=%s status=%s", type(exc).__name__, err.code, err.status)
        raise err from exc
    best: Optional[Dict[str, Any]] = None
    best_key: Tuple[int, float] = (99, 0.0)
    for i in data if isinstance(data, list) else []:
        if not isinstance(i, dict):
            continue
        kind = str(i.get("addresstype") or "")
        if kind not in _AREA_RANK:
            continue
        try:
            lat, lon = float(i["lat"]), float(i["lon"])
            importance = float(i.get("importance") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        k = (_AREA_RANK[kind], -importance)
        if best is None or k < best_key:
            raw = i.get("address")
            addr: Dict[str, Any] = raw if isinstance(raw, dict) else {}
            best_key = k
            best = {"latitude": lat, "longitude": lon, "kind": kind,
                    "prefecture": str(addr.get("province") or addr.get("state") or "").strip() or None,
                    "label": str(i.get("name") or q)[:80]}
    if len(_area_cache) >= CACHE_MAX:
        _area_cache.pop(next(iter(_area_cache)))
    _area_cache[q] = (time.monotonic() + AREA_SECONDS, best)
    return (dict(best) if best else None), False
