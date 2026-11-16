"""[Gate HomePlace] 自宅の場所(本人だけ・使うかは本人が選ぶ)の統合テスト(実PostgreSQL)。

- 未登録は configured=false。保存は If-Match(版)。違う版は 409。位置の範囲外は 422
- 保存は暗号文だけ(平文の列なし)。監査に住所・座標を残さない
- 他の人の GET には自分の自宅は出ない(本人の分だけ)
- 消すと configured=false。アカウントの書き出しには本人の分が入る
"""
import uuid

import pytest

from app.api.v1 import home_place as hp_api
from app.core import crypto as crypto_module
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import UserHomePlace


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key-not-a-secret")
    crypto_module.reset_cache_for_tests()
    yield
    crypto_module.reset_cache_for_tests()


@pytest.fixture(autouse=True)
def audit_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(hp_api, "record_audit_event", lambda **kw: calls.append(kw))
    return calls


def _act_as(user):
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


BODY = {"label": "自宅", "address": "東京都千代田区千代田1-1", "latitude": 35.685175, "longitude": 139.7528,
        "show_on_map": True, "use_for_routes": True, "send_to_route_provider": False}


def test_save_read_and_revision(auth_client, db_session, audit_calls):
    client, me = auth_client
    r = client.get("/api/v1/privacy/home-place")
    assert r.status_code == 200 and r.json()["configured"] is False and r.json()["place"] is None

    assert client.put("/api/v1/privacy/home-place", json=BODY).status_code == 428
    r = client.put("/api/v1/privacy/home-place", json=BODY, headers={"If-Match": "0"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["configured"] is True and b["revision"] == 1
    assert b["place"] == {"label": "自宅", "address": "東京都千代田区千代田1-1", "latitude": 35.685175, "longitude": 139.7528}
    assert b["send_to_route_provider"] is False

    # 保存は暗号文だけ(住所の文字を平文で持たない)
    row = db_session.query(UserHomePlace).filter(UserHomePlace.user_id == me.id).one()
    assert "千代田".encode() not in bytes(row.place_ciphertext)
    # 監査に住所・座標を残さない
    assert audit_calls
    assert all("address" not in str(c["details"]) and "35.68" not in str(c["details"]) for c in audit_calls)

    # 古い版は 409
    assert client.put("/api/v1/privacy/home-place", json=BODY, headers={"If-Match": "0"}).status_code == 409
    r = client.put("/api/v1/privacy/home-place", json={**BODY, "show_on_map": False}, headers={"If-Match": "1"})
    assert r.status_code == 200 and r.json()["revision"] == 2 and r.json()["show_on_map"] is False


def test_invalid_position_and_extra_fields(auth_client):
    client, _ = auth_client
    r = client.put("/api/v1/privacy/home-place", json={**BODY, "latitude": 91}, headers={"If-Match": "0"})
    assert r.status_code == 422
    r = client.put("/api/v1/privacy/home-place", json={**BODY, "user_id": str(uuid.uuid4())}, headers={"If-Match": "0"})
    assert r.status_code == 422


def test_other_user_cannot_see_and_delete(auth_client, make_user, db_session):
    client, me = auth_client
    assert client.put("/api/v1/privacy/home-place", json=BODY, headers={"If-Match": "0"}).status_code == 200
    other, _pw = make_user()
    _act_as(other)
    try:
        r = client.get("/api/v1/privacy/home-place")
        assert r.status_code == 200 and r.json()["configured"] is False and r.json()["place"] is None
    finally:
        _act_as(me)
    assert client.delete("/api/v1/privacy/home-place").status_code == 204
    assert client.get("/api/v1/privacy/home-place").json()["configured"] is False


def test_account_export_includes_own_home(auth_client):
    client, _ = auth_client
    assert client.put("/api/v1/privacy/home-place", json=BODY, headers={"If-Match": "0"}).status_code == 200
    r = client.get("/api/v1/privacy/data-export")
    assert r.status_code == 200
    data = r.json()
    assert data["home_place"]["place"]["address"] == "東京都千代田区千代田1-1"
