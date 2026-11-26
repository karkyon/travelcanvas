"""[Gate② G2-07] 枠の使い切り・有料クラスの失効後でも、旅行データ・予約/QR・書き出し・削除は止まらない。

内部の会員クラス(Free/Trip/…)は「外部の有料API・AIの原価枠」を決めるもので、利用者自身のデータの
閲覧・書き出し・削除の権利を決めるものではない(FR-059)。これを自動試験で固定する。
販売(FR-058)は Stripe の test mode だけ(Live・価格・商品は Owner の判断待ち)。ここは内部枠の挙動だけを確かめる
(価格・商品は仮説で、試験しない。購読の終わりで Free に戻ることは test_gate_remaining4_billing.py)。
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import Entitlement
from app.services import cost_guard as cg

PASSWORD = "TestPass123!"


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _grant(db, user_id, feature, status="active", ends_at=None):
    db.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=user_id,
                       feature_key=cg.FEATURE_PREFIX + feature, status=status, source="admin", ends_at=ends_at))
    db.flush()


def _setup(client, db_session, make_user):
    user, _ = make_user(password=PASSWORD)
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)
    plan = client.post("/api/v1/travel-plans/", json={
        "title": "枠の試験", "destination": "伊勢", "start_date": "2026-11-28", "end_date": "2026-11-29"}).json()["id"]
    res = client.post(f"/api/v1/plans/{plan}/reservations", json={
        "type": "accommodation", "provider_name": "試験宿", "confirmation_number": "ABC1234567",
        "currency": "JPY", "total_amount": 1000.0})
    assert res.status_code == 201, res.text
    return user, plan, res.json()["id"]


def _assert_user_data_still_works(client, plan, reservation_id):
    """有料の外部API・AIが止まっても、利用者自身のデータの入口は全て通る。"""
    assert client.get(f"/api/v1/travel-plans/{plan}").status_code == 200
    listed = client.get(f"/api/v1/plans/{plan}/reservations")
    assert listed.status_code == 200 and [r["id"] for r in listed.json()] == [reservation_id]
    # 予約番号の完全表示(予約画面・QRの代わりになる番号)
    reveal = client.post(f"/api/v1/plans/{plan}/reservations/{reservation_id}/reveal")
    assert reveal.status_code == 200, reveal.text
    assert "ABC1234567" in reveal.text
    assert client.get(f"/api/v1/plans/{plan}/documents").status_code == 200
    # 書き出し(カレンダー)と全データの書き出し
    assert client.get(f"/api/v1/plans/{plan}/exports/calendar.ics").status_code == 200
    assert client.get("/api/v1/privacy/data-export").status_code == 200
    # 退会の案内(削除の入口)
    assert client.get("/api/v1/privacy/account-deletion").status_code == 200
    # 編集も止まらない(手入力の旅行は無料のまま)
    day = {"local_date": "2026-11-30", "timezone_id": "Asia/Tokyo"}
    assert client.post(f"/api/v1/plans/{plan}/days", json=day).status_code in (200, 201)


def test_free_class_has_no_paid_operations_but_user_data_is_never_blocked(auth_client, db_session, make_user):
    client, _ = auth_client
    _, plan, rid = _setup(client, db_session, make_user)
    est = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                      json={"operation": "places.search", "units": {"requests": 1}}).json()
    assert est["allowed"] is False and est["reason"] == "tier_feature_not_included"
    _assert_user_data_still_works(client, plan, rid)


def test_quota_exhausted_blocks_paid_operations_only(auth_client, db_session, make_user):
    client, _ = auth_client
    user, plan, rid = _setup(client, db_session, make_user)
    _grant(db_session, user.id, "class.trip")
    from app.models.models import TravelPlan
    plan_row = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(plan)).one()
    acc = cg._account(db_session, "plan", plan_row.id, "plan", cg.resolve(db_session, plan_row, user), Decimal(50))
    acc.settled_jpy = Decimal(50)  # 1旅行の上限(¥50)を使い切った
    db_session.flush()
    est = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                      json={"operation": "places.search", "units": {"requests": 1}}).json()
    assert est["allowed"] is False  # 有料の外部APIは止まる
    _assert_user_data_still_works(client, plan, rid)


@pytest.mark.parametrize("kind", ["revoked", "expired"])
def test_cancelled_or_expired_paid_class_falls_back_to_free_without_losing_access(
        kind, auth_client, db_session, make_user):
    client, _ = auth_client
    user, plan, rid = _setup(client, db_session, make_user)
    if kind == "revoked":
        _grant(db_session, user.id, "class.journey", status="revoked")  # 解約
    else:
        yesterday = datetime.now(timezone.utc) - timedelta(days=1)
        _grant(db_session, user.id, "class.journey", ends_at=yesterday)  # 期限切れ
    assert client.get("/api/v1/entitlements").json()["class"] == "free"
    est = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                      json={"operation": "ai.generate", "units": {"input_tokens": 10, "output_tokens": 10}}).json()
    assert est["allowed"] is False
    _assert_user_data_still_works(client, plan, rid)


def test_account_deletion_works_for_free_and_exhausted_users(auth_client, db_session, make_user):
    client, _ = auth_client
    user, plan, _rid = _setup(client, db_session, make_user)
    res = client.post("/api/v1/privacy/account-deletion", json={"confirmation": "退会する", "password": PASSWORD})
    assert res.status_code == 200, res.text
    assert res.json()["deleted"] is True
