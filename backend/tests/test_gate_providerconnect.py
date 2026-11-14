"""[Gate ProviderConnect] 鍵の候補・有効性の確認・実の adapter(OpenAI・Places・Routes)・業務の明示の操作。

外への通信は httpx.MockTransport で差し替える(実の API は呼ばない。ここでの成功は「提供元が鍵を認めた」証明ではない)。
"""
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest

from app.core.config import settings
from app.models.models import (AuditLog, Entitlement, ProviderSecret, ProviderSecretVerification,
                               ProviderUsageEvent, ProviderUsageReservation, TravelDay, TravelEvent, TravelPlan)
from app.services import cost_guard as cg
from app.services import provider_calls as pc
from app.services import provider_http as ph
from app.services import provider_secrets as ps
from app.services import provider_verification as pv

OPENAI_KEY = "sk-proj-connect-test-AAAA1111"
GOOGLE_KEY = "AIzaSy-connect-test-key-BBBB2222"


class Fake:
    """送り先ごとの応答を決める MockTransport。送った要求を全て記録する。"""

    def __init__(self):
        self.requests = []
        self.routes = {}

    def set(self, host, status=200, body=None, exc=None):
        self.routes[host] = (status, body, exc)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body, exc = self.routes.get(request.url.host, (500, {"error": {}}, None))
        if exc is not None:
            raise exc
        return httpx.Response(status, json=body)


@pytest.fixture()
def net(monkeypatch):
    fake = Fake()
    fake.set("api.openai.com", 200, {"output": [{"type": "message", "content": [
        {"type": "output_text", "text": "1. 有馬温泉(要確認)"}]}], "usage": {"input_tokens": 120, "output_tokens": 300}})
    fake.set("places.googleapis.com", 200, {"places": [{"id": "pid1", "displayName": {"text": "城崎温泉"},
                                                        "formattedAddress": "兵庫県豊岡市", "location": {
                                                            "latitude": 35.62, "longitude": 134.81},
                                                        "googleMapsUri": "https://maps.google.com/?cid=1"}]})
    fake.set("routes.googleapis.com", 200, {"routes": [{"duration": "5400s", "distanceMeters": 152300}]})
    fake.set("maps.googleapis.com", 200, {})  # [Gate Remaining-7] 静的な地図(確認は 200 で通る)
    ph.set_transport(httpx.MockTransport(fake.handler))
    monkeypatch.setattr(pv, "MIN_INTERVAL_SECONDS", 0)
    yield fake
    ph.set_transport(None)


@pytest.fixture()
def admin(auth_client, db_session, monkeypatch):
    client, user = auth_client
    user.user_type = "admin"
    db_session.flush()
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    monkeypatch.setattr(settings, "SECRET_BACKEND", "db_encrypted")
    return client, user


def _plan(db, owner, tier="journey"):
    if tier != "free":
        db.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=owner.id,
                           feature_key=cg.FEATURE_PREFIX + "class." + tier, status="active", source="admin"))
    from app.services import consents
    consents.update(owner, {"ai_processing": True})
    plan = TravelPlan(id=uuid.uuid4(), user_id=owner.id, title="家族旅行")
    db.add(plan)
    db.flush()
    day = TravelDay(id=uuid.uuid4(), plan_id=plan.id, local_date=date(2026, 11, 28), timezone_id="Asia/Tokyo")
    db.add(day)
    db.flush()
    a = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day.id, title="枚方", latitude=34.81, longitude=135.65)
    b = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day.id, title="城崎", latitude=35.62, longitude=134.81)
    c = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=day.id, title="場所なし")
    db.add_all([a, b, c])
    db.flush()
    return plan, a, b, c


def _verify(client, slot, version, reason="確認"):
    return client.post(f"/api/v1/admin/ops/secrets/{slot}/verify", json={"version": version, "reason": reason})


def _ready(client, db_session, user, net):
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    ps.register(db_session, "google_maps_server_key", GOOGLE_KEY, "登録", user.id)
    assert _verify(client, "openai_api_key", 1).json()["provider_auth"] == "accepted"
    assert _verify(client, "google_maps_server_key", 1).json()["provider_auth"] == "accepted"
    net.requests.clear()


