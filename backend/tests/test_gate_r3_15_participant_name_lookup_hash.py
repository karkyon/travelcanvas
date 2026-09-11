"""
[Gate R3-15] DOC-11 §6.3 reservation_participants.name盲検索(lookup_hash)の
テスト。

完全一致検索(plan横断)、正規化(大文字小文字・前後空白)一致、未一致、
未指定400、更新時のlookup_hash更新、APIレスポンスへの非露出、他ユーザー
403、LOOKUP_INDEX_KEY未設定時の503を検証する。
"""
import pytest

from app.core.config import settings
from app.core.auth import get_current_user, AuthResult
from app.core import crypto as crypto_module
from app.main import app


RES_ENDPOINT = "/api/v1/plans/{plan_id}/reservations"
PARTICIPANTS_ENDPOINT = RES_ENDPOINT + "/{reservation_id}/participants"
SEARCH_ENDPOINT = RES_ENDPOINT + "/participants/search"


@pytest.fixture(autouse=True)
def _reservation_keys(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", "test-only-lookup-index-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


def _create_plan(client, title="参加者検索テスト旅行"):
    res = client.post(
        "/api/v1/travel-plans/",
        json={
            "title": title,
            "description": "説明",
            "destination": "大阪",
            "start_date": "2026-11-01",
            "end_date": "2026-11-03",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_reservation(client, plan_id):
    res = client.post(
        RES_ENDPOINT.format(plan_id=plan_id),
        json={"type": "flight", "provider_name": "テスト航空"},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create_participant(client, plan_id, reservation_id, name="山田太郎"):
    res = client.post(
        PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id),
        json={"name": name},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_search_finds_exact_match(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    participant = _create_participant(client, plan_id, reservation_id, name="山田太郎")

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "山田太郎"})
    assert res.status_code == 200, res.text
    items = res.json()
    assert len(items) == 1
    assert items[0]["id"] == participant["id"]
    assert items[0]["reservation_id"] == reservation_id


def test_search_is_case_and_whitespace_insensitive(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    _create_participant(client, plan_id, reservation_id, name="John Smith")

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "  john smith  "})
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_search_no_match_returns_empty_list(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    _create_participant(client, plan_id, reservation_id, name="山田太郎")

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "存在しない太郎"})
    assert res.status_code == 200
    assert res.json() == []


def test_search_requires_name_param(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "   "})
    assert res.status_code == 400


def test_search_spans_multiple_reservations_in_same_plan(auth_client):
    """[Gate R3-15] 個別予約ではなくplan配下の全予約を横断検索すること。"""
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_a = _create_reservation(client, plan_id)
    reservation_b = _create_reservation(client, plan_id)
    _create_participant(client, plan_id, reservation_a, name="鈴木花子")
    _create_participant(client, plan_id, reservation_b, name="鈴木花子")

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "鈴木花子"})
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_search_scoped_to_plan(auth_client):
    """同じ氏名でも別planの参加者はヒットしないこと。"""
    client, _user = auth_client
    plan_a = _create_plan(client, title="プランA")
    plan_b = _create_plan(client, title="プランB")
    reservation_a = _create_reservation(client, plan_a)
    reservation_b = _create_reservation(client, plan_b)
    _create_participant(client, plan_a, reservation_a, name="佐藤次郎")
    _create_participant(client, plan_b, reservation_b, name="佐藤次郎")

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_a), params={"name": "佐藤次郎"})
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_update_name_updates_lookup_hash(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    participant = _create_participant(client, plan_id, reservation_id, name="旧姓花子")

    update_res = client.patch(
        f"{PARTICIPANTS_ENDPOINT.format(plan_id=plan_id, reservation_id=reservation_id)}/{participant['id']}",
        json={"name": "新姓花子"},
    )
    assert update_res.status_code == 200, update_res.text

    old_search = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "旧姓花子"})
    assert old_search.json() == []

    new_search = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "新姓花子"})
    assert len(new_search.json()) == 1
    assert new_search.json()[0]["id"] == participant["id"]


def test_lookup_hash_never_exposed_in_responses(auth_client):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    participant = _create_participant(client, plan_id, reservation_id, name="山田太郎")
    assert "name_lookup_hash" not in participant

    search_res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "山田太郎"})
    for item in search_res.json():
        assert "name_lookup_hash" not in item


def test_other_user_without_access_gets_403_on_search(client, make_user):
    owner, _ = make_user()

    def _as_owner():
        return AuthResult(user=owner, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_owner
    plan_id = _create_plan(client, title="オーナー専用プラン")
    reservation_id = _create_reservation(client, plan_id)
    _create_participant(client, plan_id, reservation_id, name="山田太郎")

    other_user, _ = make_user()

    def _as_other():
        return AuthResult(user=other_user, is_authenticated=True, is_guest=False)

    app.dependency_overrides[get_current_user] = _as_other
    forbidden_res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "山田太郎"})
    assert forbidden_res.status_code == 403

    app.dependency_overrides[get_current_user] = _as_owner


def test_search_without_lookup_index_key_returns_503(auth_client, monkeypatch):
    client, _user = auth_client
    plan_id = _create_plan(client)
    reservation_id = _create_reservation(client, plan_id)
    _create_participant(client, plan_id, reservation_id, name="山田太郎")

    monkeypatch.setattr(settings, "LOOKUP_INDEX_KEY", None)
    crypto_module.reset_cache_for_tests()

    res = client.get(SEARCH_ENDPOINT.format(plan_id=plan_id), params={"name": "山田太郎"})
    assert res.status_code == 503

    crypto_module.reset_cache_for_tests()
