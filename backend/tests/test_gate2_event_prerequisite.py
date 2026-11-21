"""[Gate② FC-017] 予定の先行条件(「チェックインの後」など)を持たせ、先行の予定より前に始まる予定を検証で知らせる。

DOC-02 FC-017「『チェックイン後』等の先行条件を保持」。
"""
import uuid


def _plan_day(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "先行の旅"}).json()["id"]
    d = client.post(f"/api/v1/plans/{p}/days",
                    json={"local_date": "2026-12-05", "timezone_id": "Asia/Tokyo"}).json()["id"]
    return p, d


def _event(client, p, d, title, start, end=None):
    body = {"day_id": d, "title": title, "event_type": "activity", "start_at": start}
    if end:
        body["end_at"] = end
    res = client.post(f"/api/v1/plans/{p}/events", json=body, headers={"Idempotency-Key": uuid.uuid4().hex})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _set_after(client, p, eid, after):
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    return client.put(f"/api/v1/plans/{p}/events/{eid}", json={"after_event_id": after}, headers={"If-Match": str(rev)})


def test_prerequisite_is_kept_and_validation_warns_when_order_is_wrong(auth_client):
    client, _ = auth_client
    p, d = _plan_day(client)
    checkin = _event(client, p, d, "チェックイン", "2026-12-05T15:00:00+09:00", "2026-12-05T15:30:00+09:00")
    onsen = _event(client, p, d, "温泉", "2026-12-05T14:00:00+09:00")
    res = _set_after(client, p, onsen, checkin)
    assert res.status_code == 200, res.text
    assert res.json()["after_event_id"] == checkin
    run = client.post(f"/api/v1/plans/{p}/validation-runs").json()
    issues = client.get(f"/api/v1/plans/{p}/validation-runs/{run['id']}").json()["issues"]
    hit = [i for i in issues if i["code"] == "PREREQUISITE_ORDER"]
    assert len(hit) == 1 and "チェックイン" in hit[0]["message"]
    # 順序を直すと注意は消える
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    client.put(f"/api/v1/plans/{p}/events/{onsen}", json={"start_at": "2026-12-05T16:00:00+09:00"},
               headers={"If-Match": str(rev)})
    run2 = client.post(f"/api/v1/plans/{p}/validation-runs").json()
    issues2 = client.get(f"/api/v1/plans/{p}/validation-runs/{run2['id']}").json()["issues"]
    assert not [i for i in issues2 if i["code"] == "PREREQUISITE_ORDER"]


def test_refuses_self_cycle_and_other_trip_and_clears_with_empty(auth_client):
    client, _ = auth_client
    p, d = _plan_day(client)
    a = _event(client, p, d, "A", "2026-12-05T09:00:00+09:00")
    b = _event(client, p, d, "B", "2026-12-05T10:00:00+09:00")
    assert _set_after(client, p, a, a).json()["detail"]["code"] == "invalid_prerequisite"
    assert _set_after(client, p, b, a).status_code == 200
    assert _set_after(client, p, a, b).json()["detail"]["code"] == "invalid_prerequisite"  # 循環
    p2, d2 = _plan_day(client)
    other = _event(client, p2, d2, "別の旅の予定", "2026-12-05T09:00:00+09:00")
    assert _set_after(client, p, a, other).json()["detail"]["code"] == "invalid_prerequisite"
    cleared = _set_after(client, p, b, "")
    assert cleared.status_code == 200 and cleared.json()["after_event_id"] is None


def test_deleting_the_prerequisite_releases_it(auth_client, db_session):
    from app.models.models import TravelEvent

    client, _ = auth_client
    p, d = _plan_day(client)
    a = _event(client, p, d, "A", "2026-12-05T09:00:00+09:00")
    b = _event(client, p, d, "B", "2026-12-05T10:00:00+09:00")
    _set_after(client, p, b, a)
    rev = client.get(f"/api/v1/plans/{p}").json()["revision"]
    assert client.delete(f"/api/v1/plans/{p}/events/{a}", headers={"If-Match": str(rev)}).status_code in (200, 204)
    db_session.expire_all()
    assert db_session.get(TravelEvent, uuid.UUID(b)).after_event_id is None
