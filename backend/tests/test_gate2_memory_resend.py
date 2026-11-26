"""
[Gate② 縦断 7] 旅の記録の再送(通信のやり直し・二重押し)。

- 写真の保存は同じ client_upload_id を 1 つにしていたが、再送が先の送信と同時に届くと、両方が「まだ無い」を読み、
  後の方が一意の索引(uq_memories_client_upload)でサーバーの誤りになっていた → 旅行の行を押さえてから読む
- メモ・動画の記録には再送の印が無かった → 共通の処理 app/core/idempotent_create.py
別の接続で本当に重ねる(db_session を使わず commit し、後片付けで消す)。
"""
import io
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.memories as memories_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.models.models import IdempotencyRecord, Memory, TravelPlan, User, UserType
from tests.test_gate_p12_memories import PNG


def test_memory_resends_make_one(monkeypatch, tmp_path):
    monkeypatch.setattr(memories_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"mm_{uuid.uuid4().hex[:10]}@example.com",
                username=f"mm_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "記録"}).json()["id"])
        base = f"/api/v1/plans/{pid}"
        # メモ: 同じ印は先の記録・違う内容は 409
        key = str(uuid.uuid4())
        note = {"kind": "note", "body": "朝の清水寺は静か"}
        first = c.post(f"{base}/memories", json=note, headers={"Idempotency-Key": key})
        assert first.status_code == 201, first.text
        again = c.post(f"{base}/memories", json=note, headers={"Idempotency-Key": key})
        assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
        changed = c.post(f"{base}/memories", json={**note, "body": "別"}, headers={"Idempotency-Key": key})
        assert changed.status_code == 409

        # 写真: 同じ client_upload_id を同時に 2 回
        barrier = threading.Barrier(2)
        orig = memories_api._count_check

        def _checked_then_race(*a, **k):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(*a, **k)

        monkeypatch.setattr(memories_api, "_count_check", _checked_then_race)
        upload_id = uuid.uuid4().hex
        out = []

        def _go():
            res = TestClient(app, raise_server_exceptions=False).post(
                f"{base}/memories/upload", data={"kind": "photo", "client_upload_id": upload_id},
                files={"file": ("a.png", io.BytesIO(PNG))})
            out.append((res.status_code, res.json().get("id")))

        threads = [threading.Thread(target=_go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        assert [code for code, _ in out] == [201, 201] and out[0][1] == out[1][1], out
        s = SessionLocal()
        try:
            assert s.query(Memory).filter(Memory.plan_id == pid).count() == 2  # メモ 1・写真 1
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
            s.execute(text("DELETE FROM usage_counters WHERE subject_id = :u"), {"u": str(user.id)})
            s.query(User).filter(User.id == user.id).delete(synchronize_session=False)
            s.commit()
        finally:
            s.close()
