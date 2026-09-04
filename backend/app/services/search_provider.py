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
        resp = await client.get(url, params=params)
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
        logger.warning("Wikipedia search failed for %r: %s", query, exc)
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
            url, params=params, headers={"User-Agent": "TravelCanvas/1.0 (search adapter)"}
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
        logger.warning("Nominatim search failed for %r: %s", query, exc)
        return []
    finally:
        if owns_client:
            await client.aclose()


async def search_overpass(
    query: str,
    latitude: Optional[float],
    longitude: Optional[float],
    radius_km: float = 5.0,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """Overpass API(OpenStreetMap POI検索、APIキー不要)。座標が無ければ
    範囲を絞れないため空リストを返す(失敗ではなく仕様上の制約)。"""
    if latitude is None or longitude is None:
        return []

    url = "https://overpass-api.de/api/interpreter"
    radius_m = int(radius_km * 1000)
    overpass_query = f"""
    [out:json][timeout:8];
    (
      node["name"~"{query}",i](around:{radius_m},{latitude},{longitude});
    );
    out body 10;
    """

    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    try:
        resp = await client.post(url, data={"data": overpass_query})
        resp.raise_for_status()
        data = resp.json()
        retrieved_at = _now()
        results = []
        for element in data.get("elements", []):
            tags = element.get("tags", {})
            name = tags.get("name")
            if not name:
                continue
            results.append({
                "provider": "overpass",
                "external_id": str(element.get("id")),
                "name": name,
                "category": tags.get("amenity") or tags.get("tourism") or tags.get("shop"),
                "latitude": element.get("lat"),
                "longitude": element.get("lon"),
                "address": tags.get("addr:full") or None,
                "raw_payload": element,
                "source_url": f"https://www.openstreetmap.org/node/{element.get('id')}",
                "retrieved_at": retrieved_at,
            })
        return results
    except Exception as exc:  # noqa: BLE001
        logger.warning("Overpass search failed for %r: %s", query, exc)
        return []
    finally:
        if owns_client:
            await client.aclose()


async def search_all_providers(
    query: str,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_km: float = 5.0,
) -> List[Dict[str, Any]]:
    """全providerを並列に呼び出し、結果を1つのリストへ結合する。
    重複は削除しない(監査指摘: duplicate候補は自動削除せず比較提示)。
    いずれかのproviderが失敗しても他のproviderの結果は返す。ここで
    絶対にダミーデータを生成しない。"""
    import asyncio

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        wiki_task = search_wikipedia(query, client=client)
        nominatim_task = search_nominatim(query, latitude, longitude, client=client)
        overpass_task = search_overpass(query, latitude, longitude, radius_km, client=client)
        results = await asyncio.gather(wiki_task, nominatim_task, overpass_task, return_exceptions=True)

    combined: List[Dict[str, Any]] = []
    for provider_name, r in zip(("wikipedia", "nominatim", "overpass"), results):
        if isinstance(r, Exception):
            logger.warning("%s provider raised: %s", provider_name, r)
            continue
        combined.extend(r)
    return combined
