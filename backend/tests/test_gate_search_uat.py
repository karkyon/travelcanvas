"""[Gate SearchUAT] 旅行相談の「候補を探す」(OpenStreetMap・Overpass)の失敗の是正。

実環境(omega-dev2)の失敗の原因は未確定(scripts/ops/search_diag.sh の同じ要求の比較で確かめる)。コードで確かめた不足:
Overpass への要求に User-Agent が無かった(公開 server の利用条件は識別できる User-Agent を求める)。失敗は全て
「提供元が応答しない」になり、原因を区別できなかった。
- 要求は識別できる User-Agent をつける(Nominatim・Wikipedia も同じ)
- 失敗を分類する(blocked・rate_limited・timeout・server_error・network・unreadable・provider_timeout)。
  200 でも remark の runtime error だけで要素が無い応答は「該当なし」にしない
- API は provider_errors を返し、無料の利用の記録にも分類を残す
- 下書きの Google の場所は place ID と Google マップの URL だけを保存する(名前・住所・位置は保存しない)
外への通信は httpx.MockTransport(実の server へは送らない)。
"""
import asyncio
import uuid

import httpx
import pytest

from app.models.models import PlanCandidate, ProviderUsageEvent
from app.services import search_provider as sp


def _run(handler, category="sightseeing"):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await sp.search_overpass("", 34.4875, 136.7091, 10.0, client=c, category=category,
                                            raise_errors=True)
    return asyncio.run(go())


def test_overpass_request_identifies_the_app():
    seen = {}

    def handler(request):
        seen.update(ua=request.headers.get("user-agent"), accept=request.headers.get("accept"))
        return httpx.Response(200, json={"elements": [
            {"type": "way", "id": 7, "center": {"lat": 34.45, "lon": 136.72},
             "tags": {"name": "伊勢神宮 外宮", "historic": "yes"}},
        ]})
    rows = _run(handler)
    assert seen["ua"] == sp.USER_AGENT and "TravelCanvas" in seen["ua"] and "python-httpx" not in seen["ua"]
    assert seen["accept"] == "application/json"
    assert rows[0]["name"] == "伊勢神宮 外宮" and rows[0]["source_url"] == "https://www.openstreetmap.org/way/7"


@pytest.mark.parametrize("response,code", [
    (httpx.Response(406, text="Not Acceptable"), "blocked"),
    (httpx.Response(403, text="Forbidden"), "blocked"),
    (httpx.Response(429, text="Too Many Requests"), "rate_limited"),
    (httpx.Response(504, text="Gateway Timeout"), "provider_timeout"),
    (httpx.Response(500, text="err"), "server_error"),
    (httpx.Response(200, text="<html>busy</html>"), "unreadable"),
    (httpx.Response(200, json={"elements": [], "remark": "runtime error: Query timed out in \"query\""}),
     "provider_timeout"),
    # [F06] 必須の構造が無い・型が違う応答は「該当なし」にしない。分類できない remark は決まった分類へ
    (httpx.Response(200, json={}), "unreadable"),
    (httpx.Response(200, json={"elements": "x"}), "unreadable"),
    (httpx.Response(200, json=[]), "unreadable"),
    (httpx.Response(200, json={"elements": [], "remark": "something odd"}), "server_error"),
])
def test_failures_are_classified_not_reported_as_empty(response, code):
    with pytest.raises(sp.SearchProviderError) as e:
        _run(lambda request: response)
    assert e.value.code == code


def test_timeout_and_network_errors_are_classified():
    def slow(request):
        raise httpx.ReadTimeout("t", request=request)

    def down(request):
        raise httpx.ConnectError("dns", request=request)
    with pytest.raises(sp.SearchProviderError) as e:
        _run(slow)
    assert e.value.code == "timeout"
    with pytest.raises(sp.SearchProviderError) as e:
        _run(down)
    assert e.value.code == "network"


def test_successful_empty_answer_is_empty_not_error():
    out = _run(lambda request: httpx.Response(200, json={"elements": []}))
    assert out == [] and out.partial is False


