"""[Gate SpotInfo] 行きたい場所の電話・URL・写真・食事の情報、自動取得、候補の「まとめる」で消す、予定の食事の情報。

外への送信はしない(place_info.lookup・place_photo.resolve を差し替える)。
"""
import uuid

import pytest

from app.models.models import Poll, PollOption
from app.services import candidates as cs
from app.services import dining
from app.services.media_providers import ImageCandidate, now


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_dining_rules_and_osm_tags():
    info = dining.DiningInfo(genres=["sushi", "kaisen", "sushi"], budget_lunch="1000_2000", parking="yes",
                             payment=["cash", "card"], features=["kids"], moods=["family"], signature=" 海鮮丼 ")
    assert info.genres == ["sushi", "kaisen"] and info.signature == "海鮮丼"
    assert dining.to_json(dining.DiningInfo()) is None
    for bad in ({"genres": ["unknown"]}, {"budget_dinner": "999"}, {"features": ["x"]}, {"moods": ["x"]},
                {"genres": ["sushi", "ramen", "curry", "cafe"]}, {"seats": 0}, {"extra": 1}):
        with pytest.raises(ValueError):
            dining.DiningInfo(**bad)
    tags = {"cuisine": "sushi;seafood;japanese;ramen", "opening_hours": "Mo-Su 11:00-21:00", "reservation": "yes",
            "smoking": "no", "payment:cash": "yes", "payment:visa": "yes", "payment:suica": "yes", "payment:paypay": "yes",  # noqa: E501
            "takeaway": "yes", "capacity": "24", "wheelchair": "yes"}
    got = dining.from_osm_tags(tags, "restaurant")
    assert got["genres"] == ["sushi", "kaisen", "washoku"]
    assert got["hours"] == "Mo-Su 11:00-21:00" and got["reservation"] == "possible" and got["smoking"] == "no"
    assert got["payment"] == ["cash", "card", "emoney", "qr"] and got["seats"] == 24
    assert set(got["features"]) == {"takeout", "wheelchair"}
    assert dining.from_osm_tags({}, "cafe") == {"genres": ["cafe"]}
    assert dining.merge_empty({"genres": ["ramen"], "hours": None}, got)["genres"] == ["ramen"]


def test_same_address_needs_house_number_and_nearby():
    a = {"title": "門司港レトロ", "address": "福岡県北九州市", "latitude": 33.9458, "longitude": 130.9622}
    b = {"title": "TOTOミュージアム", "address": "福岡県北九州市", "latitude": 33.866, "longitude": 130.865}
    assert cs.duplicate_reasons(a, b) == []
    c = {**a, "address": "福岡県北九州市門司区港町1-1"}
    d = {**b, "address": "福岡県北九州市門司区港町1-1", "latitude": 33.9459, "longitude": 130.9623}
    assert "same_address" in cs.duplicate_reasons(c, d)


def test_wish_spot_extras_create_update(auth_client):
    client, _owner = auth_client
    body = {"name": "回転寿司 港", "category": "restaurant", "phone": "093-000-0000",
            "urls": [{"url": "https://sushi.example/"}],
            "photo": {"provider": "wikimedia_commons", "provider_id": "File:Sushi.jpg", "author": "A", "license": "CC BY-SA 4.0",  # noqa: E501
                      "source_page_url": "https://commons.wikimedia.org/wiki/File:Sushi.jpg"},
            "dining": {"genres": ["sushi"], "budget_lunch": "1000_2000", "parking": "nearby", "signature": "地魚の握り"}}
    r = client.post("/api/v1/spots/", json=body)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["phone"] == "093-000-0000" and s["urls"] == [{"url": "https://sushi.example/", "label": None}]
    assert s["photo"]["provider_id"] == "File:Sushi.jpg" and s["dining"]["genres"] == ["sushi"]
    u = client.put(f"/api/v1/spots/{s['id']}", json={"dining": {"genres": ["kaisen"]}, "urls": [], "photo": None})
    assert u.status_code == 200, u.text
    assert u.json()["dining"] == {"genres": ["kaisen"]} and u.json()["urls"] is None and u.json()["photo"] is None
    for bad in ({"urls": [{"url": "javascript:alert(1)"}]}, {"photo": {"provider": "other", "provider_id": "File:x.jpg"}},  # noqa: E501
                {"photo": {"provider_id": "../etc"}}, {"dining": {"genres": ["nope"]}}):
        assert client.put(f"/api/v1/spots/{s['id']}", json=bad).status_code == 422


