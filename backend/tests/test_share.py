"""
[Gate #27] 共有リンク・コラボレーター招待の最小縦切りテスト。正常系に加え、
他ユーザーが所有者以外のプランを共有操作できないこと(IDOR拒否)を検証する。
"""
from app.core.auth import get_current_user, AuthResult


def _create_plan(client, title="共有テストプラン"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={"title": title, "destination": "大阪"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_create_share_link(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["permission"] == "view"
    assert body["plan_id"] == plan_id


def test_invite_collaborator(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": "collaborator@example.com", "role": "viewer"},
    )
    assert res.status_code == 200
    assert res.json()["role"] == "viewer"
    assert res.json()["status"] == "pending"


def test_non_owner_cannot_create_share_link(client, make_user):
    from app.main import app

    owner, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=owner, is_authenticated=True, is_guest=False
    )
    plan_id = _create_plan(client, title="他人のプラン")

    other_user, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=other_user, is_authenticated=True, is_guest=False
    )
    res = client.post(
        f"/api/v1/travel-plans/{plan_id}/share",
        json={"permission": "view"},
    )
    assert res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)
