"""[Gate AdminUAT] 運用コンソールの表示の食い違いを無くし、旅行相談の UAT の準備を一か所で見られるようにする。

- 使わない鍵(Google のブラウザ用)は required=False(画面は「設定不要」。未設定の警告にしない)
- 鍵の確認とは別に、提供元を止めているかを suspended_providers で返す
- /admin/ops/uat-readiness: このアカウントの会員クラス・同意・各操作の鍵と停止・模擬かどうかを、値と変える場所つきで返す
  (送らない。鍵の値は返さない)
外への通信は MockTransport(実の API は呼ばない)。
"""
import uuid

import pytest

from app.models.models import Entitlement
from app.services import consents
from app.services import cost_guard as cg
from app.services import provider_secrets as ps
from app.services import provider_stub
from tests.test_gate_providerconnect import GOOGLE_KEY, OPENAI_KEY, _verify, admin, net  # noqa: F401  (fixture)


def _tier(db, user, tier):
    db.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=user.id,
                       feature_key=cg.FEATURE_PREFIX + "class." + tier, status="active", source="admin"))
    db.flush()


def test_unused_browser_key_is_not_required_and_used_keys_are(admin, db_session, net):  # noqa: F811 (fixture)
    client, _user = admin
    body = client.get("/api/v1/admin/ops/secrets").json()
    slots = {s["slot"]: s for s in body["slots"]}
    assert slots["google_maps_browser_key"]["required"] is False
    assert "設定不要" in slots["google_maps_browser_key"]["in_use_note"]
    assert slots["openai_api_key"]["required"] is True
    assert slots["google_maps_server_key"]["required"] is True
    rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    assert rows["google_maps_js"]["secret_required"] is False
    assert rows["openai"]["secret_required"] is True and rows["fake"]["secret_required"] is False


def test_verified_key_with_placeholder_in_legacy_env_reports_both_separately(  # noqa: F811 (fixture)
        admin, db_session, net, monkeypatch):  # noqa: F811
    """DB 登録済み + 旧 .env にサンプル値 + 確認済み: 状態は configured・accepted、旧 .env は placeholder として別に返す"""
    client, user = admin
    monkeypatch.setenv("OPENAI_API_KEY", "CHANGE_ME_MANUAL_ROTATION_REQUIRED")
    monkeypatch.setattr(ps.settings, "OPENAI_API_KEY", "CHANGE_ME_MANUAL_ROTATION_REQUIRED", raising=False)
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    assert _verify(client, "openai_api_key", 1).json()["provider_auth"] == "accepted"
    slot = {s["slot"]: s for s in client.get("/api/v1/admin/ops/secrets").json()["slots"]}["openai_api_key"]
    assert slot["status"] == "configured" and slot["source"] == "cms"
    assert slot["verification"]["state"] == "accepted" and slot["verification"]["expires_at"]
    assert slot["env_legacy"] == {"present": True, "placeholder": True, "importable": False}
    assert slot["suspended_providers"] == []
    assert OPENAI_KEY not in client.get("/api/v1/admin/ops/secrets").text


def test_suspension_is_reported_apart_from_verification(admin, db_session, net):  # noqa: F811 (fixture)
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    _verify(client, "openai_api_key", 1)
    cg.suspend_provider("openai", "試験")
    try:
        slot = {s["slot"]: s for s in client.get("/api/v1/admin/ops/secrets").json()["slots"]}["openai_api_key"]
    finally:
        cg.resume_provider("openai", "試験")
    assert slot["verification"]["state"] == "accepted"
    assert slot["suspended_providers"] == ["openai"]


def test_uat_readiness_lists_value_and_where_for_each_gap(admin, db_session, net):  # noqa: F811 (fixture)
    client, _user = admin
    body = client.get("/api/v1/admin/ops/uat-readiness").json()
    assert body["ready"] is False and body["consult_path"] == "/trip-consult"
    checks = {c["key"]: c for c in body["checks"]}
    assert checks["class"]["ok"] is False and "会員クラス" in checks["class"]["where"]
    assert checks["consent"]["ok"] is False and checks["consent"]["value"] == "未同意"
    assert checks["ai.generate"]["ok"] is False and "有効性を確認" in checks["ai.generate"]["where"]
    assert checks["ai.generate"]["value"] == "鍵が登録されていません"
    for c in body["checks"]:
        assert {"key", "label", "value", "ok", "need", "where"} <= set(c)


def test_uat_readiness_is_ready_with_journey_consent_and_verified_keys(admin, db_session, net):  # noqa: F811 (fixture)
    client, user = admin
    _tier(db_session, user, "journey")
    consents.update(user, {"ai_processing": True})
    db_session.flush()
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    ps.register(db_session, "google_maps_server_key", GOOGLE_KEY, "登録", user.id)
    _verify(client, "openai_api_key", 1)
    _verify(client, "google_maps_server_key", 1)
    net.requests.clear()
    body = client.get("/api/v1/admin/ops/uat-readiness").json()
    assert net.requests == []  # 準備の表示は送らない
    checks = {c["key"]: c for c in body["checks"]}
    assert all(c["ok"] for c in body["checks"]), checks
    assert body["ready"] is True and checks["class"]["value"] == "Journey"
    assert checks["real_provider"]["value"] == "実の提供元"
    assert OPENAI_KEY not in str(body) and GOOGLE_KEY not in str(body)


def test_uat_readiness_says_stub_is_not_real_ai(admin, db_session, net, monkeypatch):  # noqa: F811 (fixture)
    client, _user = admin
    monkeypatch.setattr(provider_stub, "enabled", lambda: True)
    checks = {c["key"]: c for c in client.get("/api/v1/admin/ops/uat-readiness").json()["checks"]}
    assert checks["real_provider"]["ok"] is False and "模擬" in checks["real_provider"]["value"]


def test_uat_readiness_is_admin_only(auth_client):
    client, _user = auth_client
    assert client.get("/api/v1/admin/ops/uat-readiness").status_code == 403


@pytest.mark.parametrize("tier,ai_ok", [("trip", False), ("explorer", True)])
def test_uat_readiness_class_rule(admin, db_session, net, tier, ai_ok):  # noqa: F811 (fixture)
    client, user = admin
    _tier(db_session, user, tier)
    checks = {c["key"]: c for c in client.get("/api/v1/admin/ops/uat-readiness").json()["checks"]}
    assert checks["class"]["ok"] is ai_ok
