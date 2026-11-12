"""[Gate PlanB-Next] 日ごとの案の続き: 天気の予報の自動取得・押した時だけの AI の確かめ・雨の日の屋内の候補(範囲の検索)
・控えの案の予定の入れ替え・オフラインの切り替え(同期)・もしもの案の表の削除。

外への通信は httpx.MockTransport で差し替える(実の Open-Meteo・OpenAI・場所の検索へは送らない)。
"""
import uuid
from datetime import date, timedelta

import httpx
import pytest

from app.services import weather_forecast as wfc
from tests import test_gate_providerconnect as pcon

_plan, _ready = pcon._plan, pcon._ready
admin, net = pcon.admin, pcon.net  # 同じ fixture を使う(鍵の確認・外への通信の差し替え)


@pytest.fixture()
def adapters():
    """実装済みの adapter の登録(ほかの試験が外したままにしても、ここでは登録した状態で始める)"""
    from app.services import provider_calls as pc

    pc.register_all()
    yield


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _setup(client, day0=None):
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d0 = day0 or date.today() + timedelta(days=2)
    d = client.post(f"{base}/days", json={"local_date": d0.isoformat(), "timezone_id": "Asia/Tokyo"},
                    headers=_ik()).json()
    evs = {}
    for title, t, at in (("伊勢神宮", "sightseeing", "09:00"), ("河原でバーベキュー", "dining", "12:00"),
                         ("鳥羽水族館", "sightseeing", "15:00")):
        evs[title] = client.post(f"{base}/events", json={"day_id": d["id"], "title": title, "event_type": t,
                                                         "local_start_time": at, "latitude": 34.45,
                                                         "longitude": 136.75}, headers=_ik()).json()
    return p, base, d, evs, d0


@pytest.fixture()
def meteo():
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        assert request.url.host == "api.open-meteo.com"
        day = request.url.params["start_date"]
        probs = [10] * 11 + [70, 80, 85, 60] + [20] * 9  # 11 時〜15 時が雨
        return httpx.Response(200, json={
            "daily": {"time": [day], "weather_code": [63], "precipitation_probability_max": [80],
                      "precipitation_sum": [12.5], "temperature_2m_max": [16.2], "temperature_2m_min": [9.1]},
            "hourly": {"time": [f"{day}T{h:02d}:00" for h in range(24)], "precipitation_probability": probs,
                       "precipitation": [0.0] * 24}})
    wfc.set_transport(httpx.MockTransport(handler))
    yield sent
    wfc.set_transport(None)


def test_weather_forecast_rounds_coordinates_caches_and_suggests_rain_variant(auth_client, meteo):
    client, _ = auth_client
    p, base, d, evs, d0 = _setup(client)
    r = client.get(f"{base}/weather")
    assert r.status_code == 200, r.text
    f = r.json()["forecasts"][0]
    assert (f["date"], f["label"], f["precipitation_probability"], f["rainy"], f["has_rain_variant"]) == (
        d0.isoformat(), "雨", 80, True, False)
    # 時間ごと: 雨の時間帯と、その時間に始まる屋外の予定(BBQ 12:00)。屋内の水族館(15:00)・晴れの時間の神社は出さない
    assert f["rain_hours"] == ["11時〜15時"]
    assert [(x["title"], x["time"], x["probability"]) for x in f["affected_events"]] == [("河原でバーベキュー", "12:00", 80)]
    # 送ったのは丸めた座標と日付だけ(予定の名前は送らない)
    q = meteo[0].url.params
    assert (q["latitude"], q["longitude"]) == ("34.4", "136.8") and "伊勢" not in str(meteo[0].url)
    client.get(f"{base}/weather")
    assert len(meteo) == 1  # 使い回す
    # 雨の案を作ると has_rain_variant
    client.post(f"{base}/variants", json={"local_date": d0.isoformat(), "source": "copy_active", "reason": "rain"})
    assert client.get(f"{base}/weather").json()["forecasts"][0]["has_rain_variant"] is True
    # 今日の切り替え: 予報が雨ならおすすめを付ける(知らせが無くても)
    so = client.get(f"{base}/today/switch-options", params={"date": d0.isoformat(), "at": "08:00"}).json()
    assert so["forecast"]["rainy"] is True and so["options"][0]["recommended"] is True
    # 16 日より先・座標の無い日は予報なし(外へ送らない)
    assert wfc.forecast(34.4, 136.7, date.today() + timedelta(days=30), "Asia/Tokyo") is None
    assert wfc.forecast(None, None, d0, "Asia/Tokyo") is None


def test_weather_failure_is_no_forecast(auth_client):
    def boom(request):
        raise httpx.ConnectError("down")
    wfc.set_transport(httpx.MockTransport(boom))
    try:
        client, _ = auth_client
        p, base, d, evs, d0 = _setup(client)
        assert client.get(f"{base}/weather").json()["forecasts"] == []
    finally:
        wfc.set_transport(None)


