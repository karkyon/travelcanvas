"""
[Gate G11] 旅程の画面の営業時間の照合・移動手段の語彙(docs/ux/G11_UIUX全範囲_実装仕様.md §2.3・§4、UIX-M04・UIX-M07)。

検証する主な性質:
- 時間内・閉店まで 30 分未満・最終入場の後・ラストオーダーの後(飲食だけ)・滞在の途中で閉まる(見積もりを含む)・
  休業日(曜日・例外の日)・開く前・閉まった後・場所が無い・時刻が無い・営業時間の登録が無い を区別する
- 出典が 90 日より古い時は「時間内」を出さない(unknown・stale)。古くても違反はそのまま出す
- 深夜営業(前の日から続く)を使う。日付・時刻は旅程の日の現地
- API: 見える人だけ(他人の旅行は 403)、他の旅行の日は 404、日の現地の日付と zone を返す、予定を変えない
- 移動手段: shinkansen・helicopter を区間に使える。helicopter は所要時間を推定しない(歩きで代わりに推定しない)
"""
import uuid
from datetime import date, datetime, timedelta, timezone

from app.services import feasibility as fz
from app.services import hours_check as hc
from app.services import movement as mv
from app.services.route_estimator import estimate_leg
from tests.test_gate_l3_validation import _day, _event, _snap

NOW = datetime(2026, 10, 28, tzinfo=timezone.utc)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _by_title(snap, events, rules=None, source=None, now=NOW):
    return {e.title: hc.check_event(e, snap, rules, source, now) for e in events}


def test_statuses_for_each_case():
    d = _day()  # 2026-11-02 月曜日
    place = uuid.uuid4()
    hours = {place: [fz.HoursInfo(0, "09:00", "18:00", last_entry="17:30"),
                     fz.HoursInfo(0, "11:00", "14:00", last_order="13:30"),
                     fz.HoursInfo(1, "10:00", "02:00")]}
    evs = [
        _event(d, "時間内", "10:00", "11:00", place_id=place),
        _event(d, "閉店間際", "17:10", place_id=place),
        _event(d, "最終入場の後", "17:40", "17:50", place_id=place),
        _event(d, "開く前", "07:00", place_id=place),
        _event(d, "閉まった後", "19:00", place_id=place),
        _event(d, "途中で閉まる", "16:00", "18:30", place_id=place),
        _event(d, "場所なし", "10:00"),
        _event(d, "時刻なし", place_id=place),
        _event(d, "登録なし", "10:00", place_id=uuid.uuid4()),
    ]
    snap = _snap([d], evs, hours=hours)
    r = _by_title(snap, evs)
    assert (r["時間内"].status, r["時間内"].window_label, r["時間内"].minutes_to_close) == ("ok", "09:00〜18:00", 450)
    assert r["時間内"].last_entry == "17:30" and r["時間内"].local_date == "2026-11-02"
    assert (r["閉店間際"].status, r["閉店間際"].minutes_to_close) == ("near_close", 20)
    assert r["最終入場の後"].status == "last_entry"
    assert (r["開く前"].status, r["開く前"].reason) == ("closed", "before_open")
    assert (r["閉まった後"].status, r["閉まった後"].reason) == ("closed", "after_close")
    assert (r["途中で閉まる"].status, r["途中で閉まる"].estimated) == ("closes_during", False)
    assert (r["場所なし"].status, r["場所なし"].reason) == ("unknown", "no_place")
    assert (r["時刻なし"].status, r["時刻なし"].reason) == ("unknown", "no_time")
    assert (r["登録なし"].status, r["登録なし"].reason) == ("unknown", "no_hours")


def test_last_order_only_for_dining_and_estimated_stay():
    d = _day()
    place = uuid.uuid4()
    hours = {place: [fz.HoursInfo(0, "11:00", "14:00", last_order="13:30")]}
    dinner = _event(d, "遅い昼", "13:40", "13:55", event_type="dining", place_id=place)
    visit = _event(d, "見学", "13:40", "13:55", place_id=place)
    no_end = _event(d, "終わり不明", "13:00", place_id=place)
    snap = _snap([d], [dinner, visit, no_end], hours=hours)
    rules = mv.rules_from({"pace": "normal", "stay_minutes": {"activity": 90}})
    r = _by_title(snap, [dinner, visit, no_end], rules=rules)
    assert r["遅い昼"].status == "last_order" and r["遅い昼"].last_order == "13:30"
    assert r["見学"].status == "near_close"  # 飲食でなければ閉店まで(20分)
    assert (r["終わり不明"].status, r["終わり不明"].estimated) == ("closes_during", True)
    # 規則が無ければ見積もらない(時間内のまま)
    assert _by_title(snap, [no_end])["終わり不明"].status == "ok"


