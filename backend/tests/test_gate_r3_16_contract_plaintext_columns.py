"""
[Gate R3-16] DOC-11 §14 expand/contractのcontractフェーズ。旧平文列
(reservations.holder_name/contact_phone、reservation_participants.name/
seat/special_request)を削除したことの確認。

- モデルにもはや平文列属性が存在しないこと
- API経由の作成・更新・取得が引き続き正しく動作すること(ciphertext経由)
- migrationのpre-flightチェック自体はmigration実行時にのみ機能するため、
  ここではアプリケーションレベルの回帰が無いことを確認する。
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


def _create_plan(client, title="contract検証旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title, "description": "説明", "destination": "神戸",
            "start_date": "2027-03-01", "end_date": "2027-03-03",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_reservation_model_has_no_plaintext_columns():
    assert not hasattr(Reservation, "holder_name")
    assert not hasattr(Reservation, "contact_phone")


def test_participant_model_has_no_plaintext_columns():
    assert not hasattr(ReservationParticipant, "name")
    assert not hasattr(ReservationParticipant, "seat")
    assert not hasattr(ReservationParticipant, "special_request")


def test_reservation_create_and_read_roundtrip_after_contract(auth_client, db_session):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json={
        "type": "accommodation", "holder_name": "契約後太郎", "contact_phone": "080-9999-8888",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["holder_name"] == "契約後太郎"
    assert body["contact_phone"] == "080-9999-8888"

    get_res = client.get(f"{RES_ENDPOINT.format(plan_id=plan_id)}/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["holder_name"] == "契約後太郎"
    assert get_res.json()["contact_phone"] == "080-9999-8888"


def test_participant_create_and_read_roundtrip_after_contract(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = client.post(
        RES_ENDPOINT.format(plan_id=plan_id), json={"type": "flight"}
    ).json()["id"]
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    res = client.post(endpoint, json={
        "name": "契約後参加者", "seat": "7F", "special_request": "アレルギー対応",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "契約後参加者"
    assert body["seat"] == "7F"
    assert body["special_request"] == "アレルギー対応"

    list_res = client.get(endpoint)
    assert list_res.status_code == 200
    assert list_res.json()[0]["name"] == "契約後参加者"


def test_reservation_without_holder_name_returns_none(auth_client):
    """holder_name/contact_phoneを指定しない予約は、フォールバック無しでも
    Noneを正しく返すこと(ciphertext列自体がNULLのケース)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json={"type": "bus"})
    assert res.status_code == 201, res.text
    assert res.json()["holder_name"] is None
    assert res.json()["contact_phone"] is None


def test_participant_without_seat_or_request_returns_none(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = client.post(
        RES_ENDPOINT.format(plan_id=plan_id), json={"type": "flight"}
    ).json()["id"]
    endpoint = PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)

    res = client.post(endpoint, json={"name": "最小構成太郎"})
    assert res.status_code == 201, res.text
    assert res.json()["seat"] is None
    assert res.json()["special_request"] is None
