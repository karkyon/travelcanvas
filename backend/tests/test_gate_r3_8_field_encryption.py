"""
[Gate R3-8] reservations.holder_name/contact_phone、
reservation_participants.name/seat/special_requestの暗号化列化テスト。

- 作成時に平文列(旧列)へは一切書き込まれず、ciphertext列にのみ保存される
- レスポンスでは復号済みの値が正しく返る
- 更新(PATCH)でもciphertext列のみが更新される
- 既存(暗号化前)データの後方互換読み取り(平文列フォールバック)を確認
"""
import uuid

import pytest

from app.core.config import settings
from app.core import crypto as crypto_module
from app.models.models import Reservation, ReservationParticipant


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
PARTICIPANTS_ENDPOINT = RES_ENDPOINT + "/{reservation_id}/participants"


@pytest.fixture(autouse=True)
def _encryption_key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="暗号化テスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title, "description": "説明", "destination": "京都",
            "start_date": "2027-02-01", "end_date": "2027-02-03",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_reservation_holder_name_and_contact_phone_encrypted(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json={
        "type": "accommodation", "holder_name": "山田太郎", "contact_phone": "090-1234-5678",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["holder_name"] == "山田太郎"
    assert body["contact_phone"] == "090-1234-5678"

    row = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(body["id"])).first()
    assert row is not None
    assert row.holder_name is None  # 旧平文列は書き込まれない
    assert row.holder_name_ciphertext is not None
    assert row.contact_phone is None
    assert row.contact_phone_ciphertext is not None


def test_reservation_update_holder_name_uses_ciphertext_only(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json={"type": "flight"})
    reservation_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    update_res = client.patch(
        f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}",
        json={"holder_name": "更新後名義"},
        headers={"If-Match": str(revision)},
    )
    assert update_res.status_code == 200, update_res.text
    assert update_res.json()["holder_name"] == "更新後名義"

    row = db_session.query(Reservation).filter(Reservation.id == uuid.UUID(reservation_id)).first()
    assert row.holder_name is None
    assert row.holder_name_ciphertext is not None


def test_legacy_plaintext_row_still_readable_via_fallback(auth_client, db_session):
    """[Gate R3-8教訓] Gate R3-8以前に作成された(平文列のみを持つ)行が、
    backfill未実施でも一覧・詳細で引き続き表示できること(フォールバック)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    # 直接DBへ「暗号化前の旧データ」を模した行を挿入する(ciphertext列は空)。
    legacy = Reservation(
        plan_id=uuid.UUID(plan_id), type="train", holder_name="レガシー太郎", contact_phone="03-0000-0000",
    )
    db_session.add(legacy)
    db_session.commit()

    get_res = client.get(f"{RES_ENDPOINT.format(plan_id=plan_id)}/{legacy.id}")
    assert get_res.status_code == 200, get_res.text
    assert get_res.json()["holder_name"] == "レガシー太郎"
    assert get_res.json()["contact_phone"] == "03-0000-0000"


def test_participant_fields_encrypted(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = client.post(RES_ENDPOINT.format(plan_id=plan_id), json={"type": "flight"}).json()["id"]
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    res = client.post(endpoint, json={
        "name": "参加者太郎", "seat": "3D", "special_request": "ベジタリアン食",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "参加者太郎"
    assert body["seat"] == "3D"
    assert body["special_request"] == "ベジタリアン食"

    row = db_session.query(ReservationParticipant).filter(
        ReservationParticipant.id == uuid.UUID(body["id"])
    ).first()
    assert row.name is None
    assert row.name_ciphertext is not None
    assert row.seat is None
    assert row.seat_ciphertext is not None
    assert row.special_request is None
    assert row.special_request_ciphertext is not None


def test_participant_update_uses_ciphertext_only(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = client.post(RES_ENDPOINT.format(plan_id=plan_id), json={"type": "flight"}).json()["id"]
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    participant_id = client.post(endpoint, json={"name": "初期太郎"}).json()["id"]

    update_res = client.patch(f"{endpoint}/{participant_id}", json={"seat": "5C"})
    assert update_res.status_code == 200, update_res.text
    assert update_res.json()["name"] == "初期太郎"
    assert update_res.json()["seat"] == "5C"

    row = db_session.query(ReservationParticipant).filter(
        ReservationParticipant.id == uuid.UUID(participant_id)
    ).first()
    assert row.seat is None
    assert row.seat_ciphertext is not None
