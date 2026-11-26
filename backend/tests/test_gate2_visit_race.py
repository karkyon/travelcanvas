"""
[Gate② FC-139・FC-144・FR-050/051] 訪問の判定(端末の結果)を同時に 2 回送った時。

判定の行は (旅行, 予定, 本人) で一意(uq_visit_assessments_plan_event_user)だが、行を作る前に何も押さえていなかった
ため、二重押し・通信の再送で 2 つの要求が重なると、後の方が一意の制約に当たって 500 になっていた。
旅行の行を押さえる → 後の要求は先の行を読んで「変わらない」になる。別の接続で本当に重ねる。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.visits as visits_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, TravelPlan, User, UserType, VisitAssessment

GOOD = {"points_total": 9, "points_valid": 8, "points_inside": 7, "dwell_seconds": 900,
        "median_distance_m": 25.0, "median_accuracy_m": 8.0, "speed_kmh": 0.3}


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_device_results_double_submit(monkeypatch):
    monkeypatch.setattr(visits_api, "_audit", lambda *a, **k: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"vis_{uuid.uuid4().hex[:10]}@example.com",
                username=f"vis_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "訪問"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        day = c.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
        ev = c.post(f"{base}/events", headers=_ik(), json={
            "day_id": day["id"], "title": "清水寺", "local_start_time": "09:00", "event_type": "sightseeing",
            "latitude": 34.9948, "longitude": 135.7850})
        assert ev.status_code == 201, ev.text
        eid = ev.json()["id"]

        barrier = threading.Barrier(2)
        orig = visits_api._rows

        def _read_then_race(*a, **k):
            rows = orig(*a, **k)
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return rows

        monkeypatch.setattr(visits_api, "_rows", _read_then_race)
        out = []

        def _go():
            cc = TestClient(app, raise_server_exceptions=False)
            res = cc.post(f"{base}/visits/device-results", json={"results": [{"event_id": eid, "metrics": GOOD}]})
            out.append((res.status_code, res.json().get("result")))

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert [code for code, _ in out] == [200, 200], out
        assert sorted(r["created"] for _, r in out) == [0, 1]
        s = SessionLocal()
        try:
            assert s.query(VisitAssessment).filter(VisitAssessment.plan_id == pid).count() == 1
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
            s.execute(text("DELETE FROM audit_logs WHERE user_id = :u"), {"u": user.id})
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()


def test_first_correction_twice_at_once(monkeypatch):
    """[Gate② FC-144] 判定の無い予定への初めての訂正(「行った」)を同時に 2 回送る → 行は 1 つ・サーバーの誤りにしない"""
    monkeypatch.setattr(visits_api, "_audit", lambda *a, **k: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"vis_{uuid.uuid4().hex[:10]}@example.com",
                username=f"vis_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "訂正"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        day = c.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                     headers=_ik()).json()
        ev = c.post(f"{base}/events", headers=_ik(), json={
            "day_id": day["id"], "title": "清水寺", "latitude": 34.9948, "longitude": 135.7850})
        assert ev.status_code == 201, ev.text
        barrier = threading.Barrier(2)
        orig = visits_api._now

        def _read_then_race():
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig()

        monkeypatch.setattr(visits_api, "_now", _read_then_race)
        out = []

        def _go():
            res = TestClient(app, raise_server_exceptions=False).patch(
                f"{base}/visits/{ev.json()['id']}", json={"action": "confirm"})
            out.append(res.status_code)

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        # 後の方は先の行を読み、If-Match が無いので 400(読み直して送る)。サーバーの誤りにはしない
        assert sorted(out) in ([200, 200], [200, 400]), out
        s = SessionLocal()
        try:
            assert s.query(VisitAssessment).filter(VisitAssessment.plan_id == pid).count() == 1
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
            s.execute(text("DELETE FROM audit_logs WHERE user_id = :u"), {"u": user.id})
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
