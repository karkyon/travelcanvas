"""
[Gate HomeV2] ホーム v2 の集約(GET /api/v1/dashboard の home)と、旅行の一覧の状態の変更(実PostgreSQL)。

- 旅行の一覧の状態: 計画中(旅行前・中)/ 検討中(日付なし)/ 行った旅(旅行後)/ 見送り・中止(利用者が決める)
- 計画中の旅行の準備の段階(行き先と日付・立ち寄る場所・移動手段・予約と確認・持ち物)と、次にやること(重要な順)
- 旅の足あと: 行った旅の行き先・住所に書かれた都道府県だけ(推測しない)。計画中の都道府県は別
- 見送り・中止は編集できる人だけが変えられる(閲覧者・他人は不可)
"""
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.services import dashboard_home as dh

URL = "/api/v1/dashboard"
TOKYO = ZoneInfo("Asia/Tokyo")


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _trip(client, title, offsets, events=(), destination="三重県鳥羽市"):
    p = client.post("/api/v1/travel-plans/", json={"title": title, "destination": destination}).json()["id"]
    today = datetime.now(TOKYO).date()
    days = []
    for off in offsets:
        d = client.post(f"/api/v1/plans/{p}/days", json={
            "local_date": (today + timedelta(days=off)).isoformat(), "timezone_id": "Asia/Tokyo"}, headers=_ik())
        assert d.status_code == 201, d.text
        days.append(d.json())
    ids = []
    for title_, addr in events:
        r = client.post(f"/api/v1/plans/{p}/events", json={"day_id": days[0]["id"], "title": title_, "address": addr},
                        headers=_ik())
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return p, ids


def test_pure_rules():
    assert dh.shelf_of("upcoming", "draft") == "planning"
    assert dh.shelf_of("ongoing", None) == "planning"
    assert dh.shelf_of("past", "active") == "visited"
    assert dh.shelf_of("undated", "draft") == "considering"
    assert dh.shelf_of("upcoming", "cancelled") == "cancelled"
    assert dh.prefectures_in(["三重県鳥羽市鳥羽", "京都府京都市", "鳥羽", None, "三重県伊勢市"]) == ["三重県", "京都府"]
    tasks = dh.merge_tasks([
        {"tasks": [{"severity": "low", "title": "a"}, {"severity": "high", "title": "b"}]},
        {"tasks": [{"severity": "high", "title": "c"}, {"severity": "normal", "title": "d"}]},
    ], limit=3)
    assert [t["title"] for t in tasks] == ["b", "c", "d"]


def test_home_shelves_progress_tasks_and_footprints(auth_client):
    client, _owner = auth_client
    body = client.get(URL).json()
    assert body["home"]["shelves"] == {"planning": 0, "considering": 0, "visited": 0, "cancelled": 0}
    assert body["home"]["planning"] == [] and body["home"]["tasks"] == []

    up, (e1, e2, _e3) = _trip(client, "鳥羽の旅", [10, 11], events=[
        ("賀多神社", "三重県鳥羽市鳥羽"), ("鳥羽水族館", "三重県鳥羽市鳥羽3丁目"), ("ミキモト真珠島", None)])
    _trip(client, "金沢の旅", [-20, -19], events=[("兼六園", "石川県金沢市兼六町")], destination="石川県金沢市")
    _trip(client, "相談中", [], destination=None)
    # 1 区間だけ移動手段を決める
    r = client.post(f"/api/v1/plans/{up}/segments", json={"from_event_id": e1, "to_event_id": e2, "mode": "walking"},
                    headers=_ik())
    assert r.status_code == 201, r.text

    home = client.get(URL).json()["home"]
    assert home["shelves"] == {"planning": 1, "considering": 1, "visited": 1, "cancelled": 0}
    p = home["planning"][0]
    assert p["plan_id"] == up and p["event_count"] == 3 and p["segments"] == {"need": 2, "done": 1}
    steps = {s["key"]: s for s in p["steps"]}
    assert steps["dates"]["done"] and steps["places"]["done"] and steps["places"]["label"] == "立ち寄る場所(3 件)"
    assert not steps["moves"]["done"] and steps["moves"]["label"] == "移動手段(あと 1 区間)"
    assert not steps["packing"]["done"] and p["total"] == 5
    titles = [t["title"] for t in home["tasks"]]
    assert "移動手段を決める(1 区間)" in titles and len(titles) <= 4
    assert all(t["to"].startswith("/planner/") for t in home["tasks"])
    fp = home["footprints"]
    assert fp["prefectures"] == ["石川県"] and fp["planned_prefectures"] == ["三重県"] and fp["trips_visited"] == 1
    assert home["memories"]["timeline"][0]["title"] == "金沢の旅"
    assert home["memories"]["recent"]["photo_ids"] == []
    assert home["wishlist"] == {"count": 0, "groups": []}


