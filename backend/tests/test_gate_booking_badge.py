"""
[Gate BookingBadge] 旅程の予定ごとの予約の状態。

- 予約が結び付いた予定は「予約済み」。日付・チェックインの時刻・施設の名前・人数・取り消しの食い違いを文で返す
- 結び付いていない宿・食事・体験の予定は、名前や日付の合う予約を「この予約では?」として出し、無ければ「まだ」
- 予約できない種類(観光など)で予約の無い予定は出さない。予約番号は返さない
"""
import uuid

from app.services.booking_status import name_match


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_name_match():
    assert name_match("都リゾート 奥志摩 アクアフォレスト", "都リゾート奥志摩アクアフォレスト(宿)")
    assert name_match("赤福本店", "赤福 本店")
    assert not name_match("鳥羽国際ホテル", "都リゾート 奥志摩")


def test_booking_status(auth_client):
    client, _owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢・鳥羽", "preferences": {"party_size": 4}}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()

    def ev(title, t, **kw):
        return client.post(f"{base}/events", json={"day_id": day["id"], "title": title, "event_type": t, **kw},
                           headers=_ik()).json()

    hotel = ev("都リゾート 奥志摩 アクアフォレスト", "accommodation", local_start_time="14:00")
    dinner = ev("海鮮 まるや", "dining", local_start_time="18:00")
    lunch = ev("赤福 本店", "dining")
    sight = ev("伊勢神宮", "sightseeing")
    r1 = client.post(f"{base}/reservations", json={
        "type": "accommodation", "provider_name": "都リゾート奥志摩アクアフォレスト", "event_id": hotel["id"],
        "start_at": "2026-11-28T15:00:00+09:00", "end_at": "2026-11-29T11:00:00+09:00", "timezone_id": "Asia/Tokyo",
        "guest_count": 3, "confirmation_number": "SECRET-12345"})
    assert r1.status_code == 201, r1.text
    r2 = client.post(f"{base}/reservations", json={
        "type": "restaurant", "provider_name": "まるや 鳥羽店", "start_at": "2026-11-28T18:30:00+09:00",
        "timezone_id": "Asia/Tokyo"})
    assert r2.status_code == 201, r2.text

    r = client.get(f"{base}/booking-status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "SECRET" not in r.text
    st = body["events"]
    assert st[hotel["id"]]["state"] == "issue"
    assert st[hotel["id"]]["reservations"][0]["id"] == r1.json()["id"]
    assert st[hotel["id"]]["issues"] == ["チェックインは 15:00 からです(予定は 14:00)", "予約の人数 3名と旅行の人数 4名が違います"]
    assert st[dinner["id"]]["state"] == "suggest"
    assert st[dinner["id"]]["suggestions"][0]["id"] == r2.json()["id"]
    assert st[lunch["id"]]["state"] == "none"
    assert sight["id"] not in st

    # 予定につなぐと予約済み(時刻の食い違いを出す)
    link = client.post(f"{base}/reservations/{r2.json()['id']}/events",
                       json={"event_id": dinner["id"], "relation_type": "primary"})
    assert link.status_code == 201, link.text
    st = client.get(f"{base}/booking-status").json()["events"]
    assert st[dinner["id"]]["state"] == "issue"
    assert st[dinner["id"]]["issues"] == ["予約の時刻 18:30 と予定の時刻 18:00 が違います"]
