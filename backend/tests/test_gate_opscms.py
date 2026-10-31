"""
[Gate OpsCMS] 運用コンソール(/admin/ops/*)。

- 管理者でない利用者は全て 403(管理者の多要素認証は require_admin のまま)
- 提供元の一覧は鍵の値を返さない(設定の有無だけ)。有料の提供元は契約が未確認なら live は disabled
- 概要は Fake の額と実の提供元の見込みを分け、Cloud Billing は unavailable(作った値を出さない)
- Fake の家族旅行の試験: 外へ送らず、旅行の合計は 50円を越えない。40円で利用者の警告・45円で運用の知らせの段に入る、
  断る理由は provider の前のもの。同じ Idempotency-Key は二重に数えない。本番の環境では断る
- 台帳は旅行の題・相談の文章を返さない。止める・戻すは理由が要り、監査を残す
"""
from decimal import Decimal

import pytest

from app.api.v1 import admin_ops
from app.core.config import settings
from app.services import cost_guard as cg


@pytest.fixture()
def audits(monkeypatch):
    seen = []
    monkeypatch.setattr(admin_ops, "record_audit_event", lambda **kw: seen.append(kw))
    monkeypatch.setattr(cg, "_audit", lambda *a, **kw: None)
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    yield seen
    cg.resume_provider("openai", "test cleanup")


def _admin(db_session, user):
    user.user_type = "admin"
    db_session.flush()


def test_non_admin_is_forbidden(auth_client, audits):
    client, _user = auth_client
    for path in ("/api/v1/admin/ops/overview", "/api/v1/admin/ops/providers", "/api/v1/admin/ops/ledger",
                 "/api/v1/admin/ops/cloud"):
        assert client.get(path).status_code == 403, path
    assert client.post("/api/v1/admin/ops/test-runs/family-fake", json={"reason": "x"}).status_code == 403


def test_providers_never_return_secret_values(auth_client, db_session, audits, monkeypatch):
    client, user = auth_client
    _admin(db_session, user)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test-not-a-real-key-123456")
    r = client.get("/api/v1/admin/ops/providers")
    assert r.status_code == 200
    assert "sk-test-not-a-real-key" not in r.text
    rows = {p["name"]: p for p in r.json()["providers"]}
    assert set(rows) == {"openai", "google_maps_js", "google_places", "google_routes", "fake"}
    # .env に値があっても取得元ではない → 鍵なし(以前は configured と表示していた)
    assert rows["openai"]["secret"] == "missing" and rows["openai"]["contract"] == "unverified"
    assert rows["openai"]["secret_source"] is None and rows["openai"]["secret_last4"] is None  # .env の末尾は出さない
    assert rows["openai"]["live_calls"] == "disabled"  # 登録されていない(契約・Gate が先)
    assert rows["google_places"]["secret"] in ("missing", "configured")
    assert rows["google_places"]["secret_slot"] == "google_maps_server_key"
    assert rows["fake"]["kind"] == "fake" and rows["fake"]["live_calls"] == "test_only"
    assert rows["fake"]["secret"] == "not_needed"
    assert rows["fake"]["price_profile"] == "known"
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    assert rows["openai"]["secret"] == "missing"


def test_suspend_resume_requires_reason_and_audits(auth_client, db_session, audits):
    client, user = auth_client
    _admin(db_session, user)
    assert client.post("/api/v1/admin/ops/providers/openai/suspend", json={}).status_code == 422
    assert client.post("/api/v1/admin/ops/providers/rocket/suspend", json={"reason": "x"}).status_code == 404
    r = client.post("/api/v1/admin/ops/providers/openai/suspend", json={"reason": "請求の確認"})
    assert r.status_code == 200 and cg.is_suspended("openai")
    rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    assert rows["openai"]["suspended"] is True
    r = client.post("/api/v1/admin/ops/providers/openai/resume", json={"reason": "確認済み"})
    assert r.status_code == 200 and not cg.is_suspended("openai")
    actions = [a["action"] for a in audits]
    assert "ops_provider_suspended" in actions and "ops_provider_resumed" in actions


