"""[Gate SpotFromMedia] 写真・動画・投稿から場所の候補(外へは送らない。AI・YouTube の応答は作り物)"""
import io
import json
import pathlib

import httpx
import pytest
from PIL import Image

from app.services import place_info as pi
from app.services import place_lookup as pl
from app.services import provider_calls as pc
from app.services import video_places, youtube_data
from app.services.media_providers import registry

DESC = (pathlib.Path(__file__).parent / "fixtures" / "youtube_description_ise.txt").read_text(encoding="utf-8")


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢", "destination": "伊勢"}).json()["id"]
    return p, f"/api/v1/plans/{p}"


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 30), (120, 160, 200)).save(out, format="PNG")
    return out.getvalue()


def test_chapters_give_places_not_tickets():
    names = [p["name"] for p in video_places.from_text(DESC, "【最強パワースポット伊勢神宮】")]
    for want in ("二見興玉神社", "外宮参道", "ダンデライオンチョコレートカフェ", "伊勢神宮外宮", "猿田彦神社", "おはらい町",
                 "おかげ横丁", "ふくすけ", "赤福本店", "伊勢神宮内宮", "お伊勢屋本舗", "五十鈴川カフェ", "参道テラスカフェ"):
        assert want in names
    assert not any("まわりゃんせ" in n or "料金" in n or "オープニング" in n for n in names)
    assert names.count("おはらい町") == 1
    first = video_places.from_text(DESC)[0]
    assert first["time"] == "1:04" and "二見興玉神社" in first["context"]
    # 目次の無い投稿の文はハッシュタグと「」
    tags = [p["name"] for p in video_places.from_text("伊勢に行ってきた #伊勢神宮 #おかげ横丁 「赤福本店」で一休み")]
    assert tags[:1] == ["赤福本店"] and "伊勢神宮" in tags and "おかげ横丁" in tags


def test_places_from_text_api(auth_client):
    client, _ = auth_client
    r = client.post("/api/v1/spots/places-from-text", json={"text": DESC})
    assert r.status_code == 200 and len(r.json()["places"]) >= 13


def test_youtube_video_id():
    assert youtube_data.video_id("https://www.youtube.com/watch?v=xBlI5KoqzHQ&t=3") == "xBlI5KoqzHQ"
    assert youtube_data.video_id("https://youtu.be/s-gj_MIw5AA") == "s-gj_MIw5AA"
    assert youtube_data.video_id("https://www.youtube.com/shorts/abcDEF123") == "abcDEF123"
    assert youtube_data.video_id("https://example.com/watch?v=x") is None


def test_read_url_youtube_reads_description_when_key(auth_client, monkeypatch):
    client, _ = auth_client

    class Preview:
        status = "ok"

        def to_dict(self):
            return {"title": "【最強パワースポット伊勢神宮】", "author": "旅チャンネル", "place_suggestions": []}

    class Provider:
        async def preview(self, url):
            return Preview()

    monkeypatch.setattr(registry, "social_provider", lambda: Provider())
    monkeypatch.setattr(youtube_data, "api_key", lambda db: "yt-key-1234")
    seen = []

    def handler(req):
        seen.append(req)
        snippet = {"title": "伊勢神宮", "description": DESC, "tags": ["三重旅行"], "channelTitle": "旅"}
        return httpx.Response(200, json={"items": [{"snippet": snippet}]})

    monkeypatch.setattr(youtube_data, "transport", httpx.MockTransport(handler))
    body = client.post("/api/v1/spots/read-url", json={"url": "https://www.youtube.com/watch?v=xBlI5KoqzHQ"}).json()
    assert body["video_source"] == "youtube_data" and body["description"].startswith("今回の動画")
    assert "おかげ横丁" in [p["name"] for p in body["places"]]
    assert seen[0].url.params["id"] == "xBlI5KoqzHQ"
    # 鍵が無い時は説明欄を読まず、そのことを返す
    monkeypatch.setattr(youtube_data, "api_key", lambda db: None)
    body = client.post("/api/v1/spots/read-url", json={"url": "https://www.youtube.com/watch?v=xBlI5KoqzHQ"}).json()
    assert body["description"] is None and body["description_available"] is False


def test_image_ai_needs_consent_and_enriches(auth_client, monkeypatch):
    client, _ = auth_client
    _p, base = _plan(client)
    no = client.post(f"{base}/spot-ai/places-image", files={"file": ("a.png", _png(), "image/png")})
    assert no.status_code == 422 and no.json()["detail"]["code"] == "consent_required"
    sent = {}

    def fake_ai(db, plan, user, jpeg, hint, key):
        sent["jpeg"] = jpeg[:2]
        sent["hint"] = hint
        return {"text": json.dumps({"places": [
            {"name": "伊勢神宮内宮", "area": "三重県伊勢市", "kind": "sightseeing", "reason": "宇治橋の鳥居", "confidence": 0.9},
            {"name": "", "area": "", "kind": "other", "reason": "", "confidence": 0}]})}, {}

    async def fake_lookup(db, name, lat, lng, record, **kw):
        return {"candidates": [{"name": "伊勢神宮 内宮", "address": "三重県伊勢市宇治館町1", "latitude": 34.455,
                                "longitude": 136.725, "phone": None, "website": "https://www.isejingu.or.jp/",
                                "category": "sightseeing"}]}

    monkeypatch.setattr(pc, "ai_places_from_image", fake_ai)
    monkeypatch.setattr(pl, "lookup", fake_lookup)
    r = client.post(f"{base}/spot-ai/places-image", data={"consent": "true"},
                    files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    places = r.json()["places"]
    assert len(places) == 1 and places[0]["address"] == "三重県伊勢市宇治館町1" and places[0]["reason"] == "宇治橋の鳥居"
    assert sent["jpeg"] == b"\xff\xd8" and sent["hint"] == "伊勢"  # JPEG に作り直して送る(撮影情報を消す)


def test_text_ai_keeps_only_names_in_text(auth_client, monkeypatch):
    client, _ = auth_client
    _p, base = _plan(client)

    def fake_ai(db, plan, user, text, key):
        return {"text": json.dumps({"places": [
            {"name": "月夜見宮", "area": "", "kind": "sightseeing", "reason": "x", "confidence": 0.5},
            {"name": "東京タワー", "area": "", "kind": "sightseeing", "reason": "x", "confidence": 0.5}]})}, {}

    monkeypatch.setattr(pc, "ai_places_from_text", fake_ai)
    r = client.post(f"{base}/spot-ai/places-text", json={"text": "外宮の後に月夜見宮へ。", "consent": True})
    names = [p["name"] for p in r.json()["places"]]
    assert "月夜見宮" in names and "東京タワー" not in names


def test_ai_errors_are_reported(auth_client, monkeypatch):
    from app.services import provider_secrets as ps
    client, _ = auth_client
    _p, base = _plan(client)

    def missing(*a, **k):
        raise ps.SecretUnavailable("secret_missing")

    monkeypatch.setattr(pc, "ai_places_from_image", missing)
    r = client.post(f"{base}/spot-ai/places-image", data={"consent": "true"},
                    files={"file": ("a.png", _png(), "image/png")})
    assert r.status_code == 503 and "鍵" in r.json()["detail"]["message"]


@pytest.fixture(autouse=True)
def _reset():
    pl.reset()
    pi.reset()
    yield
