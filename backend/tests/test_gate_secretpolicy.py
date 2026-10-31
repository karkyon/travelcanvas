"""[Gate SecretPolicy] 外部 API の鍵: 取得元は DB の有効な登録版だけ(.env へ戻らない)・サンプル値の拒否・状態の分離。"""
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.v1 import admin_ops
from app.core import crypto
from app.core.config import settings
from app.models.models import AuditLog, ProviderSecret
from app.services import provider_secrets as ps

SLOT = "openai_api_key"
REAL_A = "sk-proj-db-registered-AAAA1111"
REAL_B = "sk-proj-env-leftover-BBBB2222"
PLACEHOLDER = "CHANGE_ME_MANUAL_ROTATION_REQUIRED"


@pytest.fixture()
def admin_user_id(make_user):
    user, _ = make_user()
    return user.id


@pytest.fixture()
def admin_client(auth_client, db_session, monkeypatch):
    client, user = auth_client
    user.user_type = "admin"
    db_session.flush()
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    return client, user


@pytest.mark.parametrize("value", [PLACEHOLDER, "  change_me  ", "CHANGE-ME-PLEASE", "REPLACE_ME", "replace-me-123",
                                   "YOUR_API_KEY", "your-openai-key-here", "TODO", "xxxxxxxx", "XXXXXXXXXXXX",
                                   "${OPENAI_API_KEY}", "<your key>", "<key-here>", "placeholder", "dummy", "********"])
def test_known_samples_are_placeholders(value):
    assert ps.classify_format(value) == "placeholder"


@pytest.mark.parametrize("value", ["", "   ", None, 123, "short", "has space inside key", "ctrl\x00char-in-the-key-xx",
                                   "k" * 513])
def test_malformed_values(value):
    assert ps.classify_format(value) == "malformed"


@pytest.mark.parametrize("value", ["sk-proj-abcdefghijklmnop", "AIzaSyA-realistic1234567890abcdefghijk",
                                   "sk-test-not-a-real-key-123456",
                                   "sk-abc-change_me-12345678"])  # 本物の鍵に部分文字列が偶然入っていても誤拒否しない
def test_real_looking_keys_are_accepted(value):
    assert ps.classify_format(value) == "acceptable"


