"""
[Gate EventArea] エリアの中の予定(おかげ横丁の中の赤福・ダンデライオン)。

確かめる性質:
- エリア(event_type='area')の中へ入れられる。中の予定はいつもエリアのすぐ後ろに並ぶ(後から足しても・外しても)
- 決まり: 同じ日のエリアだけ・入れ子にしない・自分自身には入らない・エリアでない予定には入らない(400 と code)
- エリアの種類をやめる・エリアを消す・別の日へ移すと、中の予定は外れる。消したエリアを元に戻すと中の予定も戻る
- 並べ替えでエリアの中の予定がばらばらに送られても、エリアの後ろへ直す
- 「移動手段を決める」の区間の数に、エリアの中の移動は入れない
"""
import uuid
from types import SimpleNamespace

from app.services import event_area
from app.services.dashboard_home import segment_progress


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢・鳥羽"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    tz = "Asia/Tokyo"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": tz}, headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-11-29", "timezone_id": tz}, headers=_ik()).json()
    return p, base, d1, d2


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _ev(client, base, day, title, event_type="sightseeing", **kw):
    r = client.post(f"{base}/events", json={"day_id": day["id"], "title": title, "event_type": event_type, **kw},
                    headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()


def _order(client, p, day_id):
    days = client.get(f"/api/v1/plans/{p}").json()["days"]
    evs = next(d for d in days if d["id"] == day_id)["events"]
    return [(e["title"], e["parent_event_id"]) for e in evs]


def _put(client, p, base, ev, **body):
    return client.put(f"{base}/events/{ev['id']}", json=body, headers={"If-Match": str(_rev(client, p))})


# ===== 純粋な関数

def _e(i, t="sightseeing", parent=None):
    return SimpleNamespace(id=i, event_type=t, parent_event_id=parent)


def test_grouped_order_puts_members_after_area_and_drops_invalid():
    area, other_area = _e("A", "area"), _e("B", "area")
    m1, m2, x, bad = _e("m1", parent="A"), _e("m2", parent="A"), _e("x"), _e("bad", "area", parent="B")
    lost = _e("lost", parent="ZZZ")
    order, drop = event_area.grouped_order([m1, x, area, lost, m2, other_area, bad])
    assert [e.id for e in order] == ["x", "A", "m1", "m2", "lost", "B", "bad"]
    assert {e.id for e in drop} == {"bad", "lost"}  # 入れ子のエリア・同じ日に無いエリア


def test_inner_pairs_are_not_counted_as_moves():
    area, m1, m2, nxt = _e("A", "area"), _e("m1", parent="A"), _e("m2", parent="A"), _e("n")
    for e in (area, m1, m2, nxt):
        e.day_id = "d"
    assert event_area.is_inner_pair(area, m1) and event_area.is_inner_pair(m1, m2)
    assert not event_area.is_inner_pair(m2, nxt)
    # 区間: 予定 → エリア(数える)・エリアの中 2 つ(数えない)・中 → 次の予定(数える)
    before = _e("b")
    before.day_id = "d"
    assert segment_progress([before, area, m1, m2, nxt], {})["need"] == 2


# ===== API

def test_put_events_into_area_keeps_them_after_area(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    ise = _ev(client, base, d1, "伊勢神宮")
    area = _ev(client, base, d1, "おかげ横丁", "area", local_start_time="13:45", local_end_time="15:45")
    toba = _ev(client, base, d1, "鳥羽水族館")
    akafuku = _ev(client, base, d1, "赤福", parent_event_id=area["id"])
    assert akafuku["parent_event_id"] == area["id"]
    assert _order(client, p, d1["id"]) == [("伊勢神宮", None), ("おかげ横丁", None), ("赤福", area["id"]), ("鳥羽水族館", None)]

    # 後から入れる(エリアの中の最後へ)
    dande = _ev(client, base, d1, "ダンデライオン")
    r = _put(client, p, base, dande, parent_event_id=area["id"])
    assert r.status_code == 200, r.text
    assert _order(client, p, d1["id"]) == [
        ("伊勢神宮", None), ("おかげ横丁", None), ("赤福", area["id"]), ("ダンデライオン", area["id"]), ("鳥羽水族館", None)]

    # 外すとエリアの後ろへ出る
    assert _put(client, p, base, akafuku, parent_event_id=None).status_code == 200
    assert _order(client, p, d1["id"]) == [
        ("伊勢神宮", None), ("おかげ横丁", None), ("ダンデライオン", area["id"]), ("赤福", None), ("鳥羽水族館", None)]

    # 1 回の「元に戻す」で、入れる前の並びに戻る
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(_rev(client, p))}).status_code == 200
    assert _order(client, p, d1["id"])[2] == ("赤福", area["id"])
    assert ise and toba


