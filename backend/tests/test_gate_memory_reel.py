"""
[Gate MemoryReel] 旅の思い出リール(GET /plans/{id}/memory-reel・ホームの行った旅の並び)。

確かめる性質:
- 写真は撮った順。見られる写真だけ(他人の「自分だけ」の写真は出さない)。旅行記に入れない写真も出さない
- 位置は写真の一覧と同じ規則(他人の写真は、位置をメンバーに公開した時だけ)
- 写真が多すぎる時は始めから終わりまで均等に間引く。最初と最後は残る
- 写真が無い旅は予定の名前を順に返す
- 旅の数(写真・メモ・行った場所・一緒に行った人)と、最後のひとこと
- 並び: ○年前の今日・この頃 > 同じ季節 > 最近。札の文
"""
import uuid
from datetime import date, datetime, timezone

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import Memory, PlanCollaborator
from app.services import memory_reel as reel


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


# ===== 純粋な関数

def test_sample_even_keeps_order_and_ends():
    assert reel.sample_even(list(range(5)), 10) == [0, 1, 2, 3, 4]
    picked = reel.sample_even(list(range(100)), 5)
    assert picked[0] == 0 and picked[-1] == 99 and picked == sorted(picked) and len(picked) == 5
    assert reel.sample_even([1, 2, 3], 1) == [1]
    assert reel.sample_even([1, 2, 3], 0) == []


def test_clip_and_local_at():
    assert reel.clip("  あ  い ", 10) == "あ い"
    assert reel.clip("", 10) is None and reel.clip(None, 10) is None
    assert reel.clip("あいうえおかきくけこさ", 5) == "あいうえ…"
    at = datetime(2025, 8, 8, 21, 12, tzinfo=timezone.utc)
    assert reel.local_at(at, "Asia/Tokyo") == "2025-08-09T06:12"
    assert reel.local_at(at, "Not/AZone") == "2025-08-08T21:12"
    assert reel.local_at(None, "Asia/Tokyo") is None


def test_reel_rank_badges():
    today = date(2026, 11, 10)
    assert reel.reel_rank(date(2025, 11, 9), date(2025, 11, 11), today) == (0, "1年前の今日")
    assert reel.reel_rank(date(2023, 11, 12), date(2023, 11, 13), today) == (0, "3年前のこの頃")
    assert reel.reel_rank(date(2024, 10, 1), date(2024, 10, 2), today) == (1, "2年前の秋")
    assert reel.reel_rank(date(2026, 10, 20), date(2026, 10, 25), today) == (2, "最近の旅")
    assert reel.reel_rank(date(2026, 5, 1), date(2026, 5, 2), today) == (2, "6か月前の旅")
    assert reel.reel_rank(date(2025, 3, 1), date(2025, 3, 2), today) == (2, "1年前の旅")
    assert reel.reel_rank(None, None, today) == (3, "行った旅")
    # 2/29 の旅は、うるう年でない年の 2/28 を同じ日として扱う
    assert reel.reel_rank(date(2024, 2, 28), date(2024, 2, 29), date(2025, 2, 28))[0] == 0


def test_order_trips_puts_anniversary_first():
    trips = [
        {"id": "recent", "start_date": "2026-10-20", "end_date": "2026-10-21"},
        {"id": "season", "start_date": "2024-10-01", "end_date": "2024-10-02"},
        {"id": "today", "start_date": "2025-11-09", "end_date": "2025-11-11"},
        {"id": "old", "start_date": "2023-05-01", "end_date": "2023-05-02"},
    ]
    out = reel.order_trips(trips, date(2026, 11, 10))
    assert [t["id"] for t in out] == ["today", "season", "recent", "old"]
    assert out[0]["reel_badge"] == "1年前の今日"
    assert "reel_badge" not in trips[0]  # 元の dict は変えない


# ===== GET /plans/{id}/memory-reel

def _setup(auth_client, db_session):
    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "伊勢・鳥羽", "destination": "三重県鳥羽市"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2025-08-09", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2025-08-10", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    ev = {}
    for name, day, t in (("二見興玉神社", d1, "06:00"), ("おかげ横丁", d1, "11:00"), ("鳥羽水族館", d2, "10:00")):
        ev[name] = client.post(f"{base}/events", json={"day_id": day["id"], "title": name, "local_start_time": t},
                               headers=_ik()).json()
    return client, owner, p, base, (d1, d2), ev


def _photo(db, plan_id, author, at, **kw):
    m = Memory(plan_id=uuid.UUID(plan_id), author_user_id=author.id, kind="photo", storage_key=f"k/{uuid.uuid4()}",
               mime_type="image/jpeg", size=10, occurred_at=at, visibility=kw.pop("visibility", "members"), **kw)
    db.add(m)
    db.commit()
    return m