def test_enrich_fills_only_empty_fields(auth_client, monkeypatch):
    from app.services import place_info, place_photo

    client, _owner = auth_client
    s = client.post("/api/v1/spots/", json={"name": "門司港 地魚屋", "category": "other",
                                            "latitude": 33.9458, "longitude": 130.9622, "address": "自分で入れた住所"}).json()
    rows = [
        {"name": "遠い同名の店", "latitude": 35.0, "longitude": 135.0, "address": "京都", "phone": "000",
         "website": None, "category": "dining", "dining": None, "photo_file": None, "wikidata": None, "source_url": None},  # noqa: E501
        {"name": "門司港 地魚屋", "latitude": 33.9460, "longitude": 130.9620, "address": "福岡県北九州市門司区港町1-1",
         "phone": "093-321-0000", "website": "https://jizakana.example/", "category": "dining",
         "dining": {"genres": ["kaisen"], "hours": "11:00-21:00"}, "photo_file": "File:Moji.jpg", "wikidata": None,
         "source_url": "https://www.openstreetmap.org/node/1"},
    ]

    async def fake_lookup(name, lat, lng, client=None):
        return rows, False

    async def fake_resolve(photo_file, wikidata, transport=None):
        assert photo_file == "File:Moji.jpg"
        return ImageCandidate(provider="wikimedia_commons", provider_id="File:Moji.jpg", title="門司港", author="B",
                              license="CC BY 4.0", license_url="https://creativecommons.org/licenses/by/4.0/",
                              attribution=None, source_page_url="https://commons.wikimedia.org/wiki/File:Moji.jpg",
                              width=640, height=480, mime="image/jpeg", retrieved_at=now(), importable=True)

    monkeypatch.setattr(place_info, "lookup", fake_lookup)
    monkeypatch.setattr(place_photo, "resolve", fake_resolve)
    r = client.post(f"/api/v1/spots/{s['id']}/enrich")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["matched"] is True and set(body["filled"]) == {"phone", "urls", "category", "dining", "photo"}
    spot = body["spot"]
    assert spot["address"] == "自分で入れた住所"  # 利用者の値は変えない
    assert spot["phone"] == "093-321-0000" and spot["category"] == "restaurant"
    assert spot["dining"]["genres"] == ["kaisen"] and spot["photo"]["author"] == "B"
    assert body["source"]["attribution"] == "© OpenStreetMap contributors"
    # 当てはまらない時は変えない
    rows[:] = [rows[0]]
    r2 = client.post(f"/api/v1/spots/{s['id']}/enrich")
    assert r2.json()["matched"] is False and r2.json()["filled"] == []


def test_enrich_provider_down_is_503(auth_client, monkeypatch):
    from app.services import place_info

    client, _owner = auth_client
    s = client.post("/api/v1/spots/", json={"name": "x"}).json()

    async def down(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(place_info, "lookup", down)
    r = client.post(f"/api/v1/spots/{s['id']}/enrich")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_unavailable"


def test_merge_deletes_and_moves_info_and_poll_options(auth_client, db_session):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "北九州"}).json()["id"]
    url = f"/api/v1/plans/{p}/candidates"
    a = client.post(url, json={"title": "門司港レトロ", "note": "時間が余ったら。"}).json()
    b = client.post(url, json={"title": "門司港レトロ", "note": "夜景がきれい", "source_url": "https://moji.example/",
                               "address": "福岡県北九州市門司区港町1-1"}).json()
    poll = Poll(id=uuid.uuid4(), plan_id=uuid.UUID(p), created_by_user_id=owner.id, title="どこへ")
    db_session.add(poll)
    db_session.flush()
    opt = PollOption(id=uuid.uuid4(), poll_id=poll.id, label="門司港レトロ", candidate_id=uuid.UUID(b["id"]))
    db_session.add(opt)
    db_session.commit()
    rev = next(i for i in client.get(url).json()["items"] if i["id"] == b["id"])["revision"]
    m = client.post(f"{url}/{b['id']}/merge", json={"into_id": a["id"]}, headers={"If-Match": str(rev)})
    assert m.status_code == 200, m.text
    items = {i["id"]: i for i in m.json()["items"]}
    assert b["id"] not in items
    assert "夜景がきれい" in items[a["id"]]["note"] and items[a["id"]]["source_url"] == "https://moji.example/"
    assert items[a["id"]]["address"] == "福岡県北九州市門司区港町1-1"
    db_session.expire_all()
    assert str(db_session.get(PollOption, opt.id).candidate_id) == a["id"]


