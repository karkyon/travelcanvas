"""[Gate PlanSpotEdit] 旅程のスポットの編集(課題一覧 #3)の試験。

- 1 日の並べ替え(POST /plans/{id}/days/{day_id}/reorder): スポットだけを入れ替え、時刻・移動手段は位置に残す。
  1 回の「元に戻す」で予定と区間の全部が戻る。確定の予定は動かせない。過不足のある並びは 400。If-Match。
- 予定の電話番号(作成・変更・空で消す・元に戻す・見せない設定で隠す)
- 場所の情報の取得(POST /spots/place-info): OpenStreetMap(Nominatim)の結果の整形・出典・保存した結果の再利用・
  提供元の失敗を 0 件と区別する(外へは送らない。httpx を差し替える)
"""
import uuid

import httpx
import pytest

from app.models.models import PlanCollaborator, TravelSegment
from app.services import place_info as pi


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "鳥羽"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    tz = "Asia/Tokyo"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": tz}, headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-11-29", "timezone_id": tz}, headers=_ik()).json()
    return p, base, d1, d2


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _ev(client, base, day, title, start=None, end=None, **kw):
    body = {"day_id": day["id"], "title": title, "event_type": "sightseeing", **kw}
    if start:
        body["local_start_time"] = start
    if end:
        body["local_end_time"] = end
    r = client.post(f"{base}/events", json=body, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()


def _seg(client, base, a, b, mode):
    body = {"from_event_id": a["id"], "to_event_id": b["id"], "mode": mode, "duration_minutes": 10}
    r = client.post(f"{base}/segments", json=body, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()


def _day_events(client, p, day_id):
    days = client.get(f"/api/v1/plans/{p}").json()["days"]
    return next(d for d in days if d["id"] == day_id)["events"]


def test_reorder_keeps_time_slots_and_segment_modes_and_undo_restores_all(auth_client, db_session):
    client, _owner = auth_client
    p, base, d1, d2 = _plan(client)
    a = _ev(client, base, d1, "ミキモト真珠島", "09:00", "10:30")
    b = _ev(client, base, d1, "賀多神社", "11:00", "11:30")
    c = _ev(client, base, d1, "鳥羽1番街", "12:00", "13:00")
    nxt = _ev(client, base, d2, "伊勢神宮", "09:00")
    s_ab = _seg(client, base, a, b, "train")
    s_bc = _seg(client, base, b, c, "driving")
    s_cn = _seg(client, base, c, nxt, "bus")  # 次の日の予定へつながる区間
    rev = _rev(client, p)

    # A と C を入れ替える(ドラッグ): 並び C, B, A
    r = client.post(f"{base}/days/{d1['id']}/reorder", json={"order": [c["id"], b["id"], a["id"]]},
                    headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["revision"] == rev + 1  # 1 つの変更
    got = [(e["title"], e["local_start_time"], e["local_end_time"]) for e in body["day"]["events"]]
    assert got == [("鳥羽1番街", "09:00", "10:30"), ("賀多神社", "11:00", "11:30"), ("ミキモト真珠島", "12:00", "13:00")]

    segs = {str(s.id): s for s in db_session.query(TravelSegment).filter(TravelSegment.plan_id == uuid.UUID(p))}
    for s in segs.values():
        db_session.refresh(s)
    # 1 番目→2 番目の区間は鉄道のまま(端が C→B に付け替わる)。2→3 は車。3 番目→翌日は バス
    assert (str(segs[s_ab["id"]].from_event_id), str(segs[s_ab["id"]].to_event_id), segs[s_ab["id"]].mode) \
        == (c["id"], b["id"], "train")
    assert (str(segs[s_bc["id"]].from_event_id), str(segs[s_bc["id"]].to_event_id), segs[s_bc["id"]].mode) \
        == (b["id"], a["id"], "driving")
    assert (str(segs[s_cn["id"]].from_event_id), str(segs[s_cn["id"]].to_event_id)) == (a["id"], nxt["id"])

    # 1 回の「元に戻す」で予定の並び・時刻と区間の端が全部戻る
    u = client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)})
    assert u.status_code == 200, u.text
    back = [(e["title"], e["local_start_time"]) for e in _day_events(client, p, d1["id"])]
    assert back == [("ミキモト真珠島", "09:00"), ("賀多神社", "11:00"), ("鳥羽1番街", "12:00")]
    db_session.expire_all()
    seg = db_session.get(TravelSegment, uuid.UUID(s_ab["id"]))
    assert (str(seg.from_event_id), str(seg.to_event_id)) == (a["id"], b["id"])
    seg = db_session.get(TravelSegment, uuid.UUID(s_cn["id"]))
    assert (str(seg.from_event_id), str(seg.to_event_id)) == (c["id"], nxt["id"])


