"""
[Gate #31] 検索プロバイダアダプタ(backend集約)。

これまでfrontend(webSearchService.ts)がWikipedia opensearch API・
Nominatim・Overpass APIをブラウザから直接叩いており、かつ結果が0件/
エラー/レート制限時には Math.random() で生成した架空の評価・座標・
住所を実データであるかのように返していた(監査で最優先禁止とされる
mock/randomフォールバックが本番コードに実在していた)。

本モジュールはそれをbackend側に集約する。設計上の絶対規則:
  各search_*関数は取得に失敗したら例外を送出せず空リストを返す。
  「データを捏造する」経路はコードのどこにも存在しない。
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = httpx.Timeout(8.0)

# [Gate SearchUAT] OpenStreetMap の公開の server(FOSSGIS の Overpass・Nominatim)の利用条件は、送り手を示す User-Agent を
# 求める(他の利用者の報告では、2026-04 頃から識別できない User-Agent の要求に overpass-api.de が HTTP 406 を返す)。
# 以前の Overpass の要求は User-Agent を付けていなかった(コードで確かめた不足)。omega-dev2 の「候補を探す」の失敗の
# 原因の候補の1つで、実環境の原因は scripts/ops/search_diag.sh の同じ要求の比較で確かめる(まだ確定していない)
USER_AGENT = "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"
HEADERS = {"User-Agent": USER_AGENT}

# 提供元の失敗の分類(「該当なし」と区別する。画面・利用の記録・運用の調査で同じ言葉を使う)
ERROR_CODES = ("blocked", "rate_limited", "timeout", "server_error", "network", "unreadable", "provider_timeout")


class OverpassResults(list):
    """[Gate SearchUAT F06] Overpass の結果。partial=True は server の処理が途中で止まり、一部だけの結果(完全ではない)。"""

    partial = False


class SearchProviderError(Exception):
    """[Gate SearchUAT] 提供元が結果を返さなかった(0件ではない)。code は ERROR_CODES、status は HTTP の状態。
    [Gate SearchUAT-S3] retry_after は 429 の Retry-After(秒)・待機中の残りの秒数(分からなければ None)。"""

    def __init__(self, code: str, status: Optional[int] = None, detail: str = "", retry_after: Optional[int] = None):
        super().__init__(f"{code} status={status} {detail}".strip())
        self.code, self.status, self.detail, self.retry_after = code, status, detail, retry_after


def classify_error(exc: BaseException) -> SearchProviderError:
    """例外を分類する(利用者の入力・URL は含めない)。"""
    if isinstance(exc, SearchProviderError):
        return exc
    if isinstance(exc, httpx.TimeoutException):
        return SearchProviderError("timeout", None, type(exc).__name__)
    if isinstance(exc, httpx.HTTPStatusError):
        from app.services import search_guard

        code = exc.response.status_code
        kind = ("rate_limited" if code == 429 else "blocked" if code in (400, 401, 403, 406)
                else "provider_timeout" if code == 504 else "server_error")
        retry_after = search_guard.parse_retry_after(exc.response.headers.get("retry-after")) if code == 429 else None
        return SearchProviderError(kind, code, retry_after=retry_after)
    if isinstance(exc, (httpx.ConnectError, httpx.NetworkError, httpx.RemoteProtocolError)):
        return SearchProviderError("network", None, type(exc).__name__)
    if isinstance(exc, ValueError):  # JSON でない応答(HTML の障害の画面など)
        return SearchProviderError("unreadable", None, type(exc).__name__)
    return SearchProviderError("network", None, type(exc).__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def search_wikipedia(query: str, client: Optional[httpx.AsyncClient] = None) -> List[Dict[str, Any]]:
    """Wikipedia opensearch API(APIキー不要)。失敗時は空リスト。"""
    url = "https://ja.wikipedia.org/w/api.php"
    params = {
        "action": "opensearch",
        "search": query,
        "limit": "5",
        "namespace": "0",
        "format": "json",
    }
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    try:
        resp = await client.get(url, params=params, headers=HEADERS)
        resp.raise_for_status()
        data = resp.json()
        titles = data[1] if len(data) > 1 else []
        descriptions = data[2] if len(data) > 2 else []
        urls = data[3] if len(data) > 3 else []
        retrieved_at = _now()
        results = []
        for i, title in enumerate(titles):
            results.append({
                "provider": "wikipedia",
                "external_id": urls[i] if i < len(urls) else title,
                "name": title,
                "category": "landmark",
                "latitude": None,
                "longitude": None,
                "address": None,
                "raw_payload": {
                    "title": title,
                    "description": descriptions[i] if i < len(descriptions) else None,
                    "url": urls[i] if i < len(urls) else None,
                },
                "source_url": urls[i] if i < len(urls) else url,
                "retrieved_at": retrieved_at,
            })
        return results
    except Exception as exc:  # noqa: BLE001
        # [Gate O2] 検索語(利用者の入力)と、それを含むURL・例外の文面はログに出さない
        logger.warning("Wikipedia search failed (query length %d): %s", len(query or ""), type(exc).__name__)
        return []
    finally:
        if owns_client:
            await client.aclose()


# [Gate AreaGeo] 観光のカテゴリの2つ目の無料の提供元: Wikipedia の位置つきの記事(geosearch。既に使っている提供元・キー不要)。
# Overpass(公開の server)が時間切れの時も、観光の候補が空にならないようにする。駅・学校などの観光でない記事は外す
WIKI_GEO_EXCLUDE = ("駅", "学校", "小学校", "中学校", "高等学校", "大学", "病院", "郵便局", "線", "道路", "国道", "県道",
                    "インターチェンジ", "ジャンクション", "警察署", "消防署", "市役所", "町役場", "村役場", "団地", "発電所",
                    "変電所", "トンネル", "バス停", "停留場", "放送局", "工場", "店", "選挙区")


async def search_wikipedia_nearby(latitude: float, longitude: float, radius_km: float,
                                  client: Optional[httpx.AsyncClient] = None) -> List[Dict[str, Any]]:
    """Wikipedia の位置つきの記事(半径は最大 10km。それより広い範囲は 10km まで)。失敗は例外(呼び手が分類する)。

    [Gate PlaceKinds] 1 回の要求(generator=geosearch)で、記事の代表画像(自由なライセンスの画像だけ・pageimages の既定)と
    短い説明も取り、種類(神社・寺/城・史跡/博物館…)を決める。市町村・役所・学校などの観光の候補でない記事は除く"""
    from app.services import place_kinds as pk

    url = "https://ja.wikipedia.org/w/api.php"
    radius_m = int(min(10.0, max(0.1, radius_km)) * 1000)
    params = {"action": "query", "generator": "geosearch", "ggscoord": f"{latitude}|{longitude}",
              "ggsradius": str(radius_m), "ggslimit": "50", "prop": "coordinates|pageimages|description",
              "piprop": "thumbnail", "pithumbsize": "320", "pilimit": "50", "colimit": "50", "format": "json",
              "formatversion": "2"}
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    try:
        resp = await client.get(url, params=params, headers=HEADERS)
        resp.raise_for_status()
        data = resp.json()
        query = (data or {}).get("query") if isinstance(data, dict) else None
        if isinstance(data, dict) and query is None and "batchcomplete" in data:
            return []  # 該当なし(geosearch の generator は 0 件の時 query を返さない)
        items = (query or {}).get("pages") if isinstance(query, dict) else None
        if not isinstance(items, list):
            raise SearchProviderError("unreadable", resp.status_code, "no pages array")
        retrieved_at = _now()
        out: List[Dict[str, Any]] = []
        for it in sorted((i for i in items if isinstance(i, dict)), key=lambda i: i.get("index", 0)):
            title = str(it.get("title") or "")
            if not title or any(title.endswith(w) or w in title for w in WIKI_GEO_EXCLUDE):
                continue
            desc = it.get("description") if isinstance(it.get("description"), str) else None
            kind = pk.classify_wikipedia(title, desc)
            if kind is None:
                continue
            coords = it.get("coordinates") if isinstance(it.get("coordinates"), list) else []
            lat = coords[0].get("lat") if coords and isinstance(coords[0], dict) else None
            lon = coords[0].get("lon") if coords and isinstance(coords[0], dict) else None
            thumb = (it.get("thumbnail") or {}).get("source") if isinstance(it.get("thumbnail"), dict) else None
            if thumb and not str(thumb).startswith("https://upload.wikimedia.org/"):
                thumb = None
            pageid = it.get("pageid")
            out.append({
                "provider": "wikipedia", "external_id": f"geo/{pageid}", "name": title, "category": kind,
                "latitude": lat, "longitude": lon, "address": None,
                "raw_payload": {"pageid": pageid, "_tc": {"kind": kind, "thumbnail_url": thumb,
                                                          "description": (desc or "")[:80] or None}},
                "source_url": f"https://ja.wikipedia.org/?curid={pageid}", "retrieved_at": retrieved_at,
            })
        return out
    finally:
        if owns_client:
            await client.aclose()


async def search_nominatim(
    query: str,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """Nominatim(OpenStreetMap)ジオコーディング検索(APIキー不要)。失敗時は空リスト。"""
    url = "https://nominatim.openstreetmap.org/search"
    params: Dict[str, Any] = {"q": query, "format": "json", "limit": "5", "addressdetails": "1"}
    if latitude is not None and longitude is not None:
        # 指定座標周辺を優先(viewbox)。厳密な絞り込みではなくヒント。
        delta = 0.5
        params["viewbox"] = f"{longitude-delta},{latitude+delta},{longitude+delta},{latitude-delta}"
        params["bounded"] = "0"

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    try:
        resp = await client.get(
            url, params=params, headers=HEADERS
        )
        resp.raise_for_status()
        data = resp.json()
        retrieved_at = _now()
        results = []
        for item in data:
            results.append({
                "provider": "nominatim",
                "external_id": str(item.get("place_id")),
                "name": item.get("display_name", "").split(",")[0],
                "category": item.get("type"),
                "latitude": float(item["lat"]) if item.get("lat") else None,
                "longitude": float(item["lon"]) if item.get("lon") else None,
                "address": item.get("display_name"),
                "raw_payload": item,
                "source_url": f"https://www.openstreetmap.org/{item.get('osm_type')}/{item.get('osm_id')}",
                "retrieved_at": retrieved_at,
            })
        return results
    except Exception as exc:  # noqa: BLE001
        logger.warning("Nominatim search failed (query length %d): %s", len(query or ""), type(exc).__name__)
        return []
    finally:
        if owns_client:
            await client.aclose()


# [Gate G11] 近くの検索のカテゴリ(仕様 §2.4)→ OpenStreetMap のタグ
CATEGORY_TAGS: Dict[str, List[str]] = {
    "food": ['["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"]'],
    "market": ['["amenity"="marketplace"]', '["shop"~"^(greengrocer|seafood|deli|butcher|bakery)$"]'],
    "shopping": ['["shop"]'],
    "viewpoint": ['["tourism"~"^(viewpoint|attraction)$"]'],
    # [Gate G11] 旅行相談の方面の詳細(観光・静かに過ごす)
    # [Gate SearchUAT-S3] 以前は historic の全て(道標・記念の札など、数が多く旅行の候補にならないもの)と artwork を
    # 探して重かった。観光の候補になる値だけにする
    "sightseeing": ['["tourism"~"^(attraction|museum|gallery|zoo|aquarium|theme_park)$"]',
                    '["historic"~"^(castle|ruins|archaeological_site|monument|fort|city_gate|manor|yes)$"]'],
    "quiet": ['["leisure"~"^(park|garden|nature_reserve)$"]', '["amenity"="place_of_worship"]'],
}
CATEGORIES = ("all",) + tuple(CATEGORY_TAGS)


def overpass_regex(text: str) -> str:
    """[Gate G11] 利用者の文字を Overpass の正規表現・文字列の中で文字どおりに扱う(以前はそのまま入れていた)"""
    out = []
    for ch in text:
        if ch in '\\.^$|?*+()[]{}':
            out.append('\\' + ch)
        elif ch == '"':
            out.append('\\"')
        elif ch in "\n\r\t":
            out.append(" ")
        else:
            out.append(ch)
    return "".join(out)


async def search_overpass(
    query: str,
    latitude: Optional[float],
    longitude: Optional[float],
    radius_km: float = 5.0,
    client: Optional[httpx.AsyncClient] = None,
    category: str = "all",
    raise_errors: bool = False,
) -> List[Dict[str, Any]]:
    """Overpass API(OpenStreetMap POI検索、APIキー不要)。座標が無ければ
    範囲を絞れないため空リストを返す(失敗ではなく仕様上の制約)。

    [Gate G11] 点(node)だけでなく、建物・敷地(way・relation)も探す(神社・城などは敷地で登録されている)。
    raise_errors=True の時は、提供元の失敗を「0件」にせず呼び手へ伝える。"""
    if latitude is None or longitude is None:
        return []

    urls = overpass_urls()
    overpass_query = build_overpass_query(query, latitude, longitude, radius_km, category)

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    try:
        data, status = await _post_overpass(client, urls, overpass_query)
        # [Gate SearchUAT F06] 正しい応答は elements の配列を持つ。elements: [] だけが「該当なし」
        if not isinstance(data, dict) or not isinstance(data.get("elements"), list):
            raise SearchProviderError("unreadable", status, "no elements array")
        elements = data["elements"]
        remark = str(data.get("remark") or "").lower()
        if remark and not elements:
            # 200 でも、server の時間切れ・メモリ不足の時は remark だけで要素が無い(「該当なし」ではない)。
            # 本文はログに出さず、決まった分類にする
            kind = "provider_timeout" if ("timed out" in remark or "runtime error" in remark) else "server_error"
            raise SearchProviderError(kind, status, "remark")
        retrieved_at = _now()
        results = OverpassResults()
        # remark つきで要素がある = 途中で止まった一部だけの結果(完全な結果と区別する)
        results.partial = bool(remark)
        for element in elements:
            if not isinstance(element, dict):
                continue
            tags = element.get("tags", {})
            if not isinstance(tags, dict):
                continue
            name = tags.get("name")
            if not name:
                continue
            center = element.get("center") or {}
            kind = element.get("type") or "node"
            lat, lon = element.get("lat", center.get("lat")), element.get("lon", center.get("lon"))
            if _outside(latitude, longitude, lat, lon, radius_km):
                continue  # [Gate SearchUAT-S3] 囲む四角で探したため、円の外の場所を除く(半径の内を保証する)
            results.append({
                "provider": "overpass",
                "external_id": str(element.get("id")) if kind == "node" else f"{kind}/{element.get('id')}",
                "name": name,
                "category": (tags.get("amenity") or tags.get("tourism") or tags.get("shop") or tags.get("leisure")
                             or tags.get("historic")),
                "latitude": lat,
                "longitude": lon,
                "address": tags.get("addr:full") or None,
                "raw_payload": element,
                "source_url": f"https://www.openstreetmap.org/{kind}/{element.get('id')}",
                "retrieved_at": retrieved_at,
            })
        return results
    except Exception as exc:  # noqa: BLE001
        err = classify_error(exc)
        # [Gate O2] 検索語・座標・URL は出さない。分類・HTTP の状態・例外の型だけ(運用の調査に使う)
        logger.warning("Overpass search failed (query length %d): %s code=%s status=%s", len(query or ""),
                       type(exc).__name__, err.code, err.status)
        if raise_errors:
            raise err from exc
        return []
    finally:
        if owns_client:
            await client.aclose()


def overpass_urls() -> List[str]:
    """送り先の一覧。1つ目は OVERPASS_URL(空なら公開の overpass-api.de)。2つ目以降は OVERPASS_FALLBACK_URLS
    (カンマ区切り)に利用者が承認して書いた送り先だけ(既定は空。承認の無い mirror へは送らない)。"""
    from app.core.config import settings

    first = (getattr(settings, "OVERPASS_URL", "") or "").strip() or "https://overpass-api.de/api/interpreter"
    extra = [u.strip() for u in str(getattr(settings, "OVERPASS_FALLBACK_URLS", "") or "").split(",")
             if u.strip().startswith("https://")]
    return list(dict.fromkeys([first] + extra))


# 次の送り先へ移ってよい失敗(server の障害・時間切れ)。429・403/406 は移らない(制限・拒否を他の server で回避しない)
FAILOVER_CODES = frozenset({"server_error", "provider_timeout", "timeout"})


async def _post_overpass(client: httpx.AsyncClient, urls: List[str], body: str) -> Tuple[Any, int]:
    last: Optional[BaseException] = None
    for i, url in enumerate(urls):
        try:
            resp = await client.post(url, data={"data": body}, headers={**HEADERS, "Accept": "application/json"})
            resp.raise_for_status()
            return resp.json(), resp.status_code
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i + 1 >= len(urls) or classify_error(exc).code not in FAILOVER_CODES:
                raise
    assert last is not None
    raise last


def _outside(lat0: float, lon0: float, lat: Any, lon: Any, radius_km: float) -> bool:
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return False  # 位置の無い要素は除かない(距離は「未照会」と表示する)
    from app.services.route_estimator import haversine_km

    return haversine_km(lat0, lon0, float(lat), float(lon)) > radius_km


# [Gate SearchUAT-S3] 公開の server の処理の上限。server が受け付けやすい小さな上限にする(以前は timeout 15 秒・
# maxsize 既定 512MB・10km の円(around)で nwr を一括に探し、配備の後の診断で時間切れ 2・502 が 1 だった)。
# 待つ時間(OVERPASS_TIMEOUT)は server の上限より少しだけ長くし、server の「時間切れ」の応答を受け取れるようにする
OVERPASS_SERVER_TIMEOUT = 10
OVERPASS_MAXSIZE = 64 * 1024 * 1024
OVERPASS_OUT_LIMIT = 60
# [Gate SearchUAT-S3] カテゴリごとの探す種類(n=点・w=敷地・r=敷地の集まり)。食べ物・市場の店はほぼ点か建物で、
# relation を探さない。観光は城・神社などの敷地(relation)も探す
CATEGORY_KINDS: Dict[str, str] = {"food": "nw", "market": "nw", "shopping": "nw", "viewpoint": "nw",
                                  "sightseeing": "nwr", "quiet": "nwr", "all": "nwr"}


def bbox_of(latitude: float, longitude: float, radius_km: float) -> Tuple[float, float, float, float]:
    """円(半径 radius_km)を囲む四角(南・西・北・東)。around より server の索引で速く探せる。円の外は後で除く"""
    import math

    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * max(0.01, math.cos(math.radians(latitude))))
    return (round(latitude - dlat, 6), round(longitude - dlon, 6),
            round(latitude + dlat, 6), round(longitude + dlon, 6))


def build_overpass_query(query: str, latitude: float, longitude: float, radius_km: float, category: str) -> str:
    """Overpass の問い合わせの本文(アプリと運用の診断が同じものを使う)。

    [Gate SearchUAT-S3] 軽くした: 円の around ではなく囲む四角(bbox・索引で速い)、カテゴリごとに必要な種類と値だけ、
    server の上限(timeout 10 秒・maxsize 64MB)、出力はタグと中心だけ(敷地の点の一覧を返さない)。"""
    s, w, n, e = bbox_of(latitude, longitude, radius_km)
    name_filter = f'["name"~"{overpass_regex(query)}",i]' if query and query.strip() else '["name"]'
    tags = CATEGORY_TAGS.get(category) or [""]
    kind = CATEGORY_KINDS.get(category, "nwr")
    selectors = "\n".join(f"      {kind}{tag}{name_filter}({s},{w},{n},{e});" for tag in tags)
    return f"""
    [out:json][timeout:{OVERPASS_SERVER_TIMEOUT}][maxsize:{OVERPASS_MAXSIZE}];
    (
{selectors}
    );
    out tags center {OVERPASS_OUT_LIMIT};
    """


class ProviderResults(list):
    """[Gate G11] 結果の一覧。応答しなかった提供元を unavailable に持つ(失敗を「見つからない」にしない)"""

    def __init__(self, items: List[Dict[str, Any]], unavailable: List[str], called: Optional[List[str]] = None,
                 errors: Optional[Dict[str, str]] = None, partial: Optional[List[str]] = None,
                 retry_after: Optional[Dict[str, int]] = None, cached: Optional[Dict[str, Dict[str, Any]]] = None):
        super().__init__(items)
        self.unavailable = unavailable
        # [Gate SearchUAT F06] 一部だけを返した提供元(server の処理が途中で止まった)
        self.partial = list(partial or [])
        # [Gate SearchUAT] 応答しなかった提供元の失敗の分類(blocked・rate_limited・timeout など)
        self.errors = dict(errors or {})
        # [Gate FR059-D11] 外へ送った提供元(無料の provider の使用の記録に使う)。保存した結果・待機中は送っていない
        self.called = list(called or [])
        # [Gate SearchUAT-S3] 429 の後の待機の残りの秒数(この間はアプリから送らない)
        self.retry_after = dict(retry_after or {})
        # [Gate SearchUAT-S3] 保存した結果を使った提供元: {"age_seconds": 秒, "stale": 古い結果(提供元の失敗の時だけ)}
        self.cached = dict(cached or {})


# [Gate G11] カテゴリで探す Overpass は公開の server が遅いことがあるため、待つ時間を長くする
# [Gate SearchUAT-S3] server の処理の上限(OVERPASS_SERVER_TIMEOUT 10 秒)より少しだけ長く待つ(以前は 20 秒。待ち時間を
# 延ばすだけでは server の混雑を増やすため、問い合わせを軽くして待ち時間は短くした)
OVERPASS_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


async def _overpass_guarded(query: str, latitude: Optional[float], longitude: Optional[float], radius_km: float,
                            client: httpx.AsyncClient, category: str) -> Dict[str, Any]:
    """[Gate SearchUAT-S3] 待機・保存を通して Overpass を探す。{"rows"|"error", "called", "cached", "retry_after"}"""
    from app.services import search_guard as sg

    if latitude is None or longitude is None:
        return {"rows": OverpassResults(), "called": False}
    key = sg.cache_key(query, latitude, longitude, radius_km, category)
    hit = sg.load(key)
    if hit is not None:
        return {"rows": OverpassResults(hit["rows"]), "called": False,
                "cached": {"age_seconds": hit["age_seconds"], "stale": False}}
    wait = sg.cooldown_remaining()
    if wait is not None:
        # 待機中は送らない(429 の Retry-After・406 を繰り返さない)。古い結果があれば「前の結果」として返す
        err = SearchProviderError(wait["code"], wait.get("status"), "cooldown", retry_after=wait["retry_after"])
        return {"error": err, "called": False, "stale": sg.load(key, allow_stale=True)}
    try:
        rows: List[Dict[str, Any]] = await search_overpass(query, latitude, longitude, radius_km, client=client,
                                                           category=category, raise_errors=True)
    except Exception as exc:  # noqa: BLE001
        err = classify_error(exc)
        waited = sg.note_failure(err.code, err.status, err.retry_after)
        if waited is not None:
            err.retry_after = waited
        return {"error": err, "called": True, "stale": sg.load(key, allow_stale=True)}
    sg.store(key, list(rows), bool(getattr(rows, "partial", False)))
    return {"rows": rows, "called": True}


async def search_all_providers(
    query: str,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_km: float = 5.0,
    category: str = "all",
) -> List[Dict[str, Any]]:
    """全providerを並列に呼び出し、結果を1つのリストへ結合する。
    重複は削除しない(監査指摘: duplicate候補は自動削除せず比較提示)。
    いずれかのproviderが失敗しても他のproviderの結果は返す。ここで
    絶対にダミーデータを生成しない。

    [Gate SearchUAT-S3] Overpass は待機(429 の Retry-After・403/406)と短い時間の保存(search_guard)を通す。
    保存した結果・待機中は外へ送らない(called に入れない)。提供元が失敗した時に古い保存の結果があれば、
    失敗(errors)と一緒に「前の結果」(cached.stale)として返す(新しい結果のふりをしない)。"""
    import asyncio

    names: tuple
    results: List[Any]
    async with httpx.AsyncClient(timeout=OVERPASS_TIMEOUT if category != "all" else REQUEST_TIMEOUT) as client:
        overpass_task = _overpass_guarded(query, latitude, longitude, radius_km, client, category)
        if category == "sightseeing" and latitude is not None and longitude is not None and not (query or "").strip():
            # [Gate AreaGeo] 観光は Overpass と Wikipedia の位置つきの記事を並べて探す(片方が時間切れでも候補が残る)
            names = ("overpass", "wikipedia")
            results = list(await asyncio.gather(
                overpass_task, search_wikipedia_nearby(latitude, longitude, radius_km, client=client),
                return_exceptions=True))
        elif category != "all":
            # [Gate G11] カテゴリで絞る時は、タグで絞れる OpenStreetMap(近くの場所)だけを使う
            names = ("overpass",)
            results = list(await asyncio.gather(overpass_task, return_exceptions=True))
        else:
            names = ("wikipedia", "nominatim", "overpass")
            results = list(await asyncio.gather(search_wikipedia(query, client=client),
                                                search_nominatim(query, latitude, longitude, client=client),
                                                overpass_task, return_exceptions=True))

    combined: List[Dict[str, Any]] = []
    unavailable: List[str] = []
    errors: Dict[str, str] = {}
    partial: List[str] = []
    called: List[str] = []
    retry_after: Dict[str, int] = {}
    cached: Dict[str, Dict[str, Any]] = {}
    for provider_name, r in zip(names, results):
        if provider_name == "overpass" and isinstance(r, dict):
            if r.get("called"):
                called.append("overpass")
            if "error" in r:
                err = r["error"]
                logger.warning("overpass provider failed: code=%s status=%s", err.code, err.status)
                unavailable.append("overpass")
                errors["overpass"] = err.code
                if err.retry_after:
                    retry_after["overpass"] = int(err.retry_after)
                stale = r.get("stale")
                if stale is not None:
                    cached["overpass"] = {"age_seconds": stale["age_seconds"], "stale": True}
                    combined.extend(stale["rows"])
                continue
            r = r["rows"]
            if "cached" in results[names.index("overpass")]:
                cached["overpass"] = results[names.index("overpass")]["cached"]
        elif provider_name != "overpass":
            called.append(provider_name)
        if isinstance(r, BaseException):
            logger.warning("%s provider raised: %s", provider_name, type(r).__name__)
            unavailable.append(provider_name)
            errors[provider_name] = classify_error(r).code
            continue
        if getattr(r, "partial", False):
            partial.append(provider_name)
        combined.extend(r)
    return ProviderResults(combined, unavailable, called, errors, partial, retry_after, cached)
