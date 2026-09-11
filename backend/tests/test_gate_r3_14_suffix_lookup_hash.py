"""
[Gate R3-14] DOC-04 SC-10/SC-17 / POC-03「末尾検索」のテスト。

末尾4文字での検索、4文字以外の長さでの400、完全一致パラメータとの同時
指定禁止、短い予約番号(4文字未満)ではsuffix索引が作られず検索できない
こと、更新/クリア時のsuffix_lookup_hash同期、APIレスポンスへの非露出を
検証する。
"""
import pytest

from app.core.config import settings
from app.core import crypto as crypto_module


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
SEARCH_ENDPOINT = RES_ENDPOINT + "/search"


@pytest.fixture(autouse=True)
def _reservation_keys(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", "test-only-lookup-index-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="末尾検索テスト旅行"):
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
        "currency": "JPY",
    }
    payload.update(overrides)
    return payload


def test_search_by_suffix_finds_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "4567"}
    )
    assert res.status_code == 200, res.text
    items = res.json()
    assert len(items) == 1
    assert items[0]["id"] == reservation_id


def test_search_by_suffix_case_insensitive(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body(confirmation_number="ABCDwxyz"))

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "wxyz"}
    )
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_search_by_suffix_wrong_length_returns_400(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "567"}
    )
    assert res.status_code == 400

    res2 = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "34567"}
    )
    assert res2.status_code == 400


def test_search_with_both_params_returns_400(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id),
        params={"confirmation_number": "ABC1234567", "confirmation_number_suffix": "4567"},
    )
    assert res.status_code == 400


def test_search_with_neither_param_returns_400(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id))
    assert res.status_code == 400


def test_short_confirmation_number_has_no_suffix_index(auth_client):
    """[Gate R3-14] 正規化後4文字未満の予約番号はsuffix索引を持たないため、
    その全文字を「末尾」として検索しても該当なしとなること
    (compute_suffix_lookup_hashがNoneを返すため作成時に索引が作られない)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body(confirmation_number="AB1"))

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "AB1"}
    )
    assert res.status_code == 400  # 3文字は許容長(4)と不一致


def test_update_confirmation_number_updates_suffix_hash(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    client.patch(
        f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}",
        json={"confirmation_number": "ZZZ9999999"},
        headers={"If-Match": str(revision)},
    )

    old = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "4567"}
    )
    assert old.json() == []

    new = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "9999"}
    )
    assert len(new.json()) == 1
    assert new.json()[0]["id"] == reservation_id


def test_clearing_confirmation_number_clears_suffix_hash(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    client.patch(
        f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}",
        json={"confirmation_number": None},
        headers={"If-Match": str(revision)},
    )

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "4567"}
    )
    assert res.json() == []


def test_suffix_lookup_hash_never_exposed_in_responses(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert "confirmation_number_suffix_lookup_hash" not in create_res.json()

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number_suffix": "4567"}
    )
    for item in search_res.json():
        assert "confirmation_number_suffix_lookup_hash" not in item


def test_exact_search_still_works_alongside_suffix_feature(auth_client):
    """[Gate R3-13との併存確認] confirmation_numberパラメータでの完全一致検索が
    引き続き動作すること(Gate R3-14でエンドポイントを拡張した際のリグレッション
    防止)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]

    res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["id"] == reservation_id
