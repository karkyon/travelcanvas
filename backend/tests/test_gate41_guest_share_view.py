"""
[Gate #41] Guest Travel View(閲覧側、CA-002)関連の検証。

1. 公開共有解決(/public/share/{token}/resolve)が、実際に日/イベントを
   含んだ`days`をトップレベルで返すこと(Gate #34a後、frontend側の型定義が
   追随しておらず表示が壊れていたバグの、backend側契約の裏取り)。
2. 所有者向け共有リンク一覧に、閲覧後はlast_accessed_atが設定され、
   閲覧前はnullのままであること。
"""


def _create_plan(client, title="Gate41テストプラン"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={"title": title, "destination": "京都"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_public_resolve_returns_days_with_events_at_top_level(client, auth_client):
    owner_client, _user = auth_client
    plan_id = _create_plan(owner_client, title="日程付き共有テスト")

    day_res = owner_client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-10-01"})
    assert day_res.status_code == 201
    day_id = day_res.json()["id"]

    event_res = owner_client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "清水寺観光", "event_type": "sightseeing"},
    )
    assert event_res.status_code == 201

    share_res = owner_client.post(
        f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"}
    )
    raw_token = share_res.json()["url"].rsplit("/", 1)[-1]

    resolve_res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert resolve_res.status_code == 200
    body = resolve_res.json()

    # [Gate #41] itineraryキーではなく、トップレベルのdaysで返ること。
    assert "itinerary" not in body
    assert "days" in body
    assert len(body["days"]) == 1
    assert body["days"][0]["date"] == "2026-10-01"
    assert len(body["days"][0]["events"]) == 1
    assert body["days"][0]["events"][0]["title"] == "清水寺観光"


def test_share_link_list_shows_last_accessed_at_after_view(client, auth_client):
    owner_client, _user = auth_client
    plan_id = _create_plan(owner_client, title="最終閲覧日時テスト")

    share_res = owner_client.post(
        f"/api/v1/travel-plans/{plan_id}/share", json={"permission": "view"}
    )
    raw_token = share_res.json()["url"].rsplit("/", 1)[-1]

    # 閲覧前: last_accessed_atはnull
    before_list = owner_client.get(f"/api/v1/travel-plans/{plan_id}/share")
    assert before_list.status_code == 200
    assert before_list.json()[0]["last_accessed_at"] is None

    # ゲストが閲覧する
    resolve_res = client.post(f"/api/v1/public/share/{raw_token}/resolve", json={})
    assert resolve_res.status_code == 200

    # 閲覧後: last_accessed_atが設定される
    after_list = owner_client.get(f"/api/v1/travel-plans/{plan_id}/share")
    assert after_list.status_code == 200
    assert after_list.json()[0]["last_accessed_at"] is not None
    assert after_list.json()[0]["use_count"] == 1
