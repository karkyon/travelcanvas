"""
[Gate #27] スポットAPIの最小縦切りテスト。

[重要] この最小縦切りを実DBに対して実行した結果、spots.py 全体が
get_current_user(常にAuthResultを返す)を User 型として扱っており、
current_user.id 等へのアクセスで実行時に
'AuthResult' object has no attribute 'id' という500エラーになる、
認証済みユーザーによるスポット作成/一覧/お気に入り/訪問記録が軒並み
機能しない実バグを発見した(travel.pyは get_current_active_user を
使っており影響を受けていない)。本Gateで spots.py を
get_current_active_user に統一する修正を行った上で、以下のテストで
実際に動作することを保証する。
"""


def test_create_and_list_spot(auth_client):
    client, _user = auth_client

    create_res = client.post(
        "/api/v1/spots/",
        json={
            "name": "浅草寺",
            "description": "浅草の観光名所",
            "category": "sightseeing",
            "address": "東京都台東区浅草2-3-1",
            "latitude": 35.7148,
            "longitude": 139.7967,
        },
    )
    assert create_res.status_code == 201
    spot_id = create_res.json()["id"]

    list_res = client.get("/api/v1/spots/")
    assert list_res.status_code == 200
    assert any(s["id"] == spot_id for s in list_res.json())


def test_favorite_add_and_list(auth_client):
    client, _user = auth_client

    create_res = client.post(
        "/api/v1/spots/",
        json={
            "name": "東京タワー",
            "description": "展望台",
            "category": "sightseeing",
            "address": "東京都港区芝公園4-2-8",
            "latitude": 35.6586,
            "longitude": 139.7454,
        },
    )
    spot_id = create_res.json()["id"]

    fav_res = client.post(f"/api/v1/spots/{spot_id}/favorite", json={})
    assert fav_res.status_code == 201

    list_res = client.get("/api/v1/spots/favorites")
    assert list_res.status_code == 200
    assert any(f["spot_id"] == spot_id for f in list_res.json())


def test_spot_creation_requires_authentication(client):
    res = client.post(
        "/api/v1/spots/",
        json={
            "name": "無認証スポット",
            "category": "other",
        },
    )
    assert res.status_code in (401, 403)
