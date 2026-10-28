"""
[Gate G11] 発見・外部の画像・SNS の投稿・予定の写真(docs/ux/G11_UIUX全範囲_実装仕様.md §2.2・§2.4・§5、UIX-M08・M09・M10・M14)。

検証する主な性質(外部へはつながない。httpx.MockTransport で provider の応答を作る):
- ライセンス: CC0・PD・CC BY・CC BY-SA は取り込める。NC・ND・不明は取り込めない(候補には出すが「取り込めない」)
- Wikimedia Commons: 決まった API・画像の host(upload.wikimedia.org)だけへつなぐ。別の host の URL・redirect・上限超えは拒む
- 取り込み: 非公開の記録として保存し、出典(作者・ライセンス・取得日時)を残す。撮影情報を除き、暗号化する。表紙・予定に使える
- provider を止めると候補も取り込みも使えない(画面は項目を出さない)
- SNS: 公式の oEmbed だけ(投稿の URL へは直接つながない)。対応外・止めてある・鍵が無い・取れない を区別し、値を作らない。
  題名は HTML を除いた文字だけ。場所の候補の確からしさは「低」「中」だけ。候補箱に social で保存できる
- 予定の写真: 編集できる人だけ設定・解除、見えない写真は使えない、記録を消すと外れる、複製はコピーしない
- 近くの検索: カテゴリ・半径・基点の検証、距離と「半径を保証するか」、Overpass の正規表現の逃がし
"""
import asyncio
import io
import uuid

import httpx
import pytest
from PIL import Image

from app.api.v1 import media_providers as mp_api
from app.api.v1 import memories as memories_api
from app.api.v1 import plan_cover as plan_cover_api
from app.core.config import settings
from app.models.models import TravelEvent
from app.services import search_provider as sp
from app.services.media_providers import ProviderUnavailable, license_allowed, plain_text
from app.services.media_providers import registry
from app.services.media_providers.social import OEmbedSocialProvider, place_words, platform_of
from app.services.media_providers.wikimedia import WikimediaCommonsProvider


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _jpeg_with_gps() -> bytes:
    ex = Image.Exif()
    ex[0x010F] = "ExternalCam"
    gps = ex.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (35.0, 0.0, 0.0)
    out = io.BytesIO()
    Image.new("RGB", (40, 30), (30, 160, 90)).save(out, format="JPEG", exif=ex.tobytes())
    return out.getvalue()


JPEG = _jpeg_with_gps()


def _page(title, lic, url="https://upload.wikimedia.org/a/b.jpg", mime="image/jpeg", author="<a href='x'>山田</a>"):
    return {"title": title, "index": 1, "imageinfo": [{
        "url": url, "thumburl": url, "mime": mime, "width": 40, "height": 30,
        "descriptionurl": f"https://commons.wikimedia.org/wiki/{title}",
        "extmetadata": {"LicenseShortName": {"value": lic}, "Artist": {"value": author},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
                        "ObjectName": {"value": "清水寺"}},
    }]}


