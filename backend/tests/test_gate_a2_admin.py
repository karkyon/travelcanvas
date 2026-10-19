"""[Gate A2] FR-040 管理・監査の統合テスト(実PostgreSQL)。管理者の多要素認証そのものは test_gate_s11_admin_mfa.py。

- 権限: 管理者以外は全ての管理者の API が 403(管理者の画面のデータは1件も返さない)
- 停止: 停止した人の端末はすぐログアウトされる。自分自身・ほかの管理者は画面から操作できない(409)。100人まで
- 検索: LIKE の特殊文字(% _)を文字として扱う(全件が当たらない)
- 閲覧の監査: 一覧・詳細・監査ログを見たことを残す(検索語・メールアドレスは残さない)
- 監査ログ: 接続元の末尾を伏せる。種類・対象・期間で絞り込める。種類の一覧を返す
- 運用の道具: grant-admin / revoke-admin(--yes が要る。権限を変えたら端末をログアウト。ゲスト・停止中は不可)
"""
import importlib.util
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.api.v1 import admin as admin_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import AuditLog, UserSession
from app.services import admin_roles

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "security_incident.py"


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(admin_api, "record_audit_event", lambda **kw: calls.append(kw))
    monkeypatch.setattr(admin_roles, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


@pytest.fixture
def admin_client(auth_client, db_session, monkeypatch):
    """管理者(多要素認証の確認は S11 の試験で見るため、ここでは外す)。"""
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    client, user = auth_client
    user.user_type = "admin"
    db_session.flush()
    return client, user


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def _session(db_session, user):
    s = UserSession(id=uuid.uuid4(), user_id=user.id, session_token=uuid.uuid4().hex,
                    expires_at=datetime.now(timezone.utc) + timedelta(days=1), is_active=True)
    db_session.add(s)
    db_session.flush()
    return s


ROUTES = [("get", "/api/v1/admin/stats/system"), ("get", "/api/v1/admin/users"),
          ("get", f"/api/v1/admin/users/{uuid.uuid4()}"), ("post", "/api/v1/admin/users/manage"),
          ("get", "/api/v1/admin/audit-logs")]


def test_non_admin_gets_nothing(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    client, _user = auth_client
    for method, path in ROUTES:
        kw = {"json": {"action": "suspend", "user_ids": [str(uuid.uuid4())]}} if method == "post" else {}
        res = getattr(client, method)(path, **kw)
        assert res.status_code == 403, (path, res.status_code)
        assert "users" not in res.text and "audit_logs" not in res.text


def test_suspend_logs_out_and_guards_self_and_admins(admin_client, make_user, db_session, audit_calls):
    client, me = admin_client
    target, _ = make_user()
    s = _session(db_session, target)
    res = client.post("/api/v1/admin/users/manage", json={"action": "suspend", "user_ids": [str(target.id)]})
    assert res.status_code == 200, res.text
    assert res.json() == {"success": True, "updated_count": 1, "sessions_revoked": 1}
    db_session.refresh(target)
    db_session.refresh(s)
    assert target.is_active is False and s.is_active is False
    assert any(c["action"] == "admin_user_suspend" and c["resource_id"] == target.id for c in audit_calls)
    assert client.post("/api/v1/admin/users/manage",
                       json={"action": "unsuspend", "user_ids": [str(target.id)]}).status_code == 200
    db_session.refresh(target)
    assert target.is_active is True

    mine = client.post("/api/v1/admin/users/manage", json={"action": "suspend", "user_ids": [str(me.id)]})
    assert mine.status_code == 409 and mine.json()["detail"]["code"] == "self_target"
    other_admin, _ = make_user()
    other_admin.is_superuser = True
    db_session.flush()
    res = client.post("/api/v1/admin/users/manage",
                      json={"action": "suspend", "user_ids": [str(target.id), str(other_admin.id)]})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "admin_target"
    db_session.refresh(target)
    assert target.is_active is True  # 一部だけ止めない
    many = [str(uuid.uuid4()) for _ in range(101)]
    assert client.post("/api/v1/admin/users/manage", json={"action": "suspend", "user_ids": many}).status_code == 400


def test_search_escapes_like_and_views_are_audited(admin_client, make_user, db_session, audit_calls):
    client, me = admin_client
    target, _ = make_user(email=f"find_me_{uuid.uuid4().hex[:6]}@example.com")
    all_users = client.get("/api/v1/admin/users", params={"page_size": 100}).json()["pagination"]["total_count"]
    assert all_users >= 2
    pct = client.get("/api/v1/admin/users", params={"search": "%"}).json()
    assert pct["pagination"]["total_count"] < all_users  # % は全件に当たらない
    found = client.get("/api/v1/admin/users", params={"search": target.email}).json()
    assert [u["id"] for u in found["users"]] == [str(target.id)]
    by_id = client.get("/api/v1/admin/users", params={"search": f" {target.id} "}).json()
    assert [u["id"] for u in by_id["users"]] == [str(target.id)]
    assert found["users"][0]["is_admin"] is False and found["users"][0]["is_self"] is False
    detail = client.get(f"/api/v1/admin/users/{target.id}").json()
    assert detail["mfa_enabled"] is False and detail["is_self"] is False
    listed = [c for c in audit_calls if c["action"] == "admin_users_listed"]
    assert listed and all(target.email not in json.dumps(c["details"]) for c in listed)
    assert any(c["action"] == "admin_user_viewed" and c["resource_id"] == target.id for c in audit_calls)


def test_audit_logs_mask_ip_and_filter(admin_client, db_session, audit_calls):
    client, me = admin_client
    target = uuid.uuid4()
    old = datetime.now(timezone.utc) - timedelta(days=3)
    db_session.add_all([
        AuditLog(id=uuid.uuid4(), user_id=me.id, action="c1_test_event", resource_type="user", resource_id=target,
                 ip_address="203.0.113.57", user_agent="Mozilla/5.0 " + "x" * 300, details={"k": 1}),
        AuditLog(id=uuid.uuid4(), user_id=me.id, action="c1_test_event", resource_type="user", resource_id=target,
                 ip_address="2001:db8:abcd:12::1", details={}, created_at=old),
    ])
    db_session.flush()
    res = client.get("/api/v1/admin/audit-logs", params={"action": "c1_test_event"}).json()
    assert res["pagination"]["total_count"] == 2 and "c1_test_event" in res["actions"]
    ips = sorted(x["ip_address"] for x in res["audit_logs"])
    assert ips == ["2001:db8:abcd::x", "203.0.113.x"]
    assert all(len(x["user_agent"] or "") <= 120 for x in res["audit_logs"])
    recent = client.get("/api/v1/admin/audit-logs", params={
        "resource_id": str(target), "since": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}).json()
    assert recent["pagination"]["total_count"] == 1
    assert client.get("/api/v1/admin/audit-logs", params={"resource_id": "bad"}).status_code == 400
    assert admin_api.mask_ip(None) is None and admin_api.mask_ip("weird") == "x"
    assert any(c["action"] == "admin_audit_logs_viewed" for c in audit_calls)


def _script():
    spec = importlib.util.spec_from_file_location("security_incident_a2", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_grant_and_revoke_admin(make_user, db_session, audit_calls, capsys):
    module = _script()
    assert module.main(["grant-admin", "--email", "nobody@example.com"]) == module.EXIT_USAGE
    assert "--yes" in capsys.readouterr().out
    user, _ = make_user()
    s = _session(db_session, user)
    out = admin_roles.grant_admin(db_session, user.email.upper(), "e2e")
    assert out["ok"] and out["already_admin"] is False and out["sessions_revoked"] == 1 and out["mfa_enabled"] is False
    db_session.refresh(user)
    db_session.refresh(s)
    assert user.user_type == "admin" and s.is_active is False
    granted = [c for c in audit_calls if c["action"] == "admin_role_granted"]
    assert granted and user.email not in json.dumps(granted[0]["details"])
    out = admin_roles.revoke_admin(db_session, user.email, "done")
    db_session.refresh(user)
    assert out["was_admin"] is True and user.user_type == "registered"
    with pytest.raises(admin_roles.AdminRoleError):
        admin_roles.grant_admin(db_session, "missing@example.com")
    user.is_active = False
    db_session.flush()
    with pytest.raises(admin_roles.AdminRoleError):
        admin_roles.grant_admin(db_session, user.email)


def test_admin_cannot_delete_own_account_from_privacy(client, make_user, db_session):
    user, password = make_user()
    user.user_type = "admin"
    db_session.flush()
    _act_as(user)
    try:
        res = client.post("/api/v1/privacy/account-deletion", json={"confirmation": "削除します", "password": password})
        assert res.status_code == 403 and res.json()["detail"]["code"] == "admin_account"
    finally:
        app.dependency_overrides.pop(get_current_user, None)
