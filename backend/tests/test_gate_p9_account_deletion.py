"""
[Gate P9] FR-039 アカウント単位の削除・同意の撤回の統合テスト。

検証する主な性質:
- 削除前の説明: 所有する旅行と参加者数、参加している旅行で消えるもの・残るもの、保持期間。DBは変えない
- 本人確認: 確認の文字が違えば422、登録ユーザーはパスワードが違えば403(監査に記録)。管理者は403
- 削除: 所有する旅行は論理削除(共有リンク即時失効)、参加は外れ、本人だけの情報(個人の持ち物・秘匿の条件・
  個人予算・本人の文書・通知・セッション)は消え、コメント・支出は同行者の記録として残る。
  アカウントはメール・パスワード・設定を消して無効化し、名前は仮名になる。監査に題名・メールを残さない
- 削除後は同じアクセストークン・ゲストトークンが使えず、同じメールでログインできない(新規登録はできる)
- 同意: 既定は全て「同意しない」。目的別に同意・撤回でき、更新日時が残る。不明な目的は422
"""
import io
import json
import uuid

import pytest

from app.api.v1 import privacy as privacy_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import (
    Budget, Comment, Document, Expense, Notification, PackingItem, PlanCollaborator, PlanConstraint,
    PlanShareLink, TravelPlan, User, UserSession,
)
from app.services import consents as cs

PASSWORD = "TestPass123!"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(privacy_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _ik():
    return {"Idempotency-Key": str(uuid.uuid4())}


def _setup(client, me, make_user, db_session, monkeypatch, tmp_path):
    """me: 自分の旅行(参加者1人・共有リンク)の所有者で、他人の旅行の編集者。"""
    monkeypatch.setattr(settings, "DOCUMENT_STORAGE_DIR", str(tmp_path / "documents"))
    other, _ = make_user()
    friend, _ = make_user()
    mine = client.post("/api/v1/travel-plans/", json={"title": "自分の京都旅行"}).json()["id"]
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(mine), user_id=friend.id, email=friend.email, role="viewer",
                                    status="accepted"))
    db_session.commit()
    share = client.post(f"/api/v1/travel-plans/{mine}/share", json={"permission": "view"})
    assert share.status_code in (200, 201), share.text

    _act_as(other)
    theirs = client.post("/api/v1/travel-plans/", json={"title": "友人の旅行"}).json()["id"]
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(theirs), user_id=me.id, email=me.email, role="editor",
                                    status="accepted"))
    db_session.commit()
    base = f"/api/v1/plans/{theirs}"
    client.post(f"{base}/packing-items", json={"name": "共有の傘", "category": "other"})

    _act_as(me)
    assert client.post(f"{base}/packing-items", json={"name": "自分の薬", "category": "health",
                                                      "scope": "personal"}).status_code == 201
    assert client.post(f"{base}/budgets", json={"kind": "member", "amount": "30000"}).status_code == 201
    r = client.post(f"{base}/constraints", json={
        "title": "秘匿の上限", "constraint_type": "forbidden", "hardness": "soft", "operator": "avoid",
        "value": {"value": "1"}, "privacy_level": "private", "scope_type": "member"})
    assert r.status_code == 201, r.text
    assert client.post(f"{base}/comments", json={"body": "残るコメント"}).status_code == 201
    assert client.post(f"{base}/expenses", json={"title": "昼食", "amount": "2000", "currency": "JPY",
                                                 "category": "food"}).status_code == 201
    doc = client.post(f"{base}/documents/upload",
                      files={"file": ("搭乗券.pdf", io.BytesIO(b"%PDF-1.4\n%p9\n"), "application/pdf")})
    assert doc.status_code == 201, doc.text
    db_session.add(Notification(user_id=me.id, type="test", title="通知"))
    db_session.commit()
    return mine, theirs, other, friend


