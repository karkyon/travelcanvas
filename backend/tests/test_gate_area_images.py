"""[Gate AreaImages / PlaceKinds] 方面の代表画像の API と、場所の検索の応答の種類・代表画像。"""
import uuid
from datetime import datetime, timezone

from app.models.models import SearchCandidate


def test_area_images_api_returns_images_and_validates(auth_client, monkeypatch):
    from app.services import area_images as ai_img
    client, _ = auth_client
    seen = []

    async def fake(names, client=None):
        seen.append(names)
        img = {"url": "https://upload.wikimedia.org/x.jpg", "title": "伊勢",
               "page_url": "https://ja.wikipedia.org/?curid=1"}
        return {n: (img if n == "伊勢" else None) for n in names}, True
    monkeypatch.setattr(ai_img, "lookup", fake)
    r = client.get("/api/v1/trip-intents/area-images", params=[("names", "伊勢"), ("names", "架空"), ("names", "伊勢")])
    assert r.status_code == 200, r.text
    assert r.json()["images"]["伊勢"]["url"].startswith("https://upload.wikimedia.org/")
    assert r.json()["images"]["架空"] is None and seen == [["伊勢", "架空"]]
    assert client.get("/api/v1/trip-intents/area-images").status_code == 422
    assert client.get("/api/v1/trip-intents/area-images", params=[("names", "x" * 41)]).status_code == 422


def test_spot_dict_has_kind_thumbnail_and_description():
    from app.api.v1.search import _candidate_to_dict
    now = datetime.now(timezone.utc)
    wiki = SearchCandidate(id=uuid.uuid4(), query="q", provider="wikipedia", name="鳥羽水族館", category="museum",
                           raw_payload={"pageid": 1, "_tc": {
                               "kind": "museum", "thumbnail_url": "https://upload.wikimedia.org/a",
                               "description": "水族館"}},
                           retrieved_at=now)
    d = _candidate_to_dict(wiki)
    assert d["kind"] == "museum" and d["thumbnail_url"] == "https://upload.wikimedia.org/a"
    assert d["description"] == "水族館"
    osm = SearchCandidate(id=uuid.uuid4(), query="q", provider="overpass", name="伊勢神宮", category="place_of_worship",
                          raw_payload={"tags": {"amenity": "place_of_worship"}}, retrieved_at=now)
    d = _candidate_to_dict(osm)
    assert d["kind"] == "shrine_temple" and d["thumbnail_url"] is None
