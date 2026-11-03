"""[Gate AreaImages] 比べる方面の代表画像(Wikipedia の記事の代表画像。キー不要・無料)。

画像は pageimages の既定(自由なライセンスの画像だけ)で、配信は upload.wikimedia.org。画面は画像に記事への
リンク(出典)を付ける。地名は保存しない(この処理の中だけ。結果は 24 時間メモリに置く)。
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

API = "https://ja.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"}
TIMEOUT = httpx.Timeout(6.0)
TTL_S = 24 * 3600
MAX_NAMES = 10
_cache: Dict[str, Tuple[float, Optional[Dict[str, str]]]] = {}


def _variants(name: str) -> List[str]:
    n = name.strip()
    out = [n]
    if not n.endswith(("市", "町", "村", "島", "温泉", "山", "湖", "宮", "寺", "城")):
        out.append(n + "市")
    return out


async def lookup(names: List[str], client: Optional[httpx.AsyncClient] = None) -> Tuple[Dict[str, Any], bool]:
    """{名前: {url, page_url, title} or None}, 外へ送ったか"""
    now = time.monotonic()
    result: Dict[str, Any] = {}
    todo: List[str] = []
    for n in names[:MAX_NAMES]:
        hit = _cache.get(n)
        if hit and now - hit[0] < TTL_S:
            result[n] = hit[1]
        else:
            todo.append(n)
    if not todo:
        return result, False
    titles = list(dict.fromkeys(v for n in todo for v in _variants(n)))
    params = {"action": "query", "titles": "|".join(titles), "prop": "pageimages", "piprop": "thumbnail",
              "pithumbsize": "480", "redirects": "1", "format": "json", "formatversion": "2"}
    owns = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT)
    try:
        resp = await client.get(API, params=params, headers=HEADERS)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        for n in todo:
            result[n] = None  # 失敗は保存しない(次の表示でもう一度)
        return result, True
    finally:
        if owns:
            await client.aclose()
    q = data.get("query") if isinstance(data, dict) else None
    q = q if isinstance(q, dict) else {}
    alias: Dict[str, str] = {}
    for key in ("normalized", "redirects"):
        for m in q.get(key) or []:
            if isinstance(m, dict) and m.get("from") and m.get("to"):
                alias[str(m["from"])] = str(m["to"])
    pages = {str(p.get("title")): p for p in (q.get("pages") or []) if isinstance(p, dict)}

    def final(t: str) -> str:
        seen = 0
        while t in alias and seen < 3:
            t, seen = alias[t], seen + 1
        return t

    for n in todo:
        found = None
        for v in _variants(n):
            page = pages.get(final(v))
            thumb = (page or {}).get("thumbnail") if page else None
            src = thumb.get("source") if isinstance(thumb, dict) else None
            if page and not page.get("missing") and src and str(src).startswith("https://upload.wikimedia.org/"):
                found = {"url": str(src), "title": str(page.get("title")),
                         "page_url": f"https://ja.wikipedia.org/?curid={page.get('pageid')}"}
                break
        _cache[n] = (now, found)
        result[n] = found
    return result, True
