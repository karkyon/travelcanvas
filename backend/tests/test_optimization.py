"""
[Gate #27] AI最適化(Gate #23実装の近傍法による経路並べ替え)の最小縦切り
テスト。日程未登録時の失敗系と、座標を持つイベントを含む日程の正常系を
実際にoptimize -> job結果取得のジョブ型フローとして検証する。
"""


def _create_plan_with_itinerary(client):
    create_res = client.post(
        "/api/v1/travel-plans/", json={"title": "最適化テストプラン"}
    )
    plan_id = create_res.json()["id"]

    itinerary = {
        "days": [
            {
                "date": "2026-10-01",
                "events": [
                    {"id": "e1", "latitude": 35.6812, "longitude": 139.7671},
                    {"id": "e2", "latitude": 35.7100, "longitude": 139.8107},
                    {"id": "e3", "latitude": 35.6586, "longitude": 139.7454},
                ],
            }
        ]
    }
    update_res = client.put(
        f"/api/v1/travel-plans/{plan_id}", json={"itinerary": itinerary}
    )
    assert update_res.status_code == 200
    return plan_id


def test_optimize_plan_without_itinerary_returns_400(auth_client):
    client, _user = auth_client
    create_res = client.post(
        "/api/v1/travel-plans/", json={"title": "空プラン"}
    )
    plan_id = create_res.json()["id"]

    res = client.post(f"/api/v1/travel-plans/{plan_id}/optimize", json={})
    assert res.status_code == 400


def test_optimize_plan_and_fetch_result(auth_client):
    client, _user = auth_client
    plan_id = _create_plan_with_itinerary(client)

    optimize_res = client.post(f"/api/v1/travel-plans/{plan_id}/optimize", json={})
    assert optimize_res.status_code == 200
    job_id = optimize_res.json()["job_id"]
    assert optimize_res.json()["status"] == "completed"

    result_res = client.get(f"/api/v1/optimization/{job_id}")
    assert result_res.status_code == 200
    body = result_res.json()
    assert "result" in body
    assert "improvements" in body["result"]