def test_no_db_version_never_falls_back_to_env(db_session, monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", REAL_B)
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve(db_session, SLOT)
    assert exc.value.code == "secret_missing"
    st = ps.state(db_session, SLOT)
    assert st["status"] == "missing" and st["source"] is None and st["last4"] is None
    assert st["env_legacy"] == {"present": True, "placeholder": False, "importable": True}
    assert REAL_B not in str(st)


def test_db_value_wins_and_env_is_never_read(db_session, monkeypatch, admin_user_id):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", REAL_B)
    ps.register(db_session, SLOT, REAL_A, "登録", admin_user_id)
    assert ps.resolve(db_session, SLOT) == REAL_A


def test_disabled_stays_disabled_even_with_env_left(db_session, monkeypatch, admin_user_id):
    ps.register(db_session, SLOT, REAL_A, "登録", admin_user_id)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", REAL_B)
    ps.disable(db_session, SLOT, admin_user_id)
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve(db_session, SLOT)
    assert exc.value.code == "secret_disabled"
    st = ps.state(db_session, SLOT)
    assert st["status"] == "disabled" and st["status"] != "missing" and st["source"] is None


def test_env_placeholder_is_not_a_key(db_session, monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", PLACEHOLDER)
    st = ps.state(db_session, SLOT)
    assert st["status"] == "missing" and st["last4"] is None  # 以前は「鍵あり・末尾IRED」だった
    assert st["env_legacy"] == {"present": True, "placeholder": True, "importable": False}
    with pytest.raises(ps.SecretUnavailable):
        ps.resolve(db_session, SLOT)


def test_cms_rejects_placeholder_and_keeps_active_version(admin_client, db_session):
    client, user = admin_client
    url = f"/api/v1/admin/ops/secrets/{SLOT}"
    assert client.post(url, json={"value": REAL_A, "reason": "初回"}).status_code == 201
    for bad in (PLACEHOLDER, "  replace_me  ", "short"):
        r = client.post(url, json={"value": bad, "reason": "試験"})
        assert r.status_code == 422, bad
        assert r.json()["detail"]["code"] in ("placeholder_secret", "invalid_secret_value")
    rows = db_session.query(ProviderSecret).filter_by(slot=SLOT).all()
    assert [(x.version, x.status) for x in rows] == [(1, "active")]  # 新しい不正な値で正常な有効版を壊さない
    assert ps.resolve(db_session, SLOT) == REAL_A


def test_stored_placeholder_is_unusable_and_visible(db_session, admin_user_id):
    db_session.add(ProviderSecret(id=uuid.uuid4(), slot=SLOT, version=1, status="active", last4="IRED",
                                  secret_ciphertext=crypto.encrypt_payload(PLACEHOLDER.encode()), reason="旧",
                                  created_by=admin_user_id))
    db_session.flush()
    st = ps.state(db_session, SLOT)
    assert st["status"] == "placeholder" and st["format"] == "placeholder"
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve(db_session, SLOT)
    assert exc.value.code == "secret_placeholder"


def test_corrupt_ciphertext_is_decrypt_failed_and_does_not_use_env(db_session, monkeypatch, admin_user_id):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", REAL_B)
    db_session.add(ProviderSecret(id=uuid.uuid4(), slot=SLOT, version=1, status="active", last4="ABCD",
                                  secret_ciphertext=b"not-a-fernet-token", reason="壊れた", created_by=admin_user_id))
    db_session.flush()
    st = ps.state(db_session, SLOT)
    assert st["status"] == "decrypt_failed" and st["retrieval"] == "decrypt_failed"
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve(db_session, SLOT)
    assert exc.value.code == "secret_decrypt_failed"


def test_registered_is_not_provider_verified(db_session, admin_user_id):
    ps.register(db_session, SLOT, REAL_A, "登録", admin_user_id)
    st = ps.state(db_session, SLOT)
    assert st["status"] == "configured" and st["provider_auth"] == "unverified"  # 提供元が認めたとは言わない


def test_explicit_import_from_env(admin_client, db_session, monkeypatch):
    client, user = admin_client
    url = f"/api/v1/admin/ops/secrets/{SLOT}/import-env"
    assert client.post(url, json={"reason": "移行"}).status_code == 422  # .env に値なし
    monkeypatch.setattr(settings, "OPENAI_API_KEY", PLACEHOLDER)
    r = client.post(url, json={"reason": "移行"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "placeholder_secret"
    assert db_session.query(ProviderSecret).filter_by(slot=SLOT).count() == 0
    monkeypatch.setattr(settings, "OPENAI_API_KEY", REAL_B)
    assert client.post(url, json={}).status_code == 422  # 理由が要る
    r = client.post(url, json={"reason": "移行"})
    assert r.status_code == 201 and r.json()["source"] == "cms" and r.json()["version"] == 1
    assert REAL_B not in r.text
    assert ps.resolve(db_session, SLOT) == REAL_B
    assert db_session.query(AuditLog).filter_by(action="ops_secret_imported_from_env").count() == 1
    assert settings.OPENAI_API_KEY == REAL_B  # .env は消さない


def test_import_requires_admin(auth_client, monkeypatch):
    client, _ = auth_client
    monkeypatch.setattr(settings, "OPENAI_API_KEY", REAL_B)
    assert client.post(f"/api/v1/admin/ops/secrets/{SLOT}/import-env", json={"reason": "x"}).status_code == 403


def test_conflict_is_reported_and_changes_nothing(db_session, admin_user_id):
    def conflict(_db, _row):
        raise IntegrityError("x", {}, Exception("dup"))

    with pytest.raises(ps.SecretError) as exc:
        ps.register(db_session, SLOT, REAL_A, "競合", admin_user_id, conflict)
    assert exc.value.code == "secret_conflict"
    assert db_session.query(ProviderSecret).filter_by(slot=SLOT).count() == 0


def test_audit_failure_changes_nothing(db_session, admin_user_id):
    def audit_down(_db, _row):
        raise RuntimeError("audit db down")

    with pytest.raises(ps.SecretError) as exc:
        ps.register(db_session, SLOT, REAL_A, "監査停止", admin_user_id, audit_down)
    assert exc.value.code == "audit_unavailable"
    assert db_session.query(ProviderSecret).filter_by(slot=SLOT).count() == 0  # 監査が書けなければ鍵も変えない


def test_secret_status_codes_do_not_leak_as_500():
    assert admin_ops._SECRET_ERROR_STATUS["secret_conflict"] == 409
    assert admin_ops._SECRET_ERROR_STATUS["audit_unavailable"] == 503


_APP = Path(__file__).resolve().parents[1] / "app"
_REPO = Path(__file__).resolve().parents[2]


def test_no_code_outside_provider_secrets_reads_provider_key_settings():
    """鍵の取得口は provider_secrets だけ(settings・os.environ・SDK の自動取得を各機能に増やさない)"""
    pat = re.compile(r"(settings\.|os\.environ|os\.getenv|environ\.get|getattr\(settings)[^\n]*"
                     r"(OPENAI_API_KEY|GOOGLE_PLACES_API_KEY|GOOGLE_MAPS_API_KEY|WEATHER_API_KEY)")
    found = [str(p.relative_to(_APP)) for p in _APP.rglob("*.py")
             if p.name != "provider_secrets.py" and pat.search(p.read_text(encoding="utf-8"))]
    assert found == [], found
    assert not any(re.search(r"^\s*(import|from)\s+(openai|googlemaps)\b", p.read_text(encoding="utf-8"), re.M)
                   for p in _APP.rglob("*.py")), "SDK をそのまま import しない(鍵は明示引数で渡す)"


def test_frontend_has_no_static_google_maps_key_path():
    hits = [str(p.relative_to(_REPO)) for p in (_REPO / "frontend" / "src").rglob("*")
            if p.is_file() and p.suffix in (".ts", ".tsx") and "VITE_GOOGLE_MAPS_API_KEY" in p.read_text(encoding="utf-8")]
    assert hits == [], hits
    for name in (".env.example", "docker-compose.yml"):
        assert "VITE_GOOGLE_MAPS_API_KEY" not in (_REPO / name).read_text(encoding="utf-8")


def test_env_example_has_no_active_provider_key_lines():
    text = (_REPO / ".env.example").read_text(encoding="utf-8")
    for name in ("OPENAI_API_KEY", "GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "WEATHER_API_KEY"):
        assert not re.search(rf"^{name}=", text, re.M), name
