"""
[Gate② FC-124・FR-047] 旅程の複製の再送(二重押し・通信のやり直し)。

以前は複製に再送の印が無く、同じ操作が 2 回届くと旅行が 2 つできた。Idempotency-Key があれば同じ鍵は先の複製を返す。
同時に 2 つ届いても元の旅行の行を押さえて 1 つずつにする(鍵の記録は複製と同じ transaction)。別の接続で本当に重ねる。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.travel as travel_api
import app.services.day_variants as dv
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, TravelPlan, User, UserType


def test_clone_with_same_key_twice_at_once_makes_one_plan(monkeypatch):
    monkeypatch.setattr(travel_api, "record_audit_event", lambda **kw: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"cl_{uuid.uuid4().hex[:10]}@example.com",
                username=f"cl_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
                user_type=UserType.REGISTERED, is_active=True, is_verified=True)
    s.add(user)
    s.commit()
    s.refresh(user)
    s.expunge(user)
    s.close()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)
    try:
        c = TestClient(app, raise_server_exceptions=False)
        pid = c.post("/api/v1/travel-plans/", json={"title": "元の旅行"}).json()["id"]
        url = f"/api/v1/travel-plans/{pid}/clone"
        key = str(uuid.uuid4())

        barrier = threading.Barrier(2)
        orig = dv.all_variants

        def _checked_then_race(db):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(db)

        monkeypatch.setattr(dv, "all_variants", _checked_then_race)
        out = []

        def _go():
            res = TestClient(app, raise_server_exceptions=False).post(url, json={}, headers={"Idempotency-Key": key})
            out.append((res.status_code, res.json().get("id")))

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert [code for code, _ in out] == [201, 201], out
        assert out[0][1] == out[1][1], out
        # 後からもう一度送っても同じ旅行。鍵が無ければ別の複製
        again = c.post(url, json={}, headers={"Idempotency-Key": key})
        assert again.status_code == 201 and again.json()["id"] == out[0][1]
        assert c.post(url, json={}).json()["id"] != out[0][1]
        s = SessionLocal()
        try:
            assert s.query(TravelPlan).filter(TravelPlan.user_id == user.id).count() == 3  # 元・鍵つきの 1 つ・鍵なしの 1 つ
        finally:
            s.close()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        s = SessionLocal()
        try:
            s.execute(text("SET CONSTRAINTS ALL DEFERRED"))
            s.query(TravelPlan).filter(TravelPlan.user_id == user.id).delete(synchronize_session=False)
            s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user.id).delete(synchronize_session=False)
            s.execute(text("DELETE FROM audit_logs WHERE user_id = :u"), {"u": user.id})
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
