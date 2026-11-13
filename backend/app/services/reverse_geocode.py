"""[Gate Remaining-2] FR-052・FR-008 逆ジオコーディング(座標 → 国・都道府県・市区町村)。無料の公開サービスだけ。

- 日本の範囲: 国土地理院の逆ジオコーダ(LonLatToAddress。市区町村コードが分かる)。名前は jp_areas(気象庁の area.json)
- 日本の外・国土地理院で分からない所: OpenStreetMap の Nominatim(利用の条件: 1 秒に 1 回・利用者を識別する User-Agent)
- 送るのは座標を 0.01 度(約 1km)に丸めた値だけ。結果は REVERSE_GEOCODE_CACHE_SECONDS(既定 30 日)使い回す
- 取れない・無効(REVERSE_GEOCODE_ENABLED=false)の時は None(画面は区画だけ。地名を作らない)
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.core.config import settings
from app.services import ext_http, jp_areas
from app.services.ext_http import Unavailable

GSI = "gsi_revgeo"
OSM = "nominatim_rev"
GSI_URL = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress"


def enabled() -> bool:
    return bool(getattr(settings, "REVERSE_GEOCODE_ENABLED", True))


def in_japan_box(lat: float, lng: float) -> bool:
    return 20.0 <= lat <= 46.0 and 122.0 <= lng <= 154.0


def _ttl() -> int:
    return int(getattr(settings, "REVERSE_GEOCODE_CACHE_SECONDS", 30 * 86400) or 86400)


def _gsi(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    if not ext_http.allowed(GSI):
        return None

    def call() -> Dict[str, Any]:
        body = ext_http.get_json(GSI, GSI_URL, params={"lat": f"{lat:.2f}", "lon": f"{lng:.2f}"})
        res = body.get("results") if isinstance(body, dict) else None
        code = str((res or {}).get("muniCd") or "").strip()
        if len(code) < 4 or not code.isdigit():
            return {}
        code = code.zfill(5)
        return {"muni_code": code}

    try:
        hit = ext_http.cached(GSI, f"{lat:.2f}:{lng:.2f}", _ttl(), call)
    except Unavailable:
        return None
    if not hit:
        return None
    code = hit["muni_code"]
    pref = jp_areas.prefecture_name(code)
    if not pref:
        return None
    return {"country_code": "JP", "country": "日本", "prefecture": pref,
            "municipality": jp_areas.municipality_name(code), "muni_code": code, "source": "国土地理院"}


def _nominatim(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    if not ext_http.allowed(OSM, "NOMINATIM_ENABLED"):
        return None
    root = (getattr(settings, "NOMINATIM_URL", "") or "https://nominatim.openstreetmap.org").rstrip("/")

    def call() -> Dict[str, Any]:
        body = ext_http.get_json(OSM, f"{root}/reverse",
                                 params={"format": "jsonv2", "lat": f"{lat:.2f}", "lon": f"{lng:.2f}", "zoom": 10,
                                         "accept-language": "ja"}, min_interval=1.0)
        addr = body.get("address") if isinstance(body, dict) else None
        if not isinstance(addr, dict):
            return {}
        cc = str(addr.get("country_code") or "").upper()[:2]
        if len(cc) != 2:
            return {}
        region = addr.get("state") or addr.get("province") or addr.get("region") or addr.get("state_district")
        muni = (addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality")
                or addr.get("county") or addr.get("city_district"))
        return {"country_code": cc, "country": str(addr.get("country") or cc)[:80],
                "prefecture": str(region)[:80] if region else None,
                "municipality": str(muni)[:80] if muni else None, "muni_code": None, "source": "OpenStreetMap"}

    try:
        hit = ext_http.cached(OSM, f"{lat:.2f}:{lng:.2f}", _ttl(), call)
    except Unavailable:
        return None
    return dict(hit) if hit else None


def reverse(lat: Optional[float], lng: Optional[float]) -> Optional[Dict[str, Any]]:
    """{country_code, country, prefecture, municipality, muni_code, source} か None"""
    if lat is None or lng is None or not enabled():
        return None
    try:
        lat_f, lng_f = round(float(lat), 2), round(float(lng), 2)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180):
        return None
    if in_japan_box(lat_f, lng_f):
        hit = _gsi(lat_f, lng_f)
        if hit:
            return hit
    return _nominatim(lat_f, lng_f)


def cached_only(lat: float, lng: float) -> bool:
    """使い回しに残っているか(送らずに答えられるか)。atlas の 1 回の要求で送る数を抑えるのに使う"""
    lat_f, lng_f = round(float(lat), 2), round(float(lng), 2)
    key = f"{lat_f:.2f}:{lng_f:.2f}"
    with ext_http._lock:
        names = (GSI, OSM)
        return any((n, key) in ext_http._cache for n in names)
