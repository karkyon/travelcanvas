"""[Gate SearchUAT-S3] OpenStreetMap(Overpass)の検索の復旧・診断の修正。

- 問い合わせを軽くする: 円の around ではなく囲む四角(bbox)、カテゴリに必要な種類と値だけ、server の上限
  (timeout 10 秒・maxsize 64MB)、出力はタグと中心だけ。円の外の場所は除く(半径の内を保証する)
- 429 は Retry-After(無ければ 60 秒)の間、403/406 は 10 分の間、アプリから送らない(406 を繰り返さない)
- 同じ条件の成功した結果を短い時間だけ使い回す。キーは条件の SHA-256 だけ(入力の原文・利用者を含めない)。
  保存した結果を使った時は外へ送っていない(無料の送信の回数に数えない)。提供元の失敗の時は古い結果を「前の結果」と示す
- 次の送り先へ移るのは、利用者が承認して書いた送り先(OVERPASS_FALLBACK_URLS)だけ。502/503/504/時間切れの時だけ移り、
  429・406 では移らない
- search_diag: 利用の記録は occurred_at で数える(以前は無い列 created_at で AttributeError)。標準は外へ 1 回
外への通信は httpx.MockTransport(実の server へは送らない)。
"""
import asyncio
import json
from urllib.parse import unquote_plus

import httpx
import pytest

from app.core.config import settings
from app.models.models import ProviderUsageEvent
from app.services import search_guard as sg
from app.services import search_provider as sp

ISE = (34.4875, 136.7091)
_REAL_CLIENT = httpx.AsyncClient


def _patch_client(monkeypatch, handler):
    real = _REAL_CLIENT
    monkeypatch.setattr(sp.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def _elements(*items):
    return {"elements": list(items)}


def _node(i, lat, lon, name="伊勢の店", **tags):
    return {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": {"name": name, **tags}}


# ===================================================================== 問い合わせの本文

@pytest.mark.parametrize("category", ["sightseeing", "food", "market"])
def test_query_is_light_bbox_and_bounded(category):
    q = sp.build_overpass_query("", ISE[0], ISE[1], 10.0, category)
    assert "around" not in q and "[timeout:10]" in q and "[maxsize:67108864]" in q
    assert "out tags center 60;" in q
    s, w, n, e = sp.bbox_of(ISE[0], ISE[1], 10.0)
    assert f"({s},{w},{n},{e})" in q and n - s == pytest.approx(2 * 10 / 111.32, abs=1e-5)
    if category == "sightseeing":
        assert "nwr[" in q and '["historic"]' not in q and "artwork" not in q
    else:
        assert "nwr[" not in q and "nw[" in q


def test_results_outside_the_circle_are_removed(monkeypatch):
    """四角の角(円の外)の場所は返さない。位置の無い要素は除かない"""
    body = _elements(_node(1, 34.49, 136.71, "近い"), _node(2, 34.4875 + 0.089, 136.7091 + 0.105, "角"),
                     {"type": "way", "id": 3, "tags": {"name": "位置なし", "tourism": "attraction"}})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))) as c:
            return await sp.search_overpass("", ISE[0], ISE[1], 10.0, client=c, category="food", raise_errors=True)
    assert [r["name"] for r in asyncio.run(go())] == ["近い", "位置なし"]


# ===================================================================== 待機(429・406)

def test_429_waits_for_retry_after_and_does_not_send_again(monkeypatch):
    sent = []

    def handler(request):
        sent.append(1)
        return httpx.Response(429, headers={"Retry-After": "120"}, text="Too Many Requests")
    _patch_client(monkeypatch, handler)
    first = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    assert first.errors == {"overpass": "rate_limited"} and first.retry_after == {"overpass": 120}
    assert first.called == ["overpass"] and len(sent) == 1
    second = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="market"))
    assert len(sent) == 1, "待機中は送らない"
    assert second.errors == {"overpass": "rate_limited"} and 100 < second.retry_after["overpass"] <= 120
    assert second.called == [] and second.unavailable == ["overpass"]


def test_406_is_not_repeated(monkeypatch):
    sent = []

    def handler(request):
        sent.append(1)
        return httpx.Response(406, text="Not Acceptable")
    _patch_client(monkeypatch, handler)
    for _ in range(3):
        out = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="market"))
        assert out.errors == {"overpass": "blocked"}
    assert len(sent) == 1
    assert 0 < sg.cooldown_remaining()["retry_after"] <= sg.BLOCKED_COOLDOWN


