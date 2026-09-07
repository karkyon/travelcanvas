"""
[Gate R1] guestが正規化API(/api/v1/plans/*)のday/event CRUDへ到達できる
ことの回帰テスト。

背景(2026-09-07 監査 P0-04): Gate #35は`/travel-plans`(metadata CRUD、
travel.py)のみをゲストへ開放しており、`/plans/*`(day/event正規化API、
plans.py)は`get_current_active_user`のままでゲストを拒否していた。
Gate #39のテスト自身が「ゲストは正規化APIを受け付けない」ことを明記して
おり、ゲストによる日/イベント付き旅行作成の縦切りが成立していなかった。

本Gateでplans.pyのday/event CRUD 9エンドポイント(プラン詳細取得・
日程の作成/更新/削除・イベントの作成/更新/削除/移動・Undo)を
`get_current_user_or_guest`に変更した。ルートプレビュー・挿入プレビュー・
最適化提案(route-preview/insertion-preview/optimization-proposal/apply)の
4エンドポイントは、AI/計算コストのある機能でありスコープ外として
`get_current_active_user`(会員限定)のまま維持している。

本テストはguest→plan作成→day作成→event作成→再取得→リビジョン確認→
upgrade→所有権維持、までをAPI経由の統合テストとして検証する
(ブラウザ経由のE2Eではない。ブラウザE2E(Playwright等)は本Gateの
スコープ外であり、別Gateでの追加セットアップが必要)。
"""
import uuid


def _create_guest(client):
    res = client.post("/api/v1/auth/guest")
    assert res.status_code == 201
    body = res.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}


def _unique_upgrade_payload():
    suffix = uuid.uuid4().hex[:10]
    return {
        "username": f"r1_guest_up_{suffix}",
        "email": f"r1_guest_up_{suffix}@example.com",
        "password": "TestPass123!",
    }


def test_guest_can_reach_plan_detail_and_create_day_and_event(client):
    """guest→plan作成(/travel-plans)→day作成→event作成→プラン詳細取得、
    がすべて200/201で完了し、revisionが正しく積み上がることを確認する。"""
    _guest_body, headers = _create_guest(client)

    plan_res = client.post(
        "/api/v1/travel-plans/",
        json={"title": "ゲストの正規化API旅行", "destination": "福岡"},
        headers=headers,
    )
    assert plan_res.status_code == 201
    plan_id = plan_res.json()["id"]

    detail_res = client.get(f"/api/v1/plans/{plan_id}", headers=headers)
    assert detail_res.status_code == 200
    assert detail_res.json()["revision"] == 1
    assert detail_res.json()["days"] == []

    day_res = client.post(
        f"/api/v1/plans/{plan_id}/days",
        json={"local_date": "2026-12-10"},
        headers=headers,
    )
    assert day_res.status_code == 201
    day_id = day_res.json()["id"]

    after_day = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()
    assert after_day["revision"] == 2

    event_res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "太宰府天満宮"},
        headers=headers,
    )
    assert event_res.status_code == 201
    event_id = event_res.json()["id"]

    after_event = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()
    assert after_event["revision"] == 3
    assert len(after_event["days"]) == 1
    assert len(after_event["days"][0]["events"]) == 1
    assert after_event["days"][0]["events"][0]["id"] == event_id


def test_guest_can_update_and_delete_day_and_event_with_if_match(client):
    """更新・削除系(If-Match必須)もguestで到達できることを確認する。"""
    _guest_body, headers = _create_guest(client)

    plan_id = client.post(
        "/api/v1/travel-plans/", json={"title": "更新削除テスト"}, headers=headers
    ).json()["id"]
    day_id = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-11"}, headers=headers
    ).json()["id"]

    rev = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()["revision"]
    update_res = client.put(
        f"/api/v1/plans/{plan_id}/days/{day_id}",
        json={"title": "更新後タイトル"},
        headers={**headers, "If-Match": str(rev)},
    )
    assert update_res.status_code == 200
    assert update_res.json()["title"] == "更新後タイトル"

    event_id = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "削除予定イベント"},
        headers=headers,
    ).json()["id"]

    rev2 = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()["revision"]
    delete_event_res = client.delete(
        f"/api/v1/plans/{plan_id}/events/{event_id}",
        headers={**headers, "If-Match": str(rev2)},
    )
    assert delete_event_res.status_code == 200

    rev3 = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()["revision"]
    delete_day_res = client.delete(
        f"/api/v1/plans/{plan_id}/days/{day_id}",
        headers={**headers, "If-Match": str(rev3)},
    )
    assert delete_day_res.status_code == 200


