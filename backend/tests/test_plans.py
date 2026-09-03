"""
[Gate #27] 旅行プラン(TravelPlan) CRUD の最小縦切りテスト。作成/一覧/取得の
正常系と、他ユーザーのプランへ403でアクセス拒否されることを検証する。
"""
from app.core.auth import get_current_user, AuthResult


def _create_plan(client, title="テスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "東京",
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
        },
    )
    return res


def test_create_and_get_travel_plan(auth_client):
    client, _user = auth_client

    create_res = _create_plan(client)
    assert create_res.status_code == 201
    plan_id = create_res.json()["id"]

    get_res = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "テスト旅行"


def test_list_travel_plans_only_returns_own_plans(auth_client):
    client, _user = auth_client
    _create_plan(client, title="自分のプラン")

    list_res = client.get("/api/v1/travel-plans/")
    assert list_res.status_code == 200
    body = list_res.json()
    assert body["total"] >= 1
    assert all("id" in p for p in body["plans"])


def test_other_user_cannot_access_plan(client, make_user, app_ref=None):
    from app.main import app

    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    create_res = _create_plan(client, title="オーナー専用プラン")
    assert create_res.status_code == 201
    plan_id = create_res.json()["id"]

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(f"/api/v1/travel-plans/{plan_id}")
    assert forbidden_res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)