# ===================================================================== 分類

@pytest.mark.parametrize("provider,status,body,code", [
    ("openai", 200, {}, "accepted"),
    ("openai", 401, {"error": {"code": "invalid_api_key"}}, "invalid_key"),
    ("openai", 403, {"error": {"type": "permission"}}, "permission_denied"),
    ("openai", 404, {"error": {"code": "model_not_found"}}, "model_not_available"),
    ("openai", 429, {"error": {"code": "insufficient_quota"}}, "insufficient_balance"),
    ("openai", 429, {"error": {"code": "rate_limit_exceeded"}}, "rate_limited"),
    ("openai", 503, None, "provider_unavailable"),
    ("google_places", 400, {"error": {"status": "INVALID_ARGUMENT", "message": "API key not valid. Please pass"}},
     "invalid_key"),
    ("google_places", 403, {"error": {"status": "PERMISSION_DENIED", "details": [{"reason": "SERVICE_DISABLED"}]}},
     "api_not_enabled"),
    ("google_routes", 403, {"error": {"details": [{"reason": "API_KEY_IP_ADDRESS_BLOCKED"}]}}, "source_restricted"),
    ("google_routes", 403, {"error": {"details": [{"reason": "BILLING_DISABLED"}]}}, "billing_required"),
    ("google_routes", 429, {"error": {"status": "RESOURCE_EXHAUSTED"}}, "rate_limited"),
    ("google_places", 302, None, "unexpected_response"),
])
def test_classification_is_fixed_codes(provider, status, body, code):
    assert ph.classify(provider, status, body) == code
    assert ph.auth_of(code) in ("accepted", "rejected", "inconclusive")


def test_only_allowlisted_endpoints_and_no_env_or_redirects():
    with pytest.raises(ValueError):
        ph.post_json("https://evil.example.com/steal", {}, {})
    src = (pc.__file__.replace("provider_calls.py", "provider_http.py"))
    text = open(src, encoding="utf-8").read()
    assert "follow_redirects=False" in text and "trust_env=False" in text and "verify=True" in text


# ===================================================================== 有効性の確認(明示の操作)

def test_nothing_is_sent_on_save_list_or_pages(admin, db_session, net):
    client, user = admin
    assert client.post("/api/v1/admin/ops/secrets/openai_api_key",
                       json={"value": OPENAI_KEY, "reason": "登録"}).status_code == 201
    client.get("/api/v1/admin/ops/secrets")
    client.get("/api/v1/admin/ops/providers")
    client.get("/api/v1/admin/ops/overview")
    pc.register_all()
    assert net.requests == []  # 保存・一覧・画面・起動では外へ送らない
    st = ps.state(db_session, "openai_api_key")
    assert st["status"] == "configured" and st["verification"]["state"] == "unverified"


def test_verify_openai_uses_the_real_endpoint_model_and_records_without_the_key(admin, db_session, net, caplog):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    r = _verify(client, "openai_api_key", 1)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider_auth"] == "accepted" and body["verification"]["state"] == "accepted"
    assert body["verification"]["expires_at"] is not None
    req = net.requests[0]
    assert str(req.url) == "https://api.openai.com/v1/responses"
    assert req.headers["authorization"] == f"Bearer {OPENAI_KEY}"
    sent = json.loads(req.content)
    assert sent["model"] == settings.OPENAI_MODEL and sent["store"] is False and sent["max_output_tokens"] == 16
    assert OPENAI_KEY not in r.text and OPENAI_KEY not in caplog.text
    audit = db_session.query(AuditLog).filter_by(action="ops_secret_verified").one()
    assert OPENAI_KEY not in json.dumps(audit.details, ensure_ascii=False)
    assert Decimal(body["budget"]["used_jpy"]) > 0


