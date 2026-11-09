"""[Gate PlanEditClear] 予定の項目を消す・変える(旅程の「スポットを編集」)の試験。

- 開始時刻を空(null)にすると消え、終了も一緒に消える。読み直しても残らない
- 住所・メモを null にすると消える。名前は空にできない(空は変えない)
- 開始の日時(start_at)が入っている予定(予約の取り込みなど)でも、開始時刻を消す・変えると start_at もそろう
- 形の違う開始時刻は 422
"""
import uuid
from datetime import datetime, timezone

from app.models.models import TravelEvent


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _setup(client):
    p = client.post("/api/v1/travel-plans/", json={"title": "鳥羽"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"},
                    headers=_ik()).json()
    body = {"day_id": d["id"], "title": "二見興玉神社", "event_type": "sightseeing",
            "local_start_time": "11:00", "local_end_time": "12:00",
            "address": "三重県伊勢市二見町江575", "description": "夫婦岩"}
    r = client.post(f"{base}/events", json=body, headers=_ik())
    assert r.status_code == 201, r.text
    return p, base, r.json()


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _event(client, p, eid):
    days = client.get(f"/api/v1/plans/{p}").json()["days"]
    return next(e for d in days for e in d["events"] if e["id"] == eid)


def test_clear_start_address_notes_persists_and_clears_end(auth_client):
    client, _ = auth_client
    p, base, ev = _setup(client)
    r = client.put(f"{base}/events/{ev['id']}", json={"title": "二見興玉神社", "local_start_time": None,
                                                      "address": None, "description": None},
                   headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    got = _event(client, p, ev["id"])
    assert got["local_start_time"] is None
    assert got["local_end_time"] is None and got["end_at"] is None
    assert got["address"] is None and got["description"] is None
    assert got["title"] == "二見興玉神社"


def test_empty_string_start_clears_and_empty_title_is_ignored(auth_client):
    client, _ = auth_client
    p, base, ev = _setup(client)
    r = client.put(f"{base}/events/{ev['id']}", json={"title": "  ", "local_start_time": ""},
                   headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    got = _event(client, p, ev["id"])
    assert got["local_start_time"] is None and got["title"] == "二見興玉神社"


def test_change_start_shifts_end_and_bad_time_is_422(auth_client):
    client, _ = auth_client
    p, base, ev = _setup(client)
    r = client.put(f"{base}/events/{ev['id']}", json={"local_start_time": "13:30"},
                   headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    assert (r.json()["local_start_time"], r.json()["local_end_time"]) == ("13:30", "14:30")
    bad = client.put(f"{base}/events/{ev['id']}", json={"local_start_time": "25:99"},
                     headers={"If-Match": str(_rev(client, p))})
    assert bad.status_code == 422


def test_start_at_is_kept_in_step_with_local_start(auth_client, db_session):
    client, _ = auth_client
    p, base, ev = _setup(client)
    row = db_session.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(ev["id"])).one()
    row.start_at = datetime(2026, 11, 28, 2, 0, tzinfo=timezone.utc)  # 11:00 JST
    row.end_at = datetime(2026, 11, 28, 3, 0, tzinfo=timezone.utc)
    db_session.commit()
    r = client.put(f"{base}/events/{ev['id']}", json={"local_start_time": "15:00"},
                   headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    assert r.json()["start_at"].startswith("2026-11-28T06:00")
    assert r.json()["local_end_time"] == "16:00"
    r = client.put(f"{base}/events/{ev['id']}", json={"local_start_time": None},
                   headers={"If-Match": str(_rev(client, p))})
    assert r.status_code == 200, r.text
    got = _event(client, p, ev["id"])
    assert got["start_at"] is None and got["local_start_time"] is None and got["local_end_time"] is None
