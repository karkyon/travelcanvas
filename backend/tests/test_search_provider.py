"""
[Gate #31] 検索プロバイダアダプタの契約テスト。

実際の外部API(Wikipedia/Nominatim/Overpass)へは一切接続せず、各APIの
実レスポンス形状を模したfixtureでhttpxをモックする(APIキー不要)。
"""
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services import search_provider


class _FakeResponse:
    def __init__(self, json_data, status_code=200):
        self._json_data = json_data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._json_data


class _FakeClient:
    """httpx.AsyncClientのget/postだけを差し替える最小フェイク。"""

    def __init__(self, get_response=None, post_response=None, raise_on_get=False, raise_on_post=False):
        self._get_response = get_response
        self._post_response = post_response
        self._raise_on_get = raise_on_get
        self._raise_on_post = raise_on_post

    async def get(self, url, params=None, headers=None):
        if self._raise_on_get:
            raise RuntimeError("simulated network failure")
        return self._get_response

    async def post(self, url, data=None):
        if self._raise_on_post:
            raise RuntimeError("simulated network failure")
        return self._post_response


@pytest.mark.asyncio
async def test_search_wikipedia_parses_opensearch_shape():
    fixture = [
        "大阪城",
        ["大阪城", "大阪城公園"],
        ["大阪市中央区にある城", "大阪城を中心とした公園"],
        ["https://ja.wikipedia.org/wiki/大阪城", "https://ja.wikipedia.org/wiki/大阪城公園"],
    ]
    client = _FakeClient(get_response=_FakeResponse(fixture))
    results = await search_provider.search_wikipedia("大阪城", client=client)

    assert len(results) == 2
    assert results[0]["provider"] == "wikipedia"
    assert results[0]["name"] == "大阪城"
    assert results[0]["retrieved_at"] is not None


@pytest.mark.asyncio
async def test_search_wikipedia_failure_returns_empty_list_not_fabricated_data():
    """[Gate #31 監査是正] プロバイダ失敗時は空リストを返すのみで、
    架空データを生成しない(webSearchService.tsにあった旧mock挙動の否定)。"""
    client = _FakeClient(raise_on_get=True)
    results = await search_provider.search_wikipedia("存在しない何か", client=client)
    assert results == []


@pytest.mark.asyncio
async def test_search_nominatim_parses_result_shape():
    fixture = [
        {
            "place_id": 12345,
            "display_name": "大阪城, 大阪市中央区, 大阪府, 日本",
            "type": "castle",
            "lat": "34.687315",
            "lon": "135.526201",
            "osm_type": "way",
            "osm_id": 999,
        }
    ]
    client = _FakeClient(get_response=_FakeResponse(fixture))
    results = await search_provider.search_nominatim("大阪城", 34.68, 135.52, client=client)

    assert len(results) == 1
    assert results[0]["provider"] == "nominatim"
    assert results[0]["latitude"] == pytest.approx(34.687315)
    assert results[0]["longitude"] == pytest.approx(135.526201)


@pytest.mark.asyncio
async def test_search_nominatim_failure_returns_empty_list():
    client = _FakeClient(raise_on_get=True)
    results = await search_provider.search_nominatim("query", None, None, client=client)
    assert results == []


@pytest.mark.asyncio
async def test_search_overpass_without_coordinates_returns_empty_list():
    """座標が無い場合はAPIを呼ばず空リストを返す(仕様上の制約であり失敗ではない)。"""
    results = await search_provider.search_overpass("cafe", None, None)
    assert results == []


@pytest.mark.asyncio
async def test_search_overpass_parses_elements_shape():
    fixture = {
        "elements": [
            {
                "id": 111,
                "lat": 34.68,
                "lon": 135.52,
                "tags": {"name": "テストカフェ", "amenity": "cafe"},
            },
            {
                # name タグが無い要素はスキップされる
                "id": 222,
                "lat": 34.68,
                "lon": 135.53,
                "tags": {"amenity": "cafe"},
            },
        ]
    }
    client = _FakeClient(post_response=_FakeResponse(fixture))
    results = await search_provider.search_overpass("cafe", 34.68, 135.52, client=client)

    assert len(results) == 1
    assert results[0]["name"] == "テストカフェ"
    assert results[0]["provider"] == "overpass"


@pytest.mark.asyncio
async def test_search_overpass_failure_returns_empty_list():
    client = _FakeClient(post_response=None, raise_on_post=True)
    results = await search_provider.search_overpass("cafe", 34.68, 135.52, client=client)
    assert results == []
