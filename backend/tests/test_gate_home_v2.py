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
