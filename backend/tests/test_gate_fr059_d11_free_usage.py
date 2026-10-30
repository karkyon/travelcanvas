"""[Gate FR059-D11] 無料の provider の使用の記録(FR-059 正本 §2.3・§13 D11)。

- 無料の provider へ送った回数を provider_usage_events に 0円・価格の版 free で残す。言葉・URL・座標・結果は残さない
- 有料の provider の名前では記録できない(0円で有料の呼び出しを隠さない)
- 記録の失敗で機能を止めない。運用コンソールの概要は無料の回数を「実の提供元の見込み」と別に出す
"""
import asyncio
from decimal import Decimal

import httpx
import pytest

from app.models.models import ProviderUsageEvent
from app.services import free_usage
from app.services import trip_intent as ti
from app.services.search_provider import ProviderResults


def _events(db, provider=None):
    q = db.query(ProviderUsageEvent).filter(ProviderUsageEvent.price_version == "free")
    if provider:
        q = q.filter(ProviderUsageEvent.provider == provider)
    return q.all()


def test_record_is_zero_yen_and_keeps_no_content(db_session, make_user):
    test_user, _ = make_user()
    free_usage.record(db_session, test_user, "overpass", "search.spots", result_code="ok")
    row = _events(db_session, "overpass")[0]
    assert row.estimated_cost_jpy == Decimal("0") and row.actual_cost_jpy == Decimal("0")
    assert row.price_version == "free" and row.request_count == 1 and row.user_id == test_user.id
    assert row.reservation_id is None and row.input_tokens is None
    with pytest.raises(ValueError):
        free_usage.record(db_session, test_user, "openai", "ai.generate")
    free_usage.record(db_session, test_user, "nominatim", "geocode.areas", request_count=0)
    assert _events(db_session, "nominatim") == []
    free_usage.record(db_session, test_user, "nominatim", "geocode.areas", result_code="weird")
    assert _events(db_session, "nominatim")[0].result_code == "error"


def test_record_failure_does_not_break_the_caller(db_session, make_user, monkeypatch):
    test_user, _ = make_user()
    from app.services import cost_guard as cg

    def boom(*a, **k):
        raise RuntimeError("db")
    monkeypatch.setattr(cg, "user_class", boom)
    free_usage.record(db_session, test_user, "overpass", "search.spots")  # 例外を出さない
    assert _events(db_session) == []


def test_search_spots_records_each_called_free_provider(auth_client, db_session, monkeypatch):
    from datetime import datetime, timezone

    from app.api.v1 import search as search_api

    client, user = auth_client
    now = datetime.now(timezone.utc)

    async def fake_all(query, lat, lng, radius, category="all"):
        return ProviderResults([{"provider": "overpass", "external_id": "1", "name": "伊勢神宮", "category": "attraction",
                                 "latitude": 34.45, "longitude": 136.72, "address": None, "raw_payload": {},
                                 "source_url": None, "retrieved_at": now}], ["wikipedia"],
                               ["wikipedia", "nominatim", "overpass"])
    monkeypatch.setattr(search_api, "search_all_providers", fake_all)
    r = client.post("/api/v1/search/spots", json={"query": "神宮", "latitude": 34.48, "longitude": 136.71})
    assert r.status_code == 200, r.text
    rows = {e.provider: e for e in _events(db_session)}
    assert set(rows) == {"wikipedia", "nominatim", "overpass"}
    assert rows["wikipedia"].result_code == "unavailable" and rows["nominatim"].result_code == "empty"
    assert rows["overpass"].result_code == "ok" and rows["overpass"].user_id == user.id
    assert all(e.operation == "search.spots" for e in rows.values())


def test_areas_records_only_real_geocode_calls(auth_client, db_session, monkeypatch):
    from app.api.v1 import trip_intents as api

    client, _user = auth_client

    async def fake_compare(origin, names, hours, strength, enabled=True):
        return {"origin": {"query": origin, "status": "ok"}, "areas": [
            {"name": n, "geocode": {"status": "ok"}} for n in names], "retrieved_at": "x", "_geocode_calls": 3,
            "providers": {}}
    monkeypatch.setattr(api.ti, "compare_areas", fake_compare)
    r = client.post("/api/v1/trip-intents/areas", json={"origin": "枚方", "areas": ["伊勢", "福井"]})
    assert r.status_code == 200, r.text
    assert "_geocode_calls" not in r.json()
    row = _events(db_session, "nominatim")[0]
    assert row.request_count == 3 and row.operation == "geocode.areas"


def test_geocode_counts_network_calls_but_not_cache_hits():
    ti.set_geocoder_for_testing(None)
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json=[{"lat": "34.48", "lon": "136.71", "display_name": "伊勢市"}])

    async def run():
        token = ti._network_calls.set(0)
        try:
            t = httpx.MockTransport(handler)
            await ti.nominatim_geocode("伊勢テスト", transport=t)
            await ti.nominatim_geocode("伊勢テスト", transport=t)  # cache
            return ti._network_calls.get()
        finally:
            ti._network_calls.reset(token)
    assert asyncio.run(run()) == 1 and calls["n"] == 1
    ti.set_geocoder_for_testing(None)


def test_overview_separates_free_calls_from_paid_estimate(auth_client, db_session, monkeypatch):
    from app.api.v1 import admin_ops
    from app.core.config import settings

    client, user = auth_client
    user.user_type = "admin"
    db_session.flush()
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    monkeypatch.setattr(admin_ops, "record_audit_event", lambda **kw: None)
    free_usage.record(db_session, user, "overpass", "search.spots", request_count=2)
    db_session.commit()
    body = client.get("/api/v1/admin/ops/overview").json()
    assert body["free_usage"]["providers"]["overpass"]["requests"] >= 2
    assert "overpass" not in body["live_usage"]["providers"]
    assert "50円の枠には入れない" in body["free_usage"]["label"]
