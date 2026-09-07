"""
[Gate #39] 旅程複製(POST /travel-plans/{plan_id}/clone、CA-005)の縦切りテスト。

検証する経路:
- 日/イベントを持つプランを複製すると、新しいplan_id・revision=1・
  itinerary=Noneで新規プランが作成され、TravelDay/TravelEventが全てコピーされる
- title未指定時は「元タイトル+のコピー」が自動生成される
- title指定時はそれが使われる
- start_date指定時、全日程・全イベントの日時が元の最初の日を基準に平行移動する
- start_date未指定時は元の日付がそのまま複製される
- 複製先のTravelEvent.lockedは元の値に関わらず常にFalse
- 日を持たないプランでも複製できる
- 他人のプランは複製できない(403)
- 存在しないプランは404
- ゲストユーザーでも自分のプランは複製できる

既存テスト(test_plans.py)と同じ流儀に合わせ、登録ユーザーは
`auth_client`(get_current_userのdependency override)を使い、ゲストは
実際の /auth/guest トークン発行フローを使う。
"""
import uuid

from app.core.auth import get_current_user, AuthResult
from app.main import app


def _create_plan_with_days_and_events(client, title="京都旅行"):
    create_res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "destination": "京都",
            "start_date": "2026-10-01",
            "end_date": "2026-10-02",
        },
    )
    assert create_res.status_code == 201
    plan_id = create_res.json()["id"]

    day1_res = client.post(
        f"/api/v1/plans/{plan_id}/days",
        json={"local_date": "2026-10-01", "timezone_id": "Asia/Tokyo", "title": "1日目"},
    )
    assert day1_res.status_code == 201
    day1_id = day1_res.json()["id"]

    event_res = client.post(
        f"/api/v1/plans/{plan_id}/events",
        json={
            "day_id": day1_id,
            "title": "清水寺",
            "event_type": "sightseeing",
            "start_at": "2026-10-01T09:00:00+09:00",
            "end_at": "2026-10-01T10:30:00+09:00",
        },
    )
    assert event_res.status_code == 201
    event_id = event_res.json()["id"]

    # [Gate #29] /plans系の更新はIf-Matchヘッダーで現在のplan.revisionを
    # 要求する。event作成でrevisionが加算されているため、最新値を取得してから送る。
    detail_res = client.get(f"/api/v1/plans/{plan_id}")
    current_revision = detail_res.json()["revision"]

    lock_res = client.put(
        f"/api/v1/plans/{plan_id}/events/{event_id}",
        json={"locked": True},
        headers={"If-Match": str(current_revision)},
    )
    assert lock_res.status_code == 200

    return plan_id, day1_id


def test_clone_copies_days_and_events_and_resets_locked(auth_client):
    client, _user = auth_client
    plan_id, _day1_id = _create_plan_with_days_and_events(client)

    clone_res = client.post(f"/api/v1/travel-plans/{plan_id}/clone", json={})
    assert clone_res.status_code == 201
    cloned = clone_res.json()

    assert cloned["id"] != plan_id
    assert cloned["title"] == "京都旅行のコピー"
    assert cloned["itinerary"] is None

    detail_res = client.get(f"/api/v1/plans/{cloned['id']}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["revision"] == 1
    assert len(detail["days"]) == 1
    assert detail["days"][0]["local_date"] == "2026-10-01"
    assert len(detail["days"][0]["events"]) == 1
    cloned_event = detail["days"][0]["events"][0]
    assert cloned_event["title"] == "清水寺"
    assert cloned_event["locked"] is False


def test_clone_with_explicit_title(auth_client):
    client, _user = auth_client
    plan_id, _ = _create_plan_with_days_and_events(client)

    clone_res = client.post(
        f"/api/v1/travel-plans/{plan_id}/clone", json={"title": "秋の京都旅行"}
    )
    assert clone_res.status_code == 201
    assert clone_res.json()["title"] == "秋の京都旅行"


def test_clone_with_start_date_shifts_days_and_events(auth_client):
    client, _user = auth_client
    plan_id, _ = _create_plan_with_days_and_events(client)

    clone_res = client.post(
        f"/api/v1/travel-plans/{plan_id}/clone", json={"start_date": "2026-11-15"}
    )
    assert clone_res.status_code == 201
    cloned = clone_res.json()

    detail_res = client.get(f"/api/v1/plans/{cloned['id']}")
    detail = detail_res.json()
    assert detail["days"][0]["local_date"] == "2026-11-15"
    shifted_event = detail["days"][0]["events"][0]
    # 元イベントの start_at は "2026-10-01T09:00:00+09:00"(=UTC 10-01T00:00:00Z)。
    # レスポンスはUTC正規化("Z")で返るため、日付のみ45日分シフトされ、
    # 時刻(UTCでの00:00:00)はそのまま保持されることを検証する。
    assert shifted_event["start_at"].startswith("2026-11-15T00:00:00")


def test_clone_without_start_date_keeps_original_dates(auth_client):
    client, _user = auth_client
    plan_id, _ = _create_plan_with_days_and_events(client)

    clone_res = client.post(f"/api/v1/travel-plans/{plan_id}/clone", json={})
    cloned = clone_res.json()

    detail_res = client.get(f"/api/v1/plans/{cloned['id']}")
    detail = detail_res.json()
    assert detail["days"][0]["local_date"] == "2026-10-01"


def test_clone_plan_without_days_still_works(auth_client):
    client, _user = auth_client
    create_res = client.post(
        "/api/v1/travel-plans/", json={"title": "予定未確定の旅行"}
    )
    assert create_res.status_code == 201
    plan_id = create_res.json()["id"]

    clone_res = client.post(f"/api/v1/travel-plans/{plan_id}/clone", json={})
    assert clone_res.status_code == 201
    assert clone_res.json()["title"] == "予定未確定の旅行のコピー"


def test_clone_other_users_plan_rejected(client, make_user):
    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id, _ = _create_plan_with_days_and_events(client, title="オーナー専用旅行")

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    clone_res = client.post(f"/api/v1/travel-plans/{plan_id}/clone", json={})
    assert clone_res.status_code == 403

    app.dependency_overrides.pop(get_current_user, None)


def test_clone_nonexistent_plan_returns_404(auth_client):
    client, _user = auth_client
    fake_id = str(uuid.uuid4())
    clone_res = client.post(f"/api/v1/travel-plans/{fake_id}/clone", json={})
    assert clone_res.status_code == 404


def test_guest_can_clone_own_plan(client):
    """[Gate #35] /plans/*(日/イベントの正規化API)はget_current_active_userの
    ままでゲストを受け付けないため(会員限定)、ここでは/travel-plans側のみで
    完結するプラン(日程未確定)の複製を検証する。日/イベントを含む複製経路は
    登録ユーザーの他テストで検証済み。"""
    guest_res = client.post("/api/v1/auth/guest")
    assert guest_res.status_code == 201
    guest_token = guest_res.json()["access_token"]
    client.headers.update({"Authorization": f"Bearer {guest_token}"})

    create_res = client.post(
        "/api/v1/travel-plans/", json={"title": "ゲストの旅行", "destination": "沖縄"}
    )
    assert create_res.status_code == 201
    plan_id = create_res.json()["id"]

    clone_res = client.post(f"/api/v1/travel-plans/{plan_id}/clone", json={})
    assert clone_res.status_code == 201
    assert clone_res.json()["title"] == "ゲストの旅行のコピー"