def test_ai_check_goes_through_consent_class_and_budget(adapters, admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, *_ = _plan(db_session, user, "journey")
    base = f"/api/v1/plans/{plan.id}"
    db_session.commit()
    v = client.post(f"{base}/variants", json={"local_date": "2026-11-28", "source": "copy_active", "reason": "rain"})
    assert v.status_code == 201, v.text
    day_id = v.json()["variants"][0]["day_id"]
    r = client.post(f"{base}/variants/{day_id}/ai-check", headers=_ik())
    assert r.status_code == 200, r.text
    assert r.json()["result"]["text"].startswith("1. 有馬温泉") and r.json()["saved"] is False
    sent = net.requests[-1].content.decode()
    assert "雨" in sent and "枚方" in sent  # 案の予定と理由を送る
    # Idempotency-Key が無ければ送らない
    assert client.post(f"{base}/variants/{day_id}/ai-check").status_code == 422


def test_ai_check_free_class_sends_nothing(adapters, admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, *_ = _plan(db_session, user, "free")
    db_session.commit()
    base = f"/api/v1/plans/{plan.id}"
    day_id = client.post(f"{base}/variants", json={"local_date": "2026-11-28", "source": "blank"}).json()[
        "variants"][0]["day_id"]
    r = client.post(f"{base}/variants/{day_id}/ai-check", headers=_ik())
    assert r.status_code in (402, 403, 429), r.text
    assert net.requests == []


def test_indoor_candidates_and_replace_outdoor_event(auth_client, monkeypatch):
    from app.services import place_finder as pf

    client, _ = auth_client
    p, base, d, evs, d0 = _setup(client)
    v = client.post(f"{base}/variants", json={"local_date": d0.isoformat(), "source": "copy_active", "reason": "rain",
                                              "scaffold": True}).json()["variants"][0]
    vday = client.get(f"{base}/variants/{v['day_id']}").json()["day"]
    bbq = next(e for e in vday["events"] if e["title"] == "河原でバーベキュー")
    calls = []

    async def fake_find(db, plan, query, genre, scope, record, points=None):
        calls.append((query, scope, points))
        table = {
            "水族館": [{"name": "鳥羽水族館", "category": "sightseeing", "distance_km": 3.0, "providers": ["x"]},
                    {"name": "海の博物館", "category": "sightseeing", "distance_km": 5.1, "providers": ["x"]}],
            "美術館": [{"name": "海辺のバーベキュー場", "category": "activity", "distance_km": 1.0, "providers": ["x"]},
                    {"name": "伊勢美術館", "category": "sightseeing", "distance_km": 2.0, "latitude": 34.46,
                     "longitude": 136.71, "providers": ["x"]}],
        }
        rows = table.get(query, [])
        return {"candidates": rows, "region": {"label": "この日の範囲", "radius_km": 5}, "sources": [],
                "failed_providers": []}
    monkeypatch.setattr(pf, "find", fake_find)
    r = client.post(f"{base}/variants/{v['day_id']}/indoor-candidates", json={"near_event_id": bbq["id"]})
    assert r.status_code == 200, r.text
    names = [c["name"] for c in r.json()["candidates"]]
    # 案にもう入っている水族館・屋外のバーベキュー場は出さない。近い順
    assert names == ["伊勢美術館", "海の博物館"] and r.json()["near_event"] == "河原でバーベキュー"
    assert calls[0][1] == "area" and calls[0][2] == [(34.45, 136.75)]  # 入れ替える予定の場所の範囲
    # 入れ替え: 同じ時刻に入り、屋外の予定は外れる。今の案は変わらない
    rev = _rev(client, p)
    rp = client.post(f"{base}/variants/{v['day_id']}/replace", json={
        "replace_event_id": bbq["id"], "name": "伊勢美術館", "latitude": 34.46, "longitude": 136.71},
        headers={"If-Match": str(rev)})
    assert rp.status_code == 200, rp.text
    after = {e["title"]: e["local_start_time"][:5] for e in client.get(f"{base}/variants/{v['day_id']}").json()[
        "day"]["events"]}
    assert after == {"伊勢神宮": "09:00", "伊勢美術館": "12:00", "鳥羽水族館": "15:00"}
    assert [e["title"] for e in client.get(f"/api/v1/plans/{p}").json()["days"][0]["events"]] == [
        "伊勢神宮", "河原でバーベキュー", "鳥羽水族館"]
    # 元に戻す
    assert client.post(f"{base}/undo", headers={"If-Match": str(_rev(client, p))}).status_code == 200
    back = [e["title"] for e in client.get(f"{base}/variants/{v['day_id']}").json()["day"]["events"]]
    assert "河原でバーベキュー" in back and "伊勢美術館" not in back
    # 今の案では入れ替えられない
    active_id = d["id"]
    assert client.post(f"{base}/variants/{active_id}/replace", json={"name": "x"},
                       headers={"If-Match": str(_rev(client, p))}).status_code == 409


def test_offline_switch_via_sync_applies_conflicts_and_resolves(auth_client):
    client, _ = auth_client
    p, base, d, evs, d0 = _setup(client)
    b = client.post(f"{base}/variants", json={"local_date": d0.isoformat(), "source": "copy_active",
                                              "name": "雨の日"}).json()["variants"][0]
    c = client.post(f"{base}/variants", json={"local_date": d0.isoformat(), "source": "blank",
                                              "name": "2人"}).json()["variants"][0]
    rev = _rev(client, p)

    def op(to, seen, op_id=None):
        return {"operation_id": op_id or str(uuid.uuid4()), "entity_type": "variant", "action": "switch",
                "entity_id": to, "base_revision": rev,
                "fields": {"from_day_id": seen, "reason": "rain", "phase": "during", "place_label": "鳥羽のあたり"}}
    first = op(b["day_id"], d["id"])
    r = client.post(f"{base}/sync", json={"device_id": "dev-1", "operations": [first]})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["status"] == "applied"
    lst = client.get(f"{base}/variants").json()["dates"][d0.isoformat()]
    assert next(x for x in lst if x["status"] == "active")["label"] == "B"
    sw = client.get(f"{base}/variant-switches").json()["switches"][0]
    assert sw["place_label"] == "鳥羽のあたり" and sw["phase"] == "during"
    # 同じ操作の再送は二重にしない
    again = client.post(f"{base}/sync", json={"device_id": "dev-1", "operations": [first]}).json()
    assert again["results"][0]["status"] == "already_applied"
    # 別の端末は A を見ていた(その後サーバーで B に変わった)→ 黙って上書きせず競合
    other = op(c["day_id"], d["id"])
    res = client.post(f"{base}/sync", json={"device_id": "dev-2", "operations": [other]}).json()["results"][0]
    assert res["status"] == "conflicted" and res["code"] == "changed_on_server"
    conflicts = client.get(f"{base}/sync/conflicts").json()["conflicts"]
    assert conflicts[0]["entity_type"] == "variant" and conflicts[0]["current"] == {"active": "B 雨の日"}
    # 自分の切り替えを使う
    ok = client.post(f"{base}/sync/conflicts/{other['operation_id']}/resolve", json={"resolution": "use_mine"},
                     headers={"If-Match": str(_rev(client, p))})
    assert ok.status_code == 200, ok.text
    lst = client.get(f"{base}/variants").json()["dates"][d0.isoformat()]
    assert next(x for x in lst if x["status"] == "active")["label"] == "C"


def test_branches_table_is_gone(db_session):
    from sqlalchemy import inspect

    from app.models import models as m

    assert not hasattr(m, "ItineraryBranch")
    assert "itinerary_branches" not in inspect(db_session.get_bind()).get_table_names()


def test_branch_migration_copies_jsonb_event_columns(auth_client, db_session):
    """[PlanB-P8 の直し] 移行で予定を写す時、JSONB の列(urls・dining)を正しく渡す(以前は型の無い表で写し、
    omega-dev2 の移行が「can't adapt type 'dict'」で止まった)"""
    import importlib.util
    import pathlib

    import sqlalchemy as sa

    from app.models.models import TravelDay, TravelEvent

    client, _ = auth_client
    p, base, d, evs, d0 = _setup(client)
    src = db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(evs["河原でバーベキュー"]["id"])).one()
    src.urls = ["https://bbq.example/menu"]
    src.dining = {"budget": "3000", "notes": "雨天中止"}
    db_session.commit()
    versions = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"
    path = versions / "f3a8c1d5e9b2_planb_migrate_branches.py"
    spec = importlib.util.spec_from_file_location("planb_migrate_branches", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    conn = db_session.connection()
    events = sa.Table("travel_events", sa.MetaData(), autoload_with=conn)
    nd = TravelDay(plan_id=uuid.UUID(p), local_date=d0, timezone_id="Asia/Tokyo", variant_status="standby",
                   variant_label="B")
    db_session.add(nd)
    db_session.flush()
    new_id = uuid.uuid4()
    mig._copy_event(conn, events, src.id, new_id, nd.id, {"local_start_time": "12:30"})
    db_session.commit()
    from app.services import day_variants as dv

    with dv.all_variants(db_session):
        got = db_session.query(TravelEvent).filter(TravelEvent.id == new_id).one()
    assert got.urls == ["https://bbq.example/menu"] and got.dining == {"budget": "3000", "notes": "雨天中止"}
    assert got.local_start_time == "12:30" and got.variant_standby is True and got.day_id == nd.id