def test_reel_photos_in_order_with_captions(auth_client, db_session):
    client, owner, p, base, (d1, d2), ev = _setup(auth_client, db_session)
    later = _photo(db_session, p, owner, datetime(2025, 8, 9, 2, 0, tzinfo=timezone.utc),
                   event_id=uuid.UUID(ev["おかげ横丁"]["id"]), day_id=uuid.UUID(d1["id"]), body="赤福の行列に20分",
                   latitude=34.46, longitude=136.72)
    first = _photo(db_session, p, owner, datetime(2025, 8, 8, 21, 12, tzinfo=timezone.utc),
                   place_name="夫婦岩", latitude=34.51, longitude=136.79)
    _photo(db_session, p, owner, datetime(2025, 8, 9, 3, 0, tzinfo=timezone.utc), include_in_journal=False)
    db_session.add(Memory(plan_id=uuid.UUID(p), author_user_id=owner.id, kind="note", body="また来たいね、と全員一致",
                          occurred_at=datetime(2025, 8, 10, 9, 0, tzinfo=timezone.utc), visibility="members"))
    db_session.commit()

    r = client.get(f"{base}/memory-reel")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [s["memory_id"] for s in body["slides"]] == [str(first.id), str(later.id)]
    s0, s1 = body["slides"]
    assert s0["title"] == "夫婦岩" and s0["local_at"] == "2025-08-09T06:12" and s0["latitude"] == 34.51
    assert s1["title"] == "おかげ横丁" and s1["body"] == "赤福の行列に20分" and s1["local_at"] == "2025-08-09T11:00"
    assert body["photo_count"] == 3  # 旅行記に入れない写真も数には入る(リールには出さない)
    assert body["note_count"] == 1
    assert body["place_count"] == 2  # おかげ横丁(予定)・夫婦岩(場所の名前)
    assert body["member_count"] == 1
    assert body["quote"] == "また来たいね、と全員一致"
    assert body["start_date"] == "2025-08-09" and body["end_date"] == "2025-08-10" and body["day_count"] == 2
    assert body["fallback_events"] == []


def test_reel_hides_private_photos_and_locations_of_others(auth_client, db_session, make_user):
    client, owner, p, base, _days, _ev = _setup(auth_client, db_session)
    friend, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=friend.id, email=friend.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    at = datetime(2025, 8, 9, 1, 0, tzinfo=timezone.utc)
    shared = _photo(db_session, p, owner, at, latitude=34.5, longitude=136.8, location_visibility="private")
    open_loc = _photo(db_session, p, owner, at, latitude=34.4, longitude=136.7, location_visibility="members")
    _photo(db_session, p, owner, at, visibility="private")

    _act_as(friend)
    try:
        slides = client.get(f"{base}/memory-reel").json()["slides"]
    finally:
        _act_as(owner)
    by_id = {s["memory_id"]: s for s in slides}
    assert set(by_id) == {str(shared.id), str(open_loc.id)}  # 「自分だけ」の写真は出ない
    assert by_id[str(shared.id)]["latitude"] is None  # 位置を公開していない写真は位置を出さない
    assert by_id[str(open_loc.id)]["latitude"] == 34.4


def test_reel_samples_many_photos(auth_client, db_session):
    client, owner, p, base, _days, _ev = _setup(auth_client, db_session)
    ids = [_photo(db_session, p, owner, datetime(2025, 8, 9, 0, i, tzinfo=timezone.utc)).id for i in range(50)]
    slides = client.get(f"{base}/memory-reel").json()["slides"]
    assert len(slides) == reel.MAX_SLIDES
    assert slides[0]["memory_id"] == str(ids[0]) and slides[-1]["memory_id"] == str(ids[-1])


def test_reel_without_photos_uses_event_names(auth_client, db_session):
    client, _owner, _p, base, _days, _ev = _setup(auth_client, db_session)
    body = client.get(f"{base}/memory-reel").json()
    assert body["slides"] == [] and body["quote"] is None
    assert [e["title"] for e in body["fallback_events"]] == ["二見興玉神社", "おかげ横丁", "鳥羽水族館"]
    assert body["fallback_events"][0] == {"title": "二見興玉神社", "local_date": "2025-08-09", "local_time": "06:00"}


def test_reel_requires_access(auth_client, db_session, make_user):
    client, owner, _p, base, _days, _ev = _setup(auth_client, db_session)
    stranger, _ = make_user()
    _act_as(stranger)
    try:
        assert client.get(f"{base}/memory-reel").status_code in (403, 404)
    finally:
        _act_as(owner)
