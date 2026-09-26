"""
[Gate L3] FR-017 実行可能性検証の試験。

前半: 判定エンジン(feasibility.evaluate)の単体試験(DBを使わない)。
後半: API(/plans/{plan_id}/validation-runs)の統合試験(実PostgreSQL)。

検証する主な性質:
- 時間重複・移動不足・営業時間外・予約との不一致・取消済み予約をERROR/WARNINGで検出する
- 情報が足りないものは「検証不能(unverified)」として別に数え、問題なしにしない
- 制約(時刻・予算・移動量・食事間隔・移動手段・文字)の判定と、制約ごとの結果
- 秘匿制約の値を問題の文面・根拠・修正候補・DBに一切残さない。作成者以外には根拠も隠す
- 入力が変わった結果は is_stale=true になる。履歴はプランごとに上限件数まで
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.api.v1 import constraints as constraints_module
from app.api.v1 import validation as validation_module
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import (
    OpeningHours, PlanCollaborator, PlanConstraint, Place, TravelEvent, ValidationIssue, ValidationRun,
)
from app.services import feasibility as fz
from app.services.constraint_evaluation import ConstraintSet, EffectiveConstraint

JST = timezone(timedelta(hours=9))
DAY1 = date(2026, 11, 2)  # 月曜日


# ================================================================ 単体試験の部品

def _day(local_date=DAY1, tz="Asia/Tokyo"):
    return fz.DayInfo(uuid.uuid4(), local_date, tz)


def _at(day, hhmm):
    h, m = map(int, hhmm.split(":"))
    local = datetime(day.local_date.year, day.local_date.month, day.local_date.day, h, m, tzinfo=JST)
    return local.astimezone(timezone.utc)


def _event(day, title, start=None, end=None, event_type="activity", place_id=None, description="", address="",
           sort_order=0, all_day=False):
    return fz.EventInfo(
        id=uuid.uuid4(), day=day, title=title, description=description, address=address, event_type=event_type,
        place_id=place_id, is_all_day=all_day, start=_at(day, start) if start else None,
        end=_at(day, end) if end else None, sort_order=sort_order,
    )


def _segment(src, dst, mode="train", duration=None, distance=None, prep=0, buffer=0, cost=None, currency=None,
             departure=None, arrival=None, status="planned"):
    return fz.SegmentInfo(
        id=uuid.uuid4(), from_event_id=src.id if src else None, to_event_id=dst.id if dst else None, mode=mode,
        status=status, duration_minutes=duration, distance_km=distance, preparation_minutes=prep,
        buffer_before_minutes=buffer, planned_departure_at=departure, planned_arrival_at=arrival,
        cost=Decimal(str(cost)) if cost is not None else None, currency=currency,
    )


def _snap(days, events, segments=(), reservations=(), links=(), hours=None):
    return fz.Snapshot(
        days=list(days), events=list(events), segments=list(segments),
        reservations={r.id: r for r in reservations}, links=list(links), opening_hours=hours or {},
    )


def _constraint(operator, value, *, ctype="last_transport", hardness="hard", scope_type="plan", scope_id=None,
                private=False, weight=None):
    return EffectiveConstraint(
        id=uuid.uuid4(), owner_user_id=uuid.uuid4(), is_private=private, scope_type=scope_type, scope_id=scope_id,
        constraint_type=ctype, hardness=hardness, operator=operator, value=value,
        weight=weight if hardness == "soft" else None,
    )


def _codes(result, kind=None):
    return [f.code for f in result.findings if kind is None or f.kind == kind]


def _status(result, c):
    return next(r["status"] for r in result.constraint_results if r["constraint_id"] == str(c.id))


# ================================================================ 旅程そのものの判定

def test_time_overlap_is_error_and_same_start_is_warning():
    d = _day()
    a = _event(d, "美術館", "10:00", "12:00")
    b = _event(d, "昼食", "11:30", "12:30")
    c = _event(d, "散歩", "14:00")
    e = _event(d, "買い物", "14:00")
    r = fz.evaluate(_snap([d], [a, b, c, e]), ConstraintSet())
    overlap = next(f for f in r.findings if f.code == "TIME_OVERLAP")
    assert overlap.severity == "ERROR" and overlap.entity_id == b.id
    assert overlap.suggestion["earliest_start"] == a.end.isoformat()
    assert "SAME_START_TIME" in _codes(r)
    assert fz.counts(r.findings)["error"] == 1 and fz.counts(r.findings)["warning"] == 1


def test_end_before_start_is_error_and_not_used_for_other_checks():
    d = _day()
    bad = _event(d, "逆転", "12:00", "11:00")
    r = fz.evaluate(_snap([d], [bad]), ConstraintSet())
    assert _codes(r) == ["INVALID_TIME_RANGE"]


def test_unknown_start_time_is_reported_as_unverified_not_ok():
    d = _day()
    r = fz.evaluate(_snap([d], [_event(d, "時刻未定")]), ConstraintSet())
    assert _codes(r, "unverified") == ["EVENT_TIME_UNKNOWN"]
    assert r.unchecked == {"event_time_unknown": 1}
    assert fz.counts(r.findings) == {"error": 0, "warning": 0, "info": 0, "unverified": 1}


def test_all_day_event_is_neither_error_nor_unverified():
    d = _day()
    r = fz.evaluate(_snap([d], [_event(d, "終日", all_day=True)]), ConstraintSet())
    assert r.findings == []


def test_travel_shortfall_uses_duration_preparation_and_buffer():
    d = _day()
    a = _event(d, "清水寺", "09:00", "10:00")
    b = _event(d, "金閣寺", "10:30")
    seg = _segment(a, b, duration=25, prep=5, buffer=10)
    r = fz.evaluate(_snap([d], [a, b], [seg]), ConstraintSet())
    f = next(f for f in r.findings if f.code == "TRAVEL_TIME_SHORTFALL")
    assert f.severity == "ERROR" and f.entity_id == seg.id
    assert f.evidence == {"available_minutes": 30, "required_minutes": 40, "shortage_minutes": 10}
    assert f.suggestion["earliest_start"] == (a.end + timedelta(minutes=40)).isoformat()

    ok = _segment(a, b, duration=20, prep=5, buffer=5)
    assert "TRAVEL_TIME_SHORTFALL" not in _codes(fz.evaluate(_snap([d], [a, b], [ok]), ConstraintSet()))


def test_travel_with_unknown_end_is_error_only_when_certain_otherwise_unverified():
    d = _day()
    a = _event(d, "朝食", "08:00")  # 終了未定
    b = _event(d, "会議", "08:20")
    certain = fz.evaluate(_snap([d], [a, b], [_segment(a, b, duration=30)]), ConstraintSet())
    f = next(f for f in certain.findings if f.code == "TRAVEL_TIME_SHORTFALL")
    assert f.evidence["from_end_unknown"] is True

    # 前の予定の終了より前に次が始まる場合は、負の分数ではなく状況を説明する
    x = _event(d, "美術館", "10:00", "12:00")
    y = _event(d, "昼食", "11:30")
    overlap = fz.evaluate(_snap([d], [x, y], [_segment(x, y, duration=20)]), ConstraintSet())
    msg = next(f for f in overlap.findings if f.code == "TRAVEL_TIME_SHORTFALL").message
    assert "12:00" in msg and "-" not in msg

    c = _event(d, "会議", "10:00")
    unsure = fz.evaluate(_snap([d], [a, c], [_segment(a, c, duration=30)]), ConstraintSet())
    assert "STAY_LENGTH_UNKNOWN" in _codes(unsure, "unverified")
    assert unsure.unchecked["stay_length_unknown"] == 1
    hint = next(f for f in unsure.findings if f.code == "STAY_LENGTH_UNKNOWN")
    assert hint.suggestion["latest_end"] == (c.start - timedelta(minutes=30)).isoformat()


def test_segment_without_duration_is_unverified_and_cancelled_segment_is_ignored():
    d = _day()
    a, b = _event(d, "A", "09:00", "10:00"), _event(d, "B", "10:05")
    r = fz.evaluate(_snap([d], [a, b], [_segment(a, b)]), ConstraintSet())
    assert _codes(r) == ["SEGMENT_DURATION_UNKNOWN"]
    r2 = fz.evaluate(_snap([d], [a, b], [_segment(a, b, duration=300, status="cancelled")]), ConstraintSet())
    assert r2.findings == []


def test_planned_arrival_after_next_start_is_error():
    d = _day()
    a, b = _event(d, "A", "09:00"), _event(d, "B", "10:00")
    seg = _segment(a, b, duration=10, arrival=_at(d, "10:20"))
    r = fz.evaluate(_snap([d], [a, b], [seg]), ConstraintSet())
    assert _codes(r) == ["ARRIVES_AFTER_START"]


def test_reservation_mismatch_and_cancelled_reservation():
    d = _day()
    ev = _event(d, "夕食", "18:00")
    res_ok = fz.ReservationInfo(uuid.uuid4(), "料亭", "confirmed", _at(d, "18:10"), 10000, "JPY")
    res_off = fz.ReservationInfo(uuid.uuid4(), "料亭", "confirmed", _at(d, "19:00"), 10000, "JPY")
    res_cancel = fz.ReservationInfo(uuid.uuid4(), "旧予約", "cancelled", _at(d, "18:00"), 5000, "JPY")
    ok = fz.evaluate(_snap([d], [ev], reservations=[res_ok], links=[fz.LinkInfo(ev.id, res_ok.id, "primary")]),
                     ConstraintSet())
    assert ok.findings == []  # 15分以内は許容
    off = fz.evaluate(_snap([d], [ev], reservations=[res_off], links=[fz.LinkInfo(ev.id, res_off.id, "primary")]),
                      ConstraintSet())
    f = off.findings[0]
    assert f.code == "RESERVATION_TIME_MISMATCH" and f.severity == "WARNING"
    assert f.evidence["difference_minutes"] == -60
    related = fz.evaluate(
        _snap([d], [ev], reservations=[res_off], links=[fz.LinkInfo(ev.id, res_off.id, "related")]), ConstraintSet())
    assert related.findings == []  # 関連予約は時刻を揃える対象ではない
    cancel = fz.evaluate(
        _snap([d], [ev], reservations=[res_cancel], links=[fz.LinkInfo(ev.id, res_cancel.id, "primary")]),
        ConstraintSet())
    assert _codes(cancel) == ["RESERVATION_CANCELLED"] and cancel.findings[0].severity == "ERROR"


def test_opening_hours_closed_day_outside_hours_overnight_and_unknown():
    d = _day()  # 月曜日
    place = uuid.uuid4()
    hours = {place: [fz.HoursInfo(0, "09:00", "17:00")]}
    inside = _event(d, "寺", "10:00", "16:00", place_id=place)
    late = _event(d, "寺", "16:30", "17:30", place_id=place)
    early = _event(d, "寺", "08:00", place_id=place)
    r = fz.evaluate(_snap([d], [inside, late, early], hours=hours), ConstraintSet())
    assert sorted(f.entity_id for f in r.findings if f.code == "OUTSIDE_OPENING_HOURS") == sorted([late.id, early.id])

    closed = fz.evaluate(_snap([d], [inside], hours={place: [fz.HoursInfo(1, "09:00", "17:00")]}), ConstraintSet())
    assert _codes(closed) == ["CLOSED_ON_DAY"]

    bar = uuid.uuid4()
    night = fz.evaluate(_snap([d], [_event(d, "バー", "23:30", place_id=bar)],
                              hours={bar: [fz.HoursInfo(0, "18:00", "02:00")]}), ConstraintSet())
    assert night.findings == []

    unknown_place = uuid.uuid4()
    unk = fz.evaluate(_snap([d], [_event(d, "店", "12:00", place_id=unknown_place)]), ConstraintSet())
    assert unk.findings == [] and unk.unchecked == {"opening_hours_unknown": 1}


# ================================================================ 制約の判定

def test_time_constraint_before_after_between():
    d = _day()
    early = _event(d, "朝市", "06:00", "07:00")
    late = _event(d, "夜景", "21:00", "22:30")
    no_end = _event(d, "夕食", "19:00")
    before = _constraint("before", {"value": "22:00"})
    after = _constraint("after", {"value": "07:00"}, ctype="preference", hardness="soft", weight=40)
    r = fz.evaluate(_snap([d], [early, late, no_end]), ConstraintSet([before, after]))
    b = [f for f in r.findings if f.constraint is before and f.kind == "violation"]
    assert [f.entity_id for f in b] == [late.id] and b[0].severity == "ERROR"
    assert _status(r, before) == "violated"
    a = [f for f in r.findings if f.constraint is after and f.kind == "violation"]
    assert [f.entity_id for f in a] == [early.id] and a[0].severity == "WARNING" and a[0].evidence["weight"] == 40

    # 終了が分からない予定しか無ければ「満たす」ではなく「検証不能」
    only = fz.evaluate(_snap([d], [no_end]), ConstraintSet([before]))
    assert _status(only, before) == "unverified"

    window = _constraint("between", {"value": "22:00", "value_to": "02:00"}, ctype="meeting")
    night = _event(d, "ナイトツアー", "23:00", "23:50")
    day_ev = _event(d, "昼", "12:00", "13:00")
    w = fz.evaluate(_snap([d], [night, day_ev]), ConstraintSet([window]))
    assert [f.entity_id for f in w.findings if f.kind == "violation"] == [day_ev.id]


def test_time_constraint_scope_day_and_event_and_missing_scope():
    d1, d2 = _day(), _day(DAY1 + timedelta(days=1))
    e1, e2 = _event(d1, "一日目", "23:00", "23:30"), _event(d2, "二日目", "23:00", "23:30")
    by_day = _constraint("before", {"value": "22:00"}, scope_type="day", scope_id=d2.id)
    r = fz.evaluate(_snap([d1, d2], [e1, e2]), ConstraintSet([by_day]))
    assert [f.entity_id for f in r.findings if f.kind == "violation"] == [e2.id]
    by_event = _constraint("before", {"value": "22:00"}, scope_type="event", scope_id=e1.id)
    r2 = fz.evaluate(_snap([d1, d2], [e1, e2]), ConstraintSet([by_event]))
    assert [f.entity_id for f in r2.findings if f.kind == "violation"] == [e1.id]
    missing = _constraint("before", {"value": "22:00"}, scope_type="event", scope_id=uuid.uuid4())
    r3 = fz.evaluate(_snap([d1], [e1]), ConstraintSet([missing]))
    assert _codes(r3) == ["CONSTRAINT_SCOPE_MISSING"] and _status(r3, missing) == "unverified"


def test_budget_constraint_sums_same_currency_and_reports_rest_as_unverified():
    d = _day()
    a, b = _event(d, "A", "09:00", "10:00"), _event(d, "B", "11:00", "12:00")
    hotel = fz.ReservationInfo(uuid.uuid4(), "宿", "confirmed", _at(d, "15:00"), 40000, "JPY")
    cancelled = fz.ReservationInfo(uuid.uuid4(), "取消", "cancelled", _at(d, "15:00"), 99999, "JPY")
    usd = fz.ReservationInfo(uuid.uuid4(), "ツアー", "confirmed", _at(d, "15:00"), 100, "USD")
    seg = _segment(a, b, duration=30, cost=15000, currency="JPY", departure=_at(d, "10:00"))
    limit = _constraint("max", {"value": 50000, "unit": "JPY"}, ctype="budget_limit")
    r = fz.evaluate(_snap([d], [a, b], [seg], [hotel, cancelled, usd]), ConstraintSet([limit]))
    over = next(f for f in r.findings if f.code == "BUDGET_EXCEEDED")
    assert over.evidence == {"total": 55000.0, "limit": 50000, "unit": "JPY"}
    assert "BUDGET_PARTIALLY_UNCHECKED" in _codes(r, "unverified")
    assert _status(r, limit) == "violated"

    ok = _constraint("max", {"value": 60000, "unit": "JPY"}, ctype="budget_limit")
    r2 = fz.evaluate(_snap([d], [a, b], [seg], [hotel]), ConstraintSet([ok]))
    assert r2.findings == [] and _status(r2, ok) == "satisfied"

    per_member = _constraint("max", {"value": 60000, "unit": "JPY"}, ctype="budget_limit", scope_type="member")
    r3 = fz.evaluate(_snap([d], [a, b], [seg], [hotel]), ConstraintSet([per_member]))
    assert _codes(r3) == ["BUDGET_NOT_CHECKABLE"] and _status(r3, per_member) == "unverified"


def test_budget_constraint_for_one_day_counts_only_that_day():
    d1, d2 = _day(), _day(DAY1 + timedelta(days=1))
    r1 = fz.ReservationInfo(uuid.uuid4(), "宿1", "confirmed", _at(d1, "15:00"), 30000, "JPY")
    r2 = fz.ReservationInfo(uuid.uuid4(), "宿2", "confirmed", _at(d2, "15:00"), 30000, "JPY")
    c = _constraint("max", {"value": 40000, "unit": "JPY"}, ctype="budget_limit", scope_type="day", scope_id=d2.id)
    r = fz.evaluate(_snap([d1, d2], [], reservations=[r1, r2]), ConstraintSet([c]))
    assert r.findings == [] and _status(r, c) == "satisfied"


def test_fatigue_and_meal_interval_constraints():
    d = _day()
    a, b, c = _event(d, "A", "09:00"), _event(d, "B", "12:00"), _event(d, "C", "16:00")
    segs = [_segment(a, b, duration=90, distance=40), _segment(b, c, duration=60, distance=30)]
    minutes = _constraint("max", {"value": 2, "unit": "hours"}, ctype="fatigue", hardness="soft", weight=60)
    km = _constraint("max", {"value": 100, "unit": "km"}, ctype="fatigue", hardness="soft", weight=60)
    r = fz.evaluate(_snap([d], [a, b, c], segs), ConstraintSet([minutes, km]))
    f = next(f for f in r.findings if f.code == "DAILY_TRAVEL_LIMIT")
    assert f.constraint is minutes and f.evidence["total"] == 150 and f.evidence["limit"] == 120
    assert _status(r, minutes) == "violated" and _status(r, km) == "satisfied"

    breakfast = _event(d, "朝食", "07:00", event_type="dining")
    lunch = _event(d, "昼食", "13:30", event_type="dining")
    meal = _constraint("max", {"value": 300, "unit": "minutes"}, ctype="meal_interval", hardness="soft", weight=50)
    m = fz.evaluate(_snap([d], [breakfast, lunch]), ConstraintSet([meal]))
    mf = next(f for f in m.findings if f.code == "MEAL_INTERVAL")
    assert mf.entity_id == lunch.id and mf.evidence["interval_minutes"] == 390


def test_avoid_transport_maps_japanese_words_to_modes():
    d = _day()
    a, b, c = _event(d, "A", "09:00"), _event(d, "B", "10:00"), _event(d, "C", "12:00")
    taxi = _segment(a, b, mode="taxi", duration=10)
    train = _segment(b, c, mode="train", duration=30)
    avoid = _constraint("avoid", {"value": "タクシー"}, ctype="avoid_transport", hardness="soft", weight=80)
    r = fz.evaluate(_snap([d], [a, b, c], [taxi, train]), ConstraintSet([avoid]))
    f = [f for f in r.findings if f.code == "AVOIDED_TRANSPORT_USED"]
    assert [x.entity_id for x in f] == [taxi.id] and f[0].severity == "WARNING"
    shinkansen = _constraint("avoid", {"value": "新幹線は使わない"}, ctype="avoid_transport")
    r2 = fz.evaluate(_snap([d], [a, b, c], [taxi, train]), ConstraintSet([shinkansen]))
    assert [x.entity_id for x in r2.findings if x.kind == "violation"] == [train.id]


def test_text_constraints_are_possible_violation_or_unverified_never_satisfied():
    d = _day()
    sushi = _event(d, "寿司 えび専門店", "12:00")
    avoid = _constraint("avoid", {"value": "えび"}, ctype="forbidden")
    r = fz.evaluate(_snap([d], [sushi]), ConstraintSet([avoid]))
    assert _codes(r, "violation") == ["POSSIBLE_CONSTRAINT_VIOLATION"]
    r2 = fz.evaluate(_snap([d], [_event(d, "蕎麦", "12:00")]), ConstraintSet([avoid]))
    assert _codes(r2) == ["TEXT_CONSTRAINT_NOT_CHECKABLE"] and _status(r2, avoid) == "unverified"
    prefer = _constraint("prefer", {"value": "海の見える店"}, ctype="scenery", hardness="soft", weight=30)
    r3 = fz.evaluate(_snap([d], [sushi]), ConstraintSet([prefer]))
    assert _codes(r3) == ["CONSTRAINT_NOT_MACHINE_CHECKABLE"] and _status(r3, prefer) == "unverified"


def test_constraint_without_applicable_items_is_not_applicable():
    d = _day()
    c = _constraint("before", {"value": "22:00"})
    r = fz.evaluate(_snap([d], []), ConstraintSet([c]))
    assert r.findings == [] and _status(r, c) == "not_applicable"


def test_private_constraint_findings_never_contain_the_constraint_value():
    d = _day()
    sushi = _event(d, "寿司 えび専門店", "12:00", "13:00")
    late = _event(d, "夜景", "23:00", "23:30")
    secret_avoid = _constraint("avoid", {"value": "えび"}, ctype="forbidden", private=True)
    secret_time = _constraint("before", {"value": "22:15"}, private=True)
    secret_budget = _constraint("max", {"value": 12345, "unit": "JPY"}, ctype="budget_limit", private=True)
    hotel = fz.ReservationInfo(uuid.uuid4(), "宿", "confirmed", _at(d, "15:00"), 20000, "JPY")
    r = fz.evaluate(_snap([d], [sushi, late], reservations=[hotel]),
                    ConstraintSet([secret_avoid, secret_time, secret_budget]))
    private_findings = [f for f in r.findings if f.constraint is not None]
    assert len(private_findings) == 3
    dumped = json.dumps([[f.message, f.evidence, f.suggestion] for f in private_findings], ensure_ascii=False)
    for secret in ("えび", "22:15", "12345", "12,345"):
        assert secret not in dumped
    assert all(f.suggestion is None for f in private_findings)
    assert {f.message for f in private_findings} == {fz.PRIVATE_MESSAGE, fz.PRIVATE_POSSIBLE_MESSAGE}


def test_unavailable_private_constraint_is_unverified():
    cid = uuid.uuid4()
    r = fz.evaluate(_snap([_day()], []), ConstraintSet(unavailable=[cid]), unavailable_owners={cid: uuid.uuid4()})
    assert _codes(r) == ["CONSTRAINT_UNAVAILABLE"]
    assert r.constraint_results == [{"constraint_id": str(cid), "status": "unverified"}]


def test_findings_are_ordered_errors_first_then_warnings_then_unverified():
    d = _day()
    a = _event(d, "A", "10:00", "12:00")
    b = _event(d, "B", "11:00")
    c = _event(d, "C", "11:00")
    e = _event(d, "未定")
    r = fz.evaluate(_snap([d], [e, a, b, c]), ConstraintSet())
    kinds = [(f.kind, f.severity) for f in r.findings]
    assert kinds == sorted(kinds, key=lambda k: (k[0] != "violation", {"ERROR": 0, "WARNING": 1, "INFO": 2}[k[1]]))
    assert kinds[0] == ("violation", "ERROR") and kinds[-1] == ("unverified", "INFO")


# ================================================================ API統合試験

RUNS = "/api/v1/plans/{plan_id}/validation-runs"
CONSTRAINTS = "/api/v1/plans/{plan_id}/constraints"


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    monkeypatch.setattr(constraints_module, "record_audit_event", lambda **kw: None)


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _idem():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _plan_with_day(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "検証テスト旅行"})
    assert res.status_code == 201, res.text
    plan_id = res.json()["id"]
    day = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-11-02", "timezone_id": "Asia/Tokyo"},
                      headers=_idem())
    assert day.status_code == 201, day.text
    return plan_id, day.json()["id"]


def _event_api(client, plan_id, day_id, title, local_start_time=None, **extra):
    body = {"day_id": day_id, "title": title, **extra}
    if local_start_time:
        body["local_start_time"] = local_start_time
    res = client.post(f"/api/v1/plans/{plan_id}/events", json=body, headers=_idem())
    assert res.status_code == 201, res.text
    return res.json()


def _run(client, plan_id):
    res = client.post(RUNS.format(plan_id=plan_id))
    assert res.status_code == 201, res.text
    return res.json()


def test_run_detects_overlap_and_travel_shortfall_end_to_end(auth_client, db_session):
    client, user = auth_client
    plan_id, day_id = _plan_with_day(client)
    a = _event_api(client, plan_id, day_id, "美術館", start_at="2026-11-02T10:00:00+09:00",
                   end_at="2026-11-02T12:00:00+09:00")
    b = _event_api(client, plan_id, day_id, "昼食", "11:30", event_type="dining")
    c = _event_api(client, plan_id, day_id, "時刻未定")
    seg = client.post(f"/api/v1/plans/{plan_id}/segments", headers=_idem(), json={
        "from_event_id": a["id"], "to_event_id": b["id"], "mode": "walking", "duration_minutes": 20,
    })
    assert seg.status_code == 201, seg.text

    run = _run(client, plan_id)
    assert run["status"] == "completed" and run["algorithm_version"] == "feasibility-v1"
    assert run["is_stale"] is False and run["created_by_me"] is True
    codes = {i["code"] for i in run["issues"]}
    assert {"TIME_OVERLAP", "TRAVEL_TIME_SHORTFALL", "EVENT_TIME_UNKNOWN"} <= codes
    assert run["counts"]["error"] == 2 and run["counts"]["unverified"] == 1
    assert run["unchecked"] == {"event_time_unknown": 1}
    unknown = next(i for i in run["issues"] if i["code"] == "EVENT_TIME_UNKNOWN")
    assert unknown["kind"] == "unverified" and unknown["entity_id"] == c["id"]
    assert unknown["entity_label"] == "2026-11-02 時刻未定" and unknown["day_id"] == day_id
    assert set(run["issues"][0]) == {
        "id", "code", "kind", "severity", "message", "entity_type", "entity_id", "entity_label", "day_id",
        "constraint_id", "constraint_title", "is_private_constraint", "is_masked", "evidence", "suggestion",
    }

    stored = db_session.query(ValidationRun).filter(ValidationRun.id == uuid.UUID(run["id"])).one()
    assert stored.error_count == 2 and len(stored.issues) == len(run["issues"])
    assert stored.input_revision >= 1


def test_list_and_get_and_staleness(auth_client):
    client, _user = auth_client
    plan_id, day_id = _plan_with_day(client)
    empty = client.get(RUNS.format(plan_id=plan_id))
    assert empty.status_code == 200 and empty.json() == []

    first = _run(client, plan_id)
    listed = client.get(RUNS.format(plan_id=plan_id)).json()
    assert [r["id"] for r in listed] == [first["id"]] and "issues" not in listed[0]
    assert listed[0]["is_stale"] is False

    _event_api(client, plan_id, day_id, "追加した予定", "09:00")
    assert client.get(RUNS.format(plan_id=plan_id)).json()[0]["is_stale"] is True
    detail = client.get(RUNS.format(plan_id=plan_id) + f"/{first['id']}")
    assert detail.status_code == 200 and detail.json()["is_stale"] is True

    # 制約の変更もプランrevisionは進めないが、結果は古くなる
    second = _run(client, plan_id)
    assert second["is_stale"] is False
    res = client.post(CONSTRAINTS.format(plan_id=plan_id), json={
        "title": "22時までに宿", "constraint_type": "last_transport", "hardness": "hard", "operator": "before",
        "value": {"value": "22:00"},
    })
    assert res.status_code == 201, res.text
    assert client.get(RUNS.format(plan_id=plan_id) + f"/{second['id']}").json()["is_stale"] is True


def test_get_unknown_or_other_plans_run_is_404(auth_client):
    client, _user = auth_client
    plan_a, _ = _plan_with_day(client)
    plan_b, _ = _plan_with_day(client)
    run = _run(client, plan_a)
    assert client.get(RUNS.format(plan_id=plan_b) + f"/{run['id']}").status_code == 404
    assert client.get(RUNS.format(plan_id=plan_a) + f"/{uuid.uuid4()}").status_code == 404
    assert client.get(RUNS.format(plan_id=plan_a) + "/not-a-uuid").status_code == 404


def test_permissions_viewer_can_run_stranger_cannot(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id, _day = _plan_with_day(client)
    viewer, _ = make_user()
    stranger, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    _act_as(viewer)
    run = _run(client, plan_id)
    assert run["created_by_me"] is True
    _act_as(stranger)
    assert client.post(RUNS.format(plan_id=plan_id)).status_code == 403
    assert client.get(RUNS.format(plan_id=plan_id)).status_code == 403
    _act_as(owner)
    assert client.get(RUNS.format(plan_id=plan_id)).json()[0]["created_by_me"] is False
    assert client.post(RUNS.format(plan_id=str(uuid.uuid4()))).status_code == 404


def test_constraint_results_and_titles_in_response(auth_client):
    client, _user = auth_client
    plan_id, day_id = _plan_with_day(client)
    _event_api(client, plan_id, day_id, "夜景", start_at="2026-11-02T22:30:00+09:00",
               end_at="2026-11-02T23:00:00+09:00")
    c = client.post(CONSTRAINTS.format(plan_id=plan_id), json={
        "title": "22時までに宿へ", "constraint_type": "last_transport", "hardness": "hard", "operator": "before",
        "value": {"value": "22:00"},
    }).json()
    run = _run(client, plan_id)
    assert run["constraint_results"] == [{
        "constraint_id": c["id"], "status": "violated", "is_private": False, "is_mine": True,
        "constraint_title": "22時までに宿へ",
    }]
    issue = next(i for i in run["issues"] if i["constraint_id"] == c["id"])
    assert issue["severity"] == "ERROR" and issue["constraint_title"] == "22時までに宿へ"
    assert "22時までに宿へ" in issue["message"] and issue["is_masked"] is False


def test_private_constraint_is_masked_for_others_and_never_stored_in_plain(auth_client, make_user, db_session):
    client, owner = auth_client
    plan_id, day_id = _plan_with_day(client)
    _event_api(client, plan_id, day_id, "寿司 えび専門店", "12:00")
    member, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan_id), user_id=member.id, email=member.email,
                                    role="editor", status="accepted"))
    db_session.commit()
    _act_as(member)
    secret = client.post(CONSTRAINTS.format(plan_id=plan_id), json={
        "title": "甲殻類は食べられない", "constraint_type": "forbidden", "hardness": "hard", "operator": "avoid",
        "value": {"value": "えび"}, "privacy_level": "private", "scope_type": "member",
    })
    assert secret.status_code == 201, secret.text
    secret_id = secret.json()["id"]

    # 所有者が検証しても秘匿制約は判定に使われるが、内容は見えない
    _act_as(owner)
    run = _run(client, plan_id)
    issue = next(i for i in run["issues"] if i["constraint_id"] == secret_id)
    assert issue["kind"] == "violation" and issue["severity"] == "ERROR"
    assert issue["is_private_constraint"] is True and issue["is_masked"] is True
    assert issue["constraint_title"] is None and issue["evidence"] is None and issue["suggestion"] is None
    assert issue["message"] == fz.PRIVATE_POSSIBLE_MESSAGE
    result = next(r for r in run["constraint_results"] if r["constraint_id"] == secret_id)
    assert result == {"constraint_id": secret_id, "status": "violated", "is_private": True, "is_mine": False,
                      "constraint_title": None}
    owner_view = json.dumps(run, ensure_ascii=False)
    assert "甲殻類" not in owner_view and "えび\"" not in owner_view and '"えび' not in owner_view

    # 作成者本人には題名が付く
    _act_as(member)
    mine = client.get(RUNS.format(plan_id=plan_id) + f"/{run['id']}").json()
    my_issue = next(i for i in mine["issues"] if i["constraint_id"] == secret_id)
    assert my_issue["is_masked"] is False and my_issue["constraint_title"] == "甲殻類は食べられない"
    assert next(r for r in mine["constraint_results"] if r["constraint_id"] == secret_id)["is_mine"] is True

    # DBに値・題名を残さない
    for row in db_session.query(ValidationIssue).filter(ValidationIssue.run_id == uuid.UUID(run["id"])):
        text = json.dumps([row.message, row.evidence_json, row.suggestion_json], ensure_ascii=False)
        assert "甲殻類" not in text and "えび\"" not in text.replace("えび専門店", "")
    stored = db_session.query(ValidationRun).filter(ValidationRun.id == uuid.UUID(run["id"])).one()
    assert "甲殻類" not in json.dumps(stored.summary_json, ensure_ascii=False)


def test_undecryptable_private_constraint_is_reported_as_unverified(auth_client, db_session, monkeypatch):
    client, _owner = auth_client
    plan_id, _day = _plan_with_day(client)
    res = client.post(CONSTRAINTS.format(plan_id=plan_id), json={
        "title": "秘密", "constraint_type": "forbidden", "hardness": "hard", "operator": "avoid",
        "value": {"value": "x"}, "privacy_level": "private",
    })
    assert res.status_code == 201, res.text
    row = db_session.query(PlanConstraint).filter(PlanConstraint.id == uuid.UUID(res.json()["id"])).one()
    row.value_ciphertext = b"broken-ciphertext"
    db_session.commit()
    run = _run(client, plan_id)
    assert [i["code"] for i in run["issues"]] == ["CONSTRAINT_UNAVAILABLE"]
    assert run["counts"]["unverified"] == 1
    assert run["constraint_results"][0]["status"] == "unverified"


def test_opening_hours_from_database(auth_client, db_session):
    client, _user = auth_client
    plan_id, day_id = _plan_with_day(client)
    place = Place(name="テスト寺", latitude=35.0, longitude=135.7)
    db_session.add(place)
    db_session.commit()
    db_session.add(OpeningHours(place_id=place.id, day_of_week=0, open_time="09:00", close_time="17:00"))
    db_session.commit()
    ev = _event_api(client, plan_id, day_id, "テスト寺", "18:00", place_id=str(place.id))
    run = _run(client, plan_id)
    issue = next(i for i in run["issues"] if i["code"] == "OUTSIDE_OPENING_HOURS")
    assert issue["entity_id"] == ev["id"] and issue["evidence"]["open"] == "09:00"


def test_reservation_link_checks_end_to_end(auth_client):
    client, _user = auth_client
    plan_id, day_id = _plan_with_day(client)
    ev = _event_api(client, plan_id, day_id, "夕食", "18:00", event_type="dining")
    res = client.post(f"/api/v1/plans/{plan_id}/reservations", json={
        "type": "restaurant", "provider_name": "料亭", "event_id": ev["id"],
        "start_at": "2026-11-02T19:00:00+09:00", "total_amount": 12000, "currency": "JPY",
    })
    assert res.status_code == 201, res.text
    run = _run(client, plan_id)
    mismatch = next(i for i in run["issues"] if i["code"] == "RESERVATION_TIME_MISMATCH")
    assert mismatch["severity"] == "WARNING" and mismatch["entity_id"] == ev["id"]
    assert mismatch["suggestion"]["action"] == "align_to_reservation"


def test_history_is_pruned_to_max_runs(auth_client, db_session, monkeypatch):
    client, _user = auth_client
    plan_id, _day = _plan_with_day(client)
    monkeypatch.setattr(validation_module, "MAX_RUNS_PER_PLAN", 3)
    ids = [_run(client, plan_id)["id"] for _ in range(5)]
    remaining = db_session.query(ValidationRun).filter(ValidationRun.plan_id == uuid.UUID(plan_id)).count()
    assert remaining == 3
    assert client.get(RUNS.format(plan_id=plan_id) + f"/{ids[-1]}").status_code == 200


def test_engine_failure_is_recorded_as_failed_not_as_ok(auth_client, monkeypatch):
    client, _user = auth_client
    plan_id, _day = _plan_with_day(client)

    def _boom(*_a, **_kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(fz, "evaluate", _boom)
    run = _run(client, plan_id)
    assert run["status"] == "failed" and run["issues"] == []
    assert run["counts"] == {"error": 0, "warning": 0, "info": 0, "unverified": 0}


def test_plan_deletion_cascades_runs(auth_client, db_session):
    """validation_runs/issuesはプラン削除を妨げない(ON DELETE CASCADE)。"""
    client, _user = auth_client
    res = client.post("/api/v1/travel-plans/", json={"title": "削除用"})
    plan_id = res.json()["id"]
    _run(client, plan_id)
    assert client.delete(f"/api/v1/travel-plans/{plan_id}").status_code in (200, 204)
    assert db_session.query(ValidationRun).filter(ValidationRun.plan_id == uuid.UUID(plan_id)).count() == 0


def test_database_checks_guard_private_issue_owner(db_session, make_user):
    from sqlalchemy.exc import IntegrityError
    from app.models.models import TravelPlan
    user, _ = make_user()
    plan = TravelPlan(user_id=user.id, title="t")
    db_session.add(plan)
    db_session.commit()
    run = ValidationRun(plan_id=plan.id, created_by_user_id=user.id, input_revision=0, input_fingerprint="x" * 64,
                        algorithm_version="v", status="completed", summary_json={},
                        started_at=datetime.now(timezone.utc))
    run.issues.append(ValidationIssue(code="X", kind="violation", severity="ERROR", message="m",
                                      is_private_constraint=True))
    nested = db_session.begin_nested()
    db_session.add(run)
    with pytest.raises(IntegrityError):
        db_session.flush()
    nested.rollback()
    bad = ValidationRun(plan_id=plan.id, created_by_user_id=user.id, input_revision=0, input_fingerprint="x",
                        algorithm_version="v", status="running", summary_json={},
                        started_at=datetime.now(timezone.utc))
    nested = db_session.begin_nested()
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        db_session.flush()
    nested.rollback()


def test_event_model_has_no_new_columns():
    """L3は旅程テーブルを変更しない(additive migrationのみ)。"""
    assert "validation" not in " ".join(c.name for c in TravelEvent.__table__.columns)