def test_overview_and_cloud_do_not_invent_values(auth_client, db_session, audits):
    client, user = auth_client
    _admin(db_session, user)
    o = client.get("/api/v1/admin/ops/overview").json()
    assert o["thresholds"] == {"user_warning_jpy": "40.0000", "ops_alert_jpy": "45.0000", "hard_cap_jpy": "50.0000"}
    assert o["cloud_billing"]["status"] == "unavailable"
    assert "fake_usage" in o and "live_usage" in o
    c = client.get("/api/v1/admin/ops/cloud").json()
    keys = {u["key"] for u in c["unavailable"]}
    assert {"billing", "services", "secrets"} <= keys
    for item in c["items"]:
        assert item["status"] in ("known", "unavailable")
        if item["status"] == "unavailable":
            assert item["value"] is None


def test_family_fake_run_stays_under_cap_and_is_idempotent(auth_client, db_session, audits):
    client, user = auth_client
    _admin(db_session, user)
    assert client.post("/api/v1/admin/ops/test-runs/family-fake", json={}).status_code == 422
    r = client.post("/api/v1/admin/ops/test-runs/family-fake", json={"reason": "家族旅行の Fake 試験"})
    assert r.status_code == 201, r.text
    body = r.json()
    s = body["summary"]
    assert s["external_calls"] == 0 and s["provider"] == "fake"
    assert s["never_over_cap"] is True
    # 全ての回数の上限を使い切る(価格の版の検算 49.55円)。40円・45円の段を通る
    assert Decimal(s["final_total_jpy"]) >= Decimal("45") and s["first_user_warning_step"] and s["first_ops_alert_step"]
    assert Decimal(s["final_total_jpy"]) <= Decimal("50")
    assert s["settled_steps"] >= 1 and s["denied_steps"] >= 1
    assert s["first_denial"]["reason"].endswith("_exceeded")  # 上限(額・回数)で、provider へ送る前に断る
    assert s["idempotency_replay"]["checked"] and s["idempotency_replay"]["same_reservation"]
    assert s["idempotency_replay"]["double_counted"] is False
    for step in body["steps"]:
        assert Decimal(step["plan_total_jpy"]) <= Decimal("50")
        if Decimal(step["plan_total_jpy"]) >= Decimal("40"):
            assert step["state"] in ("user_warning", "ops_alert", "limit_reached")
        if Decimal(step["plan_total_jpy"]) >= Decimal("45"):
            assert step["state"] in ("ops_alert", "limit_reached")
    assert body["case"]["origin"] == "大阪府枚方市" and body["case"]["lodging_budget_jpy"] == [60000, 80000]
    assert any(a["action"] == "ops_fake_test_run" for a in audits)
    ledger = client.get("/api/v1/admin/ops/ledger").json()
    row = next(x for x in ledger["rows"] if x["plan_id"] == s["plan_id"])
    assert row["fake_only"] is True and "title" not in row
    assert "[運用の試験]" not in client.get("/api/v1/admin/ops/ledger").text


