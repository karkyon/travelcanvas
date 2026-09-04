"""
[Gate #31] /search/spots・/search/candidates/{id}/adopt・/search/places/{id} の
統合テスト。実際の外部APIへは接続せず、app.api.v1.search.search_all_providers を
monkeypatchして固定のcandidateデータを返す(APIキー不要)。
"""
from datetime import datetime, timezone

import app.api.v1.search as search_module
from app.models.models import FieldSource, Place, SearchCandidate, SourceRecord


def _fake_provider_results():
    now = datetime.now(timezone.utc)
    return [
        {
            "provider": "wikipedia",
            "external_id": "https://ja.wikipedia.org/wiki/大阪城",
            "name": "大阪城",
            "category": "landmark",
            "latitude": None,
            "longitude": None,
            "address": None,
            "raw_payload": {"title": "大阪城"},
            "source_url": "https://ja.wikipedia.org/wiki/大阪城",
            "retrieved_at": now,
        },
        {
            "provider": "nominatim",
            "external_id": "12345",
            "name": "大阪城",
            "category": "castle",
            "latitude": 34.687315,
            "longitude": 135.526201,
            "address": "大阪城, 大阪市中央区, 大阪府",
            "raw_payload": {"place_id": 12345},
            "source_url": "https://www.openstreetmap.org/way/999",
            "retrieved_at": now,
        },
    ]


async def _fake_search_all_providers(query, latitude=None, longitude=None, radius_km=5.0):
    return _fake_provider_results()


async def _fake_empty_search_all_providers(query, latitude=None, longitude=None, radius_km=5.0):
    return []


def test_search_spots_persists_candidates_and_source_records(auth_client, monkeypatch, db_session):
    client, user = auth_client
    monkeypatch.setattr(search_module, "search_all_providers", _fake_search_all_providers)

    res = client.post("/api/v1/search/spots", json={"query": "大阪城"})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 2
    providers = {c["provider"] for c in body["candidates"]}
    assert providers == {"wikipedia", "nominatim"}

    candidate_ids = [c["id"] for c in body["candidates"]]
    stored = db_session.query(SearchCandidate).filter(SearchCandidate.id.in_(candidate_ids)).all()
    assert len(stored) == 2
    for c in stored:
        source = db_session.query(SourceRecord).filter(SourceRecord.candidate_id == c.id).first()
        assert source is not None
        assert source.provider == c.provider


def test_search_spots_returns_empty_not_fabricated_when_all_providers_fail(auth_client, monkeypatch):
    """[Gate #31 監査是正の中核テスト] 全providerが0件でも、architectureのどこにも
    Math.random()相当のフォールバックが存在しないため、結果は必ず0件になる。"""
    client, _user = auth_client
    monkeypatch.setattr(search_module, "search_all_providers", _fake_empty_search_all_providers)

    res = client.post("/api/v1/search/spots", json={"query": "存在しないキーワードxyz"})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 0
    assert body["candidates"] == []


def test_search_spots_duplicate_query_creates_new_rows_not_dedup(auth_client, monkeypatch, db_session):
    """[Gate #31] 監査指摘: duplicate候補は自動削除せず比較提示する。
    同一queryを2回検索しても、既存候補が上書き・統合されず両方残る。"""
    client, _user = auth_client
    monkeypatch.setattr(search_module, "search_all_providers", _fake_search_all_providers)

    client.post("/api/v1/search/spots", json={"query": "大阪城"})
    client.post("/api/v1/search/spots", json={"query": "大阪城"})

    all_candidates = db_session.query(SearchCandidate).filter(SearchCandidate.query == "大阪城").all()
    assert len(all_candidates) == 4  # 2 providers x 2回


def test_search_spots_requires_query(auth_client):
    client, _user = auth_client
    res = client.post("/api/v1/search/spots", json={"query": "   "})
    assert res.status_code == 400


def test_adopt_candidate_creates_place_with_field_sources(auth_client, monkeypatch, db_session):
    client, _user = auth_client
    monkeypatch.setattr(search_module, "search_all_providers", _fake_search_all_providers)

    res = client.post("/api/v1/search/spots", json={"query": "大阪城"})
    nominatim_candidate = next(c for c in res.json()["candidates"] if c["provider"] == "nominatim")

    res = client.post(f"/api/v1/search/candidates/{nominatim_candidate['id']}/adopt")
    assert res.status_code == 200
    place_body = res.json()
    assert place_body["name"] == "大阪城"
    assert place_body["location"]["latitude"] == 34.687315

    place = db_session.query(Place).filter(Place.id == place_body["id"]).first()
    assert place is not None
    assert str(place.adopted_from_candidate_id) == nominatim_candidate["id"]

    field_sources = db_session.query(FieldSource).filter(FieldSource.place_id == place.id).all()
    field_names = {fs.field_name for fs in field_sources}
    assert "name" in field_names
    assert "latitude" in field_names

    # 採用によって新しいSourceRecord(place_id付き)が作られ、candidateのSourceRecordと
    # 同じprovider/URLを引き継いでいる(source継承)
    place_source = db_session.query(SourceRecord).filter(SourceRecord.place_id == place.id).first()
    assert place_source is not None
    assert place_source.provider == "nominatim"


def test_adopt_unknown_candidate_returns_404(auth_client):
    client, _user = auth_client
    res = client.post("/api/v1/search/candidates/00000000-0000-0000-0000-000000000000/adopt")
    assert res.status_code == 404


def test_get_place_returns_field_sources(auth_client, monkeypatch):
    client, _user = auth_client
    monkeypatch.setattr(search_module, "search_all_providers", _fake_search_all_providers)

    res = client.post("/api/v1/search/spots", json={"query": "大阪城"})
    candidate_id = res.json()["candidates"][0]["id"]
    place_id = client.post(f"/api/v1/search/candidates/{candidate_id}/adopt").json()["id"]

    res = client.get(f"/api/v1/search/places/{place_id}")
    assert res.status_code == 200
    assert len(res.json()["field_sources"]) > 0
