"""
[Gate #27] auth の最小縦切りテスト。register -> login -> /me の正常系と、
重複登録・誤ったパスワードの失敗系を実DBに対して検証する。
"""
import uuid


def _unique_user():
    suffix = uuid.uuid4().hex[:10]
    return {
        "username": f"u_{suffix}",
        "email": f"{suffix}@example.com",
        "password": "TestPass123!",
    }


def test_register_login_me_round_trip(client):
    payload = _unique_user()

    register_res = client.post("/api/v1/auth/register", json=payload)
    assert register_res.status_code == 200
    register_body = register_res.json()
    assert register_body["user"]["email"] == payload["email"]
    assert "access_token" in register_body

    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": payload["email"], "password": payload["password"]},
    )
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]

    me_res = client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me_res.status_code == 200
    assert me_res.json()["email"] == payload["email"]


def test_register_duplicate_email_rejected(client):
    payload = _unique_user()
    first = client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 200

    second_payload = dict(payload)
    second_payload["username"] = f"other_{uuid.uuid4().hex[:8]}"
    second = client.post("/api/v1/auth/register", json=second_payload)
    assert second.status_code == 400


def test_login_with_wrong_password_rejected(client):
    payload = _unique_user()
    client.post("/api/v1/auth/register", json=payload)

    res = client.post(
        "/api/v1/auth/login",
        json={"email": payload["email"], "password": "wrong-password"},
    )
    assert res.status_code == 401


def test_me_without_token_rejected(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code in (401, 403)
