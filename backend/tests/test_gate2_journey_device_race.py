"""
[Gate② 縦断 6・7] 同時に 2 回届いた時に一意の制約でサーバーの誤りになっていた 2 か所。別の接続で本当に重ねる。

- 予定の実績(「行った」)の初めての記録(uq_event_actuals_plan_event)→ 旅行の行を押さえてから読む
- 同じ端末の初めてのオフラインの鍵の取得(uq_offline_devices_user_device。2 つのタブ・起動時の 2 つの要求)
  → 本人の行を押さえて読み直す
"""
import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.journey as journey_api
import app.api.v1.offline_pack as offline_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.models import EventActual, IdempotencyRecord, OfflineDevice, TravelPlan, User, UserType


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture()
def committed_user():
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"jd_{uuid.uuid4().hex[:10]}@example.com",
                username=f"jd_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
                user_type=UserType.REGISTERED, is_active=True, is_verified=True)
    s.add(user)
    s.commit()
    s.refresh(user)
    s.expunge(user)
    s.close()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)
    yield user
    app.dependency_overrides.pop(get_current_user, None)
    s = SessionLocal()
    try:
        s.execute(text("SET CONSTRAINTS ALL DEFERRED"))
        s.query(TravelPlan).filter(TravelPlan.user_id == user.id).delete(synchronize_session=False)
        s.query(OfflineDevice).filter(OfflineDevice.user_id == user.id).delete(synchronize_session=False)
        s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user.id).delete(synchronize_session=False)
        s.execute(text("DELETE FROM audit_logs WHERE user_id = :u"), {"u": user.id})
        s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
        s.commit()
    finally:
        s.close()


def _race(monkeypatch, module, name, fn):
    barrier = threading.Barrier(2)
    orig = getattr(module, name)

    def _wait_then(*a, **k):
        try:
            barrier.wait(timeout=3)
        except threading.BrokenBarrierError:
            pass
        return orig(*a, **k)

    monkeypatch.setattr(module, name, _wait_then)
    out = []
    threads = [threading.Thread(target=lambda: out.append(fn())) for _ in range(2)]
    [t.start() for t in threads]
    [t.join(timeout=60) for t in threads]
    return out


def test_first_actual_twice_at_once(committed_user, monkeypatch):
    monkeypatch.setattr(journey_api, "_audit", lambda *a, **k: None)
    c = TestClient(app, raise_server_exceptions=False)
    pid = c.post("/api/v1/travel-plans/", json={"title": "実績"}).json()["id"]
    base = f"/api/v1/plans/{pid}"
    day = c.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"}, headers=_ik()).json()
    body = {"day_id": day["id"], "title": "清水寺", "local_start_time": "09:00"}
    ev = c.post(f"{base}/events", headers=_ik(), json=body)
    assert ev.status_code == 201, ev.text

    def _put():
        return TestClient(app, raise_server_exceptions=False).put(
            f"{base}/journey/events/{ev.json()['id']}", json={"status": "visited"}).status_code

    out = _race(monkeypatch, journey_api, "_get_event", _put)
    # 後の方は先の実績を読み、If-Match が無いので 400(もう一度読み直して送る)。サーバーの誤りにはしない
    assert sorted(out) in ([200, 200], [200, 400]), out
    s = SessionLocal()
    try:
        assert s.query(EventActual).filter(EventActual.plan_id == uuid.UUID(pid)).count() == 1
    finally:
        s.close()


def test_first_offline_key_from_two_tabs(committed_user, monkeypatch):
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", "test-only-offline-pack-secret")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key")
    monkeypatch.setattr(offline_api, "record_audit_event", lambda **kw: None)
    device = str(uuid.uuid4())

    def _get():
        return TestClient(app, raise_server_exceptions=False).get(
            "/api/v1/offline-pack/key", params={"device_id": device}).status_code

    out = _race(monkeypatch, offline_api.ok, "device_label", _get)
    assert out == [200, 200], out
    s = SessionLocal()
    try:
        assert s.query(OfflineDevice).filter(OfflineDevice.user_id == committed_user.id).count() == 1
    finally:
        s.close()
