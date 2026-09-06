"""
[Gate #37] Visited Area Layer(GPS自動判定訪問記録)の縦切りテスト。

検証する経路:
- source未指定(従来通り)ならsource='manual'として記録される(後方互換)。
- source='auto_gps'・confidence・detected_accuracy_metersを指定して
  記録でき、GET /spots/visits の一覧にもそれらが反映される。
- confidenceが範囲外(0.0〜1.0外)の場合は422で拒否される。
- sourceが'manual'/'auto_gps'以外の場合は422で拒否される。
"""


def _create_spot(client, name="テスト訪問スポット"):
    create_res = client.post(
        "/api/v1/spots/",
        json={
            "name": name,
            "description": "Gate37テスト用",
            "category": "sightseeing",
            "address": "東京都某所",
            "latitude": 35.6812,
            "longitude": 139.7671,
        },
    )
    assert create_res.status_code == 201
    return create_res.json()["id"]


def test_manual_visit_defaults_to_manual_source(auth_client):
    client, _user = auth_client
    spot_id = _create_spot(client, "手動記録テスト")

    visit_res = client.post(f"/api/v1/spots/{spot_id}/visit", json={})
    assert visit_res.status_code == 201
    body = visit_res.json()
    assert body["source"] == "manual"
    assert body["confidence"] is None
    assert body["detected_accuracy_meters"] is None


def test_auto_gps_visit_records_confidence_and_accuracy(auth_client):
    client, _user = auth_client
    spot_id = _create_spot(client, "自動判定テスト")

    visit_res = client.post(
        f"/api/v1/spots/{spot_id}/visit",
        json={
            "source": "auto_gps",
            "confidence": 0.82,
            "detected_accuracy_meters": 15.5,
        },
    )
    assert visit_res.status_code == 201
    body = visit_res.json()
    assert body["source"] == "auto_gps"
    assert body["confidence"] == 0.82
    assert body["detected_accuracy_meters"] == 15.5

    list_res = client.get("/api/v1/spots/visits")
    assert list_res.status_code == 200
    match = next(v for v in list_res.json() if v["spot_id"] == spot_id)
    assert match["source"] == "auto_gps"
    assert match["confidence"] == 0.82


def test_visit_rejects_out_of_range_confidence(auth_client):
    client, _user = auth_client
    spot_id = _create_spot(client, "confidence範囲外テスト")

    res = client.post(
        f"/api/v1/spots/{spot_id}/visit",
        json={"source": "auto_gps", "confidence": 1.5},
    )
    assert res.status_code == 422


def test_visit_rejects_invalid_source(auth_client):
    client, _user = auth_client
    spot_id = _create_spot(client, "source不正テスト")

    res = client.post(
        f"/api/v1/spots/{spot_id}/visit",
        json={"source": "totally_fake_source"},
    )
    assert res.status_code == 422