def test_area_rules(auth_client):
    client, _owner = auth_client
    p, base, d1, d2 = _plan(client)
    area = _ev(client, base, d1, "おかげ横丁", "area")
    other_day_area = _ev(client, base, d2, "鳥羽一番街", "area")
    plain = _ev(client, base, d1, "伊勢神宮")
    cases = [
        ({"day_id": d1["id"], "title": "x", "parent_event_id": other_day_area["id"]}, "parent_other_day"),
        ({"day_id": d1["id"], "title": "x", "parent_event_id": plain["id"]}, "parent_not_area"),
        ({"day_id": d1["id"], "title": "x", "event_type": "area", "parent_event_id": area["id"]}, "nested_area"),
        ({"day_id": d1["id"], "title": "x", "parent_event_id": str(uuid.uuid4())}, "parent_not_found"),
        ({"day_id": d1["id"], "title": "x", "parent_event_id": "not-a-uuid"}, "invalid_parent"),
    ]
    for body, code in cases:
        r = client.post(f"{base}/events", json=body, headers=_ik())
        assert r.status_code == 400 and r.json()["detail"]["code"] == code, (code, r.text)
    r = _put(client, p, base, area, parent_event_id=area["id"])
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid_parent"


def test_area_type_change_delete_and_day_move_detach_members(auth_client):
    client, _owner = auth_client
    p, base, d1, d2 = _plan(client)
    area = _ev(client, base, d1, "おかげ横丁", "area")
    m1 = _ev(client, base, d1, "赤福", parent_event_id=area["id"])
    m2 = _ev(client, base, d1, "ダンデライオン", parent_event_id=area["id"])

    # 別の日へ移すとエリアから出る
    r = client.post(f"{base}/events/{m2['id']}/move", json={"day_id": d2["id"], "sort_order": 0},
                    headers={"If-Match": str(_rev(client, p)), **_ik()})
    assert r.status_code == 200, r.text
    assert r.json()["parent_event_id"] is None

    # エリアを消すと中の予定は外れる。元に戻すと中の予定もまた入る
    rev = _rev(client, p)
    assert client.delete(f"{base}/events/{area['id']}", headers={"If-Match": str(rev)}).status_code == 200
    assert _order(client, p, d1["id"]) == [("赤福", None)]
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    assert _order(client, p, d1["id"]) == [("おかげ横丁", None), ("赤福", area["id"])]

    # エリアの種類をやめると中の予定は外れる
    assert _put(client, p, base, area, event_type="sightseeing").status_code == 200
    assert _order(client, p, d1["id"]) == [("おかげ横丁", None), ("赤福", None)]
    assert m1


def test_reorder_keeps_members_after_area(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    a = _ev(client, base, d1, "伊勢神宮")
    area = _ev(client, base, d1, "おかげ横丁", "area")
    m = _ev(client, base, d1, "赤福", parent_event_id=area["id"])
    b = _ev(client, base, d1, "鳥羽水族館")
    # 中の予定をエリアから離して送っても、エリアの後ろへ直す(時刻は予定に付いたまま)
    order = [m["id"], a["id"], area["id"], b["id"]]
    r = client.post(f"{base}/days/{d1['id']}/reorder", json={"order": order, "keep_slots": False},
                    headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    assert [e["title"] for e in r.json()["day"]["events"]] == ["伊勢神宮", "おかげ横丁", "赤福", "鳥羽水族館"]
    # エリアのまとまりを先頭へ(エリアと中の予定を一緒に)
    r = client.post(f"{base}/days/{d1['id']}/reorder",
                    json={"order": [area["id"], m["id"], a["id"], b["id"]], "keep_slots": False},
                    headers={"If-Match": str(_rev(client, p))})
    assert [e["title"] for e in r.json()["day"]["events"]] == ["おかげ横丁", "赤福", "伊勢神宮", "鳥羽水族館"]