def test_family_fake_run_refused_in_production(auth_client, db_session, audits, monkeypatch):
    client, user = auth_client
    _admin(db_session, user)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    r = client.post("/api/v1/admin/ops/test-runs/family-fake", json={"reason": "x"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "fake_test_disabled"


# ===================================================================== 鍵の登録(Gate OpsSecrets)

def test_register_secret_encrypts_never_returns_value_and_audits(auth_client, db_session, audits, monkeypatch):
    from app.models.models import ProviderSecret
    from app.services import provider_secrets as ps

    client, user = auth_client
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-env-fallback-value-0000")
    value = "sk-cms-registered-secret-ABCD1234"
    # 管理者でなければ 403
    url = "/api/v1/admin/ops/secrets/openai_api_key"
    assert client.post(url, json={"value": value, "reason": "x"}).status_code == 403
    _admin(db_session, user)
    assert client.post("/api/v1/admin/ops/secrets/openai_api_key", json={"value": value}).status_code == 422  # 理由
    r = client.post("/api/v1/admin/ops/secrets/openai_api_key", json={"value": "short", "reason": "登録"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_secret_value"
    assert client.post("/api/v1/admin/ops/secrets/rocket", json={"value": value, "reason": "x"}).status_code == 404
    r = client.post("/api/v1/admin/ops/secrets/openai_api_key", json={"value": value, "reason": "初回の登録"})
    assert r.status_code == 201, r.text
    assert value not in r.text and "cms-registered" not in r.text
    body = r.json()
    assert body["source"] == "cms" and body["version"] == 1 and body["last4"] == "1234"
    row = db_session.query(ProviderSecret).filter_by(slot="openai_api_key", status="active").one()
    assert value.encode() not in bytes(row.secret_ciphertext)  # 平文で持たない
    assert ps.resolve(db_session, "openai_api_key") == value  # サーバーの中だけで読める
    # 一覧・提供元の画面にも値を出さない
    listing = client.get("/api/v1/admin/ops/secrets")
    assert listing.status_code == 200 and value not in listing.text
    rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    assert rows["openai"]["secret_source"] == "cms" and rows["openai"]["secret_version"] == 1
    # 監査には版と理由だけ
    from app.models.models import AuditLog
    reg = [a for a in db_session.query(AuditLog).filter_by(action="ops_secret_registered")]
    assert reg and value not in str([a.details for a in reg]) and reg[0].details["version"] == 1
    # 新しい版: 前の版は superseded、有効は1つ
    r = client.post(url, json={"value": "sk-second-version-WXYZ9876", "reason": "入れ替え"})
    assert r.json()["version"] == 2 and r.json()["last4"] == "9876"
    statuses = {x.version: x.status for x in db_session.query(ProviderSecret).filter_by(slot="openai_api_key")}
    assert statuses == {1: "superseded", 2: "active"}
    # 無効にしても .env の値へは戻らない(無効化は保持され、取得は拒否)
    assert client.post("/api/v1/admin/ops/secrets/openai_api_key/disable", json={}).status_code == 422
    r = client.post("/api/v1/admin/ops/secrets/openai_api_key/disable", json={"reason": "漏えいの疑い"})
    assert r.status_code == 200 and r.json()["status"] == "disabled" and r.json()["source"] is None
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve(db_session, "openai_api_key")
    assert exc.value.code == "secret_disabled"
    r = client.post("/api/v1/admin/ops/secrets/openai_api_key/disable", json={"reason": "二度目"})
    assert r.status_code == 409
    from app.models.models import AuditLog
    actions = {x.action for x in db_session.query(AuditLog).filter(AuditLog.resource_type == "ops_console")}
    assert {"ops_secret_registered", "ops_secret_disabled"} <= actions  # 鍵の変更と同じ transaction で監査が入る


def test_secret_without_env_is_missing(auth_client, db_session, audits, monkeypatch):
    client, user = auth_client
    _admin(db_session, user)
    monkeypatch.delenv("GOOGLE_PLACES_API_KEY", raising=False)
    slots = {s["slot"]: s for s in client.get("/api/v1/admin/ops/secrets").json()["slots"]}
    assert set(slots) == {"openai_api_key", "google_maps_browser_key", "google_maps_server_key"}
    assert slots["google_maps_server_key"]["status"] == "missing"
    assert slots["google_maps_server_key"]["providers"] == ["google_places", "google_routes"]


def test_key_present_is_not_connected_without_adapter(auth_client, db_session, audits, monkeypatch):
    """[Gate OpsSecrets-Clarity] 鍵・提供元の登録・価格が揃っても、adapter が無ければ送らない(鍵あり≠接続済み)"""
    client, user = auth_client
    _admin(db_session, user)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test-not-a-real-key-123456")
    # .env に本物の値があっても取得元ではない → 鍵なし
    cg.register_provider("openai", ["ai.generate"])
    try:
        before = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
        assert before["openai"]["secret"] == "missing" and before["openai"]["secret_source"] is None
        from app.services import provider_secrets as ps
        ps.register(db_session, "openai_api_key", "sk-cms-registered-secret-ABCD1234", "試験", user.id)
        rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    finally:
        cg.unregister_provider("openai")
    assert rows["openai"]["registered"] is True and rows["openai"]["secret"] == "configured"
    assert rows["openai"]["adapter"] == "not_implemented"
    assert rows["openai"]["live_calls"] == "disabled"
    assert rows["openai"]["secret_storage"] == "アプリの DB(provider_secrets 表・ENCRYPTION_KEY で暗号化)"
    assert rows["openai"]["secret_provider_auth"] == "unverified"
    assert rows["fake"]["adapter"] == "fake"
    assert all(p["adapter"] == "not_implemented" for n, p in rows.items() if n != "fake")
    assert admin_ops.ADAPTERS_IMPLEMENTED == frozenset()


def test_secrets_state_storage_is_app_db_not_secret_manager(auth_client, db_session, audits):
    client, user = auth_client
    _admin(db_session, user)
    body = client.get("/api/v1/admin/ops/secrets").json()
    assert "アプリの DB" in body["storage"]["location"] and "暗号化" in body["storage"]["location"]
    assert "Secret Manager には登録しません" in body["storage"]["not_secret_manager"]
    assert "ENCRYPTION_KEY を失うと復号できない" in body["storage"]["backup"]
    for slot in body["slots"]:
        assert slot["in_use"] is False and "まだこの鍵を使いません" in slot["in_use_note"]


def test_provider_secrets_column_is_covered_by_rekey(db_session):
    """ENCRYPTION_KEY の掛け直し(tcops rekey)が provider_secrets の暗号文も対象にする"""
    from app.ops.decrypt_check import encrypted_columns

    cols = encrypted_columns(db_session.connection())
    assert {"table": "provider_secrets", "column": "secret_ciphertext"} in cols


def test_bundle_secret_check_catches_server_keys(tmp_path):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "scripts" / "ci" / "check_bundle_secrets.py"
    spec = importlib.util.spec_from_file_location("check_bundle_secrets", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "ok.js").write_text("const a = 'hello';")
    assert mod.scan(tmp_path, False) == []
    (tmp_path / "assets" / "bad.js").write_text('const k = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";')
    (tmp_path / "assets" / "x.js.map").write_text("{}")
    (tmp_path / "assets" / "g.js").write_text('k="AIza' + "A" * 35 + '"')
    problems = mod.scan(tmp_path, False)
    assert any("openai_key" in p for p in problems) and any("source map" in p for p in problems)
    assert any("Google の鍵" in p for p in problems)
    assert not any("Google の鍵" in p for p in mod.scan(tmp_path, True))
    assert "sk-proj-abcdefghij" not in " ".join(problems)  # 値は出さない


def test_no_code_sends_to_paid_hosts_without_an_adapter():
    """fail closed: adapter が無い間、アプリのコードに有料の提供元の送り先(host)が無い(cost_guard を通らない送信を作らない)"""
    import re
    from pathlib import Path

    app_dir = Path(__file__).resolve().parents[1] / "app"
    hosts = re.compile(r"api\.openai\.com|places\.googleapis\.com|routes\.googleapis\.com|maps\.googleapis\.com")
    found = [str(p.relative_to(app_dir)) for p in app_dir.rglob("*.py") if hosts.search(p.read_text(encoding="utf-8"))]
    assert found == [], "adapter の Gate の前に有料の送り先がある: %s" % found