def test_reorder_without_keep_slots_moves_times_with_events(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    a = _ev(client, base, d1, "A", "09:00")
    b = _ev(client, base, d1, "B", "11:00")
    r = client.post(f"{base}/days/{d1['id']}/reorder", json={"order": [b["id"], a["id"]], "keep_slots": False},
                    headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    assert [(e["title"], e["local_start_time"]) for e in r.json()["day"]["events"]] == [("B", "11:00"), ("A", "09:00")]


def test_reorder_guards(auth_client, make_user, db_session):
    client, owner = auth_client
    p, base, d1, _d2 = _plan(client)
    a = _ev(client, base, d1, "A", "09:00")
    b = _ev(client, base, d1, "B", "11:00")
    url = f"{base}/days/{d1['id']}/reorder"
    rev = _rev(client, p)
    # 版が古い
    assert client.post(url, json={"order": [b["id"], a["id"]]}, headers={"If-Match": str(rev - 1)}).status_code == 409
    # 過不足
    bad = client.post(url, json={"order": [b["id"]]}, headers={"If-Match": str(rev)})
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "order_mismatch"
    dup = client.post(url, json={"order": [a["id"], a["id"]]}, headers={"If-Match": str(rev)})
    assert dup.status_code == 400
    # 同じ並び: 変更なし(版は進まない)
    same = client.post(url, json={"order": [a["id"], b["id"]]}, headers={"If-Match": str(rev)})
    assert same.status_code == 200 and same.json()["revision"] == rev
    # 確定の予定は動かせない
    lk = client.put(f"{base}/events/{a['id']}", json={"locked": True}, headers={"If-Match": str(rev)})
    assert lk.status_code == 200, lk.text
    locked = client.post(url, json={"order": [b["id"], a["id"]]}, headers={"If-Match": str(rev + 1)})
    assert locked.status_code == 409 and locked.json()["detail"]["code"] == "locked_event"
    # 閲覧だけの人は並べ替えられない
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    from app.core.auth import AuthResult, get_current_user
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    try:
        assert client.post(url, json={"order": [a["id"], b["id"]]},
                           headers={"If-Match": str(rev + 1)}).status_code == 403
    finally:
        app.dependency_overrides[get_current_user] = lambda: AuthResult(user=owner, is_authenticated=True,
                                                                        is_guest=False)


def test_event_phone_create_update_clear_and_undo(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    e = _ev(client, base, d1, "ミキモト真珠島", phone=" 0599-25-2028 ")
    assert e["phone"] == "0599-25-2028"
    rev = _rev(client, p)
    r = client.put(f"{base}/events/{e['id']}", json={"phone": "0599-00-0000"}, headers={"If-Match": str(rev)})
    assert r.status_code == 200 and r.json()["phone"] == "0599-00-0000"
    r = client.put(f"{base}/events/{e['id']}", json={"phone": ""}, headers={"If-Match": str(rev + 1)})
    assert r.status_code == 200 and r.json()["phone"] is None
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 2)}).status_code == 200
    assert _day_events(client, p, d1["id"])[0]["phone"] == "0599-00-0000"
    too_long = client.put(f"{base}/events/{e['id']}", json={"phone": "0" * 41}, headers={"If-Match": str(rev + 3)})
    assert too_long.status_code == 422