def test_cancel_and_restore_state_and_permissions(auth_client, make_user):
    client, _owner = auth_client
    up, _ = _trip(client, "見送る旅", [5])
    r = client.put(f"/api/v1/dashboard/trips/{up}/state", json={"state": "cancelled"})
    assert r.status_code == 200, r.text
    home = client.get(URL).json()["home"]
    assert home["shelves"]["cancelled"] == 1 and home["shelves"]["planning"] == 0 and home["planning"] == []
    assert client.put(f"/api/v1/dashboard/trips/{up}/state", json={"state": "active"}).status_code == 200
    assert client.get(URL).json()["home"]["shelves"]["planning"] == 1
    assert client.put(f"/api/v1/dashboard/trips/{up}/state", json={"state": "deleted"}).status_code == 422
    # 他人の旅行は変えられない
    from app.core.auth import AuthResult, get_current_user
    from app.main import app
    other, _pw = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.put(f"/api/v1/dashboard/trips/{up}/state", json={"state": "cancelled"}).status_code in (403, 404)


# ================================================================ [Gate Footprints2] 世界地図の点

def _geo_trip(client, title, offsets, spots, destination):
    p = client.post("/api/v1/travel-plans/", json={"title": title, "destination": destination}).json()["id"]
    today = datetime.now(TOKYO).date()
    day_body = {"local_date": (today + timedelta(days=offsets[0])).isoformat(), "timezone_id": "Asia/Tokyo"}
    day = client.post(f"/api/v1/plans/{p}/days", json=day_body, headers=_ik()).json()
    for name, lat, lng, addr in spots:
        ev = {"day_id": day["id"], "title": name, "address": addr, "latitude": lat, "longitude": lng}
        r = client.post(f"/api/v1/plans/{p}/events", json=ev, headers=_ik())
        assert r.status_code == 201, r.text
    return p


def test_in_japan_rule():
    assert dh.in_japan(35.68, 139.76) and dh.in_japan(26.21, 127.68) and dh.in_japan(43.06, 141.35)
    assert not dh.in_japan(37.56, 126.97)  # ソウル
    assert not dh.in_japan(16.05, 108.22)  # ダナン
    assert not dh.in_japan(25.03, 121.56)  # 台北


def test_footprint_points_visited_planned_and_overseas(auth_client):
    client, _owner = auth_client
    danang = [("ロン橋", 16.0614, 108.2270, None), ("ロン橋の近く", 16.0611, 108.2268, None), ("ホイアン", 15.8801, 108.3380, None)]
    _geo_trip(client, "ダナン", [-30], danang, "ベトナム")
    _geo_trip(client, "金沢", [-10], [("兼六園", 36.5621, 136.6626, "石川県金沢市兼六町")], "石川県金沢市")
    _geo_trip(client, "鳥羽", [10], [("賀多神社", 34.4813, 136.8433, "三重県鳥羽市")], "三重県鳥羽市")
    fp = client.get(URL).json()["home"]["footprints"]
    pts = {(p["lat"], p["lng"]): p for p in fp["points"]}
    # 近い点(小数 2 桁)はまとめる
    assert (16.06, 108.23) in pts and len([p for p in fp["points"] if p["label"].startswith("ダナン")]) == 2
    assert pts[(16.06, 108.23)]["state"] == "visited" and pts[(34.48, 136.84)]["state"] == "planned"
    assert pts[(36.56, 136.66)]["label"] == "金沢・兼六園"
    assert fp["overseas_trips"] == 1  # 行った旅のうち海外の位置があるのはダナンだけ(計画中は数えない)


