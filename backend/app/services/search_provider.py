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
from typing import Any, Dict, List, Optional

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
    """[Gate SearchUAT] 提供元が結果を返さなかった(0件ではない)。code は ERROR_CODES、status は HTTP の状態。"""

    def __init__(self, code: str, status: Optional[int] = None, detail: str = ""):
        super().__init__(f"{code} status={status} {detail}".strip())
        self.code, self.status, self.detail = code, status, detail


def classify_error(exc: BaseException) -> SearchProviderError:
    """例外を分類する(利用者の入力・URL は含めない)。"""
    if isinstance(exc, SearchProviderError):
        return exc
    if isinstance(exc, httpx.TimeoutException):
        return SearchProviderError("timeout", None, type(exc).__name__)
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        kind = ("rate_limited" if code == 429 else "blocked" if code in (400, 401, 403, 406)
                else "provider_timeout" if code == 504 else "server_error")
        return SearchProviderError(kind, code)
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
    "sightseeing": ['["tourism"~"^(attraction|museum|gallery|artwork)$"]', '["historic"]'],
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

    from app.core.config import settings

    url = (getattr(settings, "OVERPASS_URL", "") or "").strip() or "https://overpass-api.de/api/interpreter"
    overpass_query = build_overpass_query(query, latitude, longitude, radius_km, category)

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    try:
        resp = await client.post(url, data={"data": overpass_query},
                                 headers={**HEADERS, "Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()
        # [Gate SearchUAT F06] 正しい応答は elements の配列を持つ。elements: [] だけが「該当なし」
        if not isinstance(data, dict) or not isinstance(data.get("elements"), list):
            raise SearchProviderError("unreadable", resp.status_code, "no elements array")
        elements = data["elements"]
        remark = str(data.get("remark") or "").lower()
        if remark and not elements:
            # 200 でも、server の時間切れ・メモリ不足の時は remark だけで要素が無い(「該当なし」ではない)。
            # 本文はログに出さず、決まった分類にする
            kind = "provider_timeout" if ("timed out" in remark or "runtime error" in remark) else "server_error"
            raise SearchProviderError(kind, resp.status_code, "remark")
        retrieved_at = _now()
        results = OverpassResults()
        # remark つきで要素がある = 途中で止まった一部だけの結果(完全な結果と区別する)
        results.partial = bool(remark)
        for element in elements:
            if not isinstance(element, dict):
                continue
            tags = element.get("tags", {})
            name = tags.get("name")
            if not name:
                continue
            center = element.get("center") or {}
            kind = element.get("type") or "node"
            results.append({
                "provider": "overpass",
                "external_id": str(element.get("id")) if kind == "node" else f"{kind}/{element.get('id')}",
                "name": name,
                "category": (tags.get("amenity") or tags.get("tourism") or tags.get("shop") or tags.get("leisure")
                             or tags.get("historic")),
                "latitude": element.get("lat", center.get("lat")),
                "longitude": element.get("lon", center.get("lon")),
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


def build_overpass_query(query: str, latitude: float, longitude: float, radius_km: float, category: str) -> str:
    """Overpass の問い合わせの本文(アプリと運用の診断が同じものを使う)。"""
    radius_m = int(radius_km * 1000)
    name_filter = f'["name"~"{overpass_regex(query)}",i]' if query and query.strip() else '["name"]'
    tags = CATEGORY_TAGS.get(category) or [""]
    selectors = "\n".join(f"      nwr{tag}{name_filter}(around:{radius_m},{latitude},{longitude});" for tag in tags)
    return f"""
    [out:json][timeout:15];
    (
{selectors}
    );
    out center 30;
    """


class ProviderResults(list):
    """[Gate G11] 結果の一覧。応答しなかった提供元を unavailable に持つ(失敗を「見つからない」にしない)"""

    def __init__(self, items: List[Dict[str, Any]], unavailable: List[str], called: Optional[List[str]] = None,
                 errors: Optional[Dict[str, str]] = None, partial: Optional[List[str]] = None):
        super().__init__(items)
        self.unavailable = unavailable
        # [Gate SearchUAT F06] 一部だけを返した提供元(server の処理が途中で止まった)
        self.partial = list(partial or [])
        # [Gate SearchUAT] 応答しなかった提供元の失敗の分類(blocked・rate_limited・timeout など)
        self.errors = dict(errors or {})
        # [Gate FR059-D11] 外へ送った提供元(無料の provider の使用の記録に使う)
        self.called = list(called or [])


# [Gate G11] カテゴリで探す Overpass は公開の server が遅いことがあるため、待つ時間を長くする
OVERPASS_TIMEOUT = httpx.Timeout(20.0)


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
    絶対にダミーデータを生成しない。"""
    import asyncio

    async with httpx.AsyncClient(timeout=OVERPASS_TIMEOUT if category != "all" else REQUEST_TIMEOUT) as client:
        results: List[Any]
        if category != "all":
            # [Gate G11] カテゴリで絞る時は、タグで絞れる OpenStreetMap(近くの場所)だけを使う
            names: tuple = ("overpass",)
            results = list(await asyncio.gather(
                search_overpass(query, latitude, longitude, radius_km, client=client, category=category,
                                raise_errors=True),
                return_exceptions=True))
        else:
            names = ("wikipedia", "nominatim", "overpass")
            wiki_task = search_wikipedia(query, client=client)
            nominatim_task = search_nominatim(query, latitude, longitude, client=client)
            overpass_task = search_overpass(query, latitude, longitude, radius_km, client=client)
            results = list(await asyncio.gather(wiki_task, nominatim_task, overpass_task, return_exceptions=True))

    combined: List[Dict[str, Any]] = []
    unavailable: List[str] = []
    errors: Dict[str, str] = {}
    partial: List[str] = []
    for provider_name, r in zip(names, results):
        if isinstance(r, BaseException):
            logger.warning("%s provider raised: %s", provider_name, type(r).__name__)
            unavailable.append(provider_name)
            errors[provider_name] = classify_error(r).code
            continue
        if getattr(r, "partial", False):
            partial.append(provider_name)
        combined.extend(r)
    called = [n for n in names if not (n == "overpass" and (latitude is None or longitude is None))]
    return ProviderResults(combined, unavailable, called, errors, partial)
