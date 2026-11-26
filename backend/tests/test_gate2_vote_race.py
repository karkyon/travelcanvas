"""
[Gate② 縦断 4] 投票の同じ回答を同時に 2 回送った時(二重押し・通信の再送)。

回答は (選択肢, 本人) で一意(uq_votes_option_user)だが、行を作る前に何も押さえていなかったため、2 つの要求が
重なると両方が「まだ無い」を読み、後の方が一意の制約に当たってサーバーの誤りになっていた。旅行の行を押さえる。
別の接続で本当に重ねる。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.discussion as discussion_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, TravelPlan, User, UserType, Vote


def test_same_vote_twice_at_once(monkeypatch):
    monkeypatch.setattr(discussion_api, "_audit", lambda *a, **k: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"vote_{uuid.uuid4().hex[:10]}@example.com",
                username=f"vote_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "投票"}).json()["id"])
        poll = c.post(f"/api/v1/plans/{pid}/polls", json={"title": "夕食", "options": [{"label": "寿司"},
                                                                                     {"label": "焼肉"}]})
        assert poll.status_code == 201, poll.text
        poll = poll.json()
        sushi = next(o for o in poll["options"] if o["label"] == "寿司")["id"]

        barrier = threading.Barrier(2)
        orig = discussion_api._strip_or_none

        def _checked_then_race(v):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(v)

        monkeypatch.setattr(discussion_api, "_strip_or_none", _checked_then_race)
        out = []

        def _go():
            cc = TestClient(app, raise_server_exceptions=False)
            res = cc.put(f"/api/v1/plans/{pid}/polls/{poll['id']}/votes",
                         json={"votes": [{"option_id": sushi, "value": "ok"}]})
            out.append(res.status_code)

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert out == [200, 200], out
        s = SessionLocal()
        try:
            assert s.query(Vote).filter(Vote.user_id == user.id).count() == 1
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
