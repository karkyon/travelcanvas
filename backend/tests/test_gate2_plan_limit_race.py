"""
[Gate② 縦断 5] 旅行ごとの件数の上限(数えてから 1 件足す)を、同時の 2 つの要求で超えない。

以前は数える前に何も押さえていなかったため、上限の 1 件手前で 2 つの要求が重なると、両方が「まだ足せる」と
数えて上限を 1 件超えていた(対応中のアラート・候補・お知らせ・記録・場所の区域・為替・予算の版)。
数える前に旅行の行を押さえる(app.core.plan_access.lock_plan_row)。ここではアラートで、別の接続で本当に重ねる。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.replans as replans_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, PlanAlert, TravelPlan, User, UserType


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_active_alert_limit_holds_under_double_submit(monkeypatch):
    monkeypatch.setattr(replans_api, "_audit", lambda *a, **k: None)
    monkeypatch.setattr(replans_api, "MAX_ACTIVE_ALERTS", 1)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"lim_{uuid.uuid4().hex[:10]}@example.com",
                username=f"lim_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "上限"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        day_id = c.post(f"{base}/days", json={"local_date": "2026-11-29", "timezone_id": "Asia/Tokyo"},
                        headers=_ik()).json()["id"]

        # 両方が件数を数えた後で揃える(押さえがあれば後の方は数える前に待つ → 時間切れで進む)
        barrier = threading.Barrier(2)
        orig = replans_api._snapshot

        def _counted_then_race(db, plan):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(db, plan)

        monkeypatch.setattr(replans_api, "_snapshot", _counted_then_race)
        out = []

        def _go():
            cc = TestClient(app, raise_server_exceptions=False)
            res = cc.post(f"{base}/alerts", json={"kind": "weather", "day_id": day_id})
            out.append(res.status_code)

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert sorted(out) == [201, 409], out
        s = SessionLocal()
        try:
            assert s.query(PlanAlert).filter(PlanAlert.plan_id == pid, PlanAlert.status == "active").count() == 1
        finally:
            s.close()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        s = SessionLocal()
        try:
            s.execute(text("SET CONSTRAINTS ALL DEFERRED"))
            if pid:
                s.query(TravelPlan).filter(TravelPlan.id == pid).delete(synchronize_session=False)
            s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user.id).delete(synchronize_session=False)
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
