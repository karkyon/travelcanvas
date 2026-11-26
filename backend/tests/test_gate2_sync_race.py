"""
[Gate② 縦断 6] 圏外の操作の再送が、先の送信と同時に届いた時(同じ operation_id)。

以前は両方が「まだ当てていない」を読んで二重に当てようとし、後の方は旅行の版の重なりの 409(または一意の制約)に
なった。端末は成功した操作の再送を「失敗」と受け取ってしまう。操作ごとに旅行の行を押さえて読み直す →
後の方は再送の結果(replay)になり、予定は 1 件だけ。別の接続で本当に重ねる。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.sync as sync_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, TravelEvent, TravelPlan, User, UserType


def test_same_offline_operation_resent_while_first_in_flight(monkeypatch):
    monkeypatch.setattr(sync_api, "record_audit_event", lambda **kw: None, raising=False)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"sync_{uuid.uuid4().hex[:10]}@example.com",
                username=f"sync_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
                user_type=UserType.REGISTERED, is_active=True, is_verified=True)
    s.add(user)
    s.commit()
    s.refresh(user)
    s.expunge(user)
    s.close()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)
    pid = None
    try:
        c = TestClient(app, raise_server_exceptions=False)
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "圏外"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        day = c.post(f"{base}/days", json={"local_date": "2026-11-28", "timezone_id": "Asia/Tokyo"},
                     headers={"Idempotency-Key": str(uuid.uuid4())}).json()
        op = {"operation_id": str(uuid.uuid4()), "entity_type": "event", "action": "create", "temp_id": "tmp-1",
              "fields": {"day_id": day["id"], "title": "カフェ", "local_start_time": "15:30"}}

        barrier = threading.Barrier(2)
        orig = sync_api.sy.clean_fields

        def _checked_then_race(*a, **k):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(*a, **k)

        monkeypatch.setattr(sync_api.sy, "clean_fields", _checked_then_race)
        out = []

        def _go():
            cc = TestClient(app, raise_server_exceptions=False)
            res = cc.post(f"{base}/sync", json={"device_id": "phone-1", "operations": [op]})
            out.append((res.status_code, res.json()))

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert [code for code, _ in out] == [200, 200], out
        statuses = sorted(body["results"][0]["status"] for _, body in out)
        assert statuses == ["already_applied", "applied"], out  # 後の方は再送の結果
        s = SessionLocal()
        try:
            assert s.query(TravelEvent).filter(TravelEvent.plan_id == pid).count() == 1
        finally:
            s.close()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        s = SessionLocal()
        try:
            s.execute(text("SET CONSTRAINTS ALL DEFERRED"))
            if pid:
                s.execute(text("DELETE FROM sync_operations WHERE plan_id = :p"), {"p": pid})
                s.query(TravelPlan).filter(TravelPlan.id == pid).delete(synchronize_session=False)
            s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user.id).delete(synchronize_session=False)
            s.execute(text("DELETE FROM audit_logs WHERE user_id = :u"), {"u": user.id})
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