def test_hidden_locations_are_not_mapped_or_counted(auth_client, make_user, db_session):
    """位置・住所を見せない設定の旅行は、点にも都道府県の数にも使わない"""
    from app.core.auth import AuthResult, get_current_user
    from app.main import app
    from app.models.models import PlanCollaborator, TravelPlan

    client, owner = auth_client
    p = _geo_trip(client, "共有の旅", [-5], [("兼六園", 36.5621, 136.6626, "石川県金沢市兼六町")], "旅行")
    member, _pw = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=member.id, email=member.email, role="viewer",
                                    status="accepted"))
    plan = db_session.get(TravelPlan, uuid.UUID(p))
    plan.member_field_policy = {"roles": {"viewer": ["event_address"]}}
    db_session.commit()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=member, is_authenticated=True, is_guest=False)
    try:
        fp = client.get(URL).json()["home"]["footprints"]
        assert fp["points"] == [] and fp["prefectures"] == []
        # 見せる設定に戻すと出る
        plan.member_field_policy = {"roles": {"viewer": []}}
        db_session.commit()
        fp = client.get(URL).json()["home"]["footprints"]
        assert fp["prefectures"] == ["石川県"] and len(fp["points"]) == 1
    finally:
        app.dependency_overrides[get_current_user] = lambda: AuthResult(user=owner, is_authenticated=True,
                                                                        is_guest=False)


# ================================================================ [Gate FootHover] 地図のポップアップの旅行

def test_recent_trips_rule():
    rows = [dh.foot_trip({"id": f"p{i}", "title": f"t{i}", "start_date": f"2026-0{i}-01", "end_date": None}, "visited")
            for i in range(1, 8)]
    rows.append(dh.foot_trip({"id": "nodate", "title": "未定", "start_date": None, "end_date": None}, "planned"))
    rows.append(dh.foot_trip({"id": "p3", "title": "t3", "start_date": "2026-03-01", "end_date": None}, "planned"))
    out = dh.recent_trips(rows)
    assert [r["plan_id"] for r in out] == ["p7", "p6", "p5", "p4", "p3"]  # 新しい順・5 件・同じ旅行は 1 件
    assert out[-1]["state"] == "visited"  # 行ったと計画中が重なれば行った


def test_pref_trips_and_point_trips(auth_client):
    client, _owner = auth_client
    k1 = _geo_trip(client, "金沢 1 回目", [-40], [("兼六園", 36.5621, 136.6626, "石川県金沢市兼六町")], "石川県金沢市")
    k2 = _geo_trip(client, "金沢 2 回目", [-10], [("兼六園", 36.5622, 136.6627, "石川県金沢市兼六町")], "石川県金沢市")
    tb = _geo_trip(client, "鳥羽", [10], [("賀多神社", 34.4813, 136.8433, "三重県鳥羽市")], "三重県鳥羽市")
    fp = client.get(URL).json()["home"]["footprints"]
    ishikawa = fp["pref_trips"]["石川県"]
    assert [t["plan_id"] for t in ishikawa] == [k2, k1] and {t["state"] for t in ishikawa} == {"visited"}
    assert ishikawa[0]["title"] == "金沢 2 回目" and ishikawa[0]["start_date"]
    assert [t["plan_id"] for t in fp["pref_trips"]["三重県"]] == [tb] and fp["pref_trips"]["三重県"][0]["state"] == "planned"
    kenroku = next(p for p in fp["points"] if (p["lat"], p["lng"]) == (36.56, 136.66))
    assert [t["plan_id"] for t in kenroku["trips"]] == [k2, k1]
