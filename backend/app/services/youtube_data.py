"""[Gate SpotFromMedia] YouTube の動画の題名・説明欄(目次)を YouTube Data API v3 で読む(運用コンソールで鍵を登録した時だけ)。

videos.list(part=snippet)は 1 回 1 単位(1 日 10,000 単位まで無料)。読むのは題名・説明欄・タグだけで、保存しない。
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlsplit

import httpx
from sqlalchemy.orm import Session

from app.services.search_provider import HEADERS, REQUEST_TIMEOUT

logger = logging.getLogger(__name__)

SLOT = "youtube_api_key"
ENDPOINT = "https://www.googleapis.com/youtube/v3/videos"
transport: Optional[httpx.BaseTransport] = None  # 試験で差し替える


def video_id(url: str) -> Optional[str]:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    vid: Optional[str] = None
    if host == "youtu.be":
        vid = parts.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        if parts.path == "/watch":
            vid = (parse_qs(parts.query).get("v") or [""])[0] or None
        else:
            m = re.match(r"^/(?:shorts|live|embed)/([^/?#]+)", parts.path)
            vid = m.group(1) if m else None
    return vid if vid and re.fullmatch(r"[A-Za-z0-9_-]{6,20}", vid) else None


def api_key(db: Session) -> Optional[str]:
    from app.services import provider_secrets as ps

    try:
        return ps.resolve(db, SLOT)
    except Exception:  # noqa: BLE001 - 未登録なら読まない
        return None


def fetch(key: str, vid: str) -> Optional[Dict[str, Any]]:
    """題名・説明欄・タグ・チャンネル名。見つからない・失敗は None(理由はログだけ。鍵は出さない)"""
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT, transport=transport) as client:
            resp = client.get(ENDPOINT, params={"part": "snippet", "id": vid, "key": key}, headers=HEADERS)
        if resp.status_code != 200:
            logger.warning("youtube videos.list failed: status=%s", resp.status_code)
            return None
        items = resp.json().get("items") or []
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("youtube videos.list failed: %s", type(exc).__name__)
        return None
    if not items:
        return None
    sn = items[0].get("snippet") or {}
    return {"title": str(sn.get("title") or "")[:300], "description": str(sn.get("description") or "")[:8000],
            "tags": [str(t)[:50] for t in (sn.get("tags") or [])][:30],
            "channel": str(sn.get("channelTitle") or "")[:200]}