def test_google_server_key_checks_places_and_routes_separately(admin, db_session, net):
    client, user = admin
    ps.register(db_session, "google_maps_server_key", GOOGLE_KEY, "登録", user.id)
    net.set("routes.googleapis.com", 403, {"error": {"status": "PERMISSION_DENIED",
                                                     "details": [{"reason": "SERVICE_DISABLED"}]}})
    body = _verify(client, "google_maps_server_key", 1).json()
    assert body["provider_auth"] == "rejected" and body["code"] == "api_not_enabled"
    caps = {r["check"]: r["code"] for r in body["results"]}
    # [Gate Remaining-7] 場所の詳細・写真・静的な地図も操作ごとに確かめる
    assert caps == {"google_places:places.search": "accepted", "google_routes:routes.element": "api_not_enabled",
                    "google_place_details:places.details": "accepted", "google_place_details:places.photo": "accepted",
                    "google_static_maps:map.load": "accepted"}
    hosts = [rq.url.host for rq in net.requests]
    assert hosts == ["places.googleapis.com", "routes.googleapis.com", "places.googleapis.com",
                     "places.googleapis.com", "maps.googleapis.com"]
    assert net.requests[2].method == "GET" and net.requests[2].headers["x-goog-fieldmask"] == "id"
    assert "key=" in str(net.requests[4].url) and "key" not in net.requests[4].headers
    assert net.requests[0].headers["x-goog-fieldmask"] == pc.PLACES_VERIFY_FIELD_MASK
    assert net.requests[1].headers["x-goog-fieldmask"] == pc.ROUTES_FIELD_MASK
    with pytest.raises(ps.SecretUnavailable):
        ps.resolve_for_send(db_session, "google_routes", "routes.element")


def test_timeout_is_inconclusive_and_still_counted(admin, db_session, net):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    net.set("api.openai.com", exc=httpx.ReadTimeout("slow"))
    body = _verify(client, "openai_api_key", 1).json()
    assert body["provider_auth"] == "inconclusive" and body["code"] == "provider_timeout"
    recs = db_session.query(ProviderSecretVerification).all()  # [Remaining-7] AI の案と Web 検索の 2 つ
    assert len(recs) == 2
    assert all(rec.status == "finished" and rec.estimated_cost_jpy > 0 for rec in recs)  # 届いたか分からない確認も数える


def test_daily_ops_budget_and_rate_limit_stop_before_sending(admin, db_session, net, monkeypatch):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    monkeypatch.setattr(settings, "OPS_VERIFY_DAILY_CAP_JPY", 0)
    r = _verify(client, "openai_api_key", 1)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "ops_verify_budget_exceeded"
    assert net.requests == [] and db_session.query(ProviderSecretVerification).count() == 0
    monkeypatch.setattr(settings, "OPS_VERIFY_DAILY_CAP_JPY", 50)
    monkeypatch.setattr(pv, "MIN_INTERVAL_SECONDS", 60)
    assert _verify(client, "openai_api_key", 1).status_code == 200
    r = _verify(client, "openai_api_key", 1)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "verify_too_frequent"
    assert len(net.requests) == 2  # [Remaining-7] AI の案と Web 検索の確認


def test_browser_key_and_unknown_versions_are_not_verified(admin, db_session, net):
    client, user = admin
    ps.register(db_session, "google_maps_browser_key", "AIza-browser-key-CCCC3333", "登録", user.id)
    r = _verify(client, "google_maps_browser_key", 1)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "verify_unsupported"
    r = _verify(client, "openai_api_key", 9)
    assert r.status_code == 409 and net.requests == []


# ===================================================================== 候補 → 確認 → 有効化

