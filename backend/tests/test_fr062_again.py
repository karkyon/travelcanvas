"""[FR-062] 旅の記録の「また行きたい」(詳細設計 DD-2026-11-22-01 §6.4)。

元が 4 種類ある時の重なりのまとめ・ほかの人の記録が入らない・エリアの自動の集まり・行けなかった場所の移し(候補箱が残る)・
同じ場所の更新・viewer でも残せる・key の改ざん。
"""

import uuid
from datetime import datetime, timedelta, timezone

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import (
    EventActual,
    Memory,
    PlanCandidate,
    PlanCollaborator,
    Spot,
    SpotArea,
    SpotAreaItem,
    VisitAssessment,
)

T0 = datetime(2026, 11, 28, 4, 0, tzinfo=timezone.utc)


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢・おかげ横丁の旅"}).json()["id"]
    d = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"}).json()[
        "id"
    ]
    return p, d


def _event(client, p, d, title, lat, lng, start="2026-11-28T10:00:00+09:00"):
    body = {
        "day_id": d,
        "title": title,
        "event_type": "sightseeing",
        "start_at": start,
        "latitude": lat,
        "longitude": lng,
    }
    res = client.post(f"/api/v1/plans/{p}/events", json=body, headers={"Idempotency-Key": uuid.uuid4().hex})
    assert res.status_code == 201, res.text
    return uuid.UUID(res.json()["id"])


def _cand(db, p, user, title, lat, lng, note=None):
    c = PlanCandidate(
        plan_id=uuid.UUID(p),
        created_by_user_id=user.id,
        title=title,
        source_kind="manual",
        latitude=lat,
        longitude=lng,
        note=note,
    )
    db.add(c)
    db.flush()
    return c


def _as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def test_four_sources_merge_and_only_own_records(auth_client, make_user, db_session):
    client, me = auth_client
    other, _ = make_user()
    p, d = _plan(client)
    pid = uuid.UUID(p)
    naiku = _event(client, p, d, "内宮", 34.4550, 136.7253)
    geku = _event(client, p, d, "外宮", 34.4874, 136.7035)
    # スポットモードのエリアと、本人が着いた印
    area = SpotArea(
        plan_id=pid,
        title="おかげ横丁",
        radius_m=400,
        start_time="13:00",
        end_time="15:10",
        meet_latitude=34.4622,
        meet_longitude=136.7253,
    )
    db_session.add(area)
    db_session.flush()
    akafuku = _cand(db_session, p, me, "赤福 本店", 34.4623, 136.7256)
    other_shop = _cand(db_session, p, me, "ほかの人の店", 34.4630, 136.7260)
    db_session.add(SpotAreaItem(area_id=area.id, candidate_id=akafuku.id, visited_at=T0, visited_by_user_id=me.id))
    db_session.add(
        SpotAreaItem(area_id=area.id, candidate_id=other_shop.id, visited_at=T0, visited_by_user_id=other.id)
    )
    # 訪問の判定(本人の内宮)・当日の着いた(本人の内宮・ほかの人の外宮)
    db_session.add(
        VisitAssessment(
            plan_id=pid,
            event_id=naiku,
            user_id=me.id,
            state="VERIFIED_VISIT",
            algorithm_version="v1",
            source="auto",
            assessed_at=T0 - timedelta(hours=2),
        )
    )
    db_session.add(
        EventActual(
            plan_id=pid,
            event_id=naiku,
            status="visited",
            recorded_by_user_id=me.id,
            actual_start_at=T0 - timedelta(hours=3),
        )
    )
    db_session.add(EventActual(plan_id=pid, event_id=geku, status="visited", recorded_by_user_id=other.id))
    # 写真: 本人の 2 枚(内宮の予定・赤福の近く)、ほかの人の 1 枚(外宮)
    db_session.add(
        Memory(plan_id=pid, author_user_id=me.id, kind="photo", storage_key="k", event_id=naiku, occurred_at=T0)
    )
    db_session.add(
        Memory(
            plan_id=pid,
            author_user_id=me.id,
            kind="photo",
            storage_key="k",
            latitude=34.4624,
            longitude=136.7257,
            occurred_at=T0,
        )
    )
    db_session.add(
        Memory(
            plan_id=pid,
            author_user_id=other.id,
            kind="photo",
            storage_key="k",
            event_id=geku,
            latitude=34.4874,
            longitude=136.7035,
            place_name="外宮",
        )
    )
    db_session.commit()

    res = client.get(f"/api/v1/plans/{p}/again-candidates")
    assert res.status_code == 200, res.text
    body = res.json()
    names = [x["name"] for x in body["places"]]
    assert names == ["内宮", "赤福 本店"]  # 着いた順。外宮・ほかの人の店は入らない
    naiku_row, aka_row = body["places"]
    assert set(naiku_row["sources"]) == {"visit", "today", "memory"} and naiku_row["photo_count"] == 1
    assert aka_row["photo_count"] == 1 and aka_row["thumb_memory_id"]
    assert [a["title"] for a in body["areas"]] == ["おかげ横丁"]
    assert body["areas"][0]["walked_min"] == 130 and body["areas"][0]["visited_count"] == 1
    assert body["missed"] == []


