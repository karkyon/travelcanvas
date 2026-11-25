"""
[Gate② FC-154・FR-055] 位置の点の送信(圏外からの再送)が先の要求と重なった時。

以前は軌跡の行を押さえていなかったため、
- 同じ batch_id の 2 件目が一意の制約(uq_location_point_batches_track_batch)で 500 になり、
- 別の batch でも point_count の足し算が片方消えていた(上限の確かめもずれる)。
軌跡の行を FOR UPDATE で押さえる → 同じ batch は 2 件目が「再送」(replayed)、別の batch は両方とも数える。

2 本の要求を本当に重ねるため db_session を使わず別の接続で commit し、後片付けで消す。
"""
import threading
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.location_tracks as api_mod
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, LocationTrack, TravelPlan, User, UserType
from app.services import location_tracks as lt


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _points(n, start):
    return [{"recorded_at": (start + timedelta(seconds=10 * i)).isoformat(), "latitude": 35.0 + i * 0.001,
             "longitude": 135.7, "accuracy_m": 5} for i in range(n)]


@pytest.mark.parametrize("same_batch", [True, False])
def test_concurrent_point_uploads(same_batch, monkeypatch):
    monkeypatch.setattr(api_mod, "record_audit_event", lambda **kw: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"loc_{uuid.uuid4().hex[:10]}@example.com",
                username=f"loc_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        today = datetime.now(ZoneInfo("Asia/Tokyo")).date()  # 旅行の期間は日の時刻帯で決まる
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={
            "title": "位置", "start_date": (today - timedelta(days=1)).isoformat(),
            "end_date": (today + timedelta(days=1)).isoformat()}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        c.post(f"{base}/days", json={"local_date": today.isoformat(), "timezone_id": "Asia/Tokyo"}, headers=_ik())
        assert c.put("/api/v1/privacy/consents", json={"consents": {"location": True}}).status_code == 200
        t = c.post(f"{base}/location-tracks", json={"mode": "synced"})
        assert t.status_code == 201, t.text
        tb = f"{base}/location-tracks/{t.json()['id']}"
        start = datetime.now(timezone.utc) + timedelta(seconds=1)

        # 両方が「まだ無い batch」を確かめた後で揃える(押さえがあれば後の方は確かめる前に待つ → 時間切れで進む)
        barrier = threading.Barrier(2)
        orig = lt.clean_points

        def _checked_then_race(*a, **k):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(*a, **k)

        monkeypatch.setattr(lt, "clean_points", _checked_then_race)
        batch = str(uuid.uuid4())
        bodies = [{"batch_id": batch if same_batch else str(uuid.uuid4()), "points": _points(3, start)}
                  for _ in range(2)]
        out = []

        def _go(body):
            cc = TestClient(app, raise_server_exceptions=False)
            res = cc.post(f"{tb}/points", json=body)
            out.append((res.status_code, res.json()))

        threads = [threading.Thread(target=_go, args=(b,)) for b in bodies]
        [th.start() for th in threads]
        [th.join(timeout=60) for th in threads]
        assert [code for code, _ in out] == [200, 200], out
        s = SessionLocal()
        try:
            count = s.query(LocationTrack.point_count).filter(LocationTrack.id == uuid.UUID(t.json()["id"])).scalar()
        finally:
            s.close()
        if same_batch:
            assert sorted(body["replayed"] for _, body in out) == [False, True]
            assert count == 3
        else:
            assert count == 6
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        s = SessionLocal()
        try:
            s.execute(text("SET CONSTRAINTS ALL DEFERRED"))
            if pid:
                s.query(TravelPlan).filter(TravelPlan.id == pid).delete(synchronize_session=False)
            s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user.id).delete(synchronize_session=False)
            s.execute(text("DELETE FROM audit_logs WHERE user_id = :u"), {"u": user.id})  # 同意の変更の記録
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
