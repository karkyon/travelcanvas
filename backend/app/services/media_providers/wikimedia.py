"""[Gate G11] Wikimedia Commons の画像の provider(API キー不要。仕様 §5.2)。

利用の条件: 各ファイルのライセンスに従い、作者・ライセンス・出典を表示する。取り込めるのは license_allowed のものだけ。
画像の本文は upload.wikimedia.org からだけ取る(Commons の API が返した URL。利用者の URL は使わない)。redirect は追わない。
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import httpx

from . import (
    REQUEST_TIMEOUT, USER_AGENT, FetchedImage, ImageCandidate, ProviderUnavailable, get_json, license_allowed, now,
    plain_text, read_limited,
)

API = "https://commons.wikimedia.org/w/api.php"
IMAGE_HOSTS = frozenset({"upload.wikimedia.org"})
IMAGE_MIMES = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
_FILE_ID = re.compile(r"^File:[^\x00-\x1f|#<>\[\]{}]{1,240}$")


def valid_id(provider_id: str) -> bool:
    return bool(_FILE_ID.match(provider_id or ""))


def _meta(ext: Dict[str, Any], key: str) -> Optional[str]:
    v = (ext.get(key) or {}).get("value")
    return plain_text(v) if v is not None else None


def _candidate(page: Dict[str, Any]) -> Optional[ImageCandidate]:
    info = (page.get("imageinfo") or [{}])[0]
    title = page.get("title")
    if not title or not valid_id(title):
        return None
    mime = info.get("mime")
    if mime not in IMAGE_MIMES:
        return None
    ext = info.get("extmetadata") or {}
    lic = _meta(ext, "LicenseShortName")
    return ImageCandidate(
        provider="wikimedia_commons", provider_id=title,
        title=_meta(ext, "ObjectName") or title[5:].rsplit(".", 1)[0],
        author=_meta(ext, "Artist"), license=lic, license_url=_meta(ext, "LicenseUrl"),
        attribution=_meta(ext, "Attribution") or _meta(ext, "Credit"),
        source_page_url=info.get("descriptionurl"), width=info.get("width"), height=info.get("height"), mime=mime,
        retrieved_at=now(), importable=license_allowed(lic),
    )


class WikimediaCommonsProvider:
    name = "wikimedia_commons"

    def __init__(self, transport: Optional[httpx.AsyncBaseTransport] = None):
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=REQUEST_TIMEOUT, transport=self._transport, follow_redirects=False,
                                 headers={"User-Agent": USER_AGENT})

    async def search(self, query: Optional[str], lat: Optional[float], lng: Optional[float],
                     limit: int = 12) -> List[ImageCandidate]:
        limit = max(1, min(limit, 30))
        params: Dict[str, Any] = {
            "action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata",
            "iiurlwidth": "640",
        }
        if lat is not None and lng is not None:
            params.update({"generator": "geosearch", "ggscoord": f"{lat}|{lng}", "ggsradius": "3000",
                           "ggsnamespace": "6", "ggslimit": str(limit)})
        elif query and query.strip():
            params.update({"generator": "search", "gsrsearch": f"{query.strip()[:200]} filetype:bitmap",
                           "gsrnamespace": "6", "gsrlimit": str(limit)})
        else:
            return []
        async with self._client() as client:
            data = await get_json(client, API, params)
        pages = ((data or {}).get("query") or {}).get("pages") or {}
        rows = sorted(pages.values(), key=lambda p: p.get("index", 0))
        return [c for c in (_candidate(p) for p in rows) if c is not None]

    async def _info(self, client: httpx.AsyncClient, provider_id: str, width: int) -> Dict[str, Any]:
        if not valid_id(provider_id):
            raise ProviderUnavailable("invalid_id")
        data = await get_json(client, API, {
            "action": "query", "format": "json", "titles": provider_id, "prop": "imageinfo",
            "iiprop": "url|mime|size|extmetadata", "iiurlwidth": str(width),
        })
        pages = list((((data or {}).get("query") or {}).get("pages") or {}).values())
        if not pages or "missing" in pages[0]:
            raise ProviderUnavailable("not_found")
        return pages[0]

    async def _download(self, client: httpx.AsyncClient, url: Optional[str], max_bytes: int) -> bytes:
        parts = urlsplit(url or "")
        if parts.scheme != "https" or (parts.hostname or "") not in IMAGE_HOSTS:
            raise ProviderUnavailable("bad_host")
        async with client.stream("GET", url or "") as resp:
            if resp.status_code != 200:
                raise ProviderUnavailable("bad_status")
            return await read_limited(resp, max_bytes)

    async def _get(self, provider_id: str, width: int, max_bytes: int, need_license: bool) -> FetchedImage:
        async with self._client() as client:
            page = await self._info(client, provider_id, width)
            meta = _candidate(page)
            if meta is None:
                raise ProviderUnavailable("unsupported_type")
            if need_license and not meta.importable:
                raise ProviderUnavailable("license_not_allowed")
            info = (page.get("imageinfo") or [{}])[0]
            content = await self._download(client, info.get("thumburl") or info.get("url"), max_bytes)
        return FetchedImage(content=content, mime=meta.mime or "", meta=meta)

    async def thumbnail(self, provider_id: str, max_bytes: int) -> FetchedImage:
        return await self._get(provider_id, 480, max_bytes, need_license=False)

    async def fetch(self, provider_id: str, max_bytes: int) -> FetchedImage:
        return await self._get(provider_id, 1600, max_bytes, need_license=True)
