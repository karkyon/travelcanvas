"""
[Gate K1] B-008 / FR-032・FR-048 オフラインパックの鍵の配布と失効。

- 鍵は利用者ごと・版ごとに backend の秘密から決定的に導出する(同じ利用者・同じ版なら何度でも同じ鍵。
  再ログインやトークンの更新で変わらない)。DB には版の数字だけを保存する。
- 失効は版を1つ上げる(以前の鍵は二度と配られない)。If-Match で今の版を確かめる。
- 応答はキャッシュさせない。鍵の値を監査・ログに残さない。
"""
import base64
import uuid

import pytest

from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.main import app
from app.models.models import User, UserType
from app.services import offline_keys as ok
from app.utils.rate_limiter import _rate_limit_storage

KEY_URL = "/api/v1/offline-pack/key"
ROTATE_URL = "/api/v1/offline-pack/key/rotate"


def _act_as(user: User, *, guest: bool = False) -> None:
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=guest)


@pytest.fixture(autouse=True)
def _restore_overrides():
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def secrets_configured(monkeypatch):
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", "test-only-offline-pack-secret")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key")


def _register_secret(value: str) -> None:
    from tests.conftest import LEAK_COLLECTOR

    LEAK_COLLECTOR.add_secret(value)


def _decode(key: str) -> bytes:
    return base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))


def test_derivation_is_deterministic_and_separates_users_and_versions(secrets_configured):
    a, b = uuid.uuid4(), uuid.uuid4()
    assert ok.derive_key(a, 1) == ok.derive_key(a, 1)
    assert len(ok.derive_key(a, 1)) == 32
    assert ok.derive_key(a, 1) != ok.derive_key(a, 2)
    assert ok.derive_key(a, 1) != ok.derive_key(b, 1)
    assert len(ok.encode_key(ok.derive_key(a, 1))) == 43
    with pytest.raises(ValueError):
        ok.derive_key(a, 0)


def test_master_falls_back_to_encryption_key_with_its_own_label(monkeypatch):
    uid = uuid.uuid4()
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", None)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "test-only-encryption-key")
    from_encryption = ok.derive_key(uid, 1)
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", "test-only-offline-pack-secret")
    assert ok.derive_key(uid, 1) != from_encryption  # 専用の秘密を設定すると別の鍵
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", None)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", None)
    assert ok.is_configured() is False
    with pytest.raises(ok.OfflineKeyNotConfigured):
        ok.derive_key(uid, 1)


def test_version_parsing_is_defensive():
    assert ok.current_version(None) == 1
    assert ok.current_version({}) == 1
    assert ok.current_version({"offline_pack_key": {"version": 3}}) == 3
    assert ok.current_version({"offline_pack_key": {"version": "x"}}) == 1
    assert ok.current_version({"offline_pack_key": {"version": 0}}) == 1
    assert ok.current_version({"offline_pack_key": "broken"}) == 1
    prefs = {"theme": "dark"}
    updated = ok.next_preferences(prefs, "2026-10-17T00:00:00+00:00")
    assert updated["offline_pack_key"]["version"] == 2 and updated["theme"] == "dark"
    assert "offline_pack_key" not in prefs  # 元の dict は変えない


def test_get_key_returns_same_key_every_time_without_cache(client, make_user, secrets_configured):
    user, _ = make_user()
    _act_as(user)
    first = client.get(KEY_URL)
    assert first.status_code == 200, first.text
    assert first.headers["cache-control"] == "no-store"
    assert first.headers["pragma"] == "no-cache"
    body = first.json()
    _register_secret(body["key"])
    assert body["user_id"] == str(user.id)
    assert body["key_version"] == 1
    assert body["algorithm"] == "AES-256-GCM" and body["key_bits"] == 256
    assert len(body["key"]) == 43 and len(_decode(body["key"])) == 32
    assert _decode(body["key"]) == ok.derive_key(user.id, 1)
    second = client.get(KEY_URL).json()
    assert second["key"] == body["key"]  # 再ログイン・トークン更新でも同じ鍵(版が同じなら)


def test_each_user_gets_a_different_key(client, make_user, secrets_configured):
    alice, _ = make_user()
    bob, _ = make_user()
    _act_as(alice)
    ka = client.get(KEY_URL).json()["key"]
    _act_as(bob)
    kb = client.get(KEY_URL).json()["key"]
    _register_secret(ka)
    _register_secret(kb)
    assert ka != kb


def test_guest_can_get_a_key(client, db_session, secrets_configured):
    guest = User(id=uuid.uuid4(), email=None, username=f"guest_{uuid.uuid4().hex[:8]}", hashed_password=None,
                 user_type=UserType.GUEST, is_active=True, is_verified=False)
    db_session.add(guest)
    db_session.commit()
    _act_as(guest, guest=True)
    res = client.get(KEY_URL)
    assert res.status_code == 200, res.text
    _register_secret(res.json()["key"])
    assert res.json()["user_id"] == str(guest.id)


