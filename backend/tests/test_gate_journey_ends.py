"""[Gate JourneyEnds] 旅の出発・到着(任意): 保存・読み出し・入力の確かめ。"""


def _plan(client):
    r = client.post("/api/v1/travel-plans/", json={"title": "出発と到着", "destination": "京都"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_default_off_and_saves_ends(auth_client):
    client, _ = auth_client
    pid = _plan(client)
    got = client.get(f"/api/v1/travel-plans/{pid}").json()
    assert got["journey_enabled"] is False and got["journey_start_place"] is None
    r = client.put(f"/api/v1/travel-plans/{pid}", json={
        "journey_enabled": True, "journey_start_place": "  自宅  ", "journey_start_time": "07:30",
        "journey_end_place": "京都駅", "journey_end_time": "18:05:00",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["journey_enabled"] is True
    assert body["journey_start_place"] == "自宅" and body["journey_start_time"] == "07:30"
    assert body["journey_end_place"] == "京都駅" and body["journey_end_time"] == "18:05"
    # 空の文字は未設定に戻す。null の出す・出さないは変えない
    r = client.put(f"/api/v1/travel-plans/{pid}",
                   json={"journey_enabled": None, "journey_end_place": "", "journey_end_time": ""})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["journey_enabled"] is True and body["journey_end_place"] is None and body["journey_end_time"] is None


def test_rejects_bad_time_and_long_place(auth_client):
    client, _ = auth_client
    pid = _plan(client)
    assert client.put(f"/api/v1/travel-plans/{pid}", json={"journey_start_time": "25:00"}).status_code == 422
    assert client.put(f"/api/v1/travel-plans/{pid}", json={"journey_start_time": "7時"}).status_code == 422
    assert client.put(f"/api/v1/travel-plans/{pid}", json={"journey_start_place": "あ" * 121}).status_code == 422
