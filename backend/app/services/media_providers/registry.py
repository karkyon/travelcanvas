"""[Gate G11] 使う provider(設定の IMAGE_PROVIDERS・SOCIAL_PROVIDERS。空なら止まる)。試験は set_*_for_testing で差し替える。"""
from __future__ import annotations

from typing import Dict, List, Optional

from app.core.config import settings

from . import ImageProvider
from .social import OEmbedSocialProvider
from .wikimedia import WikimediaCommonsProvider

_image_override: Optional[Dict[str, ImageProvider]] = None
_social_override: Optional[OEmbedSocialProvider] = None

IMAGE_FACTORIES = {"wikimedia_commons": WikimediaCommonsProvider}
SOCIAL_NAMES = ("youtube_oembed", "tiktok_oembed", "instagram_oembed")


def _names(raw: str) -> List[str]:
    return [n.strip() for n in (raw or "").split(",") if n.strip()]


def image_providers() -> Dict[str, ImageProvider]:
    if _image_override is not None:
        return _image_override
    return {n: IMAGE_FACTORIES[n]() for n in _names(settings.IMAGE_PROVIDERS) if n in IMAGE_FACTORIES}


def social_provider() -> OEmbedSocialProvider:
    if _social_override is not None:
        return _social_override
    names = [n for n in _names(settings.SOCIAL_PROVIDERS) if n in SOCIAL_NAMES]
    if settings.SOCIAL_INSTAGRAM_OEMBED_TOKEN and "instagram_oembed" not in names:
        names.append("instagram_oembed")
    return OEmbedSocialProvider(names, instagram_token=settings.SOCIAL_INSTAGRAM_OEMBED_TOKEN or "")


def set_image_providers_for_testing(providers: Optional[Dict[str, ImageProvider]]) -> None:
    global _image_override
    _image_override = providers


def set_social_provider_for_testing(provider: Optional[OEmbedSocialProvider]) -> None:
    global _social_override
    _social_override = provider


def status() -> Dict[str, object]:
    social = social_provider()
    return {"image_providers": sorted(image_providers().keys()), "social_providers": sorted(social.enabled)}