def test_auto_cluster_when_no_spot_area(auth_client, db_session):
    client, me = auth_client
    p, d = _plan(client)
    pid = uuid.UUID(p)
    for i, (t, lat) in enumerate([("A", 34.4600), ("B", 34.4610), ("C", 34.4620), ("遠いD", 34.5000)]):
        e = _event(client, p, d, t, lat, 136.72)
        db_session.add(
            EventActual(
                plan_id=pid,
                event_id=e,
                status="visited",
                recorded_by_user_id=me.id,
                actual_start_at=T0 + timedelta(minutes=i),
            )
        )
    db_session.commit()
    body = client.get(f"/api/v1/plans/{p}/again-candidates").json()
    assert len(body["areas"]) == 1
    a = body["areas"][0]
    assert a["visited_count"] == 3 and a["title"] == "Aのあたり" and 100 <= a["radius_m"] <= 5000


def test_save_place_area_missed_and_same_place_update(auth_client, db_session):
    client, me = auth_client
    p, d = _plan(client)
    pid = uuid.UUID(p)
    e = _event(client, p, d, "内宮", 34.4550, 136.7253)
    db_session.add(
        EventActual(plan_id=pid, event_id=e, status="visited", recorded_by_user_id=me.id, actual_start_at=T0)
    )
    missed = _cand(db_session, p, me, "伊勢うどん", 34.49, 136.70, note="旅の当日に行けなかった場所")
    db_session.commit()
    body = client.get(f"/api/v1/plans/{p}/again-candidates").json()
    place_key = body["places"][0]["key"]
    miss_key = body["missed"][0]["key"]
    res = client.post(
        f"/api/v1/plans/{p}/again",
        json={"items": [{"key": place_key, "kind": "place"}, {"key": miss_key, "kind": "missed"}]},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["saved"]) == 2
    spots = {s.name: s for s in db_session.query(Spot).filter(Spot.created_by == me.id)}
    naiku = spots["内宮"]
    assert naiku.wish_kind == "again" and naiku.again_count == 1 and naiku.source_kind == "visit"
    assert naiku.source_label == "伊勢・おかげ横丁の旅" and naiku.last_visited_at is not None
    assert spots["伊勢うどん"].wish_kind == "next" and spots["伊勢うどん"].source_kind == "today"
    assert db_session.get(PlanCandidate, missed.id) is not None  # 候補箱の行は消さない
    # 同じ場所をもう一度 → 作らずに回数が増える。一覧には残した印
    again = client.post(f"/api/v1/plans/{p}/again", json={"items": [{"key": place_key, "kind": "place"}]}).json()
    assert again["saved"] == [] and again["merged"][0]["again_count"] == 2
    row = client.get(f"/api/v1/plans/{p}/again-candidates").json()["places"][0]
    assert row["saved_spot_id"] == str(naiku.id) and row["saved_kind"] == "again"


def test_key_is_signed_and_scoped(auth_client, make_user, db_session):
    client, me = auth_client
    p, d = _plan(client)
    e = _event(client, p, d, "内宮", 34.4550, 136.7253)
    db_session.add(EventActual(plan_id=uuid.UUID(p), event_id=e, status="visited", recorded_by_user_id=me.id))
    db_session.commit()
    key = client.get(f"/api/v1/plans/{p}/again-candidates").json()["places"][0]["key"]
    raw = key.rsplit(".", 1)[0]
    for bad in (raw + ".AAAAAAAAAAAAAAAA", f"actual:{uuid.uuid4()}.xxxxxxxxxxxx"):
        r = client.post(f"/api/v1/plans/{p}/again", json={"items": [{"key": bad, "kind": "place"}]})
        assert r.status_code == 422, r.text
    assert client.post(f"/api/v1/plans/{p}/again", json={"items": []}).status_code == 422
    assert (
        client.post(f"/api/v1/plans/{p}/again", json={"items": [{"key": key, "kind": "place"}] * 51}).status_code
        == 422
    )
    # ほかの旅行の人は見られない
    stranger, _ = make_user()
    _as(stranger)
    try:
        assert client.get(f"/api/v1/plans/{p}/again-candidates").status_code in (403, 404)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_viewer_can_save_to_own_wishes(auth_client, make_user, db_session):
    client, me = auth_client
    p, d = _plan(client)
    viewer, _ = make_user()
    db_session.add(
        PlanCollaborator(
            plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer", status="accepted"
        )
    )
    e = _event(client, p, d, "内宮", 34.4550, 136.7253)
    db_session.add(EventActual(plan_id=uuid.UUID(p), event_id=e, status="visited", recorded_by_user_id=viewer.id))
    db_session.commit()
    _as(viewer)
    try:
        body = client.get(f"/api/v1/plans/{p}/again-candidates").json()
        assert [x["name"] for x in body["places"]] == ["内宮"]
        r = client.post(
            f"/api/v1/plans/{p}/again", json={"items": [{"key": body["places"][0]["key"], "kind": "place"}]}
        )
        assert r.status_code == 200 and len(r.json()["saved"]) == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert db_session.query(Spot).filter(Spot.created_by == viewer.id).count() == 1
    assert db_session.query(Spot).filter(Spot.created_by == me.id).count() == 0