def test_runtime_error_with_some_elements_is_partial_not_complete():
    """[F06] remark つきで要素がある応答は「一部だけ」(完全な結果と区別する)"""
    body = {"remark": "runtime error: Query timed out", "elements": [
        {"type": "node", "id": 1, "lat": 34.4, "lon": 136.7, "tags": {"name": "伊勢市駅前", "tourism": "attraction"}},
        "broken"]}
    out = _run(lambda request: httpx.Response(200, json=body))
    assert [r["name"] for r in out] == ["伊勢市駅前"] and out.partial is True

    async def partial(*a, **kw):
        return out
    from unittest import mock
    with mock.patch.object(sp, "search_overpass", partial):
        res = asyncio.run(sp.search_all_providers("", 34.4, 136.7, 10.0, category="market"))
    assert res.partial == ["overpass"] and res.unavailable == []


def test_api_returns_failure_code_and_records_it(auth_client, db_session, monkeypatch):
    client, user = auth_client

    async def fake_all(query, lat, lng, radius, category="all"):
        return sp.ProviderResults([], ["overpass"], ["overpass"], {"overpass": "blocked"})
    from app.api.v1 import search as search_api
    monkeypatch.setattr(search_api, "search_all_providers", fake_all)
    r = client.post("/api/v1/search/spots", json={"query": "", "category": "market", "latitude": 34.4875,
                                                  "longitude": 136.7091, "radius_km": 10})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["candidates"] == [] and body["unavailable_providers"] == ["overpass"]
    assert body["provider_errors"] == {"overpass": "blocked"}
    ev = (db_session.query(ProviderUsageEvent).filter(ProviderUsageEvent.provider == "overpass",
                                                      ProviderUsageEvent.user_id == user.id).all())
    assert [e.result_code for e in ev] == ["blocked"]


def test_all_providers_collects_error_codes(monkeypatch):
    async def blocked(*a, **kw):
        raise sp.SearchProviderError("blocked", 406)
    monkeypatch.setattr(sp, "search_overpass", blocked)
    out = asyncio.run(sp.search_all_providers("", 34.4, 136.7, 10.0, category="food"))
    assert list(out) == [] and out.unavailable == ["overpass"] and out.errors == {"overpass": "blocked"}


def test_draft_keeps_google_place_id_and_url_but_not_name(auth_client, db_session):
    client, _user = auth_client
    picks = [{"place_id": "ChIJabc_123", "maps_uri": "https://maps.google.com/?cid=1"},
             {"place_id": "ChIJabc_123", "maps_uri": "https://maps.google.com/?cid=1"},
             {"place_id": "ChIJxyz", "maps_uri": "https://evil.example/x"}]
    r = client.post("/api/v1/trip-intents/draft",
                    json={"area": {"name": "伊勢"}, "intent": {"nights": 1}, "google_places": picks})
    assert r.status_code == 201, r.text
    rows = (db_session.query(PlanCandidate).filter(PlanCandidate.plan_id == uuid.UUID(r.json()["plan_id"]))
            .order_by(PlanCandidate.created_at).all())
    assert [(x.provider, x.external_id) for x in rows] == [("google_places", "ChIJabc_123"),
                                                           ("google_places", "ChIJxyz")]
    assert rows[0].source_url == "https://maps.google.com/?cid=1"
    assert rows[1].source_url == "https://www.google.com/maps/place/?q=place_id:ChIJxyz"  # 他の名前の URL は使わない
    assert all(x.latitude is None and x.address is None and x.title.startswith("Google の場所") for x in rows)
    bad = client.post("/api/v1/trip-intents/draft",
                      json={"area": {"name": "伊勢"}, "intent": {"nights": 1},
                            "google_places": [{"place_id": "a b", "maps_uri": None}]})
    assert bad.status_code == 422


def test_search_diag_reports_cause(monkeypatch, capsys):
    """[Gate SearchUAT-S3] 標準の診断は外へ 1 回(状態の照会)。--probe の結果・比較は明示した時だけ"""
    from app.ops import search_diag as sd

    async def fake_run(probe=False, compare=False):
        report = {"at": "2026-11-01T00:00:00+00:00", "endpoint": "https://overpass-api.de/api/interpreter",
                  "mode": "probe" if probe else "default",
                  "dns": {"host": "overpass-api.de", "ok": True, "addresses": ["1.2.3.4"], "ms": 3},
                  "cooldown": None,
                  "server_status": {"url": "https://overpass-api.de/api/status", "status": 200,
                                    "slots_available_now": 2, "rate_limit": 2, "ms": 40},
                  "usage_events": {"days": 7, "by_result": {"unavailable": 5}}, "requests_sent": 1}
        if probe:
            report["app_requests"] = [{"category": c, "ok": True, "count": 12, "ms": 900, "sent": True}
                                      for c in sd.CATEGORIES]
            report["requests_sent"] = 4
        report["conclusion"] = sd.conclusion(report)
        return report
    monkeypatch.setattr(sd, "run", fake_run)
    assert sd.main([]) == 0
    out = capsys.readouterr().out
    assert "外への要求 1 回" in out and "空きの枠 2" in out and "アプリの要求" not in out
    assert sd.main(["--probe"]) == 0
    out = capsys.readouterr().out
    assert "sightseeing 12件" in out and "断定" not in out
    bad = {"dns": {"ok": True}, "app_requests": [{"category": "food", "ok": False, "code": "rate_limited"}]}
    assert sd.conclusion(bad) == ["アプリの要求が失敗: 回数の制限(429)"]