def test_timeout_and_5xx_do_not_start_a_cooldown(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(502, text="Bad Gateway")
    _patch_client(monkeypatch, handler)
    asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    assert len(calls) == 2 and sg.cooldown_remaining() is None


def test_retry_after_parse():
    assert sg.parse_retry_after("30") == 30
    assert sg.parse_retry_after(None) is None and sg.parse_retry_after("soon") is None
    assert sg.note_failure("rate_limited", 429, None) == sg.DEFAULT_RETRY_AFTER
    assert sg.note_failure("rate_limited", 429, 99999) == sg.MAX_RETRY_AFTER


# ===================================================================== 送り先(承認した mirror だけ)

def test_no_unapproved_fallback_and_failover_only_on_server_errors(monkeypatch):
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        return httpx.Response(502) if request.url.host == "overpass-api.de" else httpx.Response(
            200, json=_elements(_node(1, 34.49, 136.71)))
    _patch_client(monkeypatch, handler)
    monkeypatch.setattr(settings, "OVERPASS_URL", "")
    monkeypatch.setattr(settings, "OVERPASS_FALLBACK_URLS", "")
    out = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    assert hosts == ["overpass-api.de"] and out.errors == {"overpass": "server_error"}
    hosts.clear()
    monkeypatch.setattr(settings, "OVERPASS_FALLBACK_URLS",
                        "https://mirror.example/api/interpreter, http://plain.example")
    assert sp.overpass_urls() == ["https://overpass-api.de/api/interpreter", "https://mirror.example/api/interpreter"]
    out = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    assert hosts == ["overpass-api.de", "mirror.example"] and [r["name"] for r in out] == ["伊勢の店"]


def test_rate_limit_is_not_bypassed_through_a_fallback(monkeypatch):
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        return httpx.Response(429)
    _patch_client(monkeypatch, handler)
    monkeypatch.setattr(settings, "OVERPASS_FALLBACK_URLS", "https://mirror.example/api/interpreter")
    asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    assert hosts == ["overpass-api.de"]


# ===================================================================== 短い時間の保存

def test_cache_reuses_success_without_sending_and_keys_have_no_raw_input(monkeypatch):
    monkeypatch.setattr(settings, "OVERPASS_CACHE_SECONDS", 2700)
    sent = []

    def handler(request):
        sent.append(unquote_plus(request.content.decode()))
        return httpx.Response(200, json=_elements(_node(1, 34.49, 136.71, "甘味処")))
    _patch_client(monkeypatch, handler)
    a = asyncio.run(sp.search_all_providers("甘味 ", *ISE, 10.0, category="food"))
    b = asyncio.run(sp.search_all_providers("甘味", 34.48746, 136.70912, 10.0, category="food"))
    assert len(sent) == 1 and [r["name"] for r in b] == ["甘味処"]
    assert a.called == ["overpass"] and b.called == [] and b.cached["overpass"]["stale"] is False
    assert b[0]["retrieved_at"] == a[0]["retrieved_at"], "取得の時刻は最初の取得のまま(新しい結果のふりをしない)"
    key = sg.cache_key("甘味", *ISE, 10.0, "food")
    assert key.startswith("c:") and "甘味" not in key and len(key) == 66
    raw = sg._get(key)
    assert raw is not None and "user" not in json.loads(raw)
    # 条件が違えば送る(半径・カテゴリ)
    asyncio.run(sp.search_all_providers("甘味", *ISE, 5.0, category="food"))
    assert len(sent) == 2


def test_partial_results_are_not_cached(monkeypatch):
    monkeypatch.setattr(settings, "OVERPASS_CACHE_SECONDS", 2700)
    sent = []

    def handler(request):
        sent.append(1)
        return httpx.Response(200, json={"remark": "runtime error: Query timed out",
                                         **_elements(_node(1, 34.49, 136.71))})
    _patch_client(monkeypatch, handler)
    asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    out = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="food"))
    assert len(sent) == 2 and out.partial == ["overpass"]


def test_failure_returns_the_previous_result_as_stale(monkeypatch):
    monkeypatch.setattr(settings, "OVERPASS_CACHE_SECONDS", 2700)
    state = {"ok": True}

    def handler(request):
        return (httpx.Response(200, json=_elements(_node(1, 34.49, 136.71, "前の店"))) if state["ok"]
                else httpx.Response(504))
    _patch_client(monkeypatch, handler)
    asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="market"))
    key = sg.cache_key("", *ISE, 10.0, "market")
    raw = json.loads(sg._get(key))
    raw["saved"] -= 2700 + 60  # 保存の時間を過ぎた(古い結果)
    sg._set(key, json.dumps(raw), 3600)
    state["ok"] = False
    out = asyncio.run(sp.search_all_providers("", *ISE, 10.0, category="market"))
    assert out.errors == {"overpass": "provider_timeout"} and out.unavailable == ["overpass"]
    assert [r["name"] for r in out] == ["前の店"] and out.cached["overpass"]["stale"] is True
    assert out.called == ["overpass"]


