"""
[Gate #27] 通知APIの最小縦切りテスト。招待通知の生成経路とunread-count集計を
正常系として検証する。
"""


def test_unread_count_starts_at_zero(auth_client):
    client, _user = auth_client
    res = client.get("/api/v1/notifications/unread-count")
    assert res.status_code == 200
    assert res.json()["unread_count"] == 0


def test_collaborator_invite_creates_notification_for_existing_user(
    auth_client, make_user
):
    from app.main import app
    from app.core.auth import get_current_user, AuthResult

    client, owner = auth_client

    invited_user, _ = make_user(email="invited_user_target@example.com")

    plan_res = client.post(
        "/api/v1/travel-plans/", json={"title": "招待通知テストプラン"}
    )
    plan_id = plan_res.json()["id"]

    invite_res = client.post(
        f"/api/v1/travel-plans/{plan_id}/collaborators",
        json={"email": invited_user.email, "role": "viewer"},
    )
    assert invite_res.status_code == 200

    # 招待された側として通知一覧を確認する
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=invited_user, is_authenticated=True, is_guest=False
    )
    list_res = client.get("/api/v1/notifications/")
    assert list_res.status_code == 200
    assert any(n["type"] == "collaborator_invite" for n in list_res.json())

    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=owner, is_authenticated=True, is_guest=False
    )