def test_event_dining_and_place_info_details(auth_client):
    client, _owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "食べ歩き"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": "2026-12-01", "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()  # noqa: E501
    r = client.post(f"{base}/events", json={"day_id": d["id"], "title": "焼きカレー", "event_type": "dining",
                                            "dining": {"genres": ["curry"], "budget_lunch": "1000_2000"}}, headers=_ik())  # noqa: E501
    assert r.status_code == 201, r.text
    assert r.json()["dining"] == {"genres": ["curry"], "budget_lunch": "1000_2000"}
    rev = client.get(base).json()["revision"]
    u = client.put(f"{base}/events/{r.json()['id']}", json={"dining": {"genres": ["curry"], "parking": "none"}},
                   headers={"If-Match": str(rev)})
    assert u.status_code == 200 and u.json()["dining"]["parking"] == "none"
    bad = client.put(f"{base}/events/{r.json()['id']}", json={"dining": {"genres": ["x"]}}, headers={"If-Match": str(rev + 1)})  # noqa: E501
    assert bad.status_code == 422


def test_place_info_row_reads_dining_and_photo_hints():
    from app.services import place_info

    row = place_info._row({"name": "地魚屋", "lat": "33.9", "lon": "130.9", "category": "amenity", "type": "restaurant",
                           "display_name": "地魚屋, 1-1, 港町, 門司区, 北九州市, 福岡県, 801-0852, 日本",
                           "address": {"country_code": "jp"},
                           "extratags": {"cuisine": "seafood", "wikimedia_commons": "File:Jizakana.jpg", "wikidata": "Q123"}})  # noqa: E501
    assert row["dining"] == {"genres": ["kaisen"]} and row["photo_file"] == "File:Jizakana.jpg" and row["wikidata"] == "Q123"  # noqa: E501
    row2 = place_info._row({"name": "城", "lat": "1", "lon": "1", "category": "historic", "type": "castle",
                            "display_name": "城", "extratags": {"cuisine": "sushi", "wikidata": "bad"}})
    assert row2["dining"] is None and row2["wikidata"] is None


def test_image_for_place_endpoint(auth_client, monkeypatch):
    from app.services import place_photo

    client, _owner = auth_client

    async def fake_resolve(photo_file, wikidata, transport=None):
        if wikidata == "Q1":
            return ImageCandidate(provider="wikimedia_commons", provider_id="File:A.jpg", title="A", author="X",
                                  license="CC0", license_url=None, attribution=None, source_page_url=None, width=1,
                                  height=1, mime="image/jpeg", retrieved_at=now(), importable=True)
        return None

    monkeypatch.setattr(place_photo, "resolve", fake_resolve)
    assert client.get("/api/v1/media-providers/images/for-place").status_code in (400, 422)
    r = client.get("/api/v1/media-providers/images/for-place", params={"wikidata": "Q1"})
    assert r.status_code == 200 and r.json()["image"]["provider_id"] == "File:A.jpg"
    assert client.get("/api/v1/media-providers/images/for-place", params={"file": "File:B.jpg"}).json()["image"] is None


@pytest.mark.asyncio
async def test_place_photo_resolve_rules(monkeypatch):
    from app.services import place_photo
    from app.services.media_providers import registry

    class FakeCommons:
        name = "wikimedia_commons"

        def __init__(self):
            self.asked = []

        async def describe(self, pid):
            self.asked.append(pid)
            return ImageCandidate(provider="wikimedia_commons", provider_id=pid, title=None, author=None,
                                  license="CC BY-NC" if "Nc" in pid else "CC BY 4.0", license_url=None, attribution=None,  # noqa: E501
                                  source_page_url=None, width=1, height=1, mime="image/jpeg", retrieved_at=now(),
                                  importable="Nc" not in pid)

    fake = FakeCommons()
    registry.set_image_providers_for_testing({"wikimedia_commons": fake})

    async def fake_wikidata(qid, transport=None):
        return "File:From_Wikidata.jpg"

    monkeypatch.setattr(place_photo, "_wikidata_file", fake_wikidata)
    try:
        assert (await place_photo.resolve("File:Ok.jpg", None)).provider_id == "File:Ok.jpg"
        assert await place_photo.resolve("File:Nc.jpg", None) is None  # ライセンスが許さない
        assert (await place_photo.resolve(None, "Q42")).provider_id == "File:From_Wikidata.jpg"
        assert await place_photo.resolve(None, "bad") is None
        assert await place_photo.resolve("../x", None) is None
    finally:
        registry.set_image_providers_for_testing(None)
