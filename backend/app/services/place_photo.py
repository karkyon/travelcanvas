"""[Gate SpotInfo] 場所の写真の候補(OpenStreetMap のタグに書かれた Wikimedia Commons のファイル、または Wikidata の画像 P18)。

場所そのものに結び付いた写真だけを使う(近くの別の写真を勝手に選ばない)。ライセンスが許すもの(license_allowed)だけを返し、
画面は作者・ライセンス・出典を出す。画像の本文はサーバーが中継する(/media-providers/images/thumb)。保存しない。
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

import httpx

from app.services.media_providers import (
    REQUEST_TIMEOUT, USER_AGENT, ImageCandidate, ProviderUnavailable, get_json,
)
from app.services.media_providers import registry
from app.services.media_providers.wikimedia import valid_id

logger = logging.getLogger(__name__)

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_QID = re.compile(r"^Q[1-9][0-9]{0,11}$")


async def _wikidata_file(qid: str, transport: Optional[httpx.AsyncBaseTransport] = None) -> Optional[str]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, transport=transport, follow_redirects=False,
                                 headers={"User-Agent": USER_AGENT}) as client:
        data: Dict[str, Any] = await get_json(client, WIKIDATA_API, {
            "action": "wbgetclaims", "entity": qid, "property": "P18", "format": "json"})
    claims = ((data or {}).get("claims") or {}).get("P18") or []
    for c in claims:
        value = (((c or {}).get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, str) and value.strip():
            return "File:" + value.strip().replace(" ", "_")
    return None


async def resolve(photo_file: Optional[str], wikidata: Optional[str],
                  transport: Optional[httpx.AsyncBaseTransport] = None) -> Optional[ImageCandidate]:
    """使える写真の候補(作者・ライセンスつき)。無い・読めない・ライセンスが許さない時は None"""
    provider = registry.image_providers().get("wikimedia_commons")
    if provider is None or not hasattr(provider, "describe"):
        return None
    file_id = photo_file if photo_file and valid_id(photo_file) else None
    try:
        if file_id is None and wikidata and _QID.match(wikidata):
            file_id = await _wikidata_file(wikidata, transport)
        if not file_id or not valid_id(file_id):
            return None
        meta = await provider.describe(file_id)
    except (ProviderUnavailable, httpx.HTTPError) as e:
        logger.info("place photo unavailable: %s", type(e).__name__)
        return None
    return meta if meta is not None and meta.importable else None
