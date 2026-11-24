"""
[Gate② 縦断 1] 同じ旅行への変更が重なった時の revision の進め方。

以前は、要求の始めに読んだ plan.revision を元に plan_versions へ番号を入れていたため、同じ旅行への
2 つの変更が重なると(候補の「予定に入れる」の二重押し・2 人の同時の編集)、後の方が
uq_plan_versions_plan_revision に当たって 500(internal_error)になっていた。
旅行の行を押さえて読み直し、先に別の変更が入っていたら何も残さず 409 plan_conflict で断る。

「読んだ後に別の変更が入った」状態を同じ接続の SQL で作る試験と、db_session を使わず別の接続で 2 本の要求を
本当に重ねる試験(後片付けで commit した行を消す)の両方で確かめる。
"""
import threading
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.candidates as candidates_api
from app.api.v1 import plans as plans_api
from app.api.v1.auth import hash_password
from app.core import error_catalog
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import (FieldSource, IdempotencyRecord, Place, PlanVersion, SourceRecord, TravelEvent,
                               TravelPlan, User, UserType)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    monkeypatch.setattr(candidates_api, "record_audit_event", lambda **kw: None)


def _bump_elsewhere(db_session, plan_id):
    """別の要求が先に revision を進めて plan_versions に入れた、と同じ状態を作る(ORM の plan は古いまま)。"""
    row = db_session.execute(text("UPDATE travel_plans SET revision = revision + 1 WHERE id = :p RETURNING revision"),
                             {"p": plan_id}).scalar()
    db_session.execute(text("INSERT INTO plan_versions (id, plan_id, revision, summary) VALUES (:i, :p, :r, 'other')"),
                       {"i": uuid.uuid4(), "p": plan_id, "r": row})
    return row


def test_stale_revision_is_409_not_500(auth_client, db_session):
    client, owner = auth_client
    pid = client.post("/api/v1/travel-plans/", json={"title": "重なり"}).json()["id"]
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(pid)).one()
    seen = plan.revision
    other = _bump_elsewhere(db_session, plan.id)
    assert other == seen + 1 and plan.revision == seen  # ORM の値は古いまま

    with pytest.raises(HTTPException) as e:
        plans_api._record_change_and_bump_revision(db_session, plan, owner, "manual", "travel_event", uuid.uuid4(),
                                                   "create", before_json=None, after_json={})
    assert e.value.status_code == 409 and e.value.detail["code"] == "plan_conflict"
    assert error_catalog.retry_for(409, "plan_conflict") == error_catalog.RETRY_AFTER_RELOAD


def test_fresh_revision_still_advances(auth_client, db_session):
    client, owner = auth_client
    pid = client.post("/api/v1/travel-plans/", json={"title": "ふつう"}).json()["id"]
    plan = db_session.query(TravelPlan).filter(TravelPlan.id == uuid.UUID(pid)).one()
    seen = plan.revision
    new = plans_api._record_change_and_bump_revision(db_session, plan, owner, "manual", "travel_event", uuid.uuid4(),
                                                     "create", before_json=None, after_json={})
    assert new == seen + 1
    versions = db_session.query(PlanVersion).filter(PlanVersion.plan_id == plan.id, PlanVersion.revision == new)
    assert versions.count() == 1


def _cleanup(user_id, plan_id):
    s = SessionLocal()
    try:
        if plan_id:
            rows = s.query(TravelEvent.place_id).filter(TravelEvent.plan_id == plan_id).all()
            place_ids = [r[0] for r in rows if r[0]]
            s.query(TravelPlan).filter(TravelPlan.id == plan_id).delete(synchronize_session=False)
            if place_ids:
                s.query(FieldSource).filter(FieldSource.place_id.in_(place_ids)).delete(synchronize_session=False)
                s.query(SourceRecord).filter(SourceRecord.place_id.in_(place_ids)).delete(synchronize_session=False)
                s.query(Place).filter(Place.id.in_(place_ids)).delete(synchronize_session=False)
        s.query(IdempotencyRecord).filter(IdempotencyRecord.user_id == user_id).delete(synchronize_session=False)
        s.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        s.commit()
    finally:
        s.close()


def test_candidate_schedule_double_submit_real_connections(monkeypatch):
    """候補の「予定に入れる」の二重押し: 2 本の要求を別の接続で本当に重ねる(db_session を使わず commit する)。
    片方は 201、もう片方は 409 plan_conflict(以前は 500)。予定は 1 件だけ。"""
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"race_{uuid.uuid4().hex[:10]}@example.com",
                username=f"race_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "二重押し"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        day_id = c.post(f"{base}/days", json={"local_date": "2026-11-01", "timezone_id": "Asia/Tokyo"},
                        headers=_ik()).json()["id"]
        r = c.post(f"{base}/candidates", json={"title": "清水寺", "latitude": 34.99, "longitude": 135.78})
        cid = r.json()["id"]
        rev = next(i for i in r.json()["items"] if i["id"] == cid)["revision"]

        barrier = threading.Barrier(2)
        orig = candidates_api._require_rev

        def _both_pass_then_race(cand, if_match):
            orig(cand, if_match)
            try:
                barrier.wait(timeout=5)
            except threading.BrokenBarrierError:
                pass

        monkeypatch.setattr(candidates_api, "_require_rev", _both_pass_then_race)
        out = []

        def _go():
            cc = TestClient(app, raise_server_exceptions=False)
            res = cc.post(f"{base}/candidates/{cid}/schedule", json={"day_id": day_id},
                          headers={"If-Match": str(rev)})
            out.append((res.status_code, res.json()))

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        codes = sorted(code for code, _ in out)
        assert codes == [201, 409], out
        lost = next(body for code, body in out if code == 409)
        assert lost["code"] == "plan_conflict" and lost["retry"] == "after_reload"
        s = SessionLocal()
        try:
            assert s.query(TravelEvent).filter(TravelEvent.plan_id == pid).count() == 1
        finally:
            s.close()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        _cleanup(user.id, pid)
