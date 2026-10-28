"""[Gate G11] 外部の画像・SNS の provider の interface(docs/ux/G11_UIUX全範囲_実装仕様.md §5)。

設計の規則(search_provider.py と同じ):
- 外部の API は必ずこの interface を通す。設定(IMAGE_PROVIDERS・SOCIAL_PROVIDERS)を空にすると止まり、画面はその項目を出さない
- 取得に失敗したら値を作らない(空の一覧・ProviderUnavailable)。利用者が渡した URL へ直接つながない
  (画像は provider_id から provider が URL を作り、決まった host だけへつなぐ。SNS は決まった公式の oEmbed の endpoint だけ)
- 応答の大きさに上限を置く(画像は DOCUMENT_MAX_UPLOAD_SIZE_BYTES、JSON は MAX_JSON_BYTES)。redirect は追わない
- 外部から取った本文は信用しないデータ。AI に命令として渡さない。非公開の情報を付けて外部へ送らない
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol

import httpx

REQUEST_TIMEOUT = httpx.Timeout(8.0)
MAX_JSON_BYTES = 1024 * 1024
USER_AGENT = "TravelCanvas/1.0 (+https://github.com/karkyon/travelcanvas)"


class ProviderUnavailable(Exception):
    """provider が止めてある・応答が無い・形が違う・上限を超えた(理由は code)"""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


def now() -> datetime:
    return datetime.now(timezone.utc)


# ============================================================ ライセンス(仕様 §5.3)

_ALLOWED = (
    re.compile(r"^cc0( 1\.0)?$"),
    re.compile(r"^public domain$"),
    re.compile(r"^pd([- ].*)?$"),
    re.compile(r"^cc[- ]by( \d(\.\d)?)?$"),
    re.compile(r"^cc[- ]by[- ]sa( \d(\.\d)?)?$"),
)


def license_allowed(name: Optional[str]) -> bool:
    """取り込める: CC0・Public domain・CC BY・CC BY-SA(各版)。NC・ND・不明・その他は取り込めない"""
    if not name:
        return False
    n = re.sub(r"\s+", " ", name.strip().lower())
    if "nc" in re.split(r"[- ]", n) or "nd" in re.split(r"[- ]", n):
        return False
    return any(p.match(n) for p in _ALLOWED)


_TAG = re.compile(r"<[^>]+>")


def plain_text(value: Any, limit: int = 300) -> Optional[str]:
    """HTML を除いた文字(外部の本文は表示するだけ。上限で切る)"""
    if value is None:
        return None
    text = _TAG.sub("", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] or None


# ============================================================ 画像

@dataclass
class ImageCandidate:
    provider: str
    provider_id: str
    title: Optional[str]
    author: Optional[str]
    license: Optional[str]
    license_url: Optional[str]
    attribution: Optional[str]
    source_page_url: Optional[str]
    width: Optional[int]
    height: Optional[int]
    mime: Optional[str]
    retrieved_at: datetime
    importable: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = dict(self.__dict__)
        d["retrieved_at"] = self.retrieved_at.isoformat()
        return d


@dataclass
class FetchedImage:
    content: bytes
    mime: str
    meta: ImageCandidate


class ImageProvider(Protocol):
    name: str

    async def search(self, query: Optional[str], lat: Optional[float], lng: Optional[float],
                     limit: int) -> List[ImageCandidate]: ...

    async def thumbnail(self, provider_id: str, max_bytes: int) -> FetchedImage: ...

    async def fetch(self, provider_id: str, max_bytes: int) -> FetchedImage: ...


# ============================================================ SNS

@dataclass
class SocialPreview:
    platform: Optional[str]
    status: str  # ok / unsupported / unavailable / disabled
    url: Optional[str]
    title: Optional[str] = None
    author: Optional[str] = None
    retrieved_at: Optional[datetime] = None
    place_suggestions: List[Dict[str, Any]] = field(default_factory=list)
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = dict(self.__dict__)
        d["retrieved_at"] = self.retrieved_at.isoformat() if self.retrieved_at else None
        d["fallback"] = "url_and_note" if self.status != "ok" else None
        return d


async def read_limited(resp: httpx.Response, max_bytes: int) -> bytes:
    """応答の本文を上限まで読む(超えたら ProviderUnavailable)"""
    length = resp.headers.get("content-length")
    if length and length.isdigit() and int(length) > max_bytes:
        raise ProviderUnavailable("too_large")
    out = bytearray()
    async for chunk in resp.aiter_bytes():
        out.extend(chunk)
        if len(out) > max_bytes:
            raise ProviderUnavailable("too_large")
    return bytes(out)


async def get_json(client: httpx.AsyncClient, url: str, params: Dict[str, Any]) -> Any:
    import json

    async with client.stream("GET", url, params=params, headers={"User-Agent": USER_AGENT}) as resp:
        if resp.status_code in (401, 403, 404, 410):
            raise ProviderUnavailable("not_found" if resp.status_code in (404, 410) else "forbidden")
        if resp.status_code == 429:
            raise ProviderUnavailable("rate_limited")
        if resp.status_code != 200:
            raise ProviderUnavailable("bad_status")
        body = await read_limited(resp, MAX_JSON_BYTES)
    try:
        return json.loads(body)
    except ValueError:
        raise ProviderUnavailable("bad_response")
