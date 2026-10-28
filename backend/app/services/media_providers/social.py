"""[Gate G11] SNS の投稿 URL の確認(公式の oEmbed だけ。仕様 §2.4・§3.3・§5.2、UIX-M09)。

- YouTube・TikTok は鍵の要らない公式の oEmbed。Instagram は鍵(SOCIAL_INSTAGRAM_OEMBED_TOKEN)がある時だけ(無ければ unavailable)
- 投稿の URL へは直接つながない(決まった oEmbed の endpoint に URL を渡すだけ。SSRF を起こさない)。ログインの壁を越えない
- 題名・作者は表示するだけ(信用しないデータ。AI に命令として渡さない)。画像・サムネイルは取り込まない・表示しない(権利が不明)
- 場所の候補は題名の中の地名らしい語を、既存の検索の provider(Nominatim)で照合したもの。確からしさは「低」「中」だけ
"""
from __future__ import annotations

import re
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlsplit

import httpx

from . import REQUEST_TIMEOUT, USER_AGENT, ProviderUnavailable, SocialPreview, get_json, now, plain_text

PLATFORMS = {
    "youtube": ({"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}, "https://www.youtube.com/oembed"),
    "tiktok": ({"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com"}, "https://www.tiktok.com/oembed"),
    "instagram": ({"instagram.com", "www.instagram.com"}, "https://graph.facebook.com/v19.0/instagram_oembed"),
}
PROVIDER_OF = {"youtube": "youtube_oembed", "tiktok": "tiktok_oembed", "instagram": "instagram_oembed"}

_PLACE_SUFFIX = re.compile(
    # 語の本体は漢字・カタカナ・英数字だけ(ひらがなの助詞「の」「と」などで区切る。形態素の解析はしない)
    r"([一-龯々ァ-ヶーA-Za-z0-9]{1,20}(?:寺|神社|大社|宮|城|駅|港|空港|公園|庭園|市場|通り|商店街|橋|山|岳|川|湖|滝|温泉|"
    r"海岸|浜|島|岬|美術館|博物館|水族館|動物園|タワー|横丁|町|村|市))")
_HASHTAG = re.compile(r"#([^\s#]{2,30})")


def platform_of(url: str) -> Optional[str]:
    host = (urlsplit(url).hostname or "").lower()
    for name, (hosts, _endpoint) in PLATFORMS.items():
        if host in hosts:
            return name
    return None


def place_words(text: Optional[str], limit: int = 3) -> List[str]:
    """題名から地名らしい語(場所の接尾語で終わる語・ハッシュタグ)。重複を除き、出た順に最大 limit 個"""
    if not text:
        return []
    found: List[str] = []
    for m in _PLACE_SUFFIX.finditer(text):
        found.append(m.group(1))
    for m in _HASHTAG.finditer(text):
        word = m.group(1)
        if _PLACE_SUFFIX.fullmatch(word):
            found.append(word)
    out: List[str] = []
    for w in found:
        if w not in out:
            out.append(w)
    return out[:limit]


Geocode = Callable[[str], Awaitable[List[Dict[str, Any]]]]


async def _default_geocode(word: str) -> List[Dict[str, Any]]:
    from app.services.search_provider import search_nominatim

    return await search_nominatim(word, None, None)


class OEmbedSocialProvider:
    def __init__(self, enabled: List[str], instagram_token: str = "",
                 transport: Optional[httpx.AsyncBaseTransport] = None, geocode: Optional[Geocode] = None):
        self.enabled = set(enabled)
        self.instagram_token = instagram_token
        self._transport = transport
        self._geocode = geocode or _default_geocode

    async def preview(self, url: str) -> SocialPreview:
        platform = platform_of(url)
        if platform is None:
            return SocialPreview(platform=None, status="unsupported", url=url, reason="unsupported_platform")
        if PROVIDER_OF[platform] not in self.enabled:
            return SocialPreview(platform=platform, status="disabled", url=url, reason="provider_disabled")
        _hosts, endpoint = PLATFORMS[platform]
        params: Dict[str, Any] = {"url": url, "format": "json"}
        if platform == "instagram":
            if not self.instagram_token:
                return SocialPreview(platform=platform, status="unavailable", url=url, reason="token_required")
            params = {"url": url, "access_token": self.instagram_token, "omitscript": "true"}
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, transport=self._transport, follow_redirects=False,
                                         headers={"User-Agent": USER_AGENT}) as client:
                data = await get_json(client, endpoint, params)
        except ProviderUnavailable as e:
            return SocialPreview(platform=platform, status="unavailable", url=url, reason=e.code)
        except httpx.HTTPError:
            return SocialPreview(platform=platform, status="unavailable", url=url, reason="network")
        if not isinstance(data, dict):
            return SocialPreview(platform=platform, status="unavailable", url=url, reason="bad_response")
        title = plain_text(data.get("title"), 300)
        author = plain_text(data.get("author_name"), 100)
        suggestions: List[Dict[str, Any]] = []
        for word in place_words(title):
            try:
                hits = await self._geocode(word)
            except Exception:  # noqa: BLE001 - 照合できなくても確認のカードは出す
                hits = []
            for h in hits[:1]:
                name = str(h.get("name") or "")
                suggestions.append({
                    "word": word, "name": name or word, "address": h.get("address"),
                    "latitude": h.get("latitude"), "longitude": h.get("longitude"), "provider": h.get("provider"),
                    "confidence": "medium" if name and (word in name or name in (title or "")) else "low",
                })
            if not hits:
                suggestions.append({"word": word, "name": word, "address": None, "latitude": None, "longitude": None,
                                    "provider": None, "confidence": "low"})
        return SocialPreview(platform=platform, status="ok", url=url, title=title, author=author, retrieved_at=now(),
                             place_suggestions=suggestions)