def test_preview_does_not_change_anything(auth_client, make_user, db_session, monkeypatch, tmp_path):
    client, me = auth_client
    mine, theirs, other, friend = _setup(client, me, make_user, db_session, monkeypatch, tmp_path)
    res = client.get("/api/v1/privacy/account-deletion")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["account_type"] == "registered" and body["requires_password"] is True
    assert body["confirmation_text"] == "退会する"
    assert body["owned_plans"] == [{"id": mine, "title": "自分の京都旅行", "member_count": 1}]
    assert body["member_plan_count"] == 1
    assert body["deleted_in_member_plans"] == {"personal_packing_items": 1, "private_constraints": 1,
                                               "member_budgets": 1, "documents": 1}
    assert body["kept_in_member_plans"] == {"comments": 1, "expenses": 1, "votes": 0}
    assert body["plan_delete_grace_days"] == settings.PLAN_DELETE_GRACE_DAYS
    assert [i["key"] for i in body["retention"]["items"]][0] == "deleted_plan"
    db_session.expire_all()
    assert db_session.get(User, me.id).is_active is True
    assert db_session.get(TravelPlan, uuid.UUID(mine)).deleted_at is None


def test_reauth_and_confirmation(auth_client, make_user, db_session, audit_calls):
    client, me = auth_client
    url = "/api/v1/privacy/account-deletion"
    r = client.post(url, json={"confirmation": "削除", "password": PASSWORD})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "confirmation_mismatch"
    r = client.post(url, json={"confirmation": "退会する", "password": "Wrong!123"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "reauth_failed"
    r = client.post(url, json={"confirmation": "退会する"})
    assert r.status_code == 403
    assert [c["action"] for c in audit_calls] == ["account_deletion_reauth_failed"] * 2
    assert client.post(url, json={"confirmation": "退会する", "password": PASSWORD, "x": 1}).status_code == 422
    db_session.expire_all()
    assert db_session.get(User, me.id).is_active is True
    admin, _ = make_user()
    admin.is_superuser = True
    db_session.commit()
    _act_as(admin)
    r = client.post(url, json={"confirmation": "退会する", "password": PASSWORD})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_account"


def test_delete_account(auth_client, make_user, db_session, monkeypatch, tmp_path, audit_calls):
    client, me = auth_client
    email = me.email
    mine, theirs, other, friend = _setup(client, me, make_user, db_session, monkeypatch, tmp_path)
    res = client.post("/api/v1/privacy/account-deletion", json={"confirmation": " 退会する ", "password": PASSWORD})
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "no-store"
    assert "refresh_token=" in res.headers.get("set-cookie", "")
    body = res.json()
    s = body["summary"]
    assert body["deleted"] is True and body["plan_delete_grace_days"] == settings.PLAN_DELETE_GRACE_DAYS
    assert (s["owned_plans"], s["share_links_revoked"], s["member_plans"]) == (1, 1, 1)
    assert (s["personal_packing_items"], s["private_constraints"], s["member_budgets"], s["documents"]) == (1, 1, 1, 1)
    assert s["documents_pending_purge"] == 0 and s["notifications"] == 1

    db_session.expire_all()
    u = db_session.get(User, me.id)
    assert u.is_active is False and u.email is None and u.hashed_password is None and u.preferences is None
    assert u.username == f"退会済み-{me.id.hex[:8]}"
    plan = db_session.get(TravelPlan, uuid.UUID(mine))
    assert plan.deleted_at is not None and plan.purge_after is not None
    assert all(link.revoked_at is not None for link in
               db_session.query(PlanShareLink).filter(PlanShareLink.plan_id == plan.id))
    t = uuid.UUID(theirs)
    assert db_session.query(PlanCollaborator).filter(PlanCollaborator.user_id == me.id).count() == 0
    assert db_session.query(PackingItem).filter(PackingItem.plan_id == t).count() == 1  # 共有の傘だけ残る
    assert db_session.query(PlanConstraint).filter(PlanConstraint.owner_user_id == me.id,
                                                   PlanConstraint.plan_id == t).count() == 0
    assert db_session.query(Budget).filter(Budget.plan_id == t, Budget.member_user_id == me.id).count() == 0
    doc = db_session.query(Document).filter(Document.plan_id == t).one()
    assert doc.deleted_at is not None and doc.purge_status == "purged"
    assert db_session.query(Notification).filter(Notification.user_id == me.id).count() == 0
    assert db_session.query(UserSession).filter(UserSession.user_id == me.id).count() == 0
    # 同行者の記録は残る
    assert db_session.query(Comment).filter(Comment.plan_id == t, Comment.author_user_id == me.id).count() == 1
    assert db_session.query(Expense).filter(Expense.plan_id == t, Expense.created_by_user_id == me.id).count() == 1
    # 所有者から見て、参加者一覧に残らず、旅行は使い続けられる
    _act_as(other)
    assert client.get(f"/api/v1/plans/{theirs}").status_code == 200
    collabs = client.get(f"/api/v1/travel-plans/{theirs}/collaborators").json()
    assert all(c.get("user_id") != str(me.id) for c in collabs)
    # 招待されていた友人は削除済みの旅行を見られない
    _act_as(friend)
    assert client.get(f"/api/v1/plans/{mine}").status_code == 404
    # 監査は件数だけ
    assert audit_calls[-1]["action"] == "account_deleted"
    raw = json.dumps(audit_calls, ensure_ascii=False, default=str)
    for secret in (email, "自分の京都旅行", "友人の旅行", "自分の薬"):
        assert secret not in raw


def test_real_tokens_rejected_after_delete(client, make_user, db_session):
    user, password = make_user()
    email = user.email
    token = client.post("/api/v1/auth/login", json={"email": email, "password": password}).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200
    r = client.post("/api/v1/privacy/account-deletion", headers=h,
                    json={"confirmation": "退会する", "password": password})
    assert r.status_code == 200, r.text
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code == 401
    # 同じメールで新しく登録できる
    reg = client.post("/api/v1/auth/register", json={
        "username": f"again_{uuid.uuid4().hex[:8]}", "email": email, "password": password})
    assert reg.status_code in (200, 201), reg.text

    guest = client.post("/api/v1/auth/guest").json()
    g = {"Authorization": f"Bearer {guest['access_token']}"}
    plan = client.post("/api/v1/travel-plans/", json={"title": "ゲストの旅行"}, headers=g)
    assert plan.status_code == 201
    pv = client.get("/api/v1/privacy/account-deletion", headers=g).json()
    assert pv["account_type"] == "guest" and pv["requires_password"] is False
    assert pv["owned_plans"][0]["title"] == "ゲストの旅行"
    r = client.post("/api/v1/privacy/account-deletion", headers=g, json={"confirmation": "退会する"})
    assert r.status_code == 200 and r.json()["summary"]["owned_plans"] == 1
    assert client.get("/api/v1/travel-plans/", headers=g).status_code == 401
    db_session.expire_all()
    assert db_session.get(TravelPlan, uuid.UUID(plan.json()["id"])).deleted_at is not None


def test_consents(auth_client, db_session, audit_calls):
    client, me = auth_client
    res = client.get("/api/v1/privacy/consents")
    assert res.status_code == 200
    purposes = res.json()["purposes"]
    assert [p["purpose"] for p in purposes] == ["ai_processing", "location", "analytics", "marketing_email"]
    assert all(p["granted"] is False and p["updated_at"] is None and p["in_use"] is False for p in purposes)
    res = client.put("/api/v1/privacy/consents", json={"consents": {"ai_processing": True, "location": False}})
    assert res.status_code == 200, res.text
    got = {p["purpose"]: p for p in res.json()["purposes"]}
    assert got["ai_processing"]["granted"] is True and got["ai_processing"]["updated_at"]
    assert got["location"]["granted"] is False and got["location"]["updated_at"]
    assert got["analytics"]["updated_at"] is None
    db_session.expire_all()
    assert cs.has_consent(db_session.get(User, me.id), "ai_processing") is True
    # 撤回
    res = client.put("/api/v1/privacy/consents", json={"consents": {"ai_processing": False}})
    assert {p["purpose"]: p["granted"] for p in res.json()["purposes"]}["ai_processing"] is False
    db_session.expire_all()
    assert cs.has_consent(db_session.get(User, me.id), "ai_processing") is False
    # 変化のない更新は監査しない
    client.put("/api/v1/privacy/consents", json={"consents": {"ai_processing": False}})
    assert [c["details"] for c in audit_calls] == [
        {"changes": {"ai_processing": True, "location": False}}, {"changes": {"ai_processing": False}}]
    assert client.put("/api/v1/privacy/consents", json={"consents": {"tracking": True}}).status_code == 422
    assert client.put("/api/v1/privacy/consents", json={"consents": {}}).status_code == 422
    # 他の設定は消さない
    me_res = client.put("/api/v1/auth/me", json={"preferences": {"theme": "dark"}})
    assert me_res.status_code == 200
    db_session.expire_all()
    prefs = db_session.get(User, me.id).preferences
    assert prefs["theme"] == "dark" and prefs["privacy_consents"]["ai_processing"]["granted"] is False
