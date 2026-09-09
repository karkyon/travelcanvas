"""
[Gate R3-13] DOC-11 §6.3 / DOC-08 §19 盲検索index(lookup_hash)のテスト。

confirmation_numberの完全一致検索(GET .../reservations/search)、
作成/更新/クリア時のlookup_hash同期、正規化(前後空白・大文字小文字)、
APIレスポンスへの非露出、他ユーザーからの403、LOOKUP_INDEX_KEY未設定時の
503を検証する。
"""
import pytest

from app.core.auth import get_current_user, AuthResult
from app.core.config import settings
from app.core import crypto as crypto_module
from app.main import app


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
SEARCH_ENDPOINT = RES_ENDPOINT + "/search"


@pytest.fixture(autouse=True)
def _reservation_keys(monkeypatch):
    """このテストファイル内でのみENCRYPTION_KEY/LOOKUP_INDEX_KEYを設定する
    (他テストへ影響しない)。"""
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", "test-only-lookup-index-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="盲検索テスト旅行"):
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
        "holder_name": "山田太郎",
        "currency": "JPY",
    }
    payload.update(overrides)
    return payload


def test_search_finds_exact_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert create_res.status_code == 201, create_res.text
    reservation_id = create_res.json()["id"]

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    assert search_res.status_code == 200, search_res.text
    items = search_res.json()
    assert len(items) == 1
    assert items[0]["id"] == reservation_id


def test_search_is_case_and_whitespace_insensitive(auth_client):
    """[Gate R3-13] 正規化(strip+upper)により、大文字小文字や前後空白の
    差異があっても同じhashになり検索が一致すること。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert create_res.status_code == 201

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "  abc1234567 "}
    )
    assert search_res.status_code == 200
    assert len(search_res.json()) == 1


def test_search_no_match_returns_empty_list(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "NOTFOUND999"}
    )
    assert search_res.status_code == 200
    assert search_res.json() == []


def test_search_requires_confirmation_number_param(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "   "})
    assert res.status_code == 400


def test_update_confirmation_number_updates_lookup_hash(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    update_res = client.patch(
        f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}",
        json={"confirmation_number": "ZZZ9999999"},
        headers={"If-Match": str(revision)},
    )
    assert update_res.status_code == 200, update_res.text

    old_search = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    assert old_search.json() == []

    new_search = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ZZZ9999999"}
    )
    assert len(new_search.json()) == 1
    assert new_search.json()[0]["id"] == reservation_id


def test_clearing_confirmation_number_clears_lookup_hash(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    reservation_id = create_res.json()["id"]
    revision = create_res.json()["revision"]

    update_res = client.patch(
        f"{RES_ENDPOINT.format(plan_id=plan_id)}/{reservation_id}",
        json={"confirmation_number": None},
        headers={"If-Match": str(revision)},
    )
    assert update_res.status_code == 200, update_res.text

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    assert search_res.json() == []


def test_lookup_hash_never_exposed_in_responses(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert "confirmation_number_lookup_hash" not in create_res.json()

    list_res = client.get(RES_ENDPOINT.format(plan_id=plan_id))
    for item in list_res.json():
        assert "confirmation_number_lookup_hash" not in item

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    for item in search_res.json():
        assert "confirmation_number_lookup_hash" not in item


def test_search_scoped_to_plan_and_excludes_other_plans(auth_client):
    """同じ予約番号でも別planの予約はヒットしないこと(plan_idスコープ)。"""
    client, _user = auth_client
    plan_a = _create_plan(client, title="プランA")
    plan_b = _create_plan(client, title="プランB")

    client.post(RES_ENDPOINT.format(plan_id=plan_a), json=_reservation_body())
    client.post(RES_ENDPOINT.format(plan_id=plan_b), json=_reservation_body())

    search_a = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_a), params={"confirmation_number": "ABC1234567"}
    )
    assert len(search_a.json()) == 1
    assert search_a.json()[0]["plan_id"] == plan_a


def test_other_user_without_access_gets_403_on_search(client, make_user):
    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用プラン")
    client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner


def test_search_without_lookup_index_key_returns_503(auth_client, monkeypatch):
    """LOOKUP_INDEX_KEY未設定時は、検索エンドポイント呼び出し時にのみ503を
    返す(予約の作成・編集自体は妨げない設計。§app/core/crypto.py参照)。"""
    client, _user = auth_client
    plan_id = _create_plan(client)

    create_res = client.post(RES_ENDPOINT.format(plan_id=plan_id), json=_reservation_body())
    assert create_res.status_code == 201, create_res.text

    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", None)
    crypto_module.reset_cache_for_tests()

    search_res = client.get(
        SEARCH_ENDPOINT.format(plan_id=plan_id), params={"confirmation_number": "ABC1234567"}
    )
    assert search_res.status_code == 503

    crypto_module.reset_cache_for_tests()
