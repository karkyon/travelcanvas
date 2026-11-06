"""[Gate SpotLinks] 予定(スポット)の URL の確かめ。

- http/https だけ(javascript: などは断る)。前後の空白を除き、長さは 2000 文字まで
- 1 つの予定に 5 件まで。同じ URL は 1 件にまとめる
- 保存は JSONB の配列 [{"url": str, "label": str|None}](空なら NULL)
"""
from __future__ import annotations

from typing import Any, Iterable, List, Optional
from urllib.parse import urlsplit

MAX_URLS = 5
MAX_URL_LENGTH = 2000
MAX_LABEL_LENGTH = 60


def clean_url(raw: str) -> str:
    v = (raw or "").strip()
    parts = urlsplit(v)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc or any(c.isspace() for c in v):
        raise ValueError("URL は http:// か https:// で始まる形で入れてください")
    if len(v) > MAX_URL_LENGTH:
        raise ValueError("URL が長すぎます")
    return v


def to_json(items: Optional[Iterable[Any]]) -> Optional[List[dict]]:
    """入力(EventUrl の並び)を保存の形へ。空なら None"""
    out: List[dict] = []
    seen = set()
    for it in items or []:
        url = getattr(it, "url", None) if not isinstance(it, dict) else it.get("url")
        label = getattr(it, "label", None) if not isinstance(it, dict) else it.get("label")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "label": (label or "").strip()[:MAX_LABEL_LENGTH] or None})
    return out[:MAX_URLS] or None


def from_website(website: Optional[str]) -> Optional[List[dict]]:
    """場所(Place)の公式サイトから初めの 1 件を作る(形が違えば作らない)"""
    try:
        return [{"url": clean_url(website or ""), "label": None}]
    except ValueError:
        return None
