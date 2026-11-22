"""[Gate② FC-012] 複数の予定をまとめて編集する(種類・日の移動を 1 つの変更の組で。元に戻すで一度に戻る)。

DOC-02 FC-012「複数予定のカテゴリ・参加者・日付移動を 1 変更セットで」。参加者は予定に持たない項目のため対象外。
"""
import uuid
from zoneinfo import ZoneInfo

from app.models.models import ChangeSet, TravelEvent


def _plan(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "まとめての旅"}).json()["id"]
    days = [client.post(f"/api/v1/plans/{p}/days", json={"local_date": f"2026-12-0{i}", "timezone_id": "Asia/Tokyo"}
                        ).json()["id"] for i in (5, 6)]
    return p, days


def _event(client, p, d, title, start):
    body = {"day_id": d, "title": title, "event_type": "activity", "start_at": start}
    res = client.post(f"/api/v1/plans/{p}/events", json=body, headers={"Idempotency-Key": uuid.uuid4().hex})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _rev(client, p):
    return str(client.get(f"/api/v1/plans/{p}").json()["revision"])


def test_bulk_change_type_and_move_day_in_one_change_set_and_undo(auth_client, db_session):
    client, _ = auth_client
    p, (d1, d2) = _plan(client)
    a = _event(client, p, d1, "A", "2026-12-05T09:00:00+09:00")
    b = _event(client, p, d1, "B", "2026-12-05T11:00:00+09:00")
    c = _event(client, p, d1, "C", "2026-12-05T13:00:00+09:00")
    before_sets = db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p)).count()
    res = client.post(f"/api/v1/plans/{p}/events/bulk",
                      json={"event_ids": [b, a], "event_type": "dining", "day_id": d2},
                      headers={"If-Match": _rev(client, p)})
    assert res.status_code == 200, res.text
    assert res.json()["updated"] == 2
    assert db_session.query(ChangeSet).filter(ChangeSet.plan_id == uuid.UUID(p)).count() == before_sets + 1
    db_session.expire_all()
    ea, eb, ec = (db_session.get(TravelEvent, uuid.UUID(x)) for x in (a, b, c))
    assert str(ea.day_id) == d2 and str(eb.day_id) == d2 and str(ec.day_id) == d1
    assert ea.event_type == "dining" and eb.event_type == "dining" and ec.event_type == "activity"
    assert eb.sort_order < ea.sort_order  # 選んだ順に並ぶ
    assert ea.start_at.astimezone(ZoneInfo("Asia/Tokyo")).isoformat().startswith("2026-12-06T09:00")  # 日の差だけずらす
    # 元に戻すで一度に戻る
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": _rev(client, p)}).status_code == 200
    db_session.expire_all()
    ea, eb = db_session.get(TravelEvent, uuid.UUID(a)), db_session.get(TravelEvent, uuid.UUID(b))
    assert str(ea.day_id) == d1 and str(eb.day_id) == d1 and ea.event_type == "activity" and eb.event_type == "activity"


def test_bulk_refuses_locked_area_unknown_and_stale_revision(auth_client, db_session):
    client, _ = auth_client
    p, (d1, d2) = _plan(client)
    a = _event(client, p, d1, "A", "2026-12-05T09:00:00+09:00")
    b = _event(client, p, d1, "B", "2026-12-05T11:00:00+09:00")
    url = f"/api/v1/plans/{p}/events/bulk"
    assert client.post(url, json={"event_ids": [a], "event_type": "x"}, headers={"If-Match": "999"}).status_code == 409
    assert client.post(url, json={"event_ids": [a]}, headers={"If-Match": _rev(client, p)}).status_code == 422
    assert client.post(url, json={"event_ids": [a], "event_type": "area"},
                       headers={"If-Match": _rev(client, p)}).json()["detail"]["code"] == "bulk_area_unsupported"
    assert client.post(url, json={"event_ids": [a, str(uuid.uuid4())], "event_type": "dining"},
                       headers={"If-Match": _rev(client, p)}).status_code == 404
    db_session.get(TravelEvent, uuid.UUID(b)).locked = True
    db_session.flush()
    assert client.post(url, json={"event_ids": [a, b], "event_type": "dining"},
                       headers={"If-Match": _rev(client, p)}).status_code == 409
    db_session.expire_all()
    assert db_session.get(TravelEvent, uuid.UUID(a)).event_type == "activity"  # 何も変えていない
