"""[Gate PlaceLookupJP] 場所の情報(住所・電話・公式サイト・種類・位置・食事の情報)と、住所から位置を、複数の提供元から集める。

これまでは OpenStreetMap(Nominatim)だけで、日本の宿・店は名前が無い・住所が「金沢市」までしかない、という事が多かった。
次の提供元を同時に引き、同じ場所らしい候補をまとめ、足りない所を補う。どれも保存しない(画面で確かめてから入れる)。

- Yahoo!ローカルサーチ(店・施設の住所・電話・URL・ジャンル)・Yahoo!ジオコーダ(住所 → 位置)・リバースジオコーダ(位置 → 住所)
- 楽天トラベル キーワード検索(宿の住所・電話・位置・チェックイン/アウト・駐車場・アクセス・楽天トラベルのページ)
- ホットペッパーグルメ(飲食店のジャンル・予算・営業時間・定休日・駐車場・カード・禁煙・個室・席数)
- OpenStreetMap(Nominatim)と Wikidata(公式サイト・住所・郵便番号)
- 国土地理院の住所検索(住所 → 位置)・逆ジオコーダ(位置 → 町名)。キー不要

キーが要る提供元(Yahoo!・楽天・ホットペッパー)は、運用コンソールで登録した鍵(provider_secrets)がある時だけ送る。
無料の利用登録で、使った分の請求は無い。鍵が無い時はキー不要の提供元だけで動く。
各提供元の規約に従い、結果を出す所に出典(クレジット)を出す(応答の sources)。写真・口コミ・評価は写さない。
外へ送った回数は free_usage に残す(検索の言葉・座標・結果は残さない)。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
import time
import unicodedata
from difflib import SequenceMatcher
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import dining
from app.services import place_info
from app.services.search_provider import HEADERS, REQUEST_TIMEOUT, SearchProviderError

logger = logging.getLogger(__name__)

YAHOO_LOCAL = "https://map.yahooapis.jp/search/local/V1/localSearch"
YAHOO_GEOCODE = "https://map.yahooapis.jp/geocode/V1/geoCoder"
YAHOO_REVERSE = "https://map.yahooapis.jp/geoapi/V1/reverseGeoCoder"
RAKUTEN_KEYWORD = "https://openapi.rakuten.co.jp/engine/api/Travel/KeywordHotelSearch/20260731"
HOTPEPPER = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/"
GSI_SEARCH = "https://msearch.gsi.go.jp/address-search/AddressSearch"
GSI_REVERSE = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress"
WIKIDATA = "https://www.wikidata.org/w/api.php"

# 出典(各提供元の規約のクレジット)。画面はこの値を出す(応答の URL は固定の値だけ)
SOURCES: Dict[str, Dict[str, str]] = {
    "yahoo_local": {"label": "Yahoo!ローカルサーチ", "credit": "Webサービス by Yahoo! JAPAN",
                    "url": "https://developer.yahoo.co.jp/sitemap/"},
    "rakuten_travel": {"label": "楽天トラベル", "credit": "Supported by Rakuten Developers",
                       "url": "https://developers.rakuten.com/"},
    "hotpepper": {"label": "ホットペッパーグルメ", "credit": "Powered by ホットペッパーグルメ Webサービス",
                  "url": "https://webservice.recruit.co.jp/"},
    "openstreetmap": {"label": "OpenStreetMap", "credit": "© OpenStreetMap contributors(ODbL 1.0)",
                      "url": "https://www.openstreetmap.org/copyright"},
    "wikidata": {"label": "Wikidata", "credit": "Wikidata(CC0)", "url": "https://www.wikidata.org/"},
    "gsi": {"label": "国土地理院", "credit": "国土地理院 住所検索・逆ジオコーダ", "url": "https://www.gsi.go.jp/"},
}

# provider_secrets の slot(運用コンソールで登録する)
SLOT_YAHOO = "yahoo_client_id"
SLOT_RAKUTEN_ID = "rakuten_app_id"
SLOT_RAKUTEN_KEY = "rakuten_access_key"
SLOT_HOTPEPPER = "hotpepper_api_key"

# 提供元の名前(free_usage)
USAGE = {"yahoo_local": "yahoo_local", "rakuten_travel": "rakuten_travel", "hotpepper": "hotpepper", "gsi": "gsi",
         "wikidata": "wikidata", "openstreetmap": "nominatim"}

CACHE_SECONDS = 3600
CACHE_MAX = 512
_cache: Dict[str, Tuple[float, Any]] = {}
# 試験で差し替える(None なら外へ送る)
transport: Optional[httpx.AsyncBaseTransport] = None

_PREFS = ("北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県",
          "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県",
          "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県",
          "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県",
          "宮崎県", "鹿児島県", "沖縄県")


def reset() -> None:
    _cache.clear()


def keys(db: Session) -> Dict[str, Optional[str]]:
    """登録済みで使える鍵(無ければ None)。値は画面・応答・ログに出さない"""
    from app.services import provider_secrets as ps

    out: Dict[str, Optional[str]] = {}
    for slot in (SLOT_YAHOO, SLOT_RAKUTEN_ID, SLOT_RAKUTEN_KEY, SLOT_HOTPEPPER):
        try:
            out[slot] = ps.resolve(db, slot)
        except Exception:  # noqa: BLE001 - 未登録・無効・保管先なし。その提供元へは送らない
            out[slot] = None
    return out


# ------------------------------------------------------------------ 共通

def _norm(s: Optional[str]) -> str:
    t = unicodedata.normalize("NFKC", str(s or "")).lower()
    return re.sub(r"[\s・･\-‐ー−()()「」『』【】\[\]〈〉<>,、。.]", "", t)


def name_score(query: str, name: Optional[str]) -> float:
    """名前の近さ(0〜1)。同じ・片方を含む・文字の並びの近さ"""
    a, b = _norm(query), _norm(name)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        return 0.75 + 0.2 * min(len(a), len(b)) / max(len(a), len(b))
    return SequenceMatcher(None, a, b).ratio() * 0.9


def distance_m(a_lat: Optional[float], a_lng: Optional[float], b_lat: Optional[float], b_lng: Optional[float]) -> float:
    if None in (a_lat, a_lng, b_lat, b_lng):
        return math.inf
    dy = (float(b_lat) - float(a_lat)) * 111_000  # type: ignore[arg-type]
    dx = (float(b_lng) - float(a_lng)) * 111_000 * math.cos(math.radians(float(a_lat)))  # type: ignore[arg-type]
    return math.hypot(dx, dy)


def postal(code: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", unicodedata.normalize("NFKC", str(code or "")))
    return f"{digits[:3]}-{digits[3:]}" if len(digits) == 7 else None


def strip_postal(address: Optional[str]) -> str:
    a = unicodedata.normalize("NFKC", str(address or "")).strip()
    return re.sub(r"^〒?\s*\d{3}-?\d{4}\s*", "", a).strip()


def with_postal(address: Optional[str], code: Optional[str]) -> Optional[str]:
    body = strip_postal(address)
    if not body:
        return None
    p = postal(code)
    return f"〒{p} {body}" if p else body


def address_detail(address: Optional[str]) -> int:
    """住所の細かさ(0: 無い・1: 県や市まで・2: 町名まで・3: 番地まで)"""
    body = strip_postal(address)
    if not body:
        return 0
    rest = body
    for p in _PREFS:
        if rest.startswith(p):
            rest = rest[len(p):]
            break
    m = re.match(r"^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])", rest)
    if m:
        rest = rest[m.end():]
    if not rest:
        return 1
    return 3 if re.search(r"\d|[一二三四五六七八九十]+番", rest) else 2


async def _json(client: httpx.AsyncClient, url: str, params: Dict[str, Any],
                headers: Optional[Dict[str, str]] = None) -> Any:
    key = hashlib.sha256((url + "|" + "|".join(f"{k}={params[k]}" for k in sorted(params))).encode()).hexdigest()
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    resp = await client.get(url, params=params, headers={**HEADERS, **(headers or {})})
    if resp.status_code == 404:  # 楽天は該当なしを 404 で返す
        data: Any = None
    else:
        resp.raise_for_status()
        data = resp.json()
    if len(_cache) >= CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + CACHE_SECONDS, data)
    return data


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=REQUEST_TIMEOUT, transport=transport, follow_redirects=False)


def _row(provider: str, **kw: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "name": None, "address": None, "phone": None, "website": None, "category": None, "osm_type": None,
        "latitude": None, "longitude": None, "source_url": None, "dining": None, "photo_file": None, "wikidata": None,
        "links": [], "notes": [], "providers": [provider],
    }
    base.update({k: v for k, v in kw.items() if v not in (None, "", [])})
    return base


# ------------------------------------------------------------------ 種類(言葉から)

_CATEGORY_WORDS: List[Tuple[Tuple[str, ...], str]] = [
    (("ホテル", "旅館", "民宿", "ペンション", "宿泊", "ホステル", "ゲストハウス", "リゾート", "コテージ", "グランピング"),
     "accommodation"),
    (("水族館", "動物園", "遊園地", "テーマパーク", "温泉", "日帰り入浴", "スパ", "体験", "レジャー", "ゴルフ", "スキー"),
     "activity"),
    (("料理", "レストラン", "食堂", "ラーメン", "寿司", "そば", "うどん", "カフェ", "喫茶", "居酒屋", "焼肉", "スイーツ",
      "ベーカリー", "グルメ", "ダイニング", "バー", "定食", "和食", "洋食", "中華"), "dining"),
    (("駅", "空港", "バスターミナル", "フェリー", "港", "駐車場", "レンタカー"), "transportation"),
    (("ショッピング", "百貨店", "デパート", "市場", "商店", "土産", "みやげ", "アウトレット", "スーパー", "道の駅"),
     "shopping"),
    (("公園", "庭園", "神社", "寺", "城", "美術館", "博物館", "記念館", "名所", "観光", "史跡", "展望", "滝", "灯台"),
     "sightseeing"),
]


def category_from_text(*texts: Optional[str]) -> Optional[str]:
    text = " ".join(t for t in texts if t)
    for words, cat in _CATEGORY_WORDS:
        if any(w in text for w in words):
            return cat
    return None


# ------------------------------------------------------------------ Yahoo!

def _yahoo_coords(feature: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    raw = str(((feature.get("Geometry") or {}).get("Coordinates")) or "")
    try:
        lon, lat = (float(x) for x in raw.split(",")[:2])
        return lat, lon
    except ValueError:
        return None, None


async def yahoo_local(client: httpx.AsyncClient, appid: str, name: str, lat: Optional[float],
                      lng: Optional[float]) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {"appid": appid, "query": name, "output": "json", "results": "5", "detail": "full",
                              "sort": "match"}
    if lat is not None and lng is not None:
        params.update({"lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "dist": "20"})
    data = await _json(client, YAHOO_LOCAL, params)
    rows: List[Dict[str, Any]] = []
    for f in (data or {}).get("Feature") or []:
        if not isinstance(f, dict):
            continue
        prop = f.get("Property") or {}
        raw_detail = prop.get("Detail")
        detail: Dict[str, Any] = raw_detail if isinstance(raw_detail, dict) else {}
        flat = {**prop, **detail}
        la, lo = _yahoo_coords(f)
        genres = " ".join(str(g.get("Name") or "") for g in prop.get("Genre") or [] if isinstance(g, dict))
        cat = category_from_text(genres)
        website = flat.get("PcUrl1") or flat.get("Url") or flat.get("PcUrl")
        station = ""
        for s in prop.get("Station") or []:
            if isinstance(s, dict) and s.get("Name"):
                station = f"{s.get('Railway') or ''} {s['Name']}駅 徒歩{s.get('Time') or '?'}分".strip()
                break
        din = dining.genres_from_text(genres) if cat == "dining" else []
        rows.append(_row(
            "yahoo_local", name=str(f.get("Name") or "").strip() or None,
            address=with_postal(prop.get("Address"), flat.get("ZipCode")),
            phone=str(prop.get("Tel1") or "")[:40] or None,
            website=str(website)[:2000] if website else None, category=cat, latitude=la, longitude=lo,
            dining=({"genres": din, **({"access": station[:200]} if station else {})}
                    if cat == "dining" and (din or station) else None),
            notes=[f"アクセス: {station}"] if station and cat != "dining" else [],
        ))
    return rows


async def yahoo_geocode(client: httpx.AsyncClient, appid: str, query: str) -> List[Dict[str, Any]]:
    data = await _json(client, YAHOO_GEOCODE, {"appid": appid, "query": query, "output": "json", "results": "5"})
    out = []
    for f in (data or {}).get("Feature") or []:
        if not isinstance(f, dict):
            continue
        la, lo = _yahoo_coords(f)
        if la is None:
            continue
        prop = f.get("Property") or {}
        out.append({"address": str(prop.get("Address") or f.get("Name") or "").strip() or None, "latitude": la,
                    "longitude": lo, "provider": "yahoo_local",
                    "level": str(prop.get("AddressMatchingLevel") or "") or None})
    return out


async def yahoo_reverse(client: httpx.AsyncClient, appid: str, lat: float, lng: float) -> Optional[str]:
    data = await _json(client, YAHOO_REVERSE, {"appid": appid, "lat": f"{lat:.6f}", "lon": f"{lng:.6f}",
                                               "output": "json"})
    for f in (data or {}).get("Feature") or []:
        addr = str(((f or {}).get("Property") or {}).get("Address") or "").strip()
        if addr:
            return addr
    return None


# ------------------------------------------------------------------ 楽天トラベル

def _hotel_infos(data: Any) -> List[Dict[str, Any]]:
    """formatVersion 1・2 のどちらの形でも、ホテルごとに {hotelBasicInfo, hotelDetailInfo, ...} を 1 つの dict にまとめる"""
    out: List[Dict[str, Any]] = []
    for h in (data or {}).get("hotels") or []:
        parts: List[Any] = []
        if isinstance(h, dict) and "hotel" in h:
            parts = h["hotel"] if isinstance(h["hotel"], list) else [h["hotel"]]
        elif isinstance(h, list):
            parts = h
        elif isinstance(h, dict):
            parts = [h]
        merged: Dict[str, Any] = {}
        for p in parts:
            if isinstance(p, dict):
                merged.update(p)
        if merged.get("hotelBasicInfo"):
            out.append(merged)
    return out


async def rakuten_hotels(client: httpx.AsyncClient, app_id: str, access_key: str, name: str) -> List[Dict[str, Any]]:
    words = [w for w in re.split(r"[\s　]+", unicodedata.normalize("NFKC", name)) if len(w) >= 2]
    if not words:
        return []
    params = {"applicationId": app_id, "accessKey": access_key, "keyword": " ".join(words)[:100], "format": "json",
              "formatVersion": "2", "hits": "5", "datumType": "1", "searchField": "1", "responseType": "large"}
    headers = {"accessKey": access_key}
    referer = (getattr(settings, "PLACE_LOOKUP_REFERER", "") or "").strip()
    if referer:
        headers["Referer"] = referer
    data = await _json(client, RAKUTEN_KEYWORD, params, headers)
    rows: List[Dict[str, Any]] = []
    for info in _hotel_infos(data):
        b = info.get("hotelBasicInfo") or {}
        d = info.get("hotelDetailInfo") or {}
        try:
            la = float(b["latitude"]) if b.get("latitude") not in (None, "") else None
            lo = float(b["longitude"]) if b.get("longitude") not in (None, "") else None
        except (TypeError, ValueError):
            la = lo = None
        notes: List[str] = []
        cin, cout = str(d.get("checkinTime") or "").strip(), str(d.get("checkoutTime") or "").strip()
        if cin or cout:
            parts = (f"チェックイン {cin}〜" if cin else "", f"チェックアウト 〜{cout}" if cout else "")
            notes.append(" / ".join(x for x in parts if x))
        for label, key in (("駐車場", "parkingInformation"), ("アクセス", "access"), ("最寄り駅", "nearestStation")):
            v = str(b.get(key) or "").strip()
            if v:
                notes.append(f"{label}: {v[:160]}")
        page = str(b.get("hotelInformationUrl") or "").strip()
        rows.append(_row(
            "rakuten_travel", name=str(b.get("hotelName") or "").strip() or None,
            address=with_postal(f"{b.get('address1') or ''}{b.get('address2') or ''}", b.get("postalCode")),
            phone=str(b.get("telephoneNo") or "")[:40] or None, category="accommodation", latitude=la, longitude=lo,
            links=[{"url": page[:2000], "label": "楽天トラベル(予約)"}] if page.startswith("https://") else [],
            notes=notes,
        ))
    return rows


# ------------------------------------------------------------------ ホットペッパーグルメ

async def hotpepper_shops(client: httpx.AsyncClient, key: str, name: str, lat: Optional[float],
                          lng: Optional[float]) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {"key": key, "keyword": name[:100], "format": "json", "count": "5"}
    if lat is not None and lng is not None:
        params.update({"lat": f"{lat:.6f}", "lng": f"{lng:.6f}", "range": "5"})
    data = await _json(client, HOTPEPPER, params)
    rows: List[Dict[str, Any]] = []
    for shop in ((data or {}).get("results") or {}).get("shop") or []:
        if not isinstance(shop, dict):
            continue
        la: Optional[float] = None
        lo: Optional[float] = None
        try:
            la, lo = float(shop["lat"]), float(shop["lng"])
        except (KeyError, TypeError, ValueError):
            pass
        page = str(((shop.get("urls") or {}).get("pc")) or "").strip()
        rows.append(_row(
            "hotpepper", name=str(shop.get("name") or "").strip() or None,
            address=with_postal(shop.get("address"), None),
            category="dining", latitude=la, longitude=lo, dining=dining.from_hotpepper(shop) or None,
            links=[{"url": page[:2000], "label": "ホットペッパーグルメ"}] if page.startswith("https://") else [],
        ))
    return rows


# ------------------------------------------------------------------ 国土地理院

async def gsi_geocode(client: httpx.AsyncClient, query: str) -> List[Dict[str, Any]]:
    data = await _json(client, GSI_SEARCH, {"q": query})
    out = []
    for f in data if isinstance(data, list) else []:
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
            title = str((f.get("properties") or {}).get("title") or "").strip()
        except (KeyError, TypeError, ValueError):
            continue
        out.append({"address": title or None, "latitude": float(lat), "longitude": float(lon), "provider": "gsi",
                    "level": None})
    return out[:5]


async def gsi_town(client: httpx.AsyncClient, lat: float, lng: float) -> Optional[str]:
    """位置の町名(例: 兼六町)。市区町村の名前は返らない(muniCd だけ)ので、町名だけを使う"""
    data = await _json(client, GSI_REVERSE, {"lat": f"{lat:.6f}", "lon": f"{lng:.6f}"})
    town = str(((data or {}).get("results") or {}).get("lv01Nm") or "").strip()
    return town if town and town != "－" else None


# ------------------------------------------------------------------ Wikidata

def _claim_value(claims: Dict[str, Any], prop: str) -> Optional[Any]:
    for c in claims.get(prop) or []:
        v = (((c or {}).get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(v, dict) and "text" in v:
            if v.get("language") in ("ja", None):
                return v["text"]
            continue
        if v:
            return v
    for c in claims.get(prop) or []:  # 日本語が無ければ最初の値
        v = (((c or {}).get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(v, dict) and "text" in v:
            return v["text"]
    return None


async def wikidata_facts(client: httpx.AsyncClient, qid: str) -> Dict[str, Optional[str]]:
    data = await _json(client, WIKIDATA, {"action": "wbgetentities", "ids": qid, "props": "claims", "format": "json"})
    claims = ((((data or {}).get("entities") or {}).get(qid) or {}).get("claims")) or {}
    site = _claim_value(claims, "P856")
    return {"website": str(site) if isinstance(site, str) and site.startswith("http") else None,
            "address": _claim_value(claims, "P6375"), "postal_code": _claim_value(claims, "P281")}


# ------------------------------------------------------------------ まとめる

_PRIORITY = {"address": ["yahoo_local", "rakuten_travel", "hotpepper", "wikidata", "openstreetmap"],
             "phone": ["yahoo_local", "rakuten_travel", "hotpepper", "openstreetmap"],
             "website": ["openstreetmap", "wikidata", "yahoo_local"],
             "coords": ["yahoo_local", "rakuten_travel", "hotpepper", "openstreetmap"]}


def _same(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    d = distance_m(a.get("latitude"), a.get("longitude"), b.get("latitude"), b.get("longitude"))
    s = name_score(a.get("name") or "", b.get("name"))
    if d <= 150:
        return s >= 0.5
    if d <= 600:
        return s >= 0.7
    return d == math.inf and s >= 0.9


def merge(groups: List[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """同じ場所の候補(提供元ごと)を 1 つにまとめる。項目ごとに確かな提供元を先に使う"""
    rows = [r for g in groups for r in g]

    def first(field: str, order: List[str]) -> Any:
        for p in order:
            for r in rows:
                if r["providers"][0] == p and r.get(field):
                    return r[field]
        for r in rows:
            if r.get(field):
                return r[field]
        return None

    best_addr = None
    for p in _PRIORITY["address"]:
        cands = [r["address"] for r in rows if r["providers"][0] == p and r.get("address")]
        if cands:
            cand = max(cands, key=address_detail)
            if best_addr is None or address_detail(cand) > address_detail(best_addr):
                best_addr = cand
    lat = lng = None
    for p in _PRIORITY["coords"]:
        hit = next((r for r in rows if r["providers"][0] == p and r.get("latitude") is not None), None)
        if hit:
            lat, lng = hit["latitude"], hit["longitude"]
            break
    din: Dict[str, Any] = {}
    for p in ("hotpepper", "openstreetmap", "yahoo_local"):
        for r in rows:
            if r["providers"][0] == p and r.get("dining"):
                din = dining.merge_empty(din, r["dining"])
    links: List[Dict[str, str]] = []
    for r in rows:
        for link in r.get("links") or []:
            if link["url"] not in {x["url"] for x in links}:
                links.append(link)
    notes: List[str] = []
    for r in rows:
        for n in r.get("notes") or []:
            if n not in notes:
                notes.append(n)
    providers: List[str] = []
    for r in rows:
        if r["providers"][0] not in providers:
            providers.append(r["providers"][0])
    name = first("name", ["rakuten_travel", "yahoo_local", "hotpepper", "openstreetmap"])
    return {
        "name": name, "address": best_addr, "phone": first("phone", _PRIORITY["phone"]),
        "website": first("website", _PRIORITY["website"]),
        "category": first("category", ["rakuten_travel", "hotpepper", "openstreetmap", "yahoo_local"]),
        "osm_type": first("osm_type", ["openstreetmap"]), "latitude": lat, "longitude": lng,
        "source_url": first("source_url", ["openstreetmap"]),
        "dining": din or None,  # 形の検査は返す前(_safe_dining)
        "photo_file": first("photo_file", ["openstreetmap"]), "wikidata": first("wikidata", ["openstreetmap"]),
        "links": links[:4], "notes": notes[:6], "providers": providers,
    }


def group_rows(rows: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    groups: List[List[Dict[str, Any]]] = []
    for r in rows:
        for g in groups:
            if any(_same(r, x) for x in g):
                g.append(r)
                break
        else:
            groups.append([r])
    return groups


def rank(groups: List[Dict[str, Any]], query: str, lat: Optional[float], lng: Optional[float]) -> List[Dict[str, Any]]:
    def key(c: Dict[str, Any]) -> Tuple[float, ...]:
        d = distance_m(lat, lng, c.get("latitude"), c.get("longitude"))
        near = 0.0 if d == math.inf else max(0.0, 1.0 - d / 30_000)
        return (-(name_score(query, c.get("name")) + 0.3 * near + 0.05 * len(c["providers"])
                  + 0.05 * address_detail(c.get("address"))),)
    return sorted(groups, key=key)


def _safe_dining(value: Any) -> Optional[Dict[str, Any]]:
    if not value:
        return None
    try:
        return dining.to_json(dining.DiningInfo(**value))
    except Exception:  # noqa: BLE001 - 読めない値は捨てる(値を作らない)
        return None


Recorder = Callable[[str, str], None]


async def _call(name: str, fn: Awaitable[Any], record: Recorder, failures: List[str]) -> Any:
    try:
        out = await fn
        record(name, "ok" if out else "empty")
        return out
    except Exception as exc:  # noqa: BLE001 - 1つの提供元の失敗で全体を止めない
        from app.services.search_provider import classify_error

        err = classify_error(exc)
        logger.warning("place lookup %s failed: %s code=%s status=%s", name, type(exc).__name__, err.code, err.status)
        record(name, err.code)
        failures.append(name)
        return None


async def lookup(db: Session, name: Optional[str], lat: Optional[float], lng: Optional[float],
                 record: Recorder) -> Dict[str, Any]:
    """名前(と近くの位置)から場所の候補を集める。返す: candidates・sources(出典)・unavailable(全部の提供元が答えない)"""
    name = (name or "").strip()[:200]
    k = keys(db)
    failures: List[str] = []
    rows: List[Dict[str, Any]] = []
    async with _client() as client:
        tasks: Dict[str, Awaitable[Any]] = {}
        if name and k[SLOT_YAHOO]:
            tasks["yahoo_local"] = yahoo_local(client, k[SLOT_YAHOO] or "", name, lat, lng)
        if name and k[SLOT_RAKUTEN_ID] and k[SLOT_RAKUTEN_KEY]:
            tasks["rakuten_travel"] = rakuten_hotels(client, k[SLOT_RAKUTEN_ID] or "", k[SLOT_RAKUTEN_KEY] or "", name)
        if name and k[SLOT_HOTPEPPER]:
            tasks["hotpepper"] = hotpepper_shops(client, k[SLOT_HOTPEPPER] or "", name, lat, lng)
        names = list(tasks)
        results = await asyncio.gather(*(_call(n, tasks[n], record, failures) for n in names))
        for n, res in zip(names, results):
            rows.extend(res or [])
        # OpenStreetMap(名前がそのままで無ければ、空白を外した名前・一番長い語でも試す)
        osm_ok = True
        osm_cached = False
        try:
            osm, cached = await place_info.lookup(name or None, lat, lng)
            osm_cached = cached
            if not cached:
                record("openstreetmap", "ok" if osm else "empty")
            if not osm and name and not rows:
                for variant in _variants(name):
                    osm, cached = await place_info.lookup(variant, lat, lng)
                    if not cached:
                        record("openstreetmap", "ok" if osm else "empty")
                    if osm:
                        break
        except SearchProviderError as err:
            record("openstreetmap", err.code)
            failures.append("openstreetmap")
            osm, osm_ok = [], False
        for r in osm:
            rows.append(_row("openstreetmap", **{k2: v for k2, v in r.items()}, providers=["openstreetmap"]))
        if name:
            # 名前の当たらない候補(近くの別の店など)は外す。OpenStreetMap だけの時は、別名(英語名など)で当たった物を残す
            close = [r for r in rows if name_score(name, r.get("name")) >= 0.45]
            only_osm = all(r["providers"][0] == "openstreetmap" for r in rows)
            rows = close if close or not only_osm else rows
        merged = rank([merge([g]) for g in group_rows(rows)], name, lat, lng)[:5]
        # 足りない所を補う(上の 3 件だけ): Wikidata の公式サイト・住所、住所の細かさ(町名・番地)
        for c in merged[:3]:
            await _complete(client, c, k, record, failures)
    for c in merged:
        c["dining"] = _safe_dining(c.get("dining"))
    used = sorted({p for c in merged for p in c["providers"]}, key=list(SOURCES).index)
    return {
        "candidates": merged,
        "sources": [{"provider": p, **SOURCES[p]} for p in used],
        "keyed_providers": [p for p, ok in (
            ("yahoo_local", bool(k[SLOT_YAHOO])), ("rakuten_travel", bool(k[SLOT_RAKUTEN_ID] and k[SLOT_RAKUTEN_KEY])),
            ("hotpepper", bool(k[SLOT_HOTPEPPER]))) if ok],
        "unavailable": not merged and not osm_ok and len(failures) >= 1 + len(names),
        "cached": osm_cached and not names and not failures,
        "failed_providers": failures,
    }


def _variants(name: str) -> List[str]:
    n = unicodedata.normalize("NFKC", name).strip()
    out = []
    joined = re.sub(r"\s+", "", n)
    if joined != n:
        out.append(joined)
    words = sorted((w for w in re.split(r"\s+", n) if len(w) >= 3), key=len, reverse=True)
    if len(words) >= 2:
        out.append(words[0])
    return out[:2]


async def _complete(client: httpx.AsyncClient, c: Dict[str, Any], k: Dict[str, Optional[str]], record: Recorder,
                    failures: List[str]) -> None:
    if c.get("wikidata") and (not c.get("website") or address_detail(c.get("address")) < 3):
        facts = await _call("wikidata", wikidata_facts(client, c["wikidata"]), record, failures) or {}
        if facts.get("website") and not c.get("website"):
            c["website"] = facts["website"][:2000]
        if facts.get("address") and address_detail(facts["address"]) > address_detail(c.get("address")):
            c["address"] = with_postal(facts["address"], facts.get("postal_code") or _postal_of(c.get("address")))
        if facts.get("address") or facts.get("website"):
            c["providers"].append("wikidata")
    lat, lng = c.get("latitude"), c.get("longitude")
    if lat is None or lng is None or address_detail(c.get("address")) >= 3:
        return
    if k[SLOT_YAHOO]:
        addr = await _call("yahoo_local", yahoo_reverse(client, k[SLOT_YAHOO] or "", lat, lng), record, failures)
        if addr and address_detail(addr) > address_detail(c.get("address")):
            c["address"] = with_postal(addr, _postal_of(c.get("address")))
            if "yahoo_local" not in c["providers"]:
                c["providers"].append("yahoo_local")
            return
    if address_detail(c.get("address")) == 1:
        town = await _call("gsi", gsi_town(client, lat, lng), record, failures)
        body = strip_postal(c.get("address"))
        if town and town not in body:
            c["address"] = with_postal(body + town, _postal_of(c.get("address")))
            c["providers"].append("gsi")


def _postal_of(address: Optional[str]) -> Optional[str]:
    m = re.match(r"^〒?\s*(\d{3}-?\d{4})", unicodedata.normalize("NFKC", str(address or "")).strip())
    return m.group(1) if m else None


async def geocode(db: Session, query: str, lat: Optional[float], lng: Optional[float],
                  record: Recorder) -> Dict[str, Any]:
    """住所(または名前)から位置の候補。Yahoo!ジオコーダ(鍵がある時)→ 国土地理院 → OpenStreetMap の順に、見つかるまで"""
    query = unicodedata.normalize("NFKC", (query or "").strip())[:200]
    body = strip_postal(query)
    k = keys(db)
    failures: List[str] = []
    out: List[Dict[str, Any]] = []
    async with _client() as client:
        if k[SLOT_YAHOO]:
            out = await _call("yahoo_local", yahoo_geocode(client, k[SLOT_YAHOO] or "", body), record, failures) or []
        if not out:
            out = await _call("gsi", gsi_geocode(client, body), record, failures) or []
            # 国土地理院は地名・駅名も返す。住所の時は先頭の県・市が合うものを先に
            if out and any(body.startswith(p) for p in _PREFS):
                head = body[:6]
                out.sort(key=lambda r: 0 if str(r.get("address") or "").startswith(head) else 1)
        if not out:
            try:
                osm, cached = await place_info.lookup(body, lat, lng)
                if not cached:
                    record("openstreetmap", "ok" if osm else "empty")
                out = [{"address": r.get("address") or r.get("name"), "latitude": r["latitude"],
                        "longitude": r["longitude"], "provider": "openstreetmap", "level": None}
                       for r in osm if r.get("latitude") is not None]
            except SearchProviderError as err:
                record("openstreetmap", err.code)
                failures.append("openstreetmap")
    used = sorted({r["provider"] for r in out}, key=list(SOURCES).index)
    return {"candidates": out[:5], "sources": [{"provider": p, **SOURCES[p]} for p in used],
            "unavailable": not out and bool(failures), "failed_providers": failures}
