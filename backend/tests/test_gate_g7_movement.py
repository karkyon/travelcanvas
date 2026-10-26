"""[Gate G7] MOVE-03 移動・滞在の既定・最終の便 / FR-005 日をまたぐ予定・変更の影響のプレビュー の試験。

前半: 判定の単体試験(DBを使わない)。後半: API の統合試験(実PostgreSQL)。

- 既定の滞在で終わりを見積もり、見積もりで出た問題には estimated=true を付ける(確かめた事実と区別する)
- 休憩の無い連続・長い1日・疲れの目安・短すぎる滞在・閉まる時刻の見積もり
- 最終の便: 出発が最終便より後なら誤り、余裕が無ければ注意、出発の時刻が分からなければ検証不能
- 移動の既定の保存(If-Match・検査・既定のまま)と、変えると検証の結果が古くなること
- 日をまたぐ予定(local_end_time + end_day_offset)、日程を移すと日時もずれる、前後の確認(422)
- 変更の影響のプレビュー(DBは変えない。新たに出る問題・解消する問題・関係する区間)
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.auth import AuthResult, get_current_user
from app.main import app
from app.models.models import PlanCollaborator, PlanMovementSettings
from app.services import feasibility as fz
from app.services import movement as mv
from app.services.constraint_evaluation import ConstraintSet

JST = timezone(timedelta(hours=9))
DAY1 = date(2026, 11, 21)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _day(local_date=DAY1):
    return fz.DayInfo(uuid.uuid4(), local_date, "Asia/Tokyo")


def _at(day, hhmm, plus_days=0):
    h, m = map(int, hhmm.split(":"))
    d = day.local_date + timedelta(days=plus_days)
    return datetime(d.year, d.month, d.day, h, m, tzinfo=JST).astimezone(timezone.utc)


def _event(day, title, start=None, end=None, event_type="sightseeing", place_id=None, order=0):
    return fz.EventInfo(id=uuid.uuid4(), day=day, title=title, description="", address="", event_type=event_type,
                        place_id=place_id, is_all_day=False, start=_at(day, start) if start else None,
                        end=_at(day, end) if end else None, sort_order=order)


def _segment(src, dst, mode="train", duration=None, last=None, departure=None, prep=0):
    return fz.SegmentInfo(
        id=uuid.uuid4(), from_event_id=src.id if src else None, to_event_id=dst.id if dst else None, mode=mode,
        status="planned", duration_minutes=duration, distance_km=None, preparation_minutes=prep,
        buffer_before_minutes=0, planned_departure_at=departure, planned_arrival_at=None, cost=None, currency=None,
        last_departure_at=last,
    )


def _snap(days, events, segments=(), hours=None):
    return fz.Snapshot(days=list(days), events=list(events), segments=list(segments), reservations={}, links=[],
                       opening_hours=hours or {})


def _codes(r):
    return [f.code for f in r.findings]


RULES = mv.rules_from(None)


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    from app.api.v1 import movement as movement_api

    calls = []
    monkeypatch.setattr(movement_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


# ================================================================ 単体

def test_rules_from_defaults_pace_and_party():
    assert RULES.stay_for("sightseeing") == 60 and RULES.stay_for("accommodation") is None
    assert RULES.stay_for("unknown-type") == 30  # 知らない種類は「その他」
    relaxed = mv.rules_from({"pace": "relaxed"})
    assert relaxed.stay_for("sightseeing") == 75 and relaxed.max_continuous_minutes == 150
    kids = mv.rules_from({"party": {"with_children": True}})
    assert kids.max_continuous_minutes == 120 and kids.break_minutes == 20 and kids.max_day_minutes == 600
    assert any("子ども" in n for n in kids.notes)
    assert mv.rules_from({"enabled": False}) is None
    with pytest.raises(mv.MovementError):
        mv.clean({"stay_minutes": {"accommodation": 60}})
    with pytest.raises(mv.MovementError):
        mv.clean({"surprise": 1})
    with pytest.raises(mv.MovementError):
        mv.clean({"break_minutes": 1})


def test_estimated_travel_shortfall_is_a_warning_with_evidence():
    d = _day()
    a = _event(d, "酒蔵A", "10:00")  # 終了なし → 既定60分で 11:00 まで
    b = _event(d, "酒蔵B", "11:20", "12:00")
    seg = _segment(a, b, "driving", duration=40)
    old = fz.evaluate(_snap([d], [a, b], [seg]), ConstraintSet())
    assert "STAY_LENGTH_UNKNOWN" in _codes(old) and "ESTIMATED_TRAVEL_SHORTFALL" not in _codes(old)
    r = fz.evaluate(_snap([d], [a, b], [seg]), ConstraintSet(), movement=RULES)
    f = next(x for x in r.findings if x.code == "ESTIMATED_TRAVEL_SHORTFALL")
    assert f.severity == "WARNING" and f.kind == "violation"
    assert f.evidence["estimated"] is True and f.evidence["stay_minutes"] == 60
    assert f.evidence["available_minutes"] == 20 and f.evidence["required_minutes"] == 40
    # 間に合う見込みなら検証不能のまま(問題なしにしない)。文面に見込みを足す
    b2 = _event(d, "酒蔵B", "12:00", "12:30")
    r2 = fz.evaluate(_snap([d], [a, b2], [_segment(a, b2, "driving", duration=40)]), ConstraintSet(),
                     movement=RULES)
    unk = next(x for x in r2.findings if x.code == "STAY_LENGTH_UNKNOWN")
    assert unk.kind == "unverified" and "間に合う見込み" in unk.message and unk.evidence["estimated_ok"] is True


def test_past_closing_estimate_and_short_stay():
    d = _day()
    place = uuid.uuid4()
    hours = {place: [fz.HoursInfo(d.local_date.weekday(), "09:00", "17:00")]}
    late = _event(d, "藤居本家", "16:30", place_id=place)
    short = _event(d, "八幡堀", "13:00", "13:10")
    r = fz.evaluate(_snap([d], [late, short], hours=hours), ConstraintSet(), movement=RULES)
    closing = next(x for x in r.findings if x.code == "ESTIMATED_PAST_CLOSING")
    assert closing.severity == "WARNING" and closing.evidence["close"] == "17:00"
    assert closing.suggestion["latest_start"] == _at(d, "16:00").isoformat()
    stay = next(x for x in r.findings if x.code == "SHORT_STAY")
    assert stay.evidence == {"stay_minutes": 10, "default_stay_minutes": 60, "ratio": 0.5}
    plain = fz.evaluate(_snap([d], [late, short], hours=hours), ConstraintSet())
    assert "ESTIMATED_PAST_CLOSING" not in _codes(plain) and "SHORT_STAY" not in _codes(plain)


def test_no_break_long_day_and_fatigue_metrics():
    d = _day()
    events = [
        _event(d, "美冨久酒造", "09:00", "10:00"),
        _event(d, "近江八幡", "10:05", "11:30"),
        _event(d, "藤居本家", "11:35", "13:00"),
    ]
    r = fz.evaluate(_snap([d], events), ConstraintSet(), movement=RULES)
    nb = next(x for x in r.findings if x.code == "NO_BREAK")
    assert nb.entity_type == "day" and nb.entity_id == d.id and nb.evidence["continuous_minutes"] == 240
    m = r.day_metrics[0]
    assert m["longest_continuous_minutes"] == 240 and m["active_minutes"] == 230 and m["span_minutes"] == 240
    assert m["level"] in ("light", "normal") and r.movement_applied is True
    # 食事は休憩として数える
    events2 = [events[0], _event(d, "昼食", "10:05", "11:00", event_type="dining"), events[2]]
    r2 = fz.evaluate(_snap([d], events2), ConstraintSet(), movement=RULES)
    assert "NO_BREAK" not in _codes(r2)
    # 長い1日(12時間を超える)
    long_day = [_event(d, "朝", "07:00", "08:00"), _event(d, "夜", "20:00", "21:00")]
    r3 = fz.evaluate(_snap([d], long_day), ConstraintSet(), movement=RULES)
    assert "LONG_DAY" in _codes(r3)
    # 疲れ: 徒歩の多い日
    a, b = _event(d, "A", "09:00", "11:00"), _event(d, "B", "16:00", "19:00")
    walk = _segment(a, b, "walking", duration=300)
    r4 = fz.evaluate(_snap([d], [a, b], [walk]), ConstraintSet(), movement=mv.rules_from({"max_day_minutes": 620}))
    hi = next(x for x in r4.findings if x.code == "DAY_FATIGUE_HIGH")
    assert hi.evidence["fatigue_percent"] > 100 and r4.day_metrics[0]["walking_minutes"] == 300


def test_last_transport_missed_tight_and_unverified():
    d = _day()
    a = _event(d, "夕食", "20:00", "21:30")
    b = _event(d, "宿", "23:00", event_type="accommodation")
    last = _at(d, "21:40")
    tight = fz.evaluate(_snap([d], [a, b], [_segment(a, b, "train", 30, last=last)]), ConstraintSet(),
                        movement=RULES)
    f = next(x for x in tight.findings if x.code == "LAST_TRANSPORT_TIGHT")
    assert f.evidence["spare_minutes"] == 10 and f.evidence["basis"] == "event_end"
    missed = fz.evaluate(_snap([d], [a, b], [_segment(a, b, "train", 30, last=_at(d, "21:00"))]), ConstraintSet())
    m = next(x for x in missed.findings if x.code == "LAST_TRANSPORT_MISSED")
    assert m.severity == "ERROR" and m.evidence["late_minutes"] == 30
    # 見積もりの終わりで過ぎる時は注意(確かめた事実ではない)
    a2 = _event(d, "夕食", "21:00")
    est = fz.evaluate(_snap([d], [a2, b], [_segment(a2, b, "train", 30, last=_at(d, "21:30"))]), ConstraintSet(),
                      movement=RULES)
    m2 = next(x for x in est.findings if x.code == "LAST_TRANSPORT_MISSED")
    assert m2.severity == "WARNING" and m2.evidence["estimated"] is True
    unknown = fz.evaluate(_snap([d], [a2, b], [_segment(a2, b, "train", 30, last=_at(d, "21:30"))]),
                          ConstraintSet())
    assert "LAST_TRANSPORT_UNVERIFIED" in _codes(unknown) and unknown.unchecked["last_transport_unknown"] == 1


# ================================================================ API

def _plan(client, title="G7"):
    p = client.post("/api/v1/travel-plans/", json={"title": title}).json()["id"]
    base = f"/api/v1/plans/{p}"
    d1 = client.post(f"{base}/days", json={"local_date": "2026-11-21", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    d2 = client.post(f"{base}/days", json={"local_date": "2026-11-22", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
    return p, base, d1, d2


def _rev(client, p):
    return client.get(f"/api/v1/plans/{p}").json()["revision"]


def _ev(client, base, day, title, start=None, **kw):
    body = {"day_id": day["id"], "title": title, "event_type": kw.pop("event_type", "sightseeing"), **kw}
    if start:
        body["local_start_time"] = start
    r = client.post(f"{base}/events", json=body, headers=_ik())
    assert r.status_code == 201, r.text
    return r.json()


def test_movement_settings_api_if_match_validation_and_stale(auth_client, make_user, db_session, audit_calls):
    client, owner = auth_client
    p, base, d1, _d2 = _plan(client)
    got = client.get(f"{base}/movement-settings")
    assert got.status_code == 200
    body = got.json()
    assert body["revision"] == 0 and body["is_default"] is True and body["can_edit"] is True
    assert body["effective"]["stay_minutes"]["sightseeing"] == 60
    assert {t["key"] for t in body["event_types"]} == set(mv.EVENT_TYPES)
    run = client.post(f"{base}/validation-runs").json()
    assert run["is_stale"] is False and run["movement"]["max_continuous_minutes"] == 180
    url = f"{base}/movement-settings"
    new = {"settings": {"pace": "relaxed", "party": {"with_children": True}}}
    assert client.put(url, json=new).status_code == 428
    assert client.put(url, json=new, headers={"If-Match": "3"}).status_code == 409
    bad = client.put(url, json={"settings": {"break_minutes": 0}}, headers={"If-Match": "0"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_movement_settings"
    saved = client.put(url, json=new, headers={"If-Match": "0"})
    assert saved.status_code == 200, saved.text
    s = saved.json()
    assert s["revision"] == 1 and s["effective"]["max_continuous_minutes"] == 120
    assert s["settings"]["stay_minutes"]["dining"] == 60  # 足りない項目は既定で埋める
    assert audit_calls[-1]["action"] == "movement_settings_updated"
    assert audit_calls[-1]["details"]["changed"] == ["pace", "party"]
    assert "with_children" not in str(audit_calls[-1]["details"])  # 同行者の属性の値は監査に残さない
    row = db_session.query(PlanMovementSettings).filter(PlanMovementSettings.plan_id == uuid.UUID(p)).one()
    assert row.updated_by_user_id == owner.id
    # 既定を変えたら検証の結果は古い
    assert client.get(f"{base}/validation-runs/{run['id']}").json()["is_stale"] is True
    # 閲覧だけのメンバーは見られるが変えられない。部外者は見られない
    viewer, _ = make_user()
    stranger, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(viewer)
        assert client.get(url).json()["can_edit"] is False
        assert client.put(url, json=new, headers={"If-Match": "1"}).status_code == 403
        _act_as(stranger)
        assert client.get(url).status_code in (403, 404)
    finally:
        _act_as(owner)


def test_disabling_movement_returns_to_v1_checks(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    for t, title in (("09:00", "A"), ("10:00", "B"), ("11:00", "C"), ("12:00", "D")):
        _ev(client, base, d1, title, t)
    on = client.post(f"{base}/validation-runs").json()
    assert any(i["code"] == "NO_BREAK" for i in on["issues"])
    assert on["day_metrics"][0]["estimated"] is True
    client.put(f"{base}/movement-settings", json={"settings": {"enabled": False}}, headers={"If-Match": "0"})
    off = client.post(f"{base}/validation-runs").json()
    assert not any(i["code"] == "NO_BREAK" for i in off["issues"]) and off["movement"] is None
    assert off["day_metrics"] == []


def test_cross_day_event_end_offset_and_range_checks(auth_client):
    client, _owner = auth_client
    p, base, d1, d2 = _plan(client)
    night = _ev(client, base, d1, "夜行バス", "23:30", event_type="transportation", local_end_time="06:10",
                end_day_offset=1)
    assert night["local_end_time"] == "06:10" and night["end_day_offset"] == 1
    assert night["end_at"].startswith("2026-11-21T21:10")  # JST 11/22 06:10 = UTC 11/21 21:10
    # offset を省くと、開始以前の時刻は翌日とみなす
    late = _ev(client, base, d1, "夜景", "22:00", local_end_time="00:30")
    assert late["end_day_offset"] == 1
    # 前後が逆・長すぎる・開始なしの終了は 422
    for body, code in (({"local_start_time": "10:00", "local_end_time": "09:00", "end_day_offset": 0},
                        "invalid_time_range"),
                       ({"local_start_time": "10:00", "local_end_time": "11:00", "end_day_offset": 5},
                        "invalid_end_day_offset"),
                       ({"local_end_time": "11:00"}, "end_requires_start")):
        r = client.post(f"{base}/events", json={"day_id": d1["id"], "title": "x", **body}, headers=_ik())
        assert r.status_code == 422 and r.json()["detail"]["code"] == code, r.text
    # 開始だけを変えると終了も同じだけずれる(所要時間を保つ)
    rev = _rev(client, p)
    r = client.put(f"{base}/events/{night['id']}", json={"local_start_time": "22:30"}, headers={"If-Match": str(rev)})
    assert r.status_code == 200 and r.json()["local_end_time"] == "05:10" and r.json()["end_day_offset"] == 1
    # 終了を消す
    rev = _rev(client, p)
    r = client.put(f"{base}/events/{late['id']}", json={"local_end_time": None}, headers={"If-Match": str(rev)})
    assert r.status_code == 200 and r.json()["end_at"] is None and r.json()["local_end_time"] is None
    # 日程を移すと日時もずれる(以前は日程だけ変わった)
    rev = _rev(client, p)
    moved = client.post(f"{base}/events/{night['id']}/move", json={"day_id": d2["id"], "sort_order": 0},
                        headers={"If-Match": str(rev), **_ik()})
    assert moved.status_code == 200, moved.text
    assert moved.json()["end_at"].startswith("2026-11-22T20:10") and moved.json()["end_day_offset"] == 1
    # 元に戻すと日時も戻る
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    detail = client.get(f"/api/v1/plans/{p}").json()
    back = next(e for dd in detail["days"] for e in dd["events"] if e["id"] == night["id"])
    assert back["day_id"] == d1["id"] and back["end_at"].startswith("2026-11-21T20:10")


def test_event_time_edit_permissions_and_conflicts(auth_client, make_user, db_session):
    """[Gate G7] FR-005 終了時刻・日をまたぐ予定の編集と影響の確認: 役割・部外者・版の競合(VERIFIED の証拠)。"""
    client, owner = auth_client
    p, base, d1, _d2 = _plan(client)
    ev = _ev(client, base, d1, "夜行バス", "23:30", event_type="transportation", local_end_time="06:10",
             end_day_offset=1)
    url = f"{base}/events/{ev['id']}"
    change = {"local_end_time": "07:00", "end_day_offset": 1}
    # 版が無い・古い版の更新は拒み、旅程を変えない
    assert client.put(url, json=change).status_code == 400
    rev = _rev(client, p)
    assert client.put(url, json=change, headers={"If-Match": str(rev + 3)}).status_code == 409
    assert _rev(client, p) == rev
    viewer, _ = make_user()
    stranger, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(p), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    try:
        _act_as(viewer)
        assert client.put(url, json=change, headers={"If-Match": str(rev)}).status_code == 403
        assert client.post(f"{url}/impact-preview", json=change).status_code == 403
        seen = next(e for d in client.get(f"/api/v1/plans/{p}").json()["days"] for e in d["events"]
                    if e["id"] == ev["id"])
        assert seen["local_end_time"] == "06:10" and seen["end_day_offset"] == 1  # 閲覧はできる
        _act_as(stranger)
        assert client.put(url, json=change, headers={"If-Match": str(rev)}).status_code in (403, 404)
        assert client.post(f"{url}/impact-preview", json=change).status_code in (403, 404)
    finally:
        _act_as(owner)
    r = client.put(url, json=change, headers={"If-Match": str(rev)})
    assert r.status_code == 200 and r.json()["local_end_time"] == "07:00" and r.json()["end_day_offset"] == 1
    # 同じ版での2回目(別の画面からの古い編集)は競合
    assert client.put(url, json={"local_end_time": "08:00"}, headers={"If-Match": str(rev)}).status_code == 409


def test_impact_preview_does_not_change_plan(auth_client):
    client, _owner = auth_client
    p, base, d1, d2 = _plan(client)
    a = _ev(client, base, d1, "酒蔵A", "10:00", local_end_time="11:00")
    b = _ev(client, base, d1, "酒蔵B", "12:00", local_end_time="12:45")
    seg_body = {"from_event_id": a["id"], "to_event_id": b["id"], "mode": "driving", "duration_minutes": 40}
    seg = client.post(f"{base}/segments", json=seg_body, headers=_ik())
    assert seg.status_code == 201, seg.text
    rev = _rev(client, p)
    url = f"{base}/events/{a['id']}/impact-preview"
    r = client.post(url, json={"local_start_time": "11:00", "local_end_time": "11:50"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["code"] for i in body["new_issues"]] == ["TRAVEL_TIME_SHORTFALL"]
    assert body["related"]["segments"] == 1 and body["after"]["error"] == body["before"]["error"] + 1
    assert any("新たに1件" in s for s in body["summary"])
    assert _rev(client, p) == rev  # プレビューは旅程を変えない
    # 日をまたぐ終了の試し
    over = client.post(f"{base}/events/{b['id']}/impact-preview",
                       json={"local_start_time": "23:00", "local_end_time": "01:00"}).json()
    assert over["end_day_offset"] == 1 and any("日をまたぐ" in s for s in over["summary"])
    # 削除の試し: 区間も一緒に消えると示す
    gone = client.post(url, json={"delete": True}).json()
    assert any("一緒に消えます" in s for s in gone["summary"])
    bad = client.post(url, json={"local_start_time": "12:00", "local_end_time": "11:00", "end_day_offset": 0})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_time_range"
    assert client.post(f"{base}/events/{a['id']}/impact-preview", json={"day_id": str(uuid.uuid4())}).status_code \
        == 404


def test_segment_last_departure_round_trip_and_undo(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    a = _ev(client, base, d1, "夕食", "20:00", local_end_time="21:30")
    b = _ev(client, base, d1, "宿", "23:00", event_type="accommodation")
    seg_body = {"from_event_id": a["id"], "to_event_id": b["id"], "mode": "train", "duration_minutes": 30,
                "last_departure_at": "2026-11-21T21:40:00+09:00"}
    seg = client.post(f"{base}/segments", json=seg_body, headers=_ik()).json()
    assert seg["last_departure_at"].startswith("2026-11-21T12:40")
    run = client.post(f"{base}/validation-runs").json()
    assert any(i["code"] == "LAST_TRANSPORT_TIGHT" for i in run["issues"])
    rev = _rev(client, p)
    r = client.patch(f"{base}/segments/{seg['id']}", json={"last_departure_at": "2026-11-21T21:00:00+09:00"},
                     headers={"If-Match": str(rev)})
    assert r.status_code == 200, r.text
    run = client.post(f"{base}/validation-runs").json()
    assert any(i["code"] == "LAST_TRANSPORT_MISSED" and i["severity"] == "ERROR" for i in run["issues"])
    assert client.post(f"/api/v1/plans/{p}/undo", headers={"If-Match": str(rev + 1)}).status_code == 200
    again = client.get(f"{base}/segments/{seg['id']}").json()
    assert again["last_departure_at"].startswith("2026-11-21T12:40")
    tz_less = client.patch(f"{base}/segments/{seg['id']}", json={"last_departure_at": "2026-11-21T21:00:00"},
                           headers={"If-Match": str(_rev(client, p))})
    assert tz_less.status_code == 422


def test_clone_and_export_include_movement_settings(auth_client):
    client, _owner = auth_client
    p, base, d1, _d2 = _plan(client)
    client.put(f"{base}/movement-settings", json={"settings": {"pace": "active"}}, headers={"If-Match": "0"})
    cloned = client.post(f"/api/v1/travel-plans/{p}/clone", json={}).json()
    got = client.get(f"/api/v1/plans/{cloned['id']}/movement-settings").json()
    assert got["settings"]["pace"] == "active" and got["revision"] == 1
    export = client.get(f"/api/v1/plans/{p}/data-export")
    assert export.status_code == 200
    assert export.json()["plans"][0]["tables"]["plan_movement_settings"][0]["settings"]["pace"] == "active"
