"""
[Gate L1b] FR-029当日モード(NOW/NEXT)のタイムゾーン・日跨ぎ・遅延・
オフライン再計算用データの試験。

現在時刻は app.services.today_mode.utcnow をmonkeypatchして固定する
(実時刻に依存すると、実行時刻によって日付境界を跨いで不安定になるため)。

Gate L1のテストは start_at を直接指定していたため、画面(planStore)から
作った予定(local_start_timeのみ、start_atはnull)がNOW/NEXTに一度も
出ない不具合を検出できなかった。本ファイルは画面と同じ形で予定を作る。
"""
from datetime import datetime, timezone

import pytest

from app.services import today_mode


TODAY_ENDPOINT = "/api/v1/plans/{plan_id}/today"


def _utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


@pytest.fixture
def freeze_now(monkeypatch):
    def _freeze(dt: datetime):
        monkeypatch.setattr(today_mode, "utcnow", lambda: dt)
    return _freeze


def _plan(client) -> str:
    res = client.post("/api/v1/travel-plans/", json={"title": "L1b当日モード"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _day(client, plan_id, local_date, tz) -> str:
    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": local_date, "timezone_id": tz})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _event(client, plan_id, day_id, title, **fields) -> str:
    res = client.post(f"/api/v1/plans/{plan_id}/events", json={"day_id": day_id, "title": title, **fields})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _today(client, plan_id) -> dict:
    res = client.get(TODAY_ENDPOINT.format(plan_id=plan_id))
    assert res.status_code == 200, res.text
    return res.json()


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def test_local_start_time_only_event_is_shown_in_day_timezone(auth_client, freeze_now):
    """画面から作った予定(local_start_timeのみ)が日程のIANAタイムゾーンで
    解釈されNEXTに出る。10:00 JST時点で12:30 JSTの予定は150分後。"""
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-03-10", "Asia/Tokyo")
    event_id = _event(client, plan_id, day_id, "昼食", local_start_time="12:30")
    freeze_now(_utc(2026, 3, 10, 1, 0))  # 10:00 JST

    body = _today(client, plan_id)
    assert body["today_date"] == "2026-03-10"
    assert body["timezone_id"] == "Asia/Tokyo"
    assert body["now_event"] is None
    assert body["next_event"]["id"] == event_id
    assert body["next_event"]["time_source"] == "local_start_time"
    assert body["next_event"]["local_start_time"] == "12:30"
    assert _parse(body["next_event"]["start_at"]) == _utc(2026, 3, 10, 3, 30)
    assert body["minutes_until_next"] == 150
    # 現地の日付が終わる時刻(3/11 00:00 JST)
    assert _parse(body["day_end_at"]) == _utc(2026, 3, 10, 15, 0)


def test_today_is_decided_by_each_day_timezone(auth_client, freeze_now):
    """同じUTC時刻でも、東京の日程では翌日、ロサンゼルスの日程では当日が「今日」。"""
    client, _ = auth_client
    freeze_now(_utc(2026, 3, 10, 20, 0))  # 3/11 05:00 JST、3/10 13:00 PDT

    tokyo = _plan(client)
    _day(client, tokyo, "2026-03-10", "Asia/Tokyo")
    _day(client, tokyo, "2026-03-11", "Asia/Tokyo")
    body = _today(client, tokyo)
    assert (body["today_date"], body["timezone_id"]) == ("2026-03-11", "Asia/Tokyo")

    la = _plan(client)
    _day(client, la, "2026-03-10", "America/Los_Angeles")
    _day(client, la, "2026-03-11", "America/Los_Angeles")
    body = _today(client, la)
    assert (body["today_date"], body["timezone_id"]) == ("2026-03-10", "America/Los_Angeles")


def test_dst_transition_day_uses_correct_offset(auth_client, freeze_now):
    """夏時間開始日(2026-03-08 America/New_York、EST→EDT)の09:00は13:00Z。"""
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-03-08", "America/New_York")
    _event(client, plan_id, day_id, "美術館", local_start_time="09:00")
    freeze_now(_utc(2026, 3, 8, 12, 0))  # 08:00 EDT

    body = _today(client, plan_id)
    assert _parse(body["next_event"]["start_at"]) == _utc(2026, 3, 8, 13, 0)
    assert body["minutes_until_next"] == 60


def test_open_ended_event_is_now_only_until_next_event(auth_client, freeze_now):
    """end_at未設定の予定は次の予定の開始までNOW。Gate L1では朝の予定が
    夜までNOWに残り続けていた(最も早い予定を返していた)。"""
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-05-01", "Europe/Paris")
    _event(client, plan_id, day_id, "朝食", local_start_time="08:00")
    museum = _event(client, plan_id, day_id, "ルーヴル", local_start_time="10:00")
    dinner = _event(client, plan_id, day_id, "夕食", local_start_time="19:00")

    freeze_now(_utc(2026, 5, 1, 10, 0))  # 12:00 CEST
    body = _today(client, plan_id)
    assert body["now_event"]["id"] == museum
    assert body["next_event"]["id"] == dinner
    assert body["minutes_until_next"] == 420

    freeze_now(_utc(2026, 5, 1, 20, 30))  # 22:30 CEST: 最後の予定は日付が変わるまでNOW
    body = _today(client, plan_id)
    assert body["now_event"]["id"] == dinner
    assert body["next_event"] is None
    assert body["minutes_until_next"] is None


def test_explicit_end_is_respected_and_gap_shows_no_now(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-05-01", "UTC")
    _event(client, plan_id, day_id, "会議",
           start_at="2026-05-01T09:00:00Z", end_at="2026-05-01T10:00:00Z")
    lunch = _event(client, plan_id, day_id, "昼食", local_start_time="12:00")
    freeze_now(_utc(2026, 5, 1, 11, 0))

    body = _today(client, plan_id)
    assert body["now_event"] is None
    assert body["next_event"]["id"] == lunch
    assert body["minutes_until_next"] == 60


def test_overnight_event_from_previous_day_is_now(auth_client, freeze_now):
    """前日22:00発・当日06:00着の夜行便は、当日01:00の時点でNOW。
    NEXTは今日の予定だけから選ぶ。"""
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-03-10", "Asia/Tokyo")
    d2 = _day(client, plan_id, "2026-03-11", "Asia/Tokyo")
    flight = _event(client, plan_id, d1, "夜行便",
                    start_at="2026-03-10T13:00:00Z", end_at="2026-03-10T21:00:00Z")  # 22:00〜06:00 JST
    _event(client, plan_id, d1, "前日の夕食", local_start_time="19:00")  # 終了未設定の前日予定は対象外
    breakfast = _event(client, plan_id, d2, "朝食", local_start_time="09:00")
    freeze_now(_utc(2026, 3, 10, 16, 0))  # 3/11 01:00 JST

    body = _today(client, plan_id)
    assert body["today_date"] == "2026-03-11"
    assert body["now_event"]["id"] == flight
    assert body["next_event"]["id"] == breakfast
    assert body["minutes_until_next"] == 480
    assert [e["id"] for e in body["events"]] == [flight, breakfast]


def test_next_does_not_cross_into_tomorrow(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-03-10", "Asia/Tokyo")
    d2 = _day(client, plan_id, "2026-03-11", "Asia/Tokyo")
    _event(client, plan_id, d1, "夕食", local_start_time="18:00", end_at="2026-03-10T11:00:00Z")
    _event(client, plan_id, d2, "翌朝", local_start_time="08:00")
    freeze_now(_utc(2026, 3, 10, 14, 0))  # 23:00 JST

    body = _today(client, plan_id)
    assert body["today_date"] == "2026-03-10"
    assert body["now_event"] is None
    assert body["next_event"] is None


def test_invalid_or_all_day_times_are_ignored(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-05-01", "UTC")
    _event(client, plan_id, day_id, "不正な時刻", local_start_time="25:99")
    _event(client, plan_id, day_id, "文字列", local_start_time="昼ごろ")
    _event(client, plan_id, day_id, "終日", local_start_time="10:00", is_all_day=True)
    ok = _event(client, plan_id, day_id, "正しい予定", local_start_time="9:30")
    freeze_now(_utc(2026, 5, 1, 8, 0))

    body = _today(client, plan_id)
    assert body["next_event"]["id"] == ok
    assert [e["id"] for e in body["events"]] == [ok]


def test_invalid_timezone_falls_back_to_utc(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-05-01", "Not/AZone")
    ev = _event(client, plan_id, day_id, "予定", local_start_time="12:00")
    freeze_now(_utc(2026, 5, 1, 11, 0))

    body = _today(client, plan_id)
    assert _parse(body["next_event"]["start_at"]) == _utc(2026, 5, 1, 12, 0)
    assert body["next_event"]["id"] == ev


def _revision(client, plan_id) -> str:
    return str(client.get(f"/api/v1/plans/{plan_id}").json()["revision"])


def _route_option(client, plan_id, from_event_id, to_event_id, legs):
    """経路候補を作り、各区間のrealtime_statusを設定する(作成時は常にunknownで
    保存され、遅延状況は区間の更新で反映される仕様のため)。"""
    statuses = [leg.pop("realtime_status") for leg in legs]
    res = client.post(
        f"/api/v1/plans/{plan_id}/route-options",
        json={"from_event_id": from_event_id, "to_event_id": to_event_id, "legs": legs},
        headers={"Idempotency-Key": f"l1b-{to_event_id}-{len(legs)}"},
    )
    assert res.status_code == 201, res.text
    option = res.json()
    for leg, status in zip(sorted(option["legs"], key=lambda leg: leg["leg_order"]), statuses):
        upd = client.patch(
            f"/api/v1/plans/{plan_id}/route-options/{option['id']}/legs/{leg['id']}",
            json={"realtime_status": status},
            headers={"If-Match": _revision(client, plan_id)},
        )
        assert upd.status_code == 200, upd.text
    return option["id"]


def _adopt(client, plan_id, option_id):
    res = client.post(
        f"/api/v1/plans/{plan_id}/route-options/{option_id}/adopt",
        headers={"If-Match": _revision(client, plan_id)},
    )
    assert res.status_code == 200, res.text


@pytest.mark.parametrize(
    "statuses, expected",
    [
        (["on_time", "on_time"], "on_time"),
        (["on_time", "unknown"], "unknown"),
        (["on_time", "delayed"], "delayed"),
        (["delayed", "cancelled"], "cancelled"),
    ],
)
def test_transport_status_and_departure_of_inbound_route(auth_client, freeze_now, statuses, expected):
    """NEXTの予定へ向かう採用済み経路の遅延状況と出発時刻を返す(出発まで)。"""
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-05-01", "Asia/Tokyo")
    hotel = _event(client, plan_id, day_id, "ホテル", local_start_time="08:00")
    target = _event(client, plan_id, day_id, "京都駅", local_start_time="15:00")
    legs = [
        {"mode": "train", "departure_at": f"2026-05-01T0{3 + i}:10:00Z", "realtime_status": s}
        for i, s in enumerate(statuses)
    ]
    _adopt(client, plan_id, _route_option(client, plan_id, hotel, target, legs))
    freeze_now(_utc(2026, 5, 1, 2, 0))  # 11:00 JST

    nxt = _today(client, plan_id)["next_event"]
    assert nxt["id"] == target
    assert nxt["transport_status"] == expected
    assert nxt["transport_mode"] == "mixed"
    assert _parse(nxt["departure_at"]) == _utc(2026, 5, 1, 3, 10)  # 最初の区間の出発


def test_manual_segment_without_route_reports_unknown_and_planned_departure(auth_client, freeze_now):
    client, _ = auth_client
    plan_id = _plan(client)
    day_id = _day(client, plan_id, "2026-05-01", "UTC")
    hotel = _event(client, plan_id, day_id, "ホテル", local_start_time="08:00")
    target = _event(client, plan_id, day_id, "空港", local_start_time="15:00")
    plain = _event(client, plan_id, day_id, "区間なし", local_start_time="18:00")
    res = client.post(
        f"/api/v1/plans/{plan_id}/segments",
        json={
            "from_event_id": hotel, "to_event_id": target, "mode": "taxi",
            "planned_departure_at": "2026-05-01T14:15:00Z",
        },
        headers={"Idempotency-Key": "l1b-manual-segment"},
    )
    assert res.status_code == 201, res.text
    freeze_now(_utc(2026, 5, 1, 12, 0))

    body = _today(client, plan_id)
    events = {e["id"]: e for e in body["events"]}
    assert events[target]["transport_status"] == "unknown"
    assert events[target]["transport_mode"] == "taxi"
    assert _parse(events[target]["departure_at"]) == _utc(2026, 5, 1, 14, 15)
    assert events[plain]["transport_status"] is None
    assert events[plain]["departure_at"] is None


def test_no_today_day_still_reports_overnight_event(auth_client, freeze_now):
    """旅行最終日の翌日(日程なし)でも、前日から継続中の予定はNOWに出す。
    today_dateはnullのまま(今日の日程が無いことを区別できる)。"""
    client, _ = auth_client
    plan_id = _plan(client)
    d1 = _day(client, plan_id, "2026-03-10", "UTC")
    ferry = _event(client, plan_id, d1, "夜行フェリー",
                   start_at="2026-03-10T20:00:00Z", end_at="2026-03-11T07:00:00Z")
    freeze_now(_utc(2026, 3, 11, 2, 0))

    body = _today(client, plan_id)
    assert body["today_date"] is None
    assert body["day_end_at"] is None
    assert body["now_event"]["id"] == ferry
    assert body["next_event"] is None


@pytest.mark.parametrize(
    "value, expected",
    [("09:05", (9, 5)), ("9:05", (9, 5)), ("23:59:30", (23, 59)), ("24:00", None), ("", None), (None, None)],
)
def test_parse_local_time(value, expected):
    parsed = today_mode.parse_local_time(value)
    if expected is None:
        assert parsed is None
    else:
        assert (parsed.hour, parsed.minute) == expected
