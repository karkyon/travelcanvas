"""[Gate AreaSpots] 名前で挙がった観光の場所(AI のおすすめ・方面の提案の代表的な場所)を Wikipedia の記事に結び付ける。

UAT(2026-11-03 20:40)で、鳥羽を選んだ方面の詳細に伊勢神宮・夫婦岩などの代表的な場所が出なかった。近くの検索は中心から
近い順の記事だけ(半径 10km・50件)で、有名な場所でも少し離れると入らない。名前で挙がった場所は、記事の名前(と転送)・
見つからなければ記事の検索の 1 件目で座標・代表画像・説明を取り、方面の中心から MAX_KM の内だけを返す(無料・キー不要)。
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional

import httpx

from app.services import place_kinds as pk

logger = logging.getLogger(__name__)

API = "https://ja.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"}
TIMEOUT = httpx.Timeout(8.0)
MAX_KM = 40.0
MAX_NAMES = 12
_PROPS = {"prop": "coordinates|pageimages|description|info", "piprop": "thumbnail", "pithumbsize": "320",
          "format": "json", "formatversion": "2"}


def _km(a: float, b: float, c: float, d: float) -> float:
    p1, p2 = math.radians(a), math.radians(c)
    dp, dl = math.radians(c - a), math.radians(d - b)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def _page_row(page: Dict[str, Any], spot: Dict[str, Any], retrieved_at: Any) -> Optional[Dict[str, Any]]:
    coords = page.get("coordinates") if isinstance(page.get("coordinates"), list) else []
    if not coords or not isinstance(coords[0], dict) or page.get("missing"):
        return None
    desc = page.get("description") if isinstance(page.get("description"), str) else None
    kind = pk.classify_wikipedia(str(page.get("title") or ""), desc)
    if kind is None:
        return None
    if kind == "other" and spot.get("kind") in pk.KINDS:
        kind = str(spot["kind"])
    thumb = (page.get("thumbnail") or {}).get("source") if isinstance(page.get("thumbnail"), dict) else None
    if thumb and not str(thumb).startswith("https://upload.wikimedia.org/"):
        thumb = None
    pageid = page.get("pageid")
    return {
        "provider": "wikipedia", "external_id": f"geo/{pageid}", "name": str(page.get("title")), "category": kind,
        "latitude": coords[0].get("lat"), "longitude": coords[0].get("lon"), "address": None,
        "raw_payload": {"pageid": pageid, "_tc": {"kind": kind, "thumbnail_url": thumb,
                                                  "description": (desc or "")[:80] or None,
                                                  "ai_note": (spot.get("note") or "")[:80] or None,
                                                  "ai_why": (spot.get("why") or "")[:80] or None,
                                                  "length": page.get("length")}},
        "source_url": f"https://ja.wikipedia.org/?curid={pageid}", "retrieved_at": retrieved_at,
    }


async def resolve(spots: List[Dict[str, Any]], latitude: float, longitude: float, pref: Optional[str] = None,
                  client: Optional[httpx.AsyncClient] = None) -> List[Dict[str, Any]]:
    """[{name, kind?, note?, why?}] → search_provider と同じ形の行(見つからない・遠い・観光でない場所は除く)"""
    from datetime import datetime, timezone

    clean: List[Dict[str, Any]] = []
    for s in spots[:MAX_NAMES]:
        name = str(s.get("name") or "").strip()[:40] if isinstance(s, dict) else ""
        if name and all(c["name"] != name for c in clean):
            clean.append({**s, "name": name})
    if not clean:
        return []
    now = datetime.now(timezone.utc)
    owns = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT)
    out: List[Dict[str, Any]] = []
    try:
        resp = await client.get(API, params={**_PROPS, "action": "query", "redirects": "1",
                                             "titles": "|".join(c["name"] for c in clean)}, headers=HEADERS)
        resp.raise_for_status()
        q = (resp.json() or {}).get("query") or {}
        alias = {m.get("from"): m.get("to") for key in ("normalized", "redirects") for m in (q.get(key) or [])
                 if isinstance(m, dict)}
        pages = {str(p.get("title")): p for p in (q.get("pages") or []) if isinstance(p, dict)}
        misses: List[Dict[str, Any]] = []
        for c in clean:
            t = c["name"]
            for _ in range(3):
                t = alias.get(t, t)
            page = pages.get(t)
            row = _page_row(page, c, now) if page else None
            if row is not None:
                out.append(row)
            elif not page or page.get("missing") or not page.get("coordinates"):
                misses.append(c)  # 記事が無い・位置の無い記事だけ探し直す(市町村の記事など観光でない記事は探さない)
        for c in misses[:6]:  # 名前が記事の名前と違う時(「夫婦岩」→「夫婦岩 (二見町)」など)は記事の検索の 1 件目
            r = await client.get(API, params={**_PROPS, "action": "query", "generator": "search",
                                              "gsrsearch": f"{c['name']} {pref or ''}".strip(), "gsrlimit": "1"},
                                 headers=HEADERS)
            if r.status_code != 200:
                continue
            for page in ((r.json() or {}).get("query") or {}).get("pages") or []:
                row = _page_row(page, c, now) if isinstance(page, dict) else None
                if row and all(o["external_id"] != row["external_id"] for o in out):
                    out.append(row)
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("spot resolve failed: %s", type(error).__name__)
    finally:
        if owns:
            await client.aclose()
    return [r for r in out if r["latitude"] is not None and r["longitude"] is not None
            and _km(latitude, longitude, float(r["latitude"]), float(r["longitude"])) <= MAX_KM]
