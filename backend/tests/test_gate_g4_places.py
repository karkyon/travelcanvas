"""[Gate G4] MAP-02 場所の営業時間の細かさ(最終入場・ラストオーダー・日付ごとの例外・入口・出典の違い)。

- 例外の日は曜日の営業時間より優先する(臨時休業・特別営業)。前の日から続く深夜営業もその日に数える
- 最終入場は ERROR、ラストオーダーは食事の予定だけ WARNING。昼休みのある店(区切り2つ)を正しく判定する
- API: 例外の日・入口の置き換え(If-Match・入力の検証)、その日の営業時間の確認、出典の違いの表示
"""
import uuid
from datetime import date

import pytest

from app.api.v1 import places as places_api
from app.api.v1 import candidates as candidates_api
from app.services import feasibility as fz
from app.services import place_hours
from app.services.constraint_evaluation import ConstraintSet

from tests.test_gate_l3_validation import _day, _event, _snap

MON = date(2026, 11, 2)  # 月曜日


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    monkeypatch.setattr(places_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(candidates_api, "record_audit_event", lambda **kw: None)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


# ---------------------------------------------------------------- 純粋関数

def test_day_hours_special_overrides_weekly_and_overnight():
    weekly = [fz.HoursInfo(0, "09:00", "17:00", last_entry="16:30"), fz.HoursInfo(6, "18:00", "02:00")]
    dh = place_hours.day_hours(MON, weekly, [])
    # 月曜: 09:00〜17:00 と、日曜の 18:00〜02:00 の続き
    assert dh.source == "weekly" and [w.source for w in dh.windows] == ["overnight", "weekly"]
    assert dh.windows[1].last_entry.strftime("%H:%M") == "16:30"
    closed = place_hours.day_hours(MON, weekly, [fz.SpecialHoursInfo(MON, "closed", None, None, note="臨時休業")])
    assert closed.closed and closed.source == "special" and closed.note == "臨時休業"
    assert "臨時休業" in place_hours.describe(closed)
    special = place_hours.day_hours(MON, weekly, [fz.SpecialHoursInfo(MON, "open", "10:00", "12:00")])
    assert special.source == "special" and [w.label for w in special.windows] == ["10:00〜12:00"]
    other_day = place_hours.day_hours(date(2026, 11, 3), weekly, [fz.SpecialHoursInfo(MON, "closed", None, None)])
    assert other_day.closed and other_day.source == "weekly"  # 火曜は定休日(曜日の営業時間に無い)
    assert place_hours.day_hours(MON, [], []).source == "unknown"
    j = place_hours.to_json(dh)
    assert j["windows"][0]["crosses_midnight"] is True and j["summary"].startswith("11/02(月)")


def test_parse_hm():
    assert place_hours.parse_hm("24:00").hour == 23
    for bad in (None, "", "9", "25:00", "12:60", "aa:bb"):
        assert place_hours.parse_hm(bad) is None


def test_feasibility_split_hours_last_entry_last_order_and_special():
    d = _day()  # 月曜日
    place = uuid.uuid4()
    hours = {place: [fz.HoursInfo(0, "11:00", "14:00", last_order="13:30"),
                     fz.HoursInfo(0, "17:00", "22:00", last_entry="21:00", last_order="21:30")]}
    lunch = _event(d, "昼", "12:00", "13:00", event_type="dining", place_id=place)
    gap = _event(d, "休み時間", "15:00", place_id=place)
    late_order = _event(d, "遅い昼", "13:45", "14:00", event_type="dining", place_id=place)
    late_entry = _event(d, "遅い入場", "21:15", "21:50", place_id=place)
    r = fz.evaluate(_snap([d], [lunch, gap, late_order, late_entry], hours=hours), ConstraintSet())
    by = {}
    for f in r.findings:
        by.setdefault(f.entity_id, []).append(f.code)
    assert lunch.id not in by
    assert by[gap.id] == ["OUTSIDE_OPENING_HOURS"]
    assert by[late_order.id] == ["AFTER_LAST_ORDER"]
    assert by[late_entry.id] == ["AFTER_LAST_ENTRY"]
    sev = {f.code: f.severity for f in r.findings}
    assert sev["AFTER_LAST_ORDER"] == "WARNING" and sev["AFTER_LAST_ENTRY"] == "ERROR"
    # ラストオーダーは食事の予定だけ
    museum = _event(d, "見学", "13:45", "13:55", place_id=place)
    assert fz.evaluate(_snap([d], [museum], hours=hours), ConstraintSet()).findings == []

    snap = _snap([d], [lunch], hours=hours)
    snap.special_hours = {place: [fz.SpecialHoursInfo(d.local_date, "closed", None, None, note="年末年始")]}
    res = fz.evaluate(snap, ConstraintSet())
    assert [f.code for f in res.findings] == ["CLOSED_ON_DATE"] and "年末年始" in res.findings[0].message


# ---------------------------------------------------------------- API

def _place(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "G4場所"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()["id"]
    cid = client.post(f"{base}/candidates", json={"title": "美術館", "address": "京都市"}).json()["id"]
    s = client.post(f"{base}/candidates/{cid}/schedule", json={"day_id": day, "event_type": "activity"},
                    headers={"If-Match": "1"}).json()
    return s["place_id"], base, day


def test_special_hours_entrances_day_hours_api(auth_client, make_user):
    client, _owner = auth_client
    pid, _base, _day_id = _place(client)
    url = f"/api/v1/places/{pid}"
    rev = client.get(url).json()["revision"]
    # 最終入場つきの曜日の営業時間
    r = client.put(f"{url}/opening-hours", json={"hours": [
        {"day_of_week": 0, "open_time": "09:00", "close_time": "17:00", "last_entry": "16:30"}]},
        headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert r.json()["opening_hours"][0]["last_entry"] == "16:30"
    rev = r.json()["revision"]
    # 最終入場が営業時間の外 → 422
    bad = client.put(f"{url}/opening-hours", json={"hours": [
        {"day_of_week": 0, "open_time": "09:00", "close_time": "17:00", "last_entry": "18:00"}]},
        headers={"If-Match": str(rev)})
    assert bad.status_code == 422
    # 例外の日
    items = [{"local_date": "2026-11-02", "kind": "closed", "note": "臨時休業"},
             {"local_date": "2026-11-09", "kind": "open", "open_time": "10:00", "close_time": "12:00"}]
    assert client.put(f"{url}/special-hours", json={"items": items}, headers={"If-Match": "1"}).status_code == 409
    r = client.put(f"{url}/special-hours", json={"items": items}, headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert [x["local_date"] for x in r.json()["special_hours"]] == ["2026-11-02", "2026-11-09"]
    rev = r.json()["revision"]
    for wrong in ([{"local_date": "2026-11-02", "kind": "closed", "open_time": "10:00"}],
                  [{"local_date": "2026-11-02", "kind": "open", "open_time": "10:00"}],
                  [{"local_date": "2026-11-02", "kind": "closed"}, {"local_date": "2026-11-02", "kind": "open",
                                                                    "open_time": "10:00", "close_time": "11:00"}],
                  [{"local_date": "2026-11-02", "kind": "holiday"}]):
        assert client.put(f"{url}/special-hours", json={"items": wrong},
                          headers={"If-Match": str(rev)}).status_code == 422, wrong
    # その日の営業時間
    h = client.get(f"{url}/hours", params={"date": "2026-11-02"}).json()
    assert h["closed"] is True and h["source"] == "special" and h["note"] == "臨時休業"
    h = client.get(f"{url}/hours", params={"date": "2026-11-09"}).json()
    assert h["source"] == "special" and h["windows"][0]["open"] == "10:00"
    h = client.get(f"{url}/hours", params={"date": "2026-11-16"}).json()
    assert h["source"] == "weekly" and h["windows"][0]["last_entry"] == "16:30"
    assert client.get(f"{url}/hours", params={"date": "x"}).status_code == 422
    # 入口
    ents = [{"label": "正面", "latitude": 35.0, "longitude": 135.7, "accessible": True},
            {"label": "駐車場", "note": "北側"}]
    r = client.put(f"{url}/entrances", json={"entrances": ents}, headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    assert [e["label"] for e in r.json()["entrances"]] == ["正面", "駐車場"]
    rev = r.json()["revision"]
    assert client.put(f"{url}/entrances", json={"entrances": [{"label": "正面"}, {"label": "正面"}]},
                      headers={"If-Match": str(rev)}).status_code == 422
    assert client.put(f"{url}/entrances", json={"entrances": [{"label": "x", "latitude": 95, "longitude": 0}]},
                      headers={"If-Match": str(rev)}).status_code in (400, 422)
    assert client.put(f"{url}/entrances", json={"entrances": [{"label": "e%d" % i} for i in range(11)]},
                      headers={"If-Match": str(rev)}).status_code == 422
    # 他人は見られない・直せない
    other, _ = make_user()
    from tests.test_gate_c2_candidates_places import _act_as
    _act_as(other)
    try:
        assert client.get(f"{url}/hours", params={"date": "2026-11-02"}).status_code == 404
        assert client.put(f"{url}/entrances", json={"entrances": []},
                          headers={"If-Match": str(rev)}).status_code == 404
    finally:
        _act_as(_owner)


def test_source_history_shows_values_per_source(auth_client):
    client, _owner = auth_client
    pid, _base, _day = _place(client)
    url = f"/api/v1/places/{pid}"
    rev = client.get(url).json()["revision"]
    r = client.patch(url, json={"phone": "+81 75-111-1111"}, headers={"If-Match": str(rev)})
    r = client.patch(url, json={"phone": "+81 75-222-2222"}, headers={"If-Match": str(r.json()["revision"])})
    d = client.get(url).json()
    hist = d["source_history"]
    # 同じトランザクションの中では now() が同じなので、順は比べず値の組で確かめる(本番は要求ごとに別のトランザクション)
    assert "phone" in hist and {"+81 75-222-2222", "+81 75-111-1111"} <= {x["value"] for x in hist["phone"]}
    assert all(len({x["value"] for x in items}) > 1 for items in hist.values())  # 値が同じ項目は出さない
    assert all({"value", "label", "provider"} <= set(x) for items in hist.values() for x in items)
    assert all(len(items) <= 5 for items in hist.values())
