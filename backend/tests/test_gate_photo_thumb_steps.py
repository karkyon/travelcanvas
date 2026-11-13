"""[Gate PhotoThumbSteps] Wikimedia の縮小画像は決まった幅(thumbnail steps)だけを頼む。

2026 年から決まった幅以外(480px・640px・1600px など)は 429「Use thumbnail steps」で断られ、
外部の写真を探す画面の縮小画像が全部「縮小画像を読めません」になっていた。
"""
import asyncio

import httpx

from app.services.media_providers.wikimedia import (
    FETCH_WIDTH, THUMB_STEPS, THUMB_WIDTH, WikimediaCommonsProvider, _step_urls,
)

BASE = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Beach.jpg/"


def test_widths_are_standard_steps():
    assert THUMB_WIDTH in THUMB_STEPS and FETCH_WIDTH in THUMB_STEPS


def test_step_urls_rewrites_to_steps():
    assert _step_urls(BASE + "480px-Beach.jpg", "https://upload.wikimedia.org/o.jpg", 500) == [
        BASE + "500px-Beach.jpg", BASE + "330px-Beach.jpg"]
    assert _step_urls(BASE + "1600px-Beach.jpg", None, 1280) == [BASE + "1280px-Beach.jpg", BASE + "960px-Beach.jpg"]
    # 縮小画像が無い(元が小さい)時は元の画像
    assert _step_urls(None, "https://upload.wikimedia.org/o.jpg", 500) == ["https://upload.wikimedia.org/o.jpg"]
    assert _step_urls("https://upload.wikimedia.org/o.jpg", None, 500) == ["https://upload.wikimedia.org/o.jpg"]


def _transport(seen, refuse_500=False):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host == "commons.wikimedia.org":
            width = request.url.params.get("iiurlwidth")
            page = {"title": "File:Beach.jpg", "index": 1, "imageinfo": [{
                "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Beach.jpg",
                "thumburl": f"{BASE}{width}px-Beach.jpg", "mime": "image/jpeg", "width": 4000, "height": 3000,
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:Beach.jpg",
                "extmetadata": {"LicenseShortName": {"value": "CC BY 2.0"}}}]}
            return httpx.Response(200, json={"query": {"pages": {"1": page}}})
        if refuse_500 and "/500px-" in str(request.url):
            return httpx.Response(429, text="Use thumbnail steps")
        return httpx.Response(200, content=b"\xff\xd8\xffimg", headers={"content-type": "image/jpeg"})
    return httpx.MockTransport(handler)


def test_thumbnail_and_fetch_request_standard_widths():
    seen = []
    p = WikimediaCommonsProvider(transport=_transport(seen))
    asyncio.run(p.thumbnail("File:Beach.jpg", 10_000))
    asyncio.run(p.fetch("File:Beach.jpg", 10_000))
    uploads = [u for u in seen if "upload.wikimedia.org" in u]
    assert uploads == [BASE + "500px-Beach.jpg", BASE + "1280px-Beach.jpg"]
    assert all(("iiurlwidth=500" in u or "iiurlwidth=1280" in u) for u in seen if "commons.wikimedia.org" in u)


def test_thumbnail_falls_back_one_step_when_refused():
    seen = []
    p = WikimediaCommonsProvider(transport=_transport(seen, refuse_500=True))
    img = asyncio.run(p.thumbnail("File:Beach.jpg", 10_000))
    assert img.content.startswith(b"\xff\xd8")
    assert [u for u in seen if "upload" in u] == [BASE + "500px-Beach.jpg", BASE + "330px-Beach.jpg"]
