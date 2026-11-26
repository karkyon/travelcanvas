"""
[Gate② 縦断 7] 支出の記録の再送(通信のやり直し・二重押し)。

精算は Idempotency-Key で二重の記録を防いでいたが、支出には無く、同じ支出が 2 件になって精算の額が狂った。
同じ鍵・同じ内容は最初の記録、違う内容は 409。同時の 2 つも旅行の行を押さえて 1 件だけ(別の接続で本当に重ねる)。
"""
import threading
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

import app.api.v1.finance as finance_api
from app.api.v1.auth import hash_password
from app.core.auth import AuthResult, get_current_user
from app.core.database import SessionLocal
from app.main import app
from app.models.models import Expense, IdempotencyRecord, TravelPlan, User, UserType

BODY = {"title": "夕食", "category": "food", "amount": "3000"}


def test_expense_resend_is_recorded_once(monkeypatch):
    monkeypatch.setattr(finance_api, "_audit", lambda *a, **k: None)
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"ex_{uuid.uuid4().hex[:10]}@example.com",
                username=f"ex_{uuid.uuid4().hex[:10]}", hashed_password=hash_password("TestPass123!"),
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
        pid = uuid.UUID(c.post("/api/v1/travel-plans/", json={"title": "支出"}).json()["id"])
        url = f"/api/v1/plans/{pid}/expenses"
        # 後から送り直す: 同じ記録・違う内容は 409・鍵が長すぎれば 422・鍵が無ければ今まで通り
        k1 = str(uuid.uuid4())
        first = c.post(url, json=BODY, headers={"Idempotency-Key": k1})
        assert first.status_code == 201, first.text
        again = c.post(url, json=BODY, headers={"Idempotency-Key": k1})
        assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
        other = c.post(url, json={**BODY, "amount": "3500"}, headers={"Idempotency-Key": k1})
        assert other.status_code == 409 and other.json()["detail"]["code"] == "idempotency_key_reused"
        assert c.post(url, json=BODY, headers={"Idempotency-Key": "x" * 101}).status_code == 422

        # 同時に 2 つ: 両方が「まだ無い」を読んだ所で揃える(押さえがあれば後の方は読む前に待つ → 時間切れで進む)
        barrier = threading.Barrier(2)
        orig = finance_api._apply_expense

        def _read_then_race(*a, **k):
            try:
                barrier.wait(timeout=3)
            except threading.BrokenBarrierError:
                pass
            return orig(*a, **k)

        monkeypatch.setattr(finance_api, "_apply_expense", _read_then_race)
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
            assert s.query(Expense).filter(Expense.plan_id == pid).count() == 2  # k1 の 1 件・k2 の 1 件
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