def test_guest_can_undo_last_change(client):
    """Undo(/plans/{id}/undo)もguestで到達できることを確認する。"""
    _guest_body, headers = _create_guest(client)

    plan_id = client.post(
        "/api/v1/travel-plans/", json={"title": "Undoテスト"}, headers=headers
    ).json()["id"]
    day_id = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-12"}, headers=headers
    ).json()["id"]

    rev = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()["revision"]
    undo_res = client.post(
        f"/api/v1/plans/{plan_id}/undo",
        headers={**headers, "If-Match": str(rev)},
    )
    assert undo_res.status_code == 200

    after = client.get(f"/api/v1/plans/{plan_id}", headers=headers).json()
    assert after["days"] == []


def test_full_vertical_slice_guest_to_upgrade_preserves_normalized_data(client):
    """guest→plan→day→event→reload→upgrade→(正規アカウントで)正規化API
    を引き続き使えることまでの縦切り。P0-04是正の核心テスト。"""
    _guest_body, guest_headers = _create_guest(client)

    plan_id = client.post(
        "/api/v1/travel-plans/",
        json={"title": "縦切りテスト", "destination": "那覇"},
        headers=guest_headers,
    ).json()["id"]
    day_id = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-20"}, headers=guest_headers
    ).json()["id"]
    client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={"day_id": day_id, "title": "首里城"},
        headers=guest_headers,
    )

    before_upgrade = client.get(f"/api/v1/plans/{plan_id}", headers=guest_headers).json()
    assert len(before_upgrade["days"]) == 1
    assert len(before_upgrade["days"][0]["events"]) == 1

    upgrade_res = client.post(
        "/api/v1/auth/guest/upgrade",
        json=_unique_upgrade_payload(),
        headers=guest_headers,
    )
    assert upgrade_res.status_code == 200
    new_headers = {"Authorization": f"Bearer {upgrade_res.json()['access_token']}"}

    # reload: 昇格後の正規トークンで、正規化データがそのまま読める(所有権維持)。
    after_upgrade = client.get(f"/api/v1/plans/{plan_id}", headers=new_headers)
    assert after_upgrade.status_code == 200
    assert len(after_upgrade.json()["days"]) == 1
    assert len(after_upgrade.json()["days"][0]["events"]) == 1

    # 昇格後も正規化APIへの新規書込みが続けて行える。
    rev = after_upgrade.json()["revision"]
    day2_res = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-21"}, headers=new_headers
    )
    assert day2_res.status_code == 201


def test_guest_cannot_reach_another_guests_normalized_plan(client):
    """[SEC] 別guestの正規化APIへは403。"""
    _guest_a, headers_a = _create_guest(client)
    _guest_b, headers_b = _create_guest(client)

    plan_id = client.post(
        "/api/v1/travel-plans/", json={"title": "Aの正規化プラン"}, headers=headers_a
    ).json()["id"]

    forbidden_res = client.get(f"/api/v1/plans/{plan_id}", headers=headers_b)
    assert forbidden_res.status_code == 403

    forbidden_day_res = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-15"}, headers=headers_b
    )
    assert forbidden_day_res.status_code == 403


def test_normalized_api_rejects_missing_token(client):
    """[SEC] トークン無しでは401。"""
    fake_plan_id = str(uuid.uuid4())
    res = client.get(f"/api/v1/plans/{fake_plan_id}")
    assert res.status_code == 401


def test_normalized_api_rejects_malformed_plan_id_as_404_not_422(client):
    """[SEC] UUID形式でないplan_idは、形式エラーで422にはせず404で応答する
    (他ユーザーのIDを推測して存在有無を判別できてしまうIDOR対策、
    plan_access.py の既存方針をguest経路でも維持できているかの回帰)。"""
    _guest_body, headers = _create_guest(client)
    res = client.get("/api/v1/plans/not-a-uuid", headers=headers)
    assert res.status_code == 404


def test_normalized_api_still_requires_membership_for_route_preview(client):
    """[Gate R1 スコープ確認] route-preview等のAI/計算系4エンドポイントは
    本Gateの対象外であり、引き続き会員限定(guestは403)のままである
    ことを明示的に固定する回帰テスト。"""
    _guest_body, headers = _create_guest(client)
    plan_id = client.post(
        "/api/v1/travel-plans/", json={"title": "プレビュー対象外確認"}, headers=headers
    ).json()["id"]
    day_id = client.post(
        f"/api/v1/plans/{plan_id}/days", json={"local_date": "2026-12-16"}, headers=headers
    ).json()["id"]

    res = client.get(
        f"/api/v1/plans/{plan_id}/days/{day_id}/route-preview", headers=headers
    )
    # get_current_active_userはguestを"認証エラー"(AuthenticationError、
    # ErrorCategory.AUTHENTICATION)として拒否するため401になる(403では
    # ない)。plan_access.pyの権限不足403とは異なる経路であることに注意。
    assert res.status_code == 401
