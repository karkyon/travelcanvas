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
    assert rows["openai"]["secret"] == "configured" and rows["openai"]["contract"] == "unverified"
    assert rows["openai"]["live_calls"] == "disabled"  # 登録されていない(契約・Gate が先)
    assert rows["google_places"]["secret"] == "not_defined"
    assert rows["fake"]["kind"] == "fake" and rows["fake"]["live_calls"] == "test_only"
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
