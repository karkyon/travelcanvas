"""
[Gate #34] 旧ジョブ型最適化API(Gate #23実装)は完全廃止された。

このファイルは元々、そのジョブ型フロー(optimize -> job結果取得)の
正常系・異常系を検証していたが、当該APIはP0-02(plan.itineraryを
revision/If-Match/ChangeSet/Undoを一切通さず直接書き換える)として
廃止対象になったため、5エンドポイント全てが410 Goneを固定で返すことを
検証するテストへ置き換える。新しい提案ベースの最適化
(/plans/{plan}/days/{day}/optimization-proposal)のテストは
test_optimization_proposal.pyを参照。
"""


def test_legacy_optimize_travel_plan_returns_410(auth_client):
    client, _user = auth_client
    create_res = client.post("/api/v1/travel-plans/", json={"title": "廃止APIテストプラン"})
    plan_id = create_res.json()["id"]

    res = client.post(f"/api/v1/travel-plans/{plan_id}/optimize", json={})
    assert res.status_code == 410
    assert res.json()["detail"]["error_code"] == "LEGACY_ENDPOINT_RETIRED"


def test_legacy_get_optimization_result_returns_410(auth_client):
    client, _user = auth_client
    res = client.get("/api/v1/optimization/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 410
    assert res.json()["detail"]["error_code"] == "LEGACY_ENDPOINT_RETIRED"


def test_legacy_apply_optimization_result_returns_410(auth_client):
    client, _user = auth_client
    res = client.post("/api/v1/optimization/00000000-0000-0000-0000-000000000000/apply")
    assert res.status_code == 410
    assert res.json()["detail"]["error_code"] == "LEGACY_ENDPOINT_RETIRED"


def test_legacy_cancel_optimization_result_returns_410(auth_client):
    client, _user = auth_client
    res = client.post("/api/v1/optimization/00000000-0000-0000-0000-000000000000/cancel")
    assert res.status_code == 410
    assert res.json()["detail"]["error_code"] == "LEGACY_ENDPOINT_RETIRED"


def test_legacy_optimize_route_returns_410(auth_client):
    client, _user = auth_client
    res = client.post("/api/v1/optimize-route", json={"waypoints": []})
    assert res.status_code == 410
    assert res.json()["detail"]["error_code"] == "LEGACY_ENDPOINT_RETIRED"


def test_legacy_optimize_endpoints_never_write_itinerary(auth_client, db_session):
    """[Gate #34 回帰] 廃止済みapplyを叩いても、正規化テーブルはおろか
    旧itineraryも一切変更されないことを確認する(P0-02の再発防止)。"""
    from app.models.models import TravelPlan

    client, _user = auth_client
    create_res = client.post("/api/v1/travel-plans/", json={"title": "書込み拒否確認プラン"})
    plan_id = create_res.json()["id"]

    res = client.post(f"/api/v1/optimization/{plan_id}/apply")
    assert res.status_code == 410

    plan = db_session.query(TravelPlan).filter(TravelPlan.id == plan_id).first()
    assert plan.itinerary is None
