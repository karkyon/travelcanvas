"""
[Gate② 縦断 2] 予約の取込 → 確定(confirm)・確認フォームからの登録(apply)の二重押し。

以前は取込の行を押さえずに状態(review_required)を読んでいたため、同じ取込を同時に 2 回確定すると、両方が
予約を作り、1 つの取込から予約が 2 件できていた(apply はさらに deadlock の 500 も出た)。
取込の行を FOR UPDATE で押さえ、apply は確定の commit まで 1 つの transaction で持つ → 後の要求は 409。

2 本の要求を本当に重ねるため db_session を使わず別の接続で commit し、後片付けで消す。
"""
import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.imports as imports_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, Reservation, TravelPlan, User, UserType
from tests.test_gate_booking_import import HOTEL


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _user():
    s = SessionLocal()
    try:
        u = User(id=uuid.uuid4(), email=f"imp_{uuid.uuid4().hex[:10]}@example.com",
                 username=f"imp_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
                 user_type=UserType.REGISTERED, is_active=True, is_verified=True)
        s.add(u)
        s.commit()
        s.refresh(u)
        s.expunge(u)
        return u
    finally:
        s.close()


def _cleanup(user_id, plan_id):
    s = SessionLocal()
    try:
        s.execute(text("SET CONSTRAINTS ALL DEFERRED"))
        if plan_id:
            s.query(TravelPlan).filter(TravelPlan.id == plan_id).delete(synchronize_session=False)
        s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user_id).delete(synchronize_session=False)
        s.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        s.commit()
    finally:
        s.close()


@pytest.mark.parametrize("mode", ["confirm", "apply"])
def test_double_submit_makes_one_reservation(mode, monkeypatch):
    monkeypatch.setattr(imports_api, "record_audit_event", lambda **kw: None)
    user = _user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)
    pid = None
    try:
        c = TestClient(app, raise_server_exceptions=False)
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "取込の二重押し"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        c.post(f"{base}/days", json={"local_date": "2026-04-10", "timezone_id": "Asia/Tokyo"}, headers=_ik())
        r = c.post(f"{base}/imports/extract/text", json={"text": HOTEL})
        assert r.status_code == 201, r.text
        job = r.json()
        fields = {x["field_path"]: x["value"] for x in job["candidates"]}
        if mode == "confirm":
            for x in job["candidates"]:
                ok = c.post(f"{base}/imports/{job['id']}/candidates/{x['id']}/accept", headers=_ik())
                assert ok.status_code == 200, ok.text

        # 両方が「まだ確定していない」を読んだ所で揃える(押さえがあれば後の方はここへ来る前に待つ → 時間切れで進む)
        barrier = threading.Barrier(2)
        orig = imports_api._require_review_required

        def _both_read_then_race(j):
            orig(j)
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass

        monkeypatch.setattr(imports_api, "_require_review_required", _both_read_then_race)
        out = []

        def _go():
            cc = TestClient(app, raise_server_exceptions=False)
            if mode == "confirm":
                res = cc.post(f"{base}/imports/{job['id']}/confirm")
            else:
                res = cc.post(f"{base}/imports/{job['id']}/apply", json={"fields": fields, "add_to_itinerary": True})
            out.append(res.status_code)

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert sorted(out) == [200, 409], out
        s = SessionLocal()
        try:
            assert s.query(Reservation).filter(Reservation.plan_id == pid).count() == 1
        finally:
            s.close()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        _cleanup(user.id, pid)
