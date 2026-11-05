"""[Gate WishPlaces] 利用者が貼った Web ページの URL から、場所の候補(名前・住所・座標)を読む。

候補箱の URL は取りに行かない(FC-019)が、ここは利用者が「読む」を押した時だけ 1 ページ取りに行く。守ること:
- http/https の 80・443 番だけ。解決した全アドレスが公開の時だけ接続し、確かめたアドレスへ直接つなぐ(DNS の差し替え対策)
- 転送は 3 回まで、毎回確かめ直す。HTML だけ、1MB まで、5 秒まで。Cookie・認証情報は送らない
- ページの文字はデータとして扱い、AI へ渡さない。保存しない。読めない時は取れたように見せない
"""
from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlsplit

import httpx

MAX_BYTES = 1_000_000
MAX_REDIRECTS = 3
TIMEOUT = 5.0
USER_AGENT = "TravelCanvas-PlaceReader/1.0"
_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"""([a-zA-Z:_-]+)\s*=\s*("[^"]*"|'[^']*')""")
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_LD = re.compile(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", re.I | re.S)
_PLACE_TYPES = ("place", "restaurant", "hotel", "lodging", "store", "museum", "attraction", "business", "foodestablishment",  # noqa: E501
                "park", "cafe", "bar", "landmark")

transport: Optional[httpx.BaseTransport] = None  # 試験だけが差し替える


class PageUnavailable(Exception):
    """読めない。message は利用者に見せる文。"""


@dataclass
class PagePlace:
    url: str
    name: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    words: List[str] = field(default_factory=list)


def public_addresses(host: str, port: int) -> List[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise PageUnavailable("このページのサーバーが見つかりませんでした")
    found = sorted({str(i[4][0]) for i in infos})
    if not found or any(not ipaddress.ip_address(a.split("%")[0]).is_global for a in found):
        raise PageUnavailable("この URL は読めません(公開のページだけ読めます)")
    return found


def check_url(url: str) -> "tuple[str, int, str]":
    parts = urlsplit(url)
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if parts.scheme not in ("http", "https") or not host or port not in (80, 443) or parts.username or parts.password:
        raise PageUnavailable("この URL は読めません(公開のページだけ読めます)")
    return host, port, public_addresses(host, port)[0]


def _fetch(url: str) -> "tuple[str, str]":
    current = url
    with httpx.Client(timeout=TIMEOUT, follow_redirects=False, transport=transport, trust_env=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            host, port, address = check_url(current)
            parts = urlsplit(current)
            ip = f"[{address}]" if ":" in address else address
            target = parts._replace(netloc=f"{ip}:{port}").geturl()
            request = client.build_request("GET", target, headers={"Host": parts.netloc, "User-Agent": USER_AGENT,
                                                                   "Accept": "text/html"},
                                           extensions={"sni_hostname": host})
            res = client.send(request, stream=True)
            try:
                if res.status_code in (301, 302, 303, 307, 308):
                    location = res.headers.get("location")
                    if not location:
                        raise PageUnavailable("このページを読めませんでした")
                    current = urljoin(current, location)
                    continue
                if res.status_code >= 400:
                    raise PageUnavailable("このページを読めませんでした(ログインが要るか、機械からの読み取りを断っています)")
                if "html" not in res.headers.get("content-type", "").lower():
                    raise PageUnavailable("Web ページではないため読めません")
                body = b""
                for chunk in res.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                return body.decode(res.encoding or "utf-8", errors="replace"), current
            finally:
                res.close()
    raise PageUnavailable("転送が多すぎるため読めませんでした")


def _clean(text: Any, limit: int = 200) -> Optional[str]:
    if not isinstance(text, str):
        return None
    value = re.sub(r"\s+", " ", html.unescape(text)).strip()
    return value[:limit] or None


def _float(value: Any, low: float, high: float) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def _ld_items(raw: str) -> List[Dict[str, Any]]:
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    stack: List[Any] = [data]
    out: List[Dict[str, Any]] = []
    while stack and len(out) < 50:
        item = stack.pop()
        if isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, dict):
            out.append(item)
            if isinstance(item.get("@graph"), list):
                stack.extend(item["@graph"])
    return out


def _address(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        keys = ("postalCode", "addressRegion", "addressLocality", "streetAddress", "addressCountry")
        return _clean(" ".join(str(value[k]) for k in keys[:4] if isinstance(value.get(k), str)))
    return _clean(value)


def parse_page(page: str, url: str) -> PagePlace:
    out = PagePlace(url=url)
    meta: Dict[str, str] = {}
    for tag in _META.findall(page):
        attrs = {k.lower(): v[1:-1] for k, v in _ATTR.findall(tag)}
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        if key and "content" in attrs:
            meta.setdefault(key, attrs["content"])
    for raw in _LD.findall(page):
        for item in _ld_items(raw):
            kind = item.get("@type")
            kinds = " ".join(kind) if isinstance(kind, list) else str(kind or "")
            if not any(t in kinds.lower() for t in _PLACE_TYPES):
                continue
            out.name = out.name or _clean(item.get("name"))
            out.description = out.description or _clean(item.get("description"), 500)
            out.address = out.address or _address(item.get("address"))
            geo = item.get("geo")
            if isinstance(geo, dict) and out.latitude is None:
                out.latitude = _float(geo.get("latitude"), -90, 90)
                out.longitude = _float(geo.get("longitude"), -180, 180)
    title = _TITLE.search(page)
    out.name = out.name or _clean(meta.get("og:title")) or _clean(title.group(1) if title else None)
    out.description = out.description or _clean(meta.get("og:description") or meta.get("description"), 500)
    if out.latitude is None:
        out.latitude = _float(meta.get("place:location:latitude") or meta.get("og:latitude"), -90, 90)
        out.longitude = _float(meta.get("place:location:longitude") or meta.get("og:longitude"), -180, 180)
    if out.latitude is None or out.longitude is None:
        out.latitude = out.longitude = None
    return out


def read_page(url: str) -> PagePlace:
    try:
        page, final = _fetch(url)
    except httpx.HTTPError:
        raise PageUnavailable("このページを読めませんでした(時間切れか、接続を断られました)")
    return parse_page(page, final)


def place_lines(text: str, limit: int = 8) -> List[str]:
    """画像の文字から場所の名前らしい行を拾う(押すと探す言葉にする)。"""
    out: List[str] = []
    for line in text.splitlines():
        clean = re.sub(r"\s+", " ", line).strip(" #@・|/-_=:;.,、。「」『』[]()")
        letters = re.findall(r"[A-Za-z぀-ヿ㐀-鿿가-힣]", clean)
        if not 2 <= len(clean) <= 40 or len(letters) < 2 or len(letters) / len(clean.replace(" ", "")) < 0.7:
            continue
        if re.search(r"https?:|www\.|いいね|フォロー|コメント|シェア|保存|返信|投稿|ありがとう|follow|like|share", clean, re.I):
            continue
        if clean not in out:
            out.append(clean)
        if len(out) >= limit:
            break
    return out