def test_api_reports_retry_after_cached_and_partial(auth_client, db_session, monkeypatch):
    client, user = auth_client
    monkeypatch.setattr(settings, "OVERPASS_CACHE_SECONDS", 2700)
    sent = []

    def handler(request):
        sent.append(1)
        return httpx.Response(200, json=_elements(_node(1, 34.49, 136.71, "市場")))
    _patch_client(monkeypatch, handler)
    body = {"query": "", "category": "market", "latitude": ISE[0], "longitude": ISE[1], "radius_km": 10}
    r1 = client.post("/api/v1/search/spots", json=body).json()
    r2 = client.post("/api/v1/search/spots", json=body).json()
    assert len(sent) == 1 and r1["cached_providers"] == {} and r2["cached_providers"]["overpass"]["stale"] is False
    assert r2["candidates"][0]["name"] == "市場"
    events = db_session.query(ProviderUsageEvent).filter(ProviderUsageEvent.provider == "overpass",
                                                         ProviderUsageEvent.user_id == user.id).all()
    assert len(events) == 1, "保存した結果は外へ送っていないので、無料の送信の回数に数えない"
    sg.reset()
    monkeypatch.setattr(settings, "OVERPASS_CACHE_SECONDS", 0)
    _patch_client(monkeypatch, lambda request: httpx.Response(429, headers={"Retry-After": "45"}))
    r3 = client.post("/api/v1/search/spots", json=body).json()
    assert r3["provider_errors"] == {"overpass": "rate_limited"} and r3["provider_retry_after"] == {"overpass": 45}


def test_api_partial_flag_survives_the_result_limit(auth_client, monkeypatch):
    """以前は結果の数で切った後の list から partial を読み、一部だけの結果を画面へ伝えていなかった"""
    client, _user = auth_client
    _patch_client(monkeypatch, lambda request: httpx.Response(
        200, json={"remark": "runtime error: Query timed out", **_elements(_node(1, 34.49, 136.71))}))
    r = client.post("/api/v1/search/spots", json={"query": "", "category": "food", "latitude": ISE[0],
                                                  "longitude": ISE[1], "radius_km": 10}).json()
    assert r["partial_providers"] == ["overpass"]


# ===================================================================== search_diag

def test_usage_breakdown_reads_occurred_at(db_session, make_user, monkeypatch):
    import contextlib

    from app.core import database
    from app.ops import search_diag as sd
    from app.services import free_usage

    user, _pw = make_user()
    monkeypatch.setattr(database, "SessionLocal", lambda: contextlib.nullcontext(db_session))
    for code in ("ok", "timeout", "timeout"):
        free_usage.record(db_session, user, "overpass", "search.spots", result_code=code)
    db_session.commit()
    out = sd.usage_breakdown()
    assert "error" not in out, out
    assert out["by_result"].get("timeout", 0) >= 2 and out["by_result"].get("ok", 0) >= 1


def test_default_diag_sends_one_status_request_only(monkeypatch, capsys):
    from app.ops import search_diag as sd

    urls = []
    status_text = "Connected as: 203.0.113.9\nRate limit: 2\n2 slots available now.\n"

    def handler(request):
        urls.append(str(request.url))
        return httpx.Response(200, text=status_text)
    real = _REAL_CLIENT
    monkeypatch.setattr(sd.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(sd, "dns_check", lambda url: {"host": "overpass-api.de", "ok": True, "addresses": [], "ms": 1})
    assert sd.main([]) == 0
    out = capsys.readouterr().out
    assert urls == ["https://overpass-api.de/api/status"] and "外への要求 1 回" in out
    assert "203.0.113.9" not in out, "接続元の IP は出さない"
    assert sd.MAX_REQUESTS == {"default": 1, "probe": 3, "compare": 3}


def test_probe_stops_during_cooldown(monkeypatch):
    from app.ops import search_diag as sd

    sent = []

    def handler(request):
        sent.append(1)
        return httpx.Response(429, headers={"Retry-After": "300"})
    _patch_client(monkeypatch, handler)
    out = asyncio.run(sd.run_probes(pause=0))
    assert len(sent) == 1 and [p["sent"] for p in out] == [True, False, False]
    assert out[1]["code"] == "rate_limited" and out[1]["retry_after"] > 0


def test_compare_stops_after_429(monkeypatch):
    from app.ops import search_diag as sd

    real = _REAL_CLIENT
    monkeypatch.setattr(sd.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(lambda r: httpx.Response(429)), **kw))
    out = asyncio.run(sd.compare_user_agent("https://overpass.example/api/interpreter", pause=0))
    assert [o["sent"] for o in out] == [True, False, False]


