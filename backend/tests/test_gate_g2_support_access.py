"""[Gate G2] FR-040 サポート閲覧(本人の許可・目的・時間制限・読み取り専用・監査)と運用の要約。

- 本人だけが許可を作れる(パスワードで本人確認。目的・1〜72時間。他人の旅行は不可。有効は5件まで)。取り消せる
- 管理者は有効な許可だけを見られる。自分が作った許可は 403。取り消し・期限切れは 404。管理者以外は 403
- 投影は読み取り専用で、住所・メモの本文・座標・予約番号の値を出さない。見るたびに監査と本人への知らせ・回数
- 監査に目的・問い合わせ番号の本文を残さない
- 運用の要約: 有効な共有リンク・Webhook の失敗/dead・削除待ち。共有リンクを止めると所有者に知らせる
"""
import uuid
from datetime import timedelta

import pytest

from app.api.v1 import admin as admin_api, privacy
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import Notification, PlanShareLink, SupportGrant
from app.services import support_access as sa_
from tests.test_gate_b1_organizations import CONF, _seed_plan

PASSWORD = "TestPass123!"


@pytest.fixture(autouse=True)
def audit(monkeypatch):
    calls = []
    monkeypatch.setattr(admin_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(privacy, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _grant(client, **kw):
    body = {"purpose": "予約が表示されない件の調査", "hours": 2, "password": PASSWORD, **kw}
    return client.post("/api/v1/privacy/support-grants", json=body)


def test_owner_creates_and_revokes_with_reauth(auth_client, make_user, db_session, audit):
    client, owner = auth_client
    plan_id, _ = _seed_plan(client)
    assert _grant(client, password="wrong-password").status_code == 403
    assert any(c["action"] == "support_grant_reauth_failed" for c in audit)
    assert _grant(client, hours=0).status_code == 422
    assert _grant(client, hours=73).status_code == 422
    assert _grant(client, purpose="  ").status_code == 422
    assert _grant(client, plan_id=str(uuid.uuid4())).status_code == 404

    # 他人の旅行は選べない
    other, _ = make_user()
    _act_as(other)
    other_plan, _ = _seed_plan(client)
    _act_as(owner)
    assert _grant(client, plan_id=other_plan).status_code == 404

    res = _grant(client, plan_id=plan_id, ticket_ref="T-123")
    assert res.status_code == 201, res.text
    g = res.json()
    assert g["state"] == "active" and g["scope"] == "plan" and g["plan_title"] == "修学旅行B1"
    created = [c for c in audit if c["action"] == "support_grant_created"][-1]
    assert "予約が表示されない" not in str(created["details"]) and "T-123" not in str(created["details"])

    listed = client.get("/api/v1/privacy/support-grants")
    assert listed.status_code == 200 and listed.headers["cache-control"] == "no-store"
    assert [x["id"] for x in listed.json()["grants"]] == [g["id"]]
    assert listed.json()["limits"]["max_hours"] == 72

    # 他人は取り消せない(404)
    _act_as(other)
    assert client.post(f"/api/v1/privacy/support-grants/{g['id']}/revoke").status_code == 404
    _act_as(owner)
    rv = client.post(f"/api/v1/privacy/support-grants/{g['id']}/revoke")
    assert rv.status_code == 200 and rv.json()["state"] == "revoked"

    for _ in range(sa_.MAX_ACTIVE_PER_USER):
        assert _grant(client).status_code == 201
    assert _grant(client).status_code == 409


def test_admin_views_masked_projection_with_audit_and_notice(auth_client, make_user, db_session, audit):
    client, owner = auth_client
    plan_id, _ = _seed_plan(client)
    gid = _grant(client, plan_id=plan_id).json()["id"]
    acct = _grant(client).json()["id"]

    admin, _ = make_user()
    admin.user_type = "admin"
    db_session.flush()

    # 管理者以外は見られない
    _act_as(owner)
    assert client.get("/api/v1/admin/support-grants").status_code == 403
    assert client.get(f"/api/v1/admin/support-grants/{gid}/view").status_code == 403

    _act_as(admin)
    listed = client.get("/api/v1/admin/support-grants").json()["grants"]
    assert {x["id"] for x in listed} >= {gid, acct}
    res = client.get(f"/api/v1/admin/support-grants/{gid}/view")
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "no-store"
    body = res.json()
    assert body["read_only"] is True and body["plan"]["title"] == "修学旅行B1"
    ev = body["plan"]["days"][0]["events"][0]
    assert ev["title"] == "清水寺B1" and ev["has_address"] and ev["has_notes"] and ev["has_location"]
    text = res.text
    for secret in ("京都市東山区B1", "集合メモB1", "34.99", "135.78", CONF, "持ち物は前日に確認", owner.email):
        assert secret not in text, secret
    assert body["plan"]["reservations"][0]["confirmation_number"] == "伏せています"
    assert body["grant"]["access_count"] == 1

    accessed = [c for c in audit if c["action"] == "support_grant_accessed"]
    assert accessed and accessed[-1]["details"]["subject_user_id"] == str(owner.id)
    notes = db_session.query(Notification).filter(Notification.user_id == owner.id,
                                                  Notification.type == "support_access").all()
    assert len(notes) == 1

    a = client.get(f"/api/v1/admin/support-grants/{acct}/view")
    assert a.status_code == 200 and a.json()["account"]["plans"][0]["title"] == "修学旅行B1"
    assert owner.email not in a.text

    # 本人が取り消したら見られない。期限切れも見られない
    _act_as(owner)
    client.post(f"/api/v1/privacy/support-grants/{gid}/revoke")
    g2 = db_session.query(SupportGrant).filter(SupportGrant.id == uuid.UUID(acct)).first()
    g2.expires_at = sa_.now() - timedelta(minutes=1)
    db_session.flush()
    _act_as(admin)
    assert client.get(f"/api/v1/admin/support-grants/{gid}/view").status_code == 404
    assert client.get(f"/api/v1/admin/support-grants/{acct}/view").status_code == 404
    assert any(c["action"] == "support_grant_access_denied" for c in audit)
    assert client.get(f"/api/v1/admin/support-grants/{uuid.uuid4()}/view").status_code == 404


def test_admin_cannot_view_own_grant(auth_client, db_session):
    client, me = auth_client
    me.user_type = "admin"
    db_session.flush()
    gid = _grant(client).json()["id"]
    res = client.get(f"/api/v1/admin/support-grants/{gid}/view")
    assert res.status_code == 403 and res.json()["detail"]["code"] == "own_grant"
    assert client.get("/api/v1/admin/support-grants").json()["grants"][0]["own"] is True


def test_operations_summary_and_share_link_revoke(auth_client, make_user, db_session, audit):
    client, owner = auth_client
    plan_id, _ = _seed_plan(client)
    link = PlanShareLink(id=uuid.uuid4(), plan_id=uuid.UUID(plan_id), token_hash=uuid.uuid4().hex,
                         token_prefix="abcd1234", permission="edit")
    db_session.add(link)
    db_session.flush()

    assert client.get("/api/v1/admin/operations").status_code == 403
    admin, _ = make_user()
    admin.user_type = "admin"
    db_session.flush()
    _act_as(admin)
    ops = client.get("/api/v1/admin/operations")
    assert ops.status_code == 200, ops.text
    o = ops.json()
    assert o["share_links"]["active"] >= 1 and o["share_links"]["active_edit"] >= 1
    assert set(o["webhooks"]) == {"pending", "failed", "dead", "delivered"}
    assert "purge" in o and "storage" in o

    links = client.get("/api/v1/admin/operations/share-links").json()["share_links"]
    assert any(x["id"] == str(link.id) for x in links)
    assert "token_hash" not in str(links)
    assert client.post(f"/api/v1/admin/operations/share-links/{link.id}/revoke", json={}).status_code == 422
    rv = client.post(f"/api/v1/admin/operations/share-links/{link.id}/revoke", json={"reason": "不正な大量アクセス"})
    assert rv.status_code == 200
    db_session.refresh(link)
    assert link.revoked_at is not None
    assert db_session.query(Notification).filter(Notification.user_id == owner.id,
                                                 Notification.type == "share_link_revoked_by_admin").count() == 1
    assert any(c["action"] == "admin_share_link_revoked" for c in audit)
