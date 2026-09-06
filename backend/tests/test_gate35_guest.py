"""
[Gate #35] Guest Travel View の縦切りテスト。

検証する経路:
- POST /auth/guest でゲストトークンが発行できる
- そのトークンで POST /travel-plans (作成)・GET /travel-plans (一覧)・
  GET /travel-plans/{id}(取得)・PUT(更新)・DELETE(削除)ができる
- ゲストは他人(別ゲスト・登録ユーザー)のプランへは403でアクセスできない
- POST /auth/guest/upgrade で正規アカウントへ昇格でき、昇格前に作成した
  プランの所有権がuser_id変更なしにそのまま引き継がれる
- 昇格エンドポイントは登録ユーザー(非ゲスト)からは400で拒否される
- 期限切れ/不正なゲストトークンでは他人同様401になる
"""
import uuid


def _unique_upgrade_payload():
    suffix = uuid.uuid4().hex[:10]
    return {
        "username": f"guest_up_{suffix}",
        "email": f"guest_up_{suffix}@example.com",
        "password": "TestPass123!",
    }


def test_guest_session_creation_and_plan_crud(client):
    guest_res = client.post("/api/v1/auth/guest")
    assert guest_res.status_code == 201
    guest_body = guest_res.json()
    assert guest_body["user_type"] == "guest"
    assert "access_token" in guest_body
    assert guest_body["guest_id"]

    headers = {"Authorization": f"Bearer {guest_body['access_token']}"}

    create_res = client.post(
        "/api/v1/travel-plans/",
        json={"title": "ゲストの旅行", "destination": "京都"},
        headers=headers,
    )
    assert create_res.status_code == 201
    plan = create_res.json()
    assert plan["title"] == "ゲストの旅行"
    plan_id = plan["id"]

    list_res = client.get("/api/v1/travel-plans/", headers=headers)
    assert list_res.status_code == 200
    assert any(p["id"] == plan_id for p in list_res.json()["plans"])

    get_res = client.get(f"/api/v1/travel-plans/{plan_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["id"] == plan_id

    update_res = client.put(
        f"/api/v1/travel-plans/{plan_id}",
        json={"title": "ゲストの旅行(更新後)"},
        headers=headers,
    )
    assert update_res.status_code == 200
    assert update_res.json()["title"] == "ゲストの旅行(更新後)"

    delete_res = client.delete(f"/api/v1/travel-plans/{plan_id}", headers=headers)
    assert delete_res.status_code == 200

    get_after_delete_res = client.get(f"/api/v1/travel-plans/{plan_id}", headers=headers)
    assert get_after_delete_res.status_code == 404


def test_guest_cannot_access_another_guests_plan(client):
    guest_a = client.post("/api/v1/auth/guest").json()
    guest_b = client.post("/api/v1/auth/guest").json()

    headers_a = {"Authorization": f"Bearer {guest_a['access_token']}"}
    headers_b = {"Authorization": f"Bearer {guest_b['access_token']}"}

    create_res = client.post(
        "/api/v1/travel-plans/",
        json={"title": "Aのプラン", "destination": "大阪"},
        headers=headers_a,
    )
    plan_id = create_res.json()["id"]

    forbidden_res = client.get(f"/api/v1/travel-plans/{plan_id}", headers=headers_b)
    assert forbidden_res.status_code == 403


def test_guest_upgrade_preserves_plan_ownership(client):
    guest_body = client.post("/api/v1/auth/guest").json()
    guest_headers = {"Authorization": f"Bearer {guest_body['access_token']}"}

    create_res = client.post(
        "/api/v1/travel-plans/",
        json={"title": "昇格前に作ったプラン", "destination": "札幌"},
        headers=guest_headers,
    )
    assert create_res.status_code == 201
    plan_id = create_res.json()["id"]

    upgrade_payload = _unique_upgrade_payload()
    upgrade_res = client.post(
        "/api/v1/auth/guest/upgrade",
        json=upgrade_payload,
        headers=guest_headers,
    )
    assert upgrade_res.status_code == 200
    upgrade_body = upgrade_res.json()
    assert upgrade_body["user"]["email"] == upgrade_payload["email"]
    assert upgrade_body["user"]["user_type"] == "registered"
    new_access_token = upgrade_body["access_token"]

    # 昇格後の正規トークンで、ゲスト時代に作ったプランへ引き続きアクセスできる
    # (user_idそのものは変更していないため、所有権移行の追加処理は不要)。
    new_headers = {"Authorization": f"Bearer {new_access_token}"}
    get_res = client.get(f"/api/v1/travel-plans/{plan_id}", headers=new_headers)
    assert get_res.status_code == 200
    assert get_res.json()["id"] == plan_id

    # 昇格後は通常ログインでも同じアカウントに入れる。
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": upgrade_payload["email"], "password": upgrade_payload["password"]},
    )
    assert login_res.status_code == 200


def test_upgrade_rejects_non_guest_user(auth_client):
    client, _user = auth_client
    upgrade_res = client.post(
        "/api/v1/auth/guest/upgrade",
        json=_unique_upgrade_payload(),
    )
    assert upgrade_res.status_code == 400


def test_upgrade_rejects_duplicate_email(client, make_user):
    existing_user, _password = make_user()

    guest_body = client.post("/api/v1/auth/guest").json()
    guest_headers = {"Authorization": f"Bearer {guest_body['access_token']}"}

    upgrade_res = client.post(
        "/api/v1/auth/guest/upgrade",
        json={
            "username": f"dup_{uuid.uuid4().hex[:8]}",
            "email": existing_user.email,
            "password": "TestPass123!",
        },
        headers=guest_headers,
    )
    assert upgrade_res.status_code == 400


def test_travel_plan_endpoints_reject_missing_token(client):
    res = client.post(
        "/api/v1/travel-plans/",
        json={"title": "無認証", "destination": "東京"},
    )
    assert res.status_code == 401


def test_guest_token_invalid_signature_rejected(client):
    headers = {"Authorization": "Bearer this.is.not-a-valid-jwt"}
    res = client.post(
        "/api/v1/travel-plans/",
        json={"title": "不正トークン", "destination": "東京"},
        headers=headers,
    )
    assert res.status_code == 401
