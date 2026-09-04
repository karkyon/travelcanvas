"""
[Gate #29] Plan/Day/Event正規化(/plans API)の最小縦切りテスト。
travel_days/travel_events CRUD、If-Match(楽観ロック)、Idempotency-Key、
Undo、他ユーザーからのアクセス拒否を実際のHTTPフローとして検証する。
"""
from app.core.auth import get_current_user, AuthResult


def _create_underlying_plan(client, title="Gate29テストプラン"):
    res = client.post("/api/v1/travel-plans/", json={"title": title})
    assert res.status_code == 201
    return res.json()["id"]


def test_get_plan_detail_starts_empty_with_revision_1(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)

    res = client.get(f"/api/v1/plans/{plan_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["revision"] == 1
    assert body["days"] == []


def test_create_day_bumps_revision(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)

    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"})
    assert res.status_code == 201

    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    assert detail["revision"] == 2
    assert len(detail["days"]) == 1


def test_create_day_duplicate_date_rejected(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)
    client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"})

    res = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"})
    assert res.status_code == 409


def test_update_day_requires_if_match(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)
    day = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"}).json()

    missing = client.put(f"/api/v1/plans/{plan_id}/days/{day['id']}", json={"title": "更新"})
    assert missing.status_code == 400

    stale = client.put(
        f"/api/v1/plans/{plan_id}/days/{day['id']}", json={"title": "更新"},
        headers={"If-Match": "1"},
    )
    assert stale.status_code == 409

    current_rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    ok = client.put(
        f"/api/v1/plans/{plan_id}/days/{day['id']}", json={"title": "更新"},
        headers={"If-Match": str(current_rev)},
    )
    assert ok.status_code == 200
    assert ok.json()["title"] == "更新"


def test_create_event_and_move_to_another_day(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)
    day1 = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"}).json()
    day2_rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    day2 = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-02"}
    ).json()

    event_res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day1["id"], "title": "浅草寺"},
    )
    assert event_res.status_code == 201
    event_id = event_res.json()["id"]

    rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    move_res = client.post(
        f"/api/v1/plans/{plan_id}/events/{event_id}/move",
        json={"day_id": day2["id"], "sort_order": 0},
        headers={"If-Match": str(rev)},
    )
    assert move_res.status_code == 200
    assert move_res.json()["day_id"] == day2["id"]


def test_locked_event_cannot_be_moved(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)
    day = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"}).json()
    event = client.post(
        f"/api/v1/plans/{plan_id}/events", json={"day_id": day["id"], "title": "固定イベント"}
    ).json()

    rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    client.put(
        f"/api/v1/plans/{plan_id}/events/{event['id']}", json={"locked": True},
        headers={"If-Match": str(rev)},
    )

    rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    move_res = client.post(
        f"/api/v1/plans/{plan_id}/events/{event['id']}/move",
        json={"sort_order": 5}, headers={"If-Match": str(rev)},
    )
    assert move_res.status_code == 409


def test_idempotency_key_prevents_duplicate_day_creation(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)

    key = "idem-key-abc"
    r1 = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2027-01-01"},
        headers={"Idempotency-Key": key},
    )
    r2 = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2027-01-01"},
        headers={"Idempotency-Key": key},
    )
    assert r1.json()["id"] == r2.json()["id"]

    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    assert len(detail["days"]) == 1


def test_undo_chain_reverts_update_then_create(auth_client):
    client, _user = auth_client
    plan_id = _create_underlying_plan(client)
    day = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"}).json()
    event = client.post(
        f"/api/v1/plans/{plan_id}/events", json={"day_id": day["id"], "title": "元イベント"}
    ).json()

    rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    client.put(
        f"/api/v1/plans/{plan_id}/events/{event['id']}", json={"title": "更新後"},
        headers={"If-Match": str(rev)},
    )

    # undo #1: 直前のtitle更新を取り消す -> タイトルが元に戻る
    rev = client.get(f"/api/v1/plans/{plan_id}").json()["revision"]
    undo1 = client.post(f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(rev)})
    assert undo1.status_code == 200
    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    assert detail["days"][0]["events"][0]["title"] == "元イベント"

    # undo #2: イベント作成自体を取り消す -> イベントが消える
    rev = detail["revision"]
    undo2 = client.post(f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(rev)})
    assert undo2.status_code == 200
    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    assert len(detail["days"][0]["events"]) == 0

    # undo #3: 何も取り消すものが無い状態で呼ぶと404、かつメッセージが
    # (Gate #29で発見・修正した)汎用"Endpoint not found"に潰されていないこと
    # (day作成・event作成・event更新の3つのchange setがあるため、undoは
    # 3回成功してから4回目で404になる)
    rev = detail["revision"]
    undo3 = client.post(f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(rev)})
    assert undo3.status_code == 200  # day作成の取り消し

    detail = client.get(f"/api/v1/plans/{plan_id}").json()
    assert detail["days"] == []

    rev = detail["revision"]
    undo4 = client.post(f"/api/v1/plans/{plan_id}/undo", headers={"If-Match": str(rev)})
    assert undo4.status_code == 404
    assert undo4.json()["detail"] != f"Endpoint not found: /api/v1/plans/{plan_id}/undo"


def test_other_user_cannot_access_or_modify_plan(client, make_user):
    from app.main import app

    owner, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=owner, is_authenticated=True, is_guest=False
    )
    plan_id = _create_underlying_plan(client, title="他人のプラン")

    other_user, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(
        user=other_user, is_authenticated=True, is_guest=False
    )
    res = client.get(f"/api/v1/plans/{plan_id}")
    assert res.status_code == 403

    res2 = client.post(f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-01"})
    assert res2.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


def test_specific_404_messages_are_not_swallowed_by_generic_handler(auth_client):
    """[Gate #29] app.exception_handler(404)がroute内で意図的に投げた
    HTTPException(404, detail=...)まで汎用"Endpoint not found"で上書きして
    いた既存バグの回帰テスト(spots.pyでも再現することを確認する)。"""
    client, _user = auth_client
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    res = client.get(f"/api/v1/spots/{fake_uuid}")
    assert res.status_code == 404
    assert res.json()["detail"] == "スポットが見つかりません"


def test_get_plan_detail_sets_etag_header_matching_body_revision(auth_client):
    """[Gate #31.5C] GETのdocstringが「ETagヘッダーにrevisionを載せる」と
    説明していたにも関わらず実装されていなかった不整合の回帰テスト。"""
    client, _user = auth_client
    res = client.post("/api/v1/travel-plans/", json={"title": "ETag検証プラン"})
    plan_id = res.json()["id"]

    res = client.get(f"/api/v1/plans/{plan_id}")
    assert res.status_code == 200
    body_revision = res.json()["revision"]
    assert res.headers.get("etag") == f'"{body_revision}"'
