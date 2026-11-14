"""
[Gate Remaining-7] FR-002 ゲストの持ち物を既存のアカウントへまとめる(POST /auth/guest/merge)。

- 既存のアカウントのメール・パスワードで本人を確かめ、ゲストの旅行・予定・持ち物・支出・思い出を移す
- まとめた後はゲストのトークンは使えず、既存のアカウントのトークンが返る(旅行は既存のアカウントの一覧に出る)
- パスワードが違えば何も移さない。登録ユーザーからは使えない
- 既存のアカウントの旅行の共同編集者にゲストが入っていた行は消す
"""
import uuid

from app.models.models import PlanCollaborator, TravelPlan, User
from app.services import guest_merge


def _guest(client):
    body = client.post("/api/v1/auth/guest").json()
    return {"Authorization": f"Bearer {body['access_token']}"}, uuid.UUID(body["guest_id"])


def test_guest_merges_everything_into_existing_account(client, make_user, db_session):
    target, password = make_user()
    headers, guest_id = _guest(client)
    plan = client.post("/api/v1/travel-plans/", json={"title": "ゲストの旅行"}, headers=headers).json()
    p = plan["id"]
    day = client.post(f"/api/v1/plans/{p}/days", json={"local_date": "2026-12-01", "timezone_id": "Asia/Tokyo"},
                      headers={**headers, "Idempotency-Key": str(uuid.uuid4())}).json()
    assert client.post(f"/api/v1/plans/{p}/events", json={"day_id": day["id"], "title": "清水寺"},
                       headers={**headers, "Idempotency-Key": str(uuid.uuid4())}).status_code == 201
    assert client.post(f"/api/v1/plans/{p}/packing-items", json={"name": "傘", "category": "other"},
                       headers=headers).status_code == 201

    bad = client.post("/api/v1/auth/guest/merge", json={"email": target.email, "password": "wrong-pass"},
                      headers=headers)
    assert bad.status_code == 401
    assert db_session.get(TravelPlan, uuid.UUID(p)).user_id == guest_id

    r = client.post("/api/v1/auth/guest/merge", json={"email": target.email, "password": password}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == target.email and body["merge"]["moved_total"] >= 3
    assert body["merge"]["moved"]["travel_plans.user_id"] == 1
    db_session.expire_all()
    assert db_session.get(TravelPlan, uuid.UUID(p)).user_id == target.id
    assert db_session.get(User, guest_id).is_active is False

    new_headers = {"Authorization": f"Bearer {body['access_token']}"}
    plans = client.get("/api/v1/travel-plans/", headers=new_headers).json()["plans"]
    assert any(x["id"] == p for x in plans)
    assert client.get("/api/v1/travel-plans/", headers=headers).status_code == 401  # ゲストのトークンは使えない


def test_merge_removes_guest_collaboration_on_own_plan_and_refuses_registered(client, make_user, db_session):
    target, password = make_user()
    own = TravelPlan(id=uuid.uuid4(), user_id=target.id, title="自分の旅行")
    db_session.add(own)
    db_session.flush()
    headers, guest_id = _guest(client)
    db_session.add(PlanCollaborator(plan_id=own.id, user_id=guest_id, email="guest@example.com", role="editor",
                                    status="accepted"))
    db_session.commit()
    r = client.post("/api/v1/auth/guest/merge", json={"email": target.email, "password": password}, headers=headers)
    assert r.status_code == 200, r.text
    assert db_session.query(PlanCollaborator).filter(PlanCollaborator.plan_id == own.id).count() == 0
    token = r.json()["access_token"]
    again = client.post("/api/v1/auth/guest/merge", json={"email": target.email, "password": password},
                        headers={"Authorization": f"Bearer {token}"})
    assert again.status_code == 400 and again.json()["detail"]["code"] == "not_guest"


def test_columns_cover_owned_tables_and_skip_audit():
    names = {(t.name, c.name) for t, c in guest_merge._user_columns()}
    assert ("travel_plans", "user_id") in names and ("memories", "author_user_id") in names
    assert ("expenses", "paid_by_user_id") in names and ("packing_items", "owner_user_id") in names
    assert not any(t == "audit_logs" or t == "user_sessions" for t, _ in names)
