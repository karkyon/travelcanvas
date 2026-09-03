"""
[Gate #28] 認証・セッション安全化の最小縦切りテスト。
refresh token rotation、再利用検知、logout/logout-all、session一覧・個別失効、
パスワード変更後の他session失効、rate limitを実際のHTTPフローとして検証する。

conftest.pyの `client` フィクスチャ(cookie対応のTestClient)を使う。
`auth_client`(get_current_userを直接差し替える版)はcookieベースの
refresh tokenフローを検証できないため、このファイルでは使用しない。
"""
import uuid


def _register(client, email=None, password="TestPass123!"):
    email = email or f"u_{uuid.uuid4().hex[:10]}@example.com"
    username = f"u_{uuid.uuid4().hex[:10]}"
    res = client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert res.status_code == 200
    return email, password, res.json()["access_token"]


def test_refresh_rotates_token_and_issues_new_access_token(client):
    _, _, access_token = _register(client)
    old_cookie = client.cookies.get("refresh_token")
    assert old_cookie is not None

    res = client.post("/api/v1/auth/refresh")
    assert res.status_code == 200
    assert res.json()["access_token"]
    new_cookie = client.cookies.get("refresh_token")
    assert new_cookie is not None
    assert new_cookie != old_cookie


def test_refresh_reuse_of_old_token_revokes_session(client):
    _register(client)
    old_cookie = client.cookies.get("refresh_token")

    # legitimate rotation
    res1 = client.post("/api/v1/auth/refresh")
    assert res1.status_code == 200
    new_cookie = client.cookies.get("refresh_token")

    # replay the OLD (already superseded) token -> reuse detected, session revoked
    client.cookies.set("refresh_token", old_cookie)
    res2 = client.post("/api/v1/auth/refresh")
    assert res2.status_code == 401

    # even the legitimately-rotated (newer) token must now be rejected,
    # because reuse detection revokes the whole session, not just the old token
    client.cookies.set("refresh_token", new_cookie)
    res3 = client.post("/api/v1/auth/refresh")
    assert res3.status_code == 401


def test_refresh_without_cookie_rejected(client):
    res = client.post("/api/v1/auth/refresh")
    assert res.status_code == 401


def test_logout_revokes_current_session(client):
    _, _, access_token = _register(client)

    res = client.post(
        "/api/v1/auth/logout", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert res.status_code == 200

    refresh_res = client.post("/api/v1/auth/refresh")
    assert refresh_res.status_code == 401


def test_logout_all_revokes_other_sessions_and_current_access_token(client):
    email, password, token_a = _register(client)
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    token_b = login_res.json()["access_token"]

    sessions_before = client.get(
        "/api/v1/auth/sessions", headers={"Authorization": f"Bearer {token_b}"}
    ).json()
    assert len(sessions_before) == 2

    logout_all_res = client.post(
        "/api/v1/auth/logout-all", headers={"Authorization": f"Bearer {token_b}"}
    )
    assert logout_all_res.status_code == 200

    # session revocation is checked on every request, so the still-cryptographically-valid
    # access token is rejected immediately, not just at its next refresh
    me_res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    assert me_res.status_code == 401


def test_session_owner_can_delete_own_session(client):
    _, _, access_token = _register(client)
    sessions = client.get(
        "/api/v1/auth/sessions", headers={"Authorization": f"Bearer {access_token}"}
    ).json()
    session_id = sessions[0]["id"]

    res = client.delete(
        f"/api/v1/auth/sessions/{session_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert res.status_code == 200


def test_cannot_delete_another_users_session(client):
    _, _, token_a = _register(client)
    sessions_a = client.get(
        "/api/v1/auth/sessions", headers={"Authorization": f"Bearer {token_a}"}
    ).json()
    session_a_id = sessions_a[0]["id"]

    _, _, token_b = _register(client)
    res = client.delete(
        f"/api/v1/auth/sessions/{session_a_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert res.status_code == 403


def test_password_change_revokes_other_sessions_but_keeps_current(client):
    email, password, token1 = _register(client)

    # a second "device" login = a second session for the same user.
    # Use a fresh cookie jar so the two sessions' refresh cookies don't collide
    # in this single TestClient instance.
    login_res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    token2 = login_res.json()["access_token"]

    change_res = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": password, "new_password": "NewPass456!"},
        headers={"Authorization": f"Bearer {token1}"},
    )
    assert change_res.status_code == 200

    still_valid = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token1}"})
    assert still_valid.status_code == 200

    other_device = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token2}"})
    assert other_device.status_code == 401


def test_login_rate_limited_after_repeated_failures(client):
    email, password, _ = _register(client)

    statuses = []
    for _ in range(8):
        res = client.post(
            "/api/v1/auth/login", json={"email": email, "password": "WrongPassword1!"}
        )
        statuses.append(res.status_code)

    assert statuses[:5] == [401, 401, 401, 401, 401]
    assert 429 in statuses[5:]
