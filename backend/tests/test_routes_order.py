"""
[Gate #27 / A-011] 固定path(/spots/categories/list, /spots/test/ping,
/travel-plans/test/ping)が {spot_id}/{plan_id} より後に定義されていた問題の
回帰テスト。並べ替え後もこれらのpathが正しいハンドラに到達し、UUID変換
エラー(422)にならないことを保証する。
"""


def test_spots_categories_list_not_swallowed_by_spot_id_route(client):
    response = client.get("/api/v1/spots/categories/list")
    assert response.status_code == 200
    body = response.json()
    assert "categories" in body
    assert isinstance(body["categories"], list)
    assert len(body["categories"]) > 0


def test_spots_test_ping_not_swallowed_by_spot_id_route(client):
    response = client.get("/api/v1/spots/test/ping")
    assert response.status_code == 200
    assert response.json()["message"] == "スポットAPI正常動作中"


def test_travel_plans_test_ping_not_swallowed_by_plan_id_route(client):
    response = client.get("/api/v1/travel-plans/test/ping")
    assert response.status_code == 200
    assert response.json()["message"] == "旅行プランAPI正常動作中"


def test_spot_id_route_still_returns_404_for_nonexistent_uuid(auth_client):
    """並べ替え後も本来の{spot_id}ルートが機能することを確認(副作用なし)。"""
    client, _user = auth_client
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    response = client.get(f"/api/v1/spots/{fake_uuid}")
    assert response.status_code == 404