def _commons(pages, image=JPEG, image_status=200, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(str(request.url))
        if request.url.host == "commons.wikimedia.org":
            title = request.url.params.get("titles")
            chosen = {k: v for k, v in pages.items() if title is None or v["title"] == title}
            return httpx.Response(200, json={"query": {"pages": chosen or {"-1": {"title": title, "missing": ""}}}})
        if request.url.host == "upload.wikimedia.org":
            return httpx.Response(image_status, content=image, headers={"content-type": "image/jpeg"})
        return httpx.Response(599)
    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def storage(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    monkeypatch.setattr(memories_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(mp_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(plan_cover_api, "record_audit_event", lambda **kw: None)
    yield
    registry.set_image_providers_for_testing(None)
    registry.set_social_provider_for_testing(None)


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "発見の試験"}).json()["id"]
    return p, f"/api/v1/plans/{p}"


# ---------------------------------------------------------------- 単体

def test_license_policy_and_plain_text():
    for ok in ("CC0", "CC0 1.0", "Public domain", "PD-self", "CC BY 4.0", "CC BY-SA 3.0", "CC-BY-SA 2.5", "cc by 2.0"):
        assert license_allowed(ok), ok
    for ng in (None, "", "CC BY-NC 4.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "GFDL", "All rights reserved",
               "Copyrighted"):
        assert not license_allowed(ng), ng
    assert plain_text("<a href='x'>山田 <b>太郎</b></a>\n") == "山田 太郎"
    assert plain_text(None) is None and plain_text("x" * 500, 10) == "x" * 10


def test_wikimedia_search_fetch_and_guards():
    pages = {"1": _page("File:Kiyomizu.jpg", "CC BY-SA 4.0"), "2": _page("File:NC.jpg", "CC BY-NC 4.0"),
             "3": _page("File:Svg.svg", "CC0", mime="image/svg+xml")}
    seen = []
    p = WikimediaCommonsProvider(transport=_commons(pages, seen=seen))
    found = asyncio.run(p.search("清水寺", None, None, 10))
    assert [c.provider_id for c in found] == ["File:Kiyomizu.jpg", "File:NC.jpg"]  # SVG は出さない
    assert found[0].importable and not found[1].importable and found[0].author == "山田"
    assert all(u.startswith("https://commons.wikimedia.org/") for u in seen)
    img = asyncio.run(p.fetch("File:Kiyomizu.jpg", 10_000_000))
    assert img.content == JPEG and img.mime == "image/jpeg"
    with pytest.raises(ProviderUnavailable) as e:
        asyncio.run(p.fetch("File:NC.jpg", 10_000_000))
    assert e.value.code == "license_not_allowed"
    asyncio.run(p.thumbnail("File:NC.jpg", 10_000_000))  # 縮小画像は見せるだけ(取り込まない)ので出せる
    with pytest.raises(ProviderUnavailable) as e:
        asyncio.run(p.fetch("File:Kiyomizu.jpg", 10))
    assert e.value.code == "too_large"
    bad = {"1": _page("File:Evil.jpg", "CC0", url="https://evil.example/x.jpg")}
    with pytest.raises(ProviderUnavailable) as e:
        asyncio.run(WikimediaCommonsProvider(transport=_commons(bad)).fetch("File:Evil.jpg", 10_000_000))
    assert e.value.code == "bad_host"
    for bad_id in ("Kiyomizu.jpg", "File:a|b", "File:" + "x" * 300, ""):
        with pytest.raises(ProviderUnavailable):
            asyncio.run(p.fetch(bad_id, 10_000_000))
    with pytest.raises(ProviderUnavailable) as e:
        asyncio.run(WikimediaCommonsProvider(transport=_commons(pages, image_status=302)).fetch(
            "File:Kiyomizu.jpg", 10_000_000))
    assert e.value.code == "bad_status"  # redirect を追わない
    assert asyncio.run(p.search(None, None, None, 5)) == []


def test_import_external_saves_private_memory_with_source_and_cover(auth_client):
    client, owner = auth_client
    p, base = _plan(client)
    pages = {"1": _page("File:Kiyomizu.jpg", "CC BY-SA 4.0"), "2": _page("File:NC.jpg", "CC BY-NC 4.0")}
    registry.set_image_providers_for_testing({"wikimedia_commons": WikimediaCommonsProvider(transport=_commons(pages))})
    assert client.get("/api/v1/media-providers/status").json()["image_providers"] == ["wikimedia_commons"]
    r = client.get("/api/v1/media-providers/images", params={"q": "清水寺"})
    assert r.status_code == 200 and [i["importable"] for i in r.json()["images"]] == [True, False]
    thumb = client.get("/api/v1/media-providers/images/thumb",
                       params={"provider": "wikimedia_commons", "id": "File:Kiyomizu.jpg"})
    assert thumb.status_code == 200 and thumb.headers["cache-control"] == "private, max-age=300"
    assert client.get("/api/v1/media-providers/images", params={"lat": 35}).status_code == 422
    assert client.get("/api/v1/media-providers/images").status_code == 422

    r = client.post(f"{base}/memories/import-external", json={"provider": "wikimedia_commons",
                                                              "provider_id": "File:Kiyomizu.jpg"})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["visibility"] == "private" and m["kind"] == "photo" and m["include_in_journal"] is False
    assert m["source"]["license"] == "CC BY-SA 4.0" and m["source"]["author"] == "山田"
    assert m["source"]["provider"] == "wikimedia_commons" and m["source"]["retrieved_at"]
    media = client.get(f"{base}/memories/{m['id']}/media").content
    assert b"ExternalCam" not in media and b"Exif\x00\x00" not in media
    cover = client.put(f"{base}/cover", json={"memory_id": m["id"]}).json()["cover"]
    assert cover["source"]["license"] == "CC BY-SA 4.0"

    nc = client.post(f"{base}/memories/import-external",
                     json={"provider": "wikimedia_commons", "provider_id": "File:NC.jpg"})
    assert nc.status_code == 422 and nc.json()["detail"]["code"] == "license_not_allowed"
    assert client.post(f"{base}/memories/import-external",
                       json={"provider": "nope", "provider_id": "File:Kiyomizu.jpg"}).status_code == 404

    registry.set_image_providers_for_testing({})
    assert client.get("/api/v1/media-providers/status").json()["image_providers"] == []
    assert client.get("/api/v1/media-providers/images", params={"q": "x"}).json()["images"] == []
    assert client.post(f"{base}/memories/import-external", json={"provider": "wikimedia_commons",
                                                                 "provider_id": "File:Kiyomizu.jpg"}).status_code == 404


def test_social_preview_variants_and_candidate(auth_client):
    client, owner = auth_client
    p, base = _plan(client)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        if request.url.host == "www.youtube.com":
            return httpx.Response(200, json={"title": "<b>京都</b>の清水寺と錦市場を歩く #伏見稲荷大社", "author_name": "旅人"})
        if request.url.host == "www.tiktok.com":
            return httpx.Response(404)
        return httpx.Response(599)

    async def geocode(word):
        if word == "錦市場":
            return []
        return [{"name": word, "address": f"京都市 {word}", "latitude": 35.0, "longitude": 135.7,
                 "provider": "nominatim"}]

    registry.set_social_provider_for_testing(OEmbedSocialProvider(
        ["youtube_oembed", "tiktok_oembed"], transport=httpx.MockTransport(handler), geocode=geocode))
    r = client.post(f"{base}/candidates/social-preview",
                    json={"url": "https://www.youtube.com/watch?v=abc&utm_source=x"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and body["platform"] == "youtube"
    assert body["url"] == "https://www.youtube.com/watch?v=abc"
    assert body["title"] == "京都の清水寺と錦市場を歩く #伏見稲荷大社" and body["author"] == "旅人"
    assert [s["word"] for s in body["place_suggestions"]] == ["清水寺", "錦市場", "伏見稲荷大社"]
    assert {s["confidence"] for s in body["place_suggestions"]} <= {"low", "medium"}
    assert body["fallback"] is None
    assert set(calls) == {"www.youtube.com"}  # 投稿の URL へは直接つながない

    assert client.post(f"{base}/candidates/social-preview",
                       json={"url": "https://www.tiktok.com/@a/video/1"}).json()["status"] == "unavailable"
    un = client.post(f"{base}/candidates/social-preview", json={"url": "https://example.com/post"}).json()
    assert un["status"] == "unsupported" and un["fallback"] == "url_and_note"
    ig = client.post(f"{base}/candidates/social-preview", json={"url": "https://www.instagram.com/p/xyz/"}).json()
    assert ig["status"] == "disabled"
    for bad in ("javascript:alert(1)", "ftp://x", "http://user:pw@youtube.com/x", ""):
        assert client.post(f"{base}/candidates/social-preview", json={"url": bad}).status_code == 422, bad

    registry.set_social_provider_for_testing(OEmbedSocialProvider(["instagram_oembed"], instagram_token=""))
    assert client.post(f"{base}/candidates/social-preview",
                       json={"url": "https://www.instagram.com/p/xyz/"}).json()["reason"] == "token_required"

    saved = client.post(f"{base}/candidates", json={
        "title": "清水寺", "source_url": "https://www.youtube.com/watch?v=abc", "source_kind": "social",
        "platform": "youtube", "retrieved_at": "2026-10-28T10:00:00+00:00", "latitude": 35.0, "longitude": 135.7})
    assert saved.status_code == 201, saved.text
    item = [c for c in saved.json()["items"] if c["title"] == "清水寺"][0]
    assert item["source_kind"] == "social" and item["provider"] == "youtube_oembed" and item["retrieved_at"]
    wrong = client.post(f"{base}/candidates", json={"title": "x", "source_url": "https://example.com/a",
                                                    "source_kind": "social"})
    assert wrong.status_code == 422
    mismatch = client.post(f"{base}/candidates", json={"title": "x", "source_url": "https://www.youtube.com/watch?v=1",
                                                       "source_kind": "social", "platform": "tiktok"})
    assert mismatch.status_code == 422


def test_place_words_and_platform():
    assert platform_of("https://youtu.be/x") == "youtube" and platform_of("https://vm.tiktok.com/x") == "tiktok"
    assert platform_of("https://evil.youtube.com.example.com/x") is None
    assert place_words("金閣寺と嵐山、#渡月橋 が最高") == ["金閣寺", "嵐山", "渡月橋"]
    assert place_words(None) == [] and place_words("今日のごはん") == []


def test_event_image_permissions_and_cleanup(auth_client, make_user, db_session):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app
    from app.models.models import PlanCollaborator

    client, owner = auth_client
    p, base = _plan(client)
    day = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()["id"]
    ev = client.post(f"{base}/events", json={"day_id": day, "title": "清水寺"}, headers=_ik()).json()["id"]
    photo = client.post(f"{base}/memories/upload", data={"kind": "photo"},
                        files={"file": ("a.jpg", io.BytesIO(JPEG))}).json()
    r = client.put(f"{base}/events/{ev}/image", json={"memory_id": photo["id"]})
    assert r.status_code == 200 and r.json()["image"]["memory_id"] == photo["id"]
    assert client.get(f"{base}/event-images").json()["images"][ev]["memory_id"] == photo["id"]
    media = client.get(f"{base}/events/{ev}/image/media")
    assert media.status_code == 200 and b"ExternalCam" not in media.content
    assert client.put(f"{base}/events/{uuid.uuid4()}/image", json={"memory_id": photo["id"]}).status_code == 404

    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    assert client.get(f"{base}/event-images").json()["images"] == {}  # 非公開の写真は見えない
    assert client.get(f"{base}/events/{ev}/image/media").status_code == 404
    assert client.put(f"{base}/events/{ev}/image", json={"memory_id": photo["id"]}).status_code == 403
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=owner, is_authenticated=True, is_guest=False)

    clone = client.post(f"/api/v1/travel-plans/{p}/clone", json={}).json()
    assert all(e.image_memory_id is None for e in db_session.query(TravelEvent).filter(
        TravelEvent.plan_id == uuid.UUID(clone["id"])).all())

    assert client.delete(f"{base}/memories/{photo['id']}").status_code == 204
    db_session.expire_all()
    assert db_session.get(TravelEvent, uuid.UUID(ev)).image_memory_id is None
    assert client.delete(f"{base}/events/{ev}/image").json()["image"] is None


def test_nearby_search_validation_distance_and_escape(auth_client, monkeypatch):
    client, owner = auth_client
    captured = {}

    async def fake_all(query, lat, lng, radius, category="all"):
        captured.update(query=query, category=category, radius=radius)
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        return [
            {"provider": "overpass", "external_id": "1", "name": "甘味処", "category": "cafe", "latitude": 35.0005,
             "longitude": 135.7, "address": None, "raw_payload": {}, "source_url": None, "retrieved_at": now},
            {"provider": "nominatim", "external_id": "2", "name": "遠い店", "category": "shop", "latitude": 35.1,
             "longitude": 135.7, "address": "x", "raw_payload": {}, "source_url": None, "retrieved_at": now},
            {"provider": "wikipedia", "external_id": "3", "name": "記事", "category": "landmark", "latitude": None,
             "longitude": None, "address": None, "raw_payload": {}, "source_url": None, "retrieved_at": now},
        ]

    from app.api.v1 import search as search_api
    monkeypatch.setattr(search_api, "search_all_providers", fake_all)
    r = client.post("/api/v1/search/spots", json={"query": "", "category": "food", "latitude": 35.0, "longitude": 135.7,
                                                  "radius_km": 1})
    assert r.status_code == 200, r.text
    rows = r.json()["candidates"]
    assert captured == {"query": "", "category": "food", "radius": 1}
    assert (rows[0]["distance_m"], rows[0]["within_radius"], rows[0]["radius_guaranteed"]) == (56, True, True)
    assert rows[1]["within_radius"] is False and rows[1]["radius_guaranteed"] is False
    assert rows[2]["distance_m"] is None and r.json()["base"] == {"latitude": 35.0, "longitude": 135.7}
    assert client.post("/api/v1/search/spots", json={"query": "", "category": "food"}).status_code == 422
    assert client.post("/api/v1/search/spots", json={"query": "x", "category": "pets"}).status_code == 422
    assert client.post("/api/v1/search/spots", json={"query": "x", "radius_km": 50}).status_code == 422
    assert client.post("/api/v1/search/spots", json={"query": ""}).status_code == 400

    assert sp.overpass_regex('a.b"c(d)') == 'a\\.b\\"c\\(d\\)'
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["data"] = request.content.decode()
        return httpx.Response(200, json={"elements": []})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await sp.search_overpass('甘味"]; out;', 35.0, 135.7, 1.0, client=c, category="market")
    assert asyncio.run(run()) == []
    from urllib.parse import unquote_plus
    q = unquote_plus(sent["data"])
    assert '["amenity"="marketplace"]' in q and '["name"~"甘味\\"\\]; out;",i]' in q