def test_ops_scripts_run_the_diagnosis_without_reading_secrets():
    import subprocess
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    diag = root / "scripts" / "ops" / "search_diag.sh"
    assert subprocess.run(["bash", "-n", str(diag)]).returncode == 0
    text = diag.read_text()
    assert "python -m app.ops.search_diag" in text and ".env" not in text.replace("鍵・.env の値は読まない", "")
    apply = (root / "scripts" / "ops" / "consultai_apply.sh").read_text()
    # 反映の前にログの失敗の型を残し(作り直すと消える)、反映の後に診断を実行する
    assert apply.index("predeploy-search-log") < apply.index("docker compose up -d --build")
    assert apply.index("bash scripts/ops/search_diag.sh") > apply.index("docker compose up -d --build")


def test_e2e_rate_limit_reset_is_test_only(monkeypatch):
    """[Gate AuthE2E] 試験の環境だけで回数制限の記録を消せる(本番では断る)"""
    import importlib.util
    from pathlib import Path

    from app.core.config import settings
    from app.utils import rate_limiter as rl
    spec = importlib.util.spec_from_file_location(
        "security_incident", Path(__file__).resolve().parents[1] / "scripts" / "security_incident.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rl.use_backend("memory")
    try:
        for _ in range(5):
            assert rl.check_rate_limit("register:10.0.0.9", 5, 60)
        assert not rl.check_rate_limit("register:10.0.0.9", 5, 60)
        monkeypatch.setattr(mod.rate_limiter, "use_backend", lambda name: None)
        monkeypatch.setattr(settings, "APP_ENV", "production")
        assert mod.main(["e2e-reset-rate-limits", "--yes"]) == mod.EXIT_FAIL
        assert not rl.check_rate_limit("register:10.0.0.9", 5, 60)
        monkeypatch.setattr(settings, "APP_ENV", "development")
        assert mod.main(["e2e-reset-rate-limits"]) == mod.EXIT_USAGE
        mod.main(["e2e-reset-rate-limits", "--yes"])
        assert rl.check_rate_limit("register:10.0.0.9", 5, 60)
    finally:
        rl.use_backend("auto")
        rl._rate_limit_storage.clear()


def test_user_agent_comparison_sends_the_same_body_and_only_changes_the_header(monkeypatch):
    """[F05][Gate SearchUAT-S3] 同じ送り先・同じ本文で User-Agent の条件だけを変える(各 1 回)。
    実際に送った header を記録する: 「付けない」は header そのものが無い(以前は httpx の既定の UA が付いていた)"""
    from app.ops import search_diag as sd
    seen = []

    def handler(request):
        seen.append((request.headers.get("user-agent"), request.content))
        return httpx.Response(406 if "TravelCanvas" not in (request.headers.get("user-agent") or "") else 200)
    real = httpx.AsyncClient
    monkeypatch.setattr(sd.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    out = asyncio.run(sd.compare_user_agent("https://overpass.example/api/interpreter", pause=0))
    assert [o["request"] for o in out] == ["app_user_agent", "client_default_user_agent", "no_user_agent_header"]
    assert [o["status"] for o in out] == [200, 406, 406]
    assert len({body for _ua, body in seen}) == 1  # 本文は同じ
    assert "TravelCanvas" in seen[0][0] and seen[1][0].startswith("python-httpx/") and seen[2][0] is None
    assert out[1]["wire"]["user_agent"].startswith("python-httpx/")
    assert out[2]["wire"]["user_agent"] is None and "user-agent" not in out[2]["wire"]["header_names"]
