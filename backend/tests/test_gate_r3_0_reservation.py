"""
[Gate R3-0] FR-010予約管理 最小実装のテスト。

作成/一覧・詳細でのmasked表示/reveal(owner-onlyかつ監査ログ記録)/
編集(If-Match楽観ロック)/削除(soft delete)/他ユーザーからの403、を検証する。
"""
import uuid

import pytest

from app.core.auth import get_current_user, AuthResult
from app.core.config import settings
from app.core import crypto as crypto_module
from app.main import app
from app.models.models import PlanCollaborator, Reservation


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"


@pytest.fixture(autouse=True)
def _reservation_encryption_key(monkeypatch):
    """このテストファイル内でのみENCRYPTION_KEYを設定する(他テストへ影響しない)。"""
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="予約テスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "京都",
            "start_date": "2026-10-01",
            "end_date": "2026-10-03",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _reservation_body(**overrides):
    payload = {
        "type": "accommodation",
        "provider_name": "テストホテル",
        "confirmation_number": "ABC1234567",
        "pin": "9999",
        "holder_name": "山田太郎",
        "guest_count": 2,
        "currency": "JPY",
        "total_amount": 25000.0,
    }
    payload.update(overrides)
    return payload


def test_create_and_get_reservation_masks_confirmation_number(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert create_res.status_code == 201, create_res.text
    body = create_res.json()

    # 一覧・詳細ではmaskされた値のみが返り、平文の予約番号・PINはレスポンスに含まれない
    assert body["confirmation_number_masked"] == "******4567"
    assert body["has_pin"] is True
    assert "confirmation_number" not in body
    assert "pin" not in body

    # DB上も平文で保存されていないこと
    row = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.confirmation_number_ciphertext is not None
    assert b"ABC1234567" not in row.confirmation_number_ciphertext
    assert row.pin_ciphertext is not None
    assert b"9999" not in row.pin_ciphertext

    get_res = client.get(f"{RES_ENDPOINT.format(plan_id=plan_id)}/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["confirmation_number_masked"] == "******4567"


def test_list_reservations_returns_created_items(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body(type="flight", provider_name="A航空"))
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body(type="accommodation"))

    list_res = client.get(RES_ENDPOINT.format(plan_id=plan_id))
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) == 2
    assert {i["type"] for i in items} == {"flight", "accommodation"}


def test_reveal_returns_plaintext_and_calls_audit_logger(auth_client, monkeypatch):
    """[DOC-05 §18.1] revealは必ず監査ログ記録を経由すること。

    record_audit_event()は本番運用を優先し、呼び出し元のDBトランザクション
    に依存しない独立セッション(app/services/audit_service.py参照)で書き込む
    設計のため、テストのトランザクション分離fixture(db_session)からは
    書き込み結果を直接観測できない(conftest.pyのdb_session/独立connection分離
    が理由であり、既存Gate R2-7のテストも同じ理由でDB行の直接検証は行って
    いない)。ここではreservations.record_audit_eventの呼び出し自体を
    monkeypatchで検証する。
    """
    client, user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]

    calls = []
    import app.api.v1.reservations as reservations_module

    def _spy(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(reservations_module, "record_audit_event", _spy)

    reveal_res = client.post(f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}/reveal")
    assert reveal_res.status_code == 200, reveal_res.text
    body = reveal_res.json()
    assert body["confirmation_number"] == "ABC1234567"
    assert body["pin"] == "9999"

    reveal_calls = [c for c in calls if c.get("action") == "reservation_revealed"]
    assert len(reveal_calls) == 1
    assert reveal_calls[0]["user_id"] == user.id
    assert reveal_calls[0]["resource_id"] == uuid.UUID(reservation_id)


def test_update_requires_if_match_and_bumps_revision(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]
    assert create_res.json()["revision"] == 1

    detail_url = f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}"

    # If-Match無し -> 400
    no_header_res = client.patch(detail_url, json={"provider_name": "変更後ホテル"})
    assert no_header_res.status_code == 400

    # 不一致 -> 409
    conflict_res = client.patch(
        detail_url, json={"provider_name": "変更後ホテル"}, headers={"If-Match": "999"}
    )
    assert conflict_res.status_code == 409

    # 一致 -> 200、revisionが1つ進む
    ok_res = client.patch(
        detail_url, json={"provider_name": "変更後ホテル"}, headers={"If-Match": "1"}
    )
    assert ok_res.status_code == 200, ok_res.text
    updated = ok_res.json()
    assert updated["provider_name"] == "変更後ホテル"
    assert updated["revision"] == 2


def test_delete_is_soft_delete_and_excluded_from_list(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]
    detail_url = f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}"

    del_res = client.delete(detail_url, headers={"If-Match": "1"})
    assert del_res.status_code == 204

    # 一覧・詳細から除外される
    assert client.get(detail_url).status_code == 404
    assert client.get(RES_ENDPOINT.format(plan_id=plan_id)).json() == []

    # DB上は物理削除されず、deleted_atが設定されるのみ(soft delete)
    row = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(reservation_id)).first()
    assert row is not None
    assert row.deleted_at is not None


def test_other_user_without_access_gets_403(client, make_user):
    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用プラン")
    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert create_res.status_code == 201

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(RES_ENDPOINT.format(plan_id=plan_id))
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner


def test_viewer_collaborator_cannot_create_but_can_list(auth_client, make_user, db_session):
    """[DOC-04 SC-11] 作成/編集/削除はowner/editorのみ。viewerは閲覧のみ可能。"""
    client, owner = auth_client
    plan_id = _create_plan(client, title="viewer共有テスト")

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert create_res.status_code == 201

    viewer, _ = make_user()
    db_session.add(
        PlanCollaborator(
            plan_id=uuid.UUID(plan_id),
            user_id=viewer.id,
            email=viewer.email,
            role="viewer",
            status="accepted",
        )
    )
    db_session.commit()

    def _as_viewer():
        return AuthResult(user=viewer, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_viewer

    list_res = client.get(RES_ENDPOINT.format(plan_id=plan_id))
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    forbidden_create = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert forbidden_create.status_code == 403

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
