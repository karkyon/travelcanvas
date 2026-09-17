"""
[Gate L1] FR-029当日モード(NOW/NEXT)の最小実装テスト。

GET /api/v1/plans/{plan_id}/today が以下を正しく返すことを検証する:
- 「今日」に該当するTravelDayが無い場合はnow_event/next_event/today_dateが
  すべてnull(「問題なし」への誤表示をしない)
- 当日のイベントのうち進行中のものをnow_eventとして返す
- 当日のイベントのうちこれから始まる最も早いものをnext_eventとして返し、
  minutes_until_nextを計算する
- 紐づく予約にチケットが存在する場合はhas_ticket=Trueを返す
- viewer権限でもアクセスでき、権限外(他ユーザー)からは403
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module


TODAY_ENDPOINT = "/api/v1/plans/{plan_id}/today"


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="当日モードテスト旅行"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_day(client, plan_id, local_date, timezone_id="UTC"):
    res = client.post(
        f"/api/v1/plans/{plan_id}/days",
        json={"local_date": local_date, "timezone_id": timezone_id},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_event(client, plan_id, day_id, title, start_at=None, end_at=None):
    body = {"day_id": day_id, "title": title}
    if start_at is not None:
        body["start_at"] = start_at
    if end_at is not None:
        body["end_at"] = end_at
    res = client.post(f"/api/v1/plans/{plan_id}/events", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def test_no_today_day_returns_all_null(auth_client):
    """旅行期間外(当日に該当するTravelDayが無い)場合、誤って「予定なし」
    ではなく明確にnullを返すこと。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    # 未来すぎる日付(今日には該当しない)
    _create_day(client, plan_id, "2099-01-01")

    res = client.get(TODAY_ENDPOINT.format(plan_id=plan_id))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["today_date"] is None
    assert body["now_event"] is None
    assert body["next_event"] is None
    assert body["minutes_until_next"] is None


def test_now_and_next_event_detection(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    now = datetime.now(timezone.utc)
    today_str = now.date().isoformat()
    day_id = _create_day(client, plan_id, today_str, timezone_id="UTC")

    # 進行中のイベント(NOW)
    now_event_id = _create_event(
        client, plan_id, day_id, "進行中の予定",
        start_at=_iso(now - timedelta(minutes=30)),
        end_at=_iso(now + timedelta(minutes=30)),
    )
    # これから始まるイベント(NEXT)
    next_event_id = _create_event(
        client, plan_id, day_id, "次の予定",
        start_at=_iso(now + timedelta(hours=2)),
    )
    # さらに後のイベント(NEXTにはならない)
    _create_event(
        client, plan_id, day_id, "もっと先の予定",
        start_at=_iso(now + timedelta(hours=5)),
    )
    # 既に終わったイベント(NOW/NEXTどちらにもならない)
    _create_event(
        client, plan_id, day_id, "終わった予定",
        start_at=_iso(now - timedelta(hours=3)),
        end_at=_iso(now - timedelta(hours=2)),
    )

    res = client.get(TODAY_ENDPOINT.format(plan_id=plan_id))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["today_date"] == today_str
    assert body["now_event"]["id"] == now_event_id
    assert body["now_event"]["title"] == "進行中の予定"
    assert body["next_event"]["id"] == next_event_id
    assert body["next_event"]["title"] == "次の予定"
    # 約120分後(誤差許容)
    assert 115 <= body["minutes_until_next"] <= 120


def test_has_ticket_reflects_linked_reservation_ticket(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    now = datetime.now(timezone.utc)
    day_id = _create_day(client, plan_id, now.date().isoformat(), timezone_id="UTC")
    event_id = _create_event(
        client, plan_id, day_id, "チケット付き予定",
        start_at=_iso(now - timedelta(minutes=10)),
        end_at=_iso(now + timedelta(hours=1)),
    )

    res_res = client.post(
        f"/api/v1/plans/{plan_id}/reservations",
        json={"type": "flight", "event_id": event_id},
    )
    assert res_res.status_code == 201, res_res.text
    reservation_id = res_res.json()["id"]

    # チケット無しの時点ではhas_ticket=False
    body = client.get(TODAY_ENDPOINT.format(plan_id=plan_id)).json()
    assert body["now_event"]["has_ticket"] is False
    assert body["now_event"]["reservation_id"] == reservation_id

    ticket_res = client.post(
        f"/api/v1/plans/{plan_id}/reservations/{reservation_id}/tickets",
        json={"ticket_type": "boarding_pass", "payload": "QR-DATA-XYZ"},
    )
    assert ticket_res.status_code == 201, ticket_res.text

    body = client.get(TODAY_ENDPOINT.format(plan_id=plan_id)).json()
    assert body["now_event"]["has_ticket"] is True


def test_other_user_without_access_gets_403(client, make_user):
    from app.core.auth import get_current_user, AuthResult
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用プラン")

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(TODAY_ENDPOINT.format(plan_id=plan_id))
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner
