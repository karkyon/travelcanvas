"""[Gate SpotMode] FR-060 スポットモード(自由に歩くエリア)の統合試験(DOC-02 v6.0 FR-060・DOC-04 SC-49/50)。

- 候補箱で近くにまとまった候補をエリアの案にする(400m・3件以上・見送り/既にエリアの物は除く)
- 作る・直す(If-Match。同じ候補の着いた・行きたい印は残す)・消す(候補箱は残す)
- ジャンルの推定・座れる・その日の営業時間・範囲の半径
- 当日: 着いた(2 回押しても最初の時刻)・今日はやめる・取り消し・行きたい印(閲覧者も・本人の分だけ)
- 周りを探す: 半径とエリア内で絞る・今いる場所を監査に残さない
- 権限: 作る・直す・着いたは編集者以上。閲覧者は 403。別の旅行の候補・日は 422
"""
import uuid

import pytest

from app.api.v1 import spot_areas as api
from app.models.models import PlanCandidate, SpotArea, TravelDay
from app.services import place_finder as pf
from app.services import spot_areas as sa

from tests.test_gate_p3_discussion import _act_as, _group

# おかげ横丁の周り(見本)
SPOTS = [("赤福 本店", 34.4610, 136.7247, "甘味"), ("豚捨", 34.4622, 136.7249, None),
         ("五十鈴川のカフェ", 34.4605, 136.7262, None), ("招き猫の店", 34.4625, 136.7238, "雑貨"),
         ("おかげ座", 34.4617, 136.7240, None)]


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(api, "record_audit_event", lambda **kw: None)


