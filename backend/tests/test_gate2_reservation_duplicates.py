"""[Gate② FC-042] 予約の重複の候補: 予約番号・予約先・日時・名義で見つけ、自動では消さない。

DOC-02 FC-042「confirmation/provider/日時/名義で候補検出し自動削除しない」。
"""
import pytest

from app.core import crypto as crypto_module
from app.core.config import settings
from app.models.models import Reservation

RES = "/api/v1/plans/{plan_id}/reservations"


@pytest.fixture(autouse=True)
def _reservation_encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _plan(client):
    res = client.post("/api/v1/travel-plans/", json={"title": "重複の旅", "destination": "伊勢",
                                                     "start_date": "2026-11-28", "end_date": "2026-11-29"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _add(client, plan_id, **body):
    res = client.post(RES.format(plan_id=plan_id), json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _dups(client, plan_id):
    res = client.get(RES.format(plan_id=plan_id))
    assert res.status_code == 200, res.text
    return {r["id"]: {(d["reservation_id"], d["reason"]) for d in r["duplicate_candidates"]} for r in res.json()}


def test_same_confirmation_number_is_a_candidate_and_nothing_is_deleted(auth_client, db_session):
    client, _ = auth_client
    p = _plan(client)
    # メールの取り込みと手入力で同じ宿を 2 回入れた(予約番号は書式違い)
    a = _add(client, p, type="accommodation", provider_name="伊勢の宿", confirmation_number="ABC-123456",
             start_at="2026-11-28T15:00:00+09:00")
    b = _add(client, p, type="accommodation", provider_name="Ise Inn", confirmation_number="ABC-123456",
             start_at="2026-11-28T15:00:00+09:00")
    other = _add(client, p, type="restaurant", provider_name="伊勢の食堂", confirmation_number="ZZZ-999999",
                 start_at="2026-11-28T19:00:00+09:00")
    d = _dups(client, p)
    assert d[a] == {(b, "same_confirmation_number")}
    assert d[b] == {(a, "same_confirmation_number")}
    assert d[other] == set()
    # 自動では消さない・統合しない
    assert db_session.query(Reservation).filter(Reservation.plan_id == p, Reservation.deleted_at.is_(None)).count() == 3
    # 平文の予約番号は応答に出ない
    assert "ABC-123456" not in client.get(RES.format(plan_id=p)).text


def test_same_provider_and_day_is_a_candidate_unless_holders_differ(auth_client):
    client, _ = auth_client
    p = _plan(client)
    a = _add(client, p, type="restaurant", provider_name="すし 伊勢", start_at="2026-11-28T18:00:00+09:00",
             holder_name="山田太郎")
    b = _add(client, p, type="restaurant", provider_name="すし伊勢", start_at="2026-11-28T19:30:00+09:00")
    c = _add(client, p, type="restaurant", provider_name="すし伊勢", start_at="2026-11-28T18:00:00+09:00",
             holder_name="鈴木花子")
    next_day = _add(client, p, type="restaurant", provider_name="すし伊勢", start_at="2026-11-29T18:00:00+09:00")
    d = _dups(client, p)
    assert (b, "same_provider_and_date") in d[a]
    assert (c, "same_provider_and_date") not in d[a]  # 名義がはっきり違う=別の予約
    assert d[next_day] == set()  # 日が違う


def test_cancelled_and_deleted_reservations_are_not_candidates(auth_client):
    client, _ = auth_client
    p = _plan(client)
    a = _add(client, p, type="accommodation", provider_name="宿", confirmation_number="CONF-777777")
    cancelled = _add(client, p, type="accommodation", provider_name="宿", confirmation_number="CONF-777777",
                     status="cancelled")
    gone = _add(client, p, type="accommodation", provider_name="宿", confirmation_number="CONF-777777")
    res = client.get(f"{RES.format(plan_id=p)}/{gone}")
    assert client.delete(f"{RES.format(plan_id=p)}/{gone}", headers={"If-Match": str(res.json()["revision"])}
                         ).status_code in (200, 204)
    d = _dups(client, p)
    assert d[a] == set()
    assert d[cancelled] == set()
    assert gone not in d


def test_other_plans_reservations_are_never_compared(auth_client):
    client, _ = auth_client
    p1, p2 = _plan(client), _plan(client)
    a = _add(client, p1, type="accommodation", provider_name="宿", confirmation_number="SAME-424242")
    _add(client, p2, type="accommodation", provider_name="宿", confirmation_number="SAME-424242")
    assert _dups(client, p1)[a] == set()
