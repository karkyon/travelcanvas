"""
[Gate② 縦断 1] 候補の作成の再送(二重押し・通信のやり直し)。共通の処理 app/core/idempotent_create.py。

以前は候補の作成に再送の印が無く、同じ候補が 2 件できた(重複の候補の表示で後からまとめるしかなかった)。
同じ印・同じ内容は先の候補、違う内容は 409。同時の 2 つも 1 件だけ(別の接続で本当に重ねる)。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.candidates as candidates_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, PlanCandidate, TravelPlan, User, UserType

BODY = {"title": "清水寺", "latitude": 34.9948, "longitude": 135.7850}


def test_candidate_resend_is_created_once(monkeypatch):
    monkeypatch.setattr(candidates_api, "record_audit_event", lambda **kw: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"cd_{uuid.uuid4().hex[:10]}@example.com",
                username=f"cd_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "候補"}).json()["id"])
        url = f"/api/v1/plans/{pid}/candidates"
        k1 = str(uuid.uuid4())
        first = c.post(url, json=BODY, headers={"Idempotency-Key": k1})
        assert first.status_code == 201, first.text
        again = c.post(url, json=BODY, headers={"Idempotency-Key": k1})
        assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
        assert c.post(url, json={**BODY, "title": "銀閣寺"}, headers={"Idempotency-Key": k1}).status_code == 409

        barrier = threading.Barrier(2)
        orig = candidates_api._limit

        def _checked_then_race(*a, **k):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(*a, **k)

        monkeypatch.setattr(candidates_api, "_limit", _checked_then_race)
        k2 = str(uuid.uuid4())
        out = []

        def _go():
            res = TestClient(app, raise_server_exceptions=False).post(url, json=BODY, headers={"Idempotency-Key": k2})
            out.append((res.status_code, res.json().get("id")))

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert [code for code, _ in out] == [201, 201] and out[0][1] == out[1][1], out
        s = SessionLocal()
        try:
            assert s.query(PlanCandidate).filter(PlanCandidate.plan_id == pid).count() == 2  # k1 の 1 件・k2 の 1 件
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