def _cand(client, p, title, lat, lng, category=None, priority=2):
    body = {"title": title, "latitude": lat, "longitude": lng, "priority": priority}
    if category:
        body["category"] = category
    r = client.post(f"/api/v1/plans/{p}/candidates", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _setup(auth_client, make_user, db_session):
    client, p, owner, (editor, viewer) = _group(auth_client, make_user, db_session)
    ids = [_cand(client, p, *s) for s in SPOTS]
    far = _cand(client, p, "二見興玉神社", 34.5089, 136.7859)
    day = TravelDay(id=uuid.uuid4(), plan_id=uuid.UUID(p), local_date=__import__("datetime").date(2026, 11, 29),
                    timezone_id="Asia/Tokyo", sort_order=1)
    db_session.add(day)
    db_session.commit()
    return client, p, owner, editor, viewer, ids, far, str(day.id)


def _area(client, p, ids, day_id=None, **extra):
    body = {"title": "おかげ横丁・おはらい町", "day_id": day_id, "start_time": "13:00", "end_time": "15:30",
            "meet_label": "駐車場", "meet_time": "15:30", "meet_latitude": 34.4640, "meet_longitude": 136.7230,
            "items": [{"candidate_id": c, "priority": "want" if n < 2 else "maybe", "stay_minutes": 15 + n * 5}
                      for n, c in enumerate(ids)]}
    body.update(extra)
    return client.post(f"/api/v1/plans/{p}/spot-areas", json=body)


def test_suggest_clusters_near_candidates(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    r = client.get(f"/api/v1/plans/{p}/spot-areas/suggest")
    assert r.status_code == 200
    sug = r.json()["suggestions"]
    assert len(sug) == 1 and {c["candidate_id"] for c in sug[0]["candidates"]} == set(ids)
    assert far not in {c["candidate_id"] for c in sug[0]["candidates"]}
    assert 200 <= sug[0]["radius_m"] <= 600
    # 既にエリアにした候補は案に出さない
    assert _area(client, p, ids[:3]).status_code == 201
    assert client.get(f"/api/v1/plans/{p}/spot-areas/suggest").json()["suggestions"] == []  # 残り 2 件では足りない
    _act_as(viewer)
    assert client.get(f"/api/v1/plans/{p}/spot-areas/suggest").status_code == 403


def test_create_list_and_derived_fields(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    r = _area(client, p, ids, day)
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["title"] == "おかげ横丁・おはらい町" and a["local_date"] == "2026-11-29" and a["timezone_id"] == "Asia/Tokyo"
    assert a["start_time"] == "13:00" and a["meet_time"] == "15:30" and a["revision"] == 1 and a["can_edit"]
    assert [i["title"] for i in a["items"]] == [s[0] for s in SPOTS]
    genres = {i["title"]: i["genre"] for i in a["items"]}
    assert genres["赤福 本店"] == "food" and genres["五十鈴川のカフェ"] == "cafe" and genres["招き猫の店"] == "gift"
    assert genres["おかげ座"] == "sight"
    cafe = next(i for i in a["items"] if i["genre"] == "cafe")
    assert cafe["seats"] is True and cafe["genre_label"] == "カフェ"
    assert a["items"][0]["priority"] == "want" and a["items"][2]["priority"] == "maybe"
    assert a["center_latitude"] and 200 <= a["radius_m"] <= 600
    _act_as(viewer)
    listed = client.get(f"/api/v1/plans/{p}/spot-areas").json()
    assert listed["can_edit"] is False and listed["areas"][0]["id"] == a["id"]
    assert listed["genres"]["food"] == "食べ歩き"


def test_validation_and_permissions(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    assert _area(client, p, ids, start_time="15:00", end_time="13:00").status_code == 422
    assert _area(client, p, ids, start_time="25:00").status_code == 422
    assert _area(client, p, [ids[0], ids[0]]).status_code == 422
    assert _area(client, p, ids, meet_latitude=34.0, meet_longitude=None).status_code == 422
    assert _area(client, p, ids, day_id=str(uuid.uuid4())).status_code == 422
    other = client.post("/api/v1/travel-plans/", json={"title": "別"}).json()["id"]
    foreign = _cand(client, other, "別の旅行の候補", 34.0, 136.0)
    assert _area(client, p, [foreign]).status_code == 422
    client.patch(f"/api/v1/plans/{p}/candidates/{ids[0]}", json={"status": "dismissed"},
                 headers={"If-Match": "1"})
    _act_as(viewer)
    assert _area(client, p, ids[1:]).status_code == 403
    _act_as(editor)
    assert _area(client, p, ids[1:]).status_code == 201


def test_update_keeps_day_state_and_delete_keeps_candidates(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids, day).json()
    item = a["items"][1]
    base = f"/api/v1/plans/{p}/spot-areas/{a['id']}"
    assert client.post(f"{base}/items/{item['id']}/visit", json={}).status_code == 200
    assert client.put(f"{base}/items/{item['id']}/want").json()["items"][1]["wanted_by_me"] is True
    items = [{"candidate_id": ids[1], "genre": "sight", "priority": "want"}, {"candidate_id": ids[0]}]
    body = {"title": "おかげ横丁", "day_id": day, "items": items}
    assert client.put(base, json=body).status_code == 428
    assert client.put(base, json=body, headers={"If-Match": "9"}).status_code == 409
    r = client.put(base, json=body, headers={"If-Match": str(a["revision"])})
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["revision"] == 2 and [i["candidate_id"] for i in u["items"]] == [ids[1], ids[0]]
    assert u["items"][0]["visited_at"] and u["items"][0]["wanted_by_me"] and u["items"][0]["genre"] == "sight"
    assert u["items"][0]["id"] == item["id"]
    assert client.delete(base, headers={"If-Match": "1"}).status_code == 409
    assert client.delete(base, headers={"If-Match": "2"}).status_code == 204
    db_session.expire_all()
    assert db_session.query(SpotArea).count() == 0
    assert db_session.query(PlanCandidate).filter(PlanCandidate.plan_id == uuid.UUID(p)).count() == 6


def test_visit_skip_and_wants_on_the_day(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids, day).json()
    base = f"/api/v1/plans/{p}/spot-areas/{a['id']}/items"
    first = a["items"][0]["id"]
    v1 = client.post(f"{base}/{first}/visit", json={}).json()["items"][0]
    v2 = client.post(f"{base}/{first}/visit", json={}).json()["items"][0]
    assert v1["visited_at"] == v2["visited_at"] and v1["visited_by"]
    skipped = client.post(f"{base}/{first}/visit", json={"skipped": True}).json()["items"][0]
    assert skipped["skipped"] is True and skipped["visited_at"] is None
    cleared = client.delete(f"{base}/{first}/visit").json()["items"][0]
    assert cleared["skipped"] is False and cleared["visited_at"] is None
    _act_as(viewer)
    assert client.post(f"{base}/{first}/visit", json={}).status_code == 403
    w = client.put(f"{base}/{first}/want").json()["items"][0]
    assert w["wanted_by_me"] is True and len(w["wanted_by"]) == 1
    _act_as(editor)
    w = client.put(f"{base}/{first}/want").json()["items"][0]
    assert w["wanted_by_me"] is True and len(w["wanted_by"]) == 2
    w = client.delete(f"{base}/{first}/want").json()["items"][0]
    assert w["wanted_by_me"] is False and len(w["wanted_by"]) == 1  # 閲覧者の印は残る
    assert client.post(f"{base}/{uuid.uuid4()}/visit", json={}).status_code == 404


def test_add_item_from_search_on_the_day(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids[:3], day).json()
    new = _cand(client, p, "神宮会館の休憩所", 34.4612, 136.7235)
    r = client.post(f"/api/v1/plans/{p}/spot-areas/{a['id']}/items", json={"candidate_id": new})
    assert r.status_code == 201 and r.json()["items"][-1]["genre"] == "rest" and r.json()["revision"] == 2
    assert client.post(f"/api/v1/plans/{p}/spot-areas/{a['id']}/items", json={"candidate_id": new}).status_code == 409


def test_nearby_filters_by_radius_and_area_without_storing_location(auth_client, make_user, db_session, monkeypatch):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids, day).json()
    seen = {}

    async def fake_find(db, plan, query, genre, scope, record, points=None):
        seen.update(query=query, genre=genre, scope=scope, points=points)
        return {"candidates": [
            {"name": "近くのトイレ", "latitude": 34.4614, "longitude": 136.7244, "category": "トイレ"},
            {"name": "少し先の甘味処", "latitude": 34.4650, "longitude": 136.7244, "category": "甘味"},
            {"name": "遠くの店", "latitude": 34.50, "longitude": 136.78},
            {"name": "", "latitude": 34.46, "longitude": 136.72}, {"name": "位置なし"}],
            "sources": ["mock"], "failed_providers": []}

    monkeypatch.setattr(pf, "find", fake_find)
    _act_as(viewer)
    url = f"/api/v1/plans/{p}/spot-areas/{a['id']}/nearby"
    r = client.post(url, json={"latitude": 34.4615, "longitude": 136.7245, "radius_m": 500, "kind": "toilet"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert [x["name"] for x in out["results"]] == ["近くのトイレ", "少し先の甘味処"]
    assert out["results"][0]["genre"] == "rest" and out["results"][0]["walk_minutes"] >= 1
    assert seen["query"] == "トイレ" and seen["points"] == [(34.4615, 136.7245)]
    small = client.post(url, json={"latitude": 34.4615, "longitude": 136.7245, "radius_m": 100}).json()
    assert [x["name"] for x in small["results"]] == ["近くのトイレ"]
    assert client.post(url, json={"latitude": 91, "longitude": 0}).status_code == 422


def test_service_genre_and_distance_helpers():
    assert sa.guess_genre("伊勢うどん ふくすけ") == "food"
    assert sa.guess_genre("神宮会館", "トイレ") == "rest"
    assert sa.guess_genre("なにか") == "other"
    assert 120 < sa.distance_m((34.4610, 136.7247), (34.4622, 136.7249)) < 140
    assert sa.radius_for((34.4610, 136.7247), [(34.4610, 136.7247)]) == 200


# ---------------------------------------------------------------- [Gate SpotMode-2] 別行動・旅帖の歩いた順

def test_split_off_and_rejoin_shares_only_the_promise(auth_client, make_user, db_session):
    from app.models.models import Notification, SpotAreaSplit
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids, day).json()
    url = f"/api/v1/plans/{p}/spot-areas/{a['id']}/split"
    _act_as(viewer)  # 閲覧者も自分の別行動は決められる
    r = client.put(url, json={})  # 省くとエリアの集合
    assert r.status_code == 200, r.text
    s = r.json()["splits"]
    assert len(s) == 1 and s[0]["is_me"] and s[0]["meet_time"] == "15:30" and s[0]["meet_label"] == "駐車場"
    assert set(s[0]) == {"name", "is_me", "meet_label", "meet_time", "note", "since"}  # 位置は持たない
    r = client.put(url, json={"meet_time": "15:20", "meet_label": "おかげ横丁の入口", "note": "赤福で並びます"})
    assert r.json()["splits"][0]["meet_time"] == "15:20"
    assert client.put(url, json={"meet_time": "3:20"}).status_code == 422
    assert client.put(url, json={"latitude": 34.0}).status_code == 422  # 位置は受け取らない
    db_session.expire_all()
    notes = db_session.query(Notification).filter(Notification.type == "spot_split").all()
    assert notes and all(n.user_id != viewer.id for n in notes)
    assert any("15:20" in n.message for n in notes)
    _act_as(owner)
    mine = client.get(f"/api/v1/plans/{p}/spot-areas").json()["areas"][0]["splits"]
    assert len(mine) == 1 and mine[0]["is_me"] is False
    _act_as(viewer)
    assert client.delete(url).json()["splits"] == []
    assert client.delete(url).status_code == 200  # 押し直しても困らない
    assert db_session.query(SpotAreaSplit).count() == 0


def test_split_needs_a_meet_time(auth_client, make_user, db_session):
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids, day, meet_time=None, end_time=None).json()
    url = f"/api/v1/plans/{p}/spot-areas/{a['id']}/split"
    r = client.put(url, json={})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "meet_time_required"
    assert client.put(url, json={"meet_time": "15:00"}).status_code == 200


def test_journal_draft_includes_walked_order_without_locations(auth_client, make_user, db_session):
    from datetime import datetime, timezone
    from app.models.models import SpotAreaItem
    client, p, owner, editor, viewer, ids, far, day = _setup(auth_client, make_user, db_session)
    a = _area(client, p, ids, day).json()
    order = [(a["items"][3]["id"], 4, 31), (a["items"][1]["id"], 4, 52), (a["items"][0]["id"], 5, 10)]
    for item_id, h, m in order:
        row = db_session.query(SpotAreaItem).filter(SpotAreaItem.id == uuid.UUID(item_id)).one()
        row.visited_at = datetime(2026, 11, 29, h, m, tzinfo=timezone.utc)
    db_session.commit()
    r = client.post(f"/api/v1/plans/{p}/memories/journal-draft", json={})
    assert r.status_code == 200, r.text
    d = r.json()
    walks = d["days"][0]["walks"]
    assert walks[0]["area_title"] == "おかげ横丁・おはらい町"
    assert [(s["time"], s["title"]) for s in walks[0]["stops"]] == [("13:31", "招き猫の店"), ("13:52", "豚捨"),
                                                                    ("14:10", "赤福 本店")]
    assert "### 自由に歩いた: おかげ横丁・おはらい町" in d["markdown"]
    assert "13:31 招き猫の店 → 13:52 豚捨 → 14:10 赤福 本店" in d["markdown"]
    assert sum(len(w["stops"]) for dd in d["days"] for w in dd["walks"]) == 3
    assert "34.46" not in d["markdown"]  # 位置は入れない