def test_phone_is_hidden_with_address_for_members():
    from app.services import member_policy as mp

    out = mp.mask_event_dict({"address": "三重県鳥羽市", "phone": "0599", "title": "x"}, frozenset({"event_address"}))
    assert out["phone"] is None and out["address"] is None and out["title"] == "x"
    assert mp.forbidden_write_fields(frozenset({"event_address"}), ["phone"]) == ["phone"]


# ================================================================ 場所の情報(OpenStreetMap)

SEARCH = [{
    "place_id": 1, "osm_type": "way", "osm_id": 123, "lat": "34.4836", "lon": "136.8460",
    "category": "tourism", "type": "attraction", "name": "ミキモト真珠島",
    "display_name": "ミキモト真珠島, 1, 鳥羽一丁目, 鳥羽市, 三重県, 517-8511, 日本",
    "address": {"country_code": "jp"},
    "extratags": {"phone": "+81 599-25-2028;+81 599-00-0000", "website": "https://www.mikimoto-pearl-museum.co.jp/"},
}]


@pytest.fixture()
def nominatim(monkeypatch):
    pi.reset()
    calls = []
    state = {"status": 200, "body": SEARCH}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(state["status"], json=state["body"])

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient

    monkeypatch.setattr(pi.httpx, "AsyncClient", lambda *a, **kw: real(transport=transport))
    monkeypatch.setattr(pi, "MIN_INTERVAL", 0.0)
    yield calls, state
    pi.reset()


def test_place_info_formats_japanese_address_phone_and_category(auth_client, nominatim):
    client, _owner = auth_client
    calls, _state = nominatim
    r = client.post("/api/v1/spots/place-info", json={"name": "ミキモト真珠島", "latitude": 34.48, "longitude": 136.84})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attribution"] == "© OpenStreetMap contributors" and body["license"] == "ODbL 1.0"
    c = body["candidates"][0]
    assert c["address"] == "〒517-8511 三重県鳥羽市鳥羽一丁目1"
    assert c["phone"] == "+81 599-25-2028"
    assert c["category"] == "sightseeing"
    assert c["source_url"] == "https://www.openstreetmap.org/way/123"
    req = calls[0]
    assert req.url.path == "/search" and req.url.params["accept-language"] == "ja"
    assert req.headers["user-agent"].startswith("TravelCanvas/")
    assert "viewbox" in req.url.params
    # 同じ問い合わせは保存した結果を使う(外へ送らない)
    again = client.post("/api/v1/spots/place-info", json={"name": "ミキモト真珠島", "latitude": 34.48, "longitude": 136.84})
    assert again.json()["cached"] is True and len(calls) == 1


def test_place_info_reverse_by_position_and_provider_failure(auth_client, nominatim):
    client, _owner = auth_client
    calls, state = nominatim
    state["body"] = {**SEARCH[0], "name": ""}
    r = client.post("/api/v1/spots/place-info", json={"latitude": 34.4836, "longitude": 136.846})
    assert r.status_code == 200 and calls[-1].url.path == "/reverse"
    assert r.json()["candidates"][0]["address"].startswith("〒517-8511 三重県鳥羽市")
    state["status"] = 503
    fail = client.post("/api/v1/spots/place-info", json={"name": "存在しない"}).json()
    assert fail["unavailable"] is True and fail["candidates"] == [] and fail["error_code"] == "server_error"
    assert client.post("/api/v1/spots/place-info", json={}).status_code == 422


def test_event_category_mapping():
    assert pi.event_category("amenity", "restaurant") == "dining"
    assert pi.event_category("tourism", "hotel") == "accommodation"
    assert pi.event_category("shop", "gift") == "shopping"
    assert pi.event_category("railway", "station") == "transportation"
    assert pi.event_category("amenity", "place_of_worship") == "sightseeing"
    assert pi.event_category("leisure", "park") == "activity"
    assert pi.event_category("amenity", "bench") is None