def test_special_day_overnight_and_stale_source():
    d = _day()  # 月曜日
    tue = _day(local_date=date(2026, 11, 3))
    place = uuid.uuid4()
    hours = {place: [fz.HoursInfo(0, "18:00", "02:00")]}  # 月曜の夜から火曜の 02:00 まで
    late = _event(tue, "深夜", "01:00", place_id=place)
    normal = _event(d, "夜", "19:00", place_id=place)
    snap = _snap([d, tue], [late, normal], hours=hours)
    assert hc.check_event(late, snap, None, None, NOW).status == "ok"  # 前の日から続く深夜営業。02:00 まで 60 分
    assert hc.check_event(late, snap, None, None, NOW).minutes_to_close == 60
    snap.special_hours = {place: [fz.SpecialHoursInfo(d.local_date, "closed", None, None, note="臨時休業")]}
    r = hc.check_event(normal, snap, None, None, NOW)
    assert (r.status, r.reason, r.hours_source) == ("closed", "closed_special", "special")

    snap.special_hours = {}
    old = {"provider": "osm", "retrieved_at": (NOW - timedelta(days=91)).isoformat()}
    fresh = {"provider": "osm", "retrieved_at": (NOW - timedelta(days=10)).isoformat()}
    assert hc.check_event(normal, snap, None, fresh, NOW).status == "ok"
    stale = hc.check_event(normal, snap, None, old, NOW)
    assert (stale.status, stale.reason, stale.stale) == ("unknown", "stale_source", True)
    # 古くても違反はそのまま
    early = _event(d, "早い", "10:00", place_id=place)
    assert hc.check_event(early, snap, None, old, NOW).status == "closed"
    assert hc.is_stale({"retrieved_at": None}, NOW) is False


def test_api_permissions_and_payload(auth_client, make_user, db_session):
    from app.core.auth import AuthResult, get_current_user
    from app.main import app

    client, owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "営業時間の照合"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()["id"]
    cid = client.post(f"{base}/candidates", json={"title": "美術館", "address": "京都市"}).json()["id"]
    s = client.post(f"{base}/candidates/{cid}/schedule", json={"day_id": day, "event_type": "activity"},
                    headers={"If-Match": "1"}).json()
    url = f"/api/v1/places/{s['place_id']}"
    rev = client.get(url).json()["revision"]
    assert client.put(f"{url}/opening-hours", json={"hours": [
        {"day_of_week": 0, "open_time": "09:00", "close_time": "17:00", "last_entry": "16:30"}]},
        headers={"If-Match": str(rev)}).status_code == 200
    ev_id = s["event_id"] if "event_id" in s else s["event"]["id"]
    detail = client.get(base).json()
    rev_plan = detail["revision"]
    assert client.put(f"{base}/events/{ev_id}", json={"local_start_time": "16:45"},
                      headers={"If-Match": str(rev_plan)}).status_code == 200
    before = client.get(base).json()["revision"]

    r = client.get(f"{base}/hours-check", params={"day_id": day})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["local_date"] == "2026-11-02" and body["timezone_id"] == "Asia/Tokyo" and body["near_minutes"] == 30
    item = body["events"][0]
    assert item["event_id"] == ev_id and item["status"] == "last_entry" and item["last_entry"] == "16:30"
    assert item["source"]["retrieved_at"]
    assert client.get(base).json()["revision"] == before  # 予定を変えない

    assert client.get(f"{base}/hours-check", params={"day_id": "x"}).status_code == 422
    assert client.get(f"{base}/hours-check", params={"day_id": str(uuid.uuid4())}).status_code == 404
    other, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=other, is_authenticated=True, is_guest=False)
    assert client.get(f"{base}/hours-check", params={"day_id": day}).status_code == 403


def test_transport_vocabulary():
    from app.api.v1.segments import MODES
    from app.services.branch_resources import MODES as BRANCH_MODES

    assert {"shinkansen", "helicopter"} <= MODES and {"shinkansen", "helicopter"} <= set(BRANCH_MODES)
    assert estimate_leg(35.0, 135.7, 35.6, 139.7, "helicopter") is None
    leg = estimate_leg(35.0, 135.7, 35.6, 139.7, "shinkansen")
    assert leg and leg["mode"] == "shinkansen" and leg["is_estimate"] is True
    train = estimate_leg(35.0, 135.7, 35.6, 139.7, "train")
    assert leg["duration_minutes"] < train["duration_minutes"]


def test_segments_accept_new_modes(auth_client):
    client, _owner = auth_client
    p = client.post("/api/v1/travel-plans/", json={"title": "新幹線とヘリ"}).json()["id"]
    base = f"/api/v1/plans/{p}"
    day = client.post(f"{base}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                      headers=_ik()).json()["id"]
    a, b, c = (client.post(f"{base}/events", json={"day_id": day, "title": t, "latitude": lat, "longitude": 135.7},
                           headers=_ik()).json()["id"] for t, lat in (("京都", 35.0), ("名古屋", 35.2), ("山の上", 35.3)))
    r = client.post(f"{base}/segments", json={"from_event_id": a, "to_event_id": b, "mode": "shinkansen"},
                    headers=_ik())
    assert r.status_code == 201, r.text
    assert r.json()["mode"] == "shinkansen" and r.json()["duration_minutes"] is not None
    r = client.post(f"{base}/segments", json={"from_event_id": b, "to_event_id": c, "mode": "helicopter"},
                    headers=_ik())
    assert r.status_code == 201, r.text
    assert r.json()["mode"] == "helicopter" and r.json()["duration_minutes"] is None  # 要手配(推定しない)
    bad = client.post(f"{base}/segments", json={"from_event_id": a, "to_event_id": c, "mode": "rocket"}, headers=_ik())
    assert bad.status_code == 422