def test_status_parse_and_url():
    from app.ops import search_diag as sd

    assert sd.status_url("https://overpass-api.de/api/interpreter") == "https://overpass-api.de/api/status"
    st = sd.parse_status("Rate limit: 2\n0 slots available now.\n"
                         "Slot available after: 2026-11-02T01:00:00Z, in 17 seconds.\n")
    assert st == {"rate_limit": 2, "slots_available_now": 0, "next_slot_seconds": 17}


# ===================================================================== 原価の表示(Stage A)・管理の集計(Stage E)

def test_overview_separates_allowance_verification_and_invoice(auth_client, db_session, monkeypatch):
    """¥8.05(旅行・相談の利用枠の計上)・管理者の鍵の確認・提供元の請求額(未照合)を別の欄に。計上の根拠を返す"""
    from app.services import cost_guard as cg

    client, user = auth_client
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    user.user_type = "admin"
    db_session.flush()
    o = client.get("/api/v1/admin/ops/overview").json()
    assert "提供元の請求額ではありません" in o["live_usage"]["label"]
    assert o["provider_invoice"]["status"] == "not_reconciled"
    v = o["key_verification_usage"]
    assert set(v) >= {"checks", "estimated_jpy", "daily_cap_jpy"} and "旅行・相談の 50円の枠には入れない" in v["label"]
    basis = o["price_basis"]
    assert basis["status"] == "known" and basis["policy_version"] == "2026-11-02.1"
    assert basis["jpy_per_usd"] == "227.7000"
    places = next(r for r in basis["rows"] if r["operation"] == "places.search")
    assert places["sku"] == "places-text-search-pro" and places["usd"] == "0.032" and places["jpy"] == "7.2864"
    assert places["field_mask"].startswith("places.id,")
    ai_rows = {r["unit"]: r for r in basis["rows"] if r["operation"] == "ai.generate"}
    assert ai_rows["input_tokens"]["usd"] == "0.00000005" and ai_rows["output_tokens"]["usd"] == "0.0000004"
    assert set(r["operation"] for r in basis["rows"]) == set(cg.OPERATIONS)


def test_dashboard_separates_guests_tests_and_super_admins(auth_client, db_session, monkeypatch):
    import uuid as _uuid

    from app.models.models import TravelPlan, User, UserType

    client, user = auth_client
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    user.user_type = "admin"
    db_session.flush()
    before = client.get("/api/v1/admin/stats/system").json()
    tester = User(id=_uuid.uuid4(), email=f"ops-fake-{_uuid.uuid4().hex[:8]}@ops.invalid",
                  username=f"opsfake{_uuid.uuid4().hex[:8]}", hashed_password="x", user_type=UserType.REGISTERED,
                  is_active=False, is_verified=False)
    boss = User(id=_uuid.uuid4(), email=f"sa_{_uuid.uuid4().hex[:8]}@example.com",
                username=f"sa{_uuid.uuid4().hex[:8]}", hashed_password="x", user_type="super_admin",
                is_active=True, is_verified=True)
    db_session.add_all([tester, boss])
    db_session.flush()
    db_session.add(TravelPlan(id=_uuid.uuid4(), user_id=tester.id, title="[運用の試験] 家族旅行(Fake)"))
    db_session.flush()
    after = client.get("/api/v1/admin/stats/system").json()
    u0, u1 = before["users"], after["users"]
    assert u1["total_users"] == u0["total_users"] + 2
    assert u1["test_accounts"] == u0["test_accounts"] + 1
    assert u1["user_types"]["admin"] == u0["user_types"]["admin"] + 1, "super_admin は管理者に数える"
    assert u1["registered_excluding_tests"] == u0["registered_excluding_tests"]
    assert "試験" in u1["breakdown_note"]
    p0, p1 = before["travel_plans"], after["travel_plans"]
    assert p1["total_plans"] == p0["total_plans"] + 1 and p1["test_plans"] == p0["test_plans"] + 1