def test_inactive_or_missing_user_gets_404(client, make_user, db_session, secrets_configured):
    user, _ = make_user()
    user.is_active = False
    db_session.commit()
    _act_as(user)
    res = client.get(KEY_URL)
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "offline_key_unavailable"
    ghost = User(id=uuid.uuid4(), email="ghost@example.com", username="ghost", user_type=UserType.REGISTERED,
                 is_active=True)
    _act_as(ghost)  # DB に無い利用者
    assert client.get(KEY_URL).status_code == 404


def test_not_configured_returns_503(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "OFFLINE_PACK_KEY_SECRET", None)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", None)
    user, _ = make_user()
    _act_as(user)
    res = client.get(KEY_URL)
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "offline_key_not_configured"
    assert client.post(ROTATE_URL, headers={"If-Match": "1"}).status_code == 503


def test_rotate_requires_if_match_and_checks_version(client, make_user, db_session, secrets_configured):
    user, _ = make_user()
    _act_as(user)
    old = client.get(KEY_URL).json()
    _register_secret(old["key"])
    assert client.post(ROTATE_URL).status_code == 400
    assert client.post(ROTATE_URL, headers={"If-Match": "abc"}).status_code == 400
    stale = client.post(ROTATE_URL, headers={"If-Match": "7"})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "offline_key_version_mismatch"

    rotated = client.post(ROTATE_URL, headers={"If-Match": "1"})
    assert rotated.status_code == 200, rotated.text
    assert rotated.headers["cache-control"] == "no-store"
    body = rotated.json()
    _register_secret(body["key"])
    assert body["previous_version"] == 1 and body["key_version"] == 2
    assert body["key"] != old["key"]
    now = client.get(KEY_URL).json()
    assert now["key_version"] == 2 and now["key"] == body["key"]  # 以前の鍵は二度と配られない
    db_session.expire_all()
    stored = db_session.query(User).filter(User.id == user.id).one()
    assert stored.preferences["offline_pack_key"]["version"] == 2
    assert "key" not in stored.preferences["offline_pack_key"]  # DB に鍵は保存しない
    # 同じ版での二重送信は409(別の端末の失効と競合した場合も同じ)
    assert client.post(ROTATE_URL, headers={"If-Match": "1"}).status_code == 409


def test_rotate_is_audited_with_versions_only(client, make_user, monkeypatch, secrets_configured):
    events = []
    import app.api.v1.offline_pack as mod

    monkeypatch.setattr(mod, "record_audit_event", lambda **kw: events.append(kw))
    user, _ = make_user()
    _act_as(user)
    res = client.post(ROTATE_URL, headers={"If-Match": '"1"'})
    assert res.status_code == 200
    _register_secret(res.json()["key"])
    assert len(events) == 1
    event = events[0]
    assert event["action"] == "offline_key_rotated"
    assert event["details"] == {"from_version": 1, "to_version": 2}
    assert res.json()["key"] not in repr(event)


def test_rate_limits(client, make_user, secrets_configured):
    user, _ = make_user()
    _act_as(user)
    _rate_limit_storage.clear()
    for _ in range(ok_rotate_limit()):
        version = client.get(KEY_URL).json()["key_version"]
        res = client.post(ROTATE_URL, headers={"If-Match": str(version)})
        assert res.status_code == 200
        _register_secret(res.json()["key"])
    version = client.get(KEY_URL).json()["key_version"]
    assert client.post(ROTATE_URL, headers={"If-Match": str(version)}).status_code == 429
    _rate_limit_storage.clear()
    for _ in range(ok_key_limit()):
        assert client.get(KEY_URL).status_code == 200
    over = client.get(KEY_URL)
    assert over.status_code == 429
    assert over.json()["detail"]["code"] == "rate_limited"


def ok_rotate_limit() -> int:
    import app.api.v1.offline_pack as mod

    return mod.ROTATE_RATE_LIMIT


def ok_key_limit() -> int:
    import app.api.v1.offline_pack as mod

    return mod.KEY_RATE_LIMIT


def test_profile_update_cannot_reset_the_key_version(auth_client, db_session, secrets_configured):
    """利用者がプロフィール更新で版を戻すと、失効した鍵が再び配られてしまう。PUT /auth/me では受け付けない"""
    client, user = auth_client
    rotated = client.post(ROTATE_URL, headers={"If-Match": "1"})
    assert rotated.status_code == 200
    _register_secret(rotated.json()["key"])
    res = client.put("/api/v1/auth/me", json={"preferences": {"offline_pack_key": {"version": 1}, "theme": "dark"}})
    assert res.status_code == 200, res.text
    db_session.expire_all()
    stored = db_session.query(User).filter(User.id == user.id).one()
    assert stored.preferences["offline_pack_key"]["version"] == 2
    assert stored.preferences["theme"] == "dark"
    now = client.get(KEY_URL).json()
    _register_secret(now["key"])
    assert now["key_version"] == 2