def test_candidate_never_breaks_the_working_key_and_needs_verification(admin, db_session, net):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    _verify(client, "openai_api_key", 1)
    r = client.post("/api/v1/admin/ops/secrets/openai_api_key", json={"value": "sk-proj-new-key-DDDD4444",
                                                                      "reason": "入れ替え"})
    assert r.status_code == 201 and r.json()["version"] == 1 and r.json()["candidate"]["version"] == 2
    assert ps.resolve_for_send(db_session, "openai", "ai.generate")[1] == 1  # 動いている鍵はそのまま
    url = "/api/v1/admin/ops/secrets/openai_api_key/activate"
    r = client.post(url, json={"version": 2, "expected_active_version": 1, "reason": "切替"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "candidate_not_verified"
    net.set("api.openai.com", 401, {"error": {"code": "invalid_api_key"}})
    assert _verify(client, "openai_api_key", 2).json()["provider_auth"] == "rejected"
    assert client.post(url, json={"version": 2, "expected_active_version": 1, "reason": "切替"}).status_code == 409
    net.set("api.openai.com", 200, {"output": [], "usage": {}})
    assert _verify(client, "openai_api_key", 2).json()["provider_auth"] == "accepted"
    r = client.post(url, json={"version": 2, "expected_active_version": 7, "reason": "切替"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "secret_conflict"  # 画面を開いた後の変更
    r = client.post(url, json={"version": 2, "expected_active_version": 1, "reason": "切替"})
    assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["candidate"] is None
    statuses = {x.version: x.status for x in db_session.query(ProviderSecret).filter_by(slot="openai_api_key")}
    assert statuses == {1: "superseded", 2: "active"}
    assert db_session.query(AuditLog).filter_by(action="ops_secret_activated").count() == 1


def test_discard_candidate_keeps_active(admin, db_session, net):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    ps.register(db_session, "openai_api_key", "sk-proj-cand-EEEE5555", "候補", user.id)
    r = client.post("/api/v1/admin/ops/secrets/openai_api_key/discard", json={"reason": "誤り"})
    assert r.status_code == 200 and r.json()["candidate"] is None and r.json()["version"] == 1
    assert client.post("/api/v1/admin/ops/secrets/openai_api_key/discard", json={"reason": "x"}).status_code == 409


def test_send_requires_fresh_verification_for_this_configuration(admin, db_session, net, monkeypatch):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve_for_send(db_session, "openai", "ai.generate")
    assert exc.value.code == "secret_unverified"
    _verify(client, "openai_api_key", 1)
    assert ps.resolve_for_send(db_session, "openai", "ai.generate") == (OPENAI_KEY, 1)
    monkeypatch.setattr(settings, "OPENAI_MODEL", "gpt-other-model")
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve_for_send(db_session, "openai", "ai.generate")
    assert exc.value.code == "secret_verification_stale"  # モデルを変えたら確認し直す
    monkeypatch.setattr(settings, "OPENAI_MODEL", "gpt-5-nano")
    row = db_session.query(ProviderSecret).filter_by(slot="openai_api_key", status="active").one()
    row.verify_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.flush()
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve_for_send(db_session, "openai", "ai.generate")
    assert exc.value.code == "secret_verification_expired"
    ps.disable(db_session, "openai_api_key", user.id)
    with pytest.raises(ps.SecretUnavailable) as exc:
        ps.resolve_for_send(db_session, "openai", "ai.generate")
    assert exc.value.code == "secret_disabled"


def test_provider_list_is_ready_only_after_verification(admin, db_session, net):
    client, user = admin
    ps.register(db_session, "openai_api_key", OPENAI_KEY, "登録", user.id)
    rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    assert rows["openai"]["live_calls"] == "disabled" and rows["openai"]["secret_verification"] == "unverified"
    _verify(client, "openai_api_key", 1)
    rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
    assert rows["openai"]["live_calls"] == "ready" and rows["openai"]["adapter"] == "implemented"
    cg.suspend_provider("openai", "試験")
    try:
        rows = {p["name"]: p for p in client.get("/api/v1/admin/ops/providers").json()["providers"]}
        assert rows["openai"]["live_calls"] == "disabled"
    finally:
        cg.resume_provider("openai", "試験")


# ===================================================================== 業務の明示の操作

def _post(client, path, body, key=None):
    return client.post(path, json=body, headers={"Idempotency-Key": key or uuid.uuid4().hex})


def test_ai_suggest_goes_through_tier_budget_and_records_usage(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, *_ = _plan(db_session, user, "journey")
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/ai-suggest", {"prompt": "大人4人・枚方発・車で1泊2日"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["text"].startswith("1. 有馬温泉") and body["saved"] is False and "要確認" in body["notice"]
    assert OPENAI_KEY not in r.text
    ev = db_session.query(ProviderUsageEvent).filter_by(plan_id=plan.id, provider="openai").one()
    assert ev.input_tokens == 120 and ev.output_tokens == 300 and ev.result_code == "ok"
    assert len(net.requests) == 1
    assert json.loads(net.requests[0].content)["max_output_tokens"] == pc.AI_MAX_OUTPUT_TOKENS


@pytest.mark.parametrize("tier,operation,path,body", [
    ("free", "ai.generate", "ai-suggest", {"prompt": "案"}),
    ("trip", "ai.generate", "ai-suggest", {"prompt": "案"}),
    ("free", "places.search", "places-search", {"query": "温泉"}),
])
def test_class_denial_sends_nothing(admin, db_session, net, tier, operation, path, body):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, *_ = _plan(db_session, user, tier)
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/{path}", body)
    assert r.status_code in (402, 403, 429), r.text
    assert net.requests == []  # 管理者でもクラスを迂回しない
    assert db_session.query(ProviderUsageEvent).filter_by(plan_id=plan.id).count() == 0


def test_idempotent_replay_does_not_send_twice(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, *_ = _plan(db_session, user, "journey")
    key = uuid.uuid4().hex
    assert _post(client, f"/api/v1/plans/{plan.id}/paid/places-search", {"query": "温泉"}, key).status_code == 200
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/places-search", {"query": "温泉"}, key)
    assert r.status_code == 409 and len(net.requests) == 1


def test_rejected_key_at_send_stops_the_next_send(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, *_ = _plan(db_session, user, "journey")
    net.set("api.openai.com", 401, {"error": {"code": "invalid_api_key"}})
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/ai-suggest", {"prompt": "案"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_rejected"
    res = db_session.query(ProviderUsageReservation).filter_by(plan_id=plan.id).one()
    assert res.status == "released"
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/ai-suggest", {"prompt": "案"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_not_ready"
    assert len(net.requests) == 1  # 断られた後は送らない


def test_timeout_at_send_is_counted_not_released(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, a, b, _c = _plan(db_session, user, "trip")
    net.set("routes.googleapis.com", exc=httpx.ReadTimeout("slow"))
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/route",
              {"from_event_id": str(a.id), "to_event_id": str(b.id), "mode": "driving"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_timeout"
    res = db_session.query(ProviderUsageReservation).filter_by(plan_id=plan.id).one()
    assert res.status == "settled"  # 課金されていないと決め付けない


def test_places_and_route_results_are_not_saved_and_attributed(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, a, b, c = _plan(db_session, user, "trip")
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/places-search",
              {"query": "温泉", "latitude": 34.8, "longitude": 135.6})
    assert r.status_code == 200 and r.json()["attribution"] == "Google" and r.json()["saved"] is False
    assert r.json()["results"][0]["name"] == "城崎温泉"
    sent = json.loads(net.requests[-1].content)
    assert net.requests[-1].headers["x-goog-fieldmask"] == pc.PLACES_FIELD_MASK and sent["pageSize"] == 5
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/route",
              {"from_event_id": str(a.id), "to_event_id": str(b.id), "mode": "driving"})
    assert r.status_code == 200 and r.json()["result"] == {"duration_minutes": 90.0, "distance_km": 152.3}
    before = len(net.requests)
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/route",
              {"from_event_id": str(a.id), "to_event_id": str(c.id), "mode": "driving"})
    assert r.status_code == 422 and len(net.requests) == before  # 場所の無い予定は送らない
    assert db_session.query(TravelEvent).filter_by(plan_id=plan.id).count() == 3


def test_viewer_and_missing_key_are_refused(admin, db_session, net, make_user):
    client, user = admin
    _ready(client, db_session, user, net)
    other, _pw = make_user()
    plan, *_ = _plan(db_session, other, "journey")
    r = _post(client, f"/api/v1/plans/{plan.id}/paid/ai-suggest", {"prompt": "案"})
    assert r.status_code in (403, 404) and net.requests == []
    mine, *_ = _plan(db_session, user, "journey")
    r = client.post(f"/api/v1/plans/{mine.id}/paid/ai-suggest", json={"prompt": "案"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "idempotency_key_required"


# ===================================================================== [Gate Remaining-7] FR-059 詳細・写真・地図・Web 検索

def test_place_details_photo_static_map_and_web_search(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, a, b, c = _plan(db_session, user, tier="explorer")
    db_session.commit()
    net.set("places.googleapis.com", 200, {
        "id": "ChIJabcdefghijk", "displayName": {"text": "城崎温泉"}, "formattedAddress": "兵庫県豊岡市",
        "location": {"latitude": 35.62, "longitude": 134.81}, "businessStatus": "CLOSED_TEMPORARILY",
        "regularOpeningHours": {"weekdayDescriptions": ["月曜日: 7時00分～23時00分"]},
        "photos": [{"name": "places/ChIJabcdefghijk/photos/AbCdEfGhIjKlMn",
                    "authorAttributions": [{"displayName": "投稿者"}]}],
        "photoUri": "https://lh3.googleusercontent.com/p/abc"})
    net.set("lh3.googleusercontent.com", 200, {})
    base = f"/api/v1/plans/{plan.id}/paid"
    r = _post(client, f"{base}/place-details", {"place_id": "ChIJabcdefghijk"})
    assert r.status_code == 200, r.text
    d = r.json()["result"]
    assert d["business_status"] == "CLOSED_TEMPORARILY" and d["opening_hours"] == ["月曜日: 7時00分～23時00分"]
    assert d["photos"][0]["attributions"] == ["投稿者"]
    assert net.requests[-1].method == "GET" and net.requests[-1].headers["x-goog-fieldmask"] == pc.DETAILS_FIELD_MASK

    # 写真: 名前の形が違えば送らない。正しければ URL を得て画像を取る(鍵は画像の取得へ送らない)
    n = len(net.requests)
    bad = _post(client, f"{base}/place-photo", {"photo_name": "../../etc/passwd"})
    assert bad.status_code == 422 and len(net.requests) == n
    p = _post(client, f"{base}/place-photo", {"photo_name": "places/ChIJabcdefghijk/photos/AbCdEfGhIjKlMn"})
    assert p.status_code == 200, p.text
    assert net.requests[-1].url.host == "lh3.googleusercontent.com" and "x-goog-api-key" not in net.requests[-1].headers
    assert "skipHttpRedirect=true" in str(net.requests[-2].url)

    # 静的な地図: 場所のある予定だけ。鍵は URL の key で送る
    m = _post(client, f"{base}/static-map", {"event_ids": [str(a.id), str(b.id), str(c.id)]})
    assert m.status_code == 200, m.text
    assert net.requests[-1].url.host == "maps.googleapis.com" and "path=" in str(net.requests[-1].url)
    none = _post(client, f"{base}/static-map", {"event_ids": [str(c.id)]})
    assert none.status_code == 422 and none.json()["detail"]["code"] == "event_without_location"

    # AI の Web 検索: tools に web_search を付け、出典(url_citation)を返す
    net.set("api.openai.com", 200, {"output": [{"type": "message", "content": [
        {"type": "output_text", "text": "城崎温泉は兵庫県にあります",
         "annotations": [{"type": "url_citation", "url": "https://example.jp/kinosaki", "title": "城崎"},
                         {"type": "url_citation", "url": "http://insecure.example/", "title": "x"}]}]}],
        "usage": {"input_tokens": 3000, "output_tokens": 100}})
    w = _post(client, f"{base}/ai-web-search", {"prompt": "城崎温泉の場所"})
    assert w.status_code == 200, w.text
    assert w.json()["result"]["sources"] == [{"url": "https://example.jp/kinosaki", "title": "城崎"}]
    sent = json.loads(net.requests[-1].content)
    assert sent["tools"][0]["type"] == "web_search" and sent["store"] is False


def test_web_search_is_explorer_only_and_details_need_valid_id(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    plan, a, b, c = _plan(db_session, user, tier="journey")
    db_session.commit()
    base = f"/api/v1/plans/{plan.id}/paid"
    r = _post(client, f"{base}/ai-web-search", {"prompt": "調べて"})
    assert r.status_code == 403 and net.requests == []
    assert _post(client, f"{base}/place-details", {"place_id": "a/b"}).status_code == 422
    assert net.requests == []


def test_photo_fetch_only_from_google_photo_host():
    with pytest.raises(ValueError):
        ph.fetch_photo("https://evil.example.com/x.jpg")
    with pytest.raises(ValueError):
        ph.fetch_photo("http://lh3.googleusercontent.com/x")
