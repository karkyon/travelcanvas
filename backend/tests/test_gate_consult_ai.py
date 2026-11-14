"""[Gate ConsultAI] 旅行相談の AI の読み取り・方面の案・場所の検索・経路(相談の口座)。

外への通信は httpx.MockTransport(実の API は呼ばない。ここでの成功は「提供元が鍵を認めた」証明ではない)。
"""
import json
import uuid
from decimal import Decimal

import httpx
import pytest

from app.core.config import settings
from app.models.models import (Entitlement, ProviderUsageEvent, ProviderUsageReservation, TravelPlan,
                               TripConsultSession, UsageBudgetAccount)
from app.services import consents
from app.services import consult_ai
from app.services import cost_guard as cg
from app.services import provider_http as ph
from app.services import provider_stub
from tests.test_gate_providerconnect import OPENAI_KEY, Fake, _ready  # noqa: F401  (fixture の部品)

TEXT = "家族4人で1泊2日。枚方から車で片道3時間くらいまで。予算は6〜8万円。11月28日に出発。伊勢や福井などが候補。"


def _ai_body(data, usage=(900, 250), status="completed"):
    return {"status": status, "output": [{"type": "message", "content": [
        {"type": "output_text", "text": data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)}]}],
        "usage": {"input_tokens": usage[0], "output_tokens": usage[1]}}


GOOD = {
    "origin": {"value": "大阪府枚方市", "evidence": "枚方から"},
    "party_size": {"value": 4, "evidence": "家族4人"},
    "nights": {"value": 1, "evidence": "1泊2日"},
    "transport": {"mode": "car", "highway": None, "evidence": "車で"},
    "one_way_hours": {"value": 3, "evidence": "片道3時間くらい"},
    "room": {"value": None, "evidence": None},
    "budget": {"min_yen": 60000, "max_yen": 80000, "scope": "total", "evidence": "予算は6〜8万円"},
    "dates": {"status": "fixed", "text": "11月28日", "evidence": "11月28日に出発"},
    "preferences": ["onsen", "not_a_key"],
    "areas_mentioned": ["伊勢", "福井", "架空の町"],
    "areas_suggested": [{"name": "城崎温泉", "reason": "車で行ける温泉地"}, {"name": "伊勢", "reason": "重複"}],
    "unknowns": ["宿の種類"],
}


@pytest.fixture()
def net(monkeypatch):
    fake = Fake()
    fake.set("api.openai.com", 200, _ai_body(GOOD))
    fake.set("places.googleapis.com", 200, {"places": [{"id": "pid1", "displayName": {"text": "城崎温泉"},
                                                        "formattedAddress": "兵庫県豊岡市",
                                                        "location": {"latitude": 35.62, "longitude": 134.81},
                                                        "googleMapsUri": "https://maps.google.com/?cid=1"}]})
    fake.set("routes.googleapis.com", 200, {"routes": [{"duration": "9000s", "distanceMeters": 180000}]})
    fake.set("maps.googleapis.com", 200, {})  # [Gate Remaining-7] 静的な地図の確認
    ph.set_transport(httpx.MockTransport(fake.handler))
    from app.services import provider_calls as pc
    pc.register_all()  # 他の試験が登録を外していても、実装済みの adapter を登録した状態で始める
    from app.services import provider_verification as pv
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


def _tier(db, user, tier="journey", consent=True):
    if tier != "free":
        db.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=user.id,
                           feature_key=cg.FEATURE_PREFIX + "class." + tier, status="active", source="admin"))
    consents.update(user, {"ai_processing": consent})
    db.flush()


def _session(client):
    r = client.post("/api/v1/trip-intents/ai/session")
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def _extract(client, sid, text=TEXT, key=None, **fields):
    return client.post("/api/v1/trip-intents/ai/extract", json={"session_id": sid, "text": text, **fields},
                       headers={"Idempotency-Key": key or uuid.uuid4().hex})


# ===================================================================== 送らない(断る)

def test_no_consent_sends_nothing(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user, consent=False)
    r = _extract(client, _session(client))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"
    assert net.requests == [] and db_session.query(ProviderUsageReservation).count() == 0


def test_free_class_and_unverified_key_send_nothing(admin, db_session, net):
    client, user = admin
    _tier(db_session, user, "journey")
    sid = _session(client)
    r = _extract(client, sid)  # 鍵が無い・確認していない
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_not_ready"
    assert net.requests == []
    status = client.get(f"/api/v1/trip-intents/ai/status?session_id={sid}").json()
    assert status["operations"]["ai.generate"]["ready"] is False and status["consent"]["ai_processing"] is True
    assert status["stub"] is False

    db_session.query(Entitlement).filter(Entitlement.subject_id == user.id).delete()
    db_session.flush()
    _ready(client, db_session, user, net)
    r = _extract(client, sid)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "tier_feature_not_included"
    assert net.requests == []


def test_idempotency_and_session_ownership(admin, db_session, net, make_user):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    sid = _session(client)
    r = client.post("/api/v1/trip-intents/ai/extract", json={"session_id": sid, "text": TEXT})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "idempotency_key_required"
    other, _pw = make_user()
    foreign = TripConsultSession(id=uuid.uuid4(), user_id=other.id, expires_at=cg._now() + cg.timedelta(days=1))
    db_session.add(foreign)
    db_session.flush()
    r = _extract(client, str(foreign.id))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "consult_not_found"
    assert net.requests == []
    assert _extract(client, sid, key="same-key").status_code == 200
    again = _extract(client, sid, key="same-key")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "idempotent_replay"
    assert len(net.requests) == 1


# ===================================================================== 送る(成功)

def test_ai_extract_marks_ai_rows_unconfirmed_and_records_without_text(admin, db_session, net, caplog, monkeypatch):
    from app.api.v1 import trip_intents
    audits = []
    monkeypatch.setattr(trip_intents, "record_audit_event", lambda **kw: audits.append(kw))
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    sid = _session(client)
    r = _extract(client, sid, party_size=4)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["extractor"] == "openai_responses" and body["ai_connected"] is True and body["saved"] is False
    items = {i["key"]: i for i in body["items"]}
    assert items["party_size"]["source"] == "user_input"  # あなたの入力が優先
    assert items["origin"]["source"] == "ai" and items["origin"]["value"] == "大阪府枚方市"
    assert items["origin"]["evidence"] == "枚方から" and items["origin"]["strength"] == "undecided"
    assert items["nights"]["value"] == 1 and items["transport"]["value"]["mode"] == "car"
    assert items["budget"]["source"] == "ai" and items["budget"]["value"]["min"] == 60000
    assert items["budget"]["question"]["suggested"] == "total"  # 範囲は利用者が選ぶ(AI の推定は提案だけ)
    assert items["one_way"]["question"]["id"] == "one_way_strength"
    assert items["preferences"]["value"] == ["onsen"]  # 知らない値は捨てる
    names = [a["name"] for a in body["areas"]]
    assert names == ["伊勢", "福井"]  # 文章に無い「架空の町」は方面にしない
    assert body["suggested_areas"] == [{"name": "城崎温泉", "reason": "車で行ける温泉地", "source": "ai_suggested"}]
    assert body["usage"]["scope"] == "consult" and Decimal(body["usage"]["plan_used"]) > 0
    assert OPENAI_KEY not in r.text
    sent = json.loads(net.requests[0].content)
    assert sent["text"]["format"]["type"] == "json_schema" and sent["text"]["format"]["strict"] is True
    assert sent["store"] is False and "家族4人" in sent["input"]
    assert sent["reasoning"] == {"effort": "minimal"}
    ev = db_session.query(ProviderUsageEvent).filter_by(provider="openai").one()
    assert ev.plan_id is None and ev.input_tokens == 900 and ev.result_code == "ok"
    audit = next(a for a in audits if a["action"] == "trip_consult.ai_extract")
    dumped = json.dumps(audit["details"], ensure_ascii=False)
    assert "枚方" not in dumped and "伊勢" not in dumped
    assert "家族4人" not in caplog.text and OPENAI_KEY not in caplog.text


def test_evidence_not_in_text_is_dropped_and_values_out_of_range_are_ignored():
    data = dict(GOOD)
    data["origin"] = {"value": "京都市", "evidence": "京都から出発"}  # 文章に無い根拠
    data["party_size"] = {"value": 99, "evidence": "家族4人"}  # 範囲の外
    out = consult_ai.merge(TEXT, {}, data)
    items = {i["key"]: i for i in out["items"]}
    assert items["origin"]["source"] == "ai" and items["origin"]["evidence"] is None
    assert items["party_size"]["source"] == "text"  # AI の値は捨て、規則の読み取り(未確認)のまま


@pytest.mark.parametrize("body", [
    _ai_body("{not json"), _ai_body(GOOD, status="incomplete"),
    {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "no"}]}],
     "usage": {"input_tokens": 10, "output_tokens": 5}},
])
def test_unreadable_output_is_counted_and_reported(admin, db_session, net, body):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    net.set("api.openai.com", 200, body)
    r = _extract(client, _session(client))
    assert r.status_code == 502 and r.json()["detail"]["code"] == "ai_output_invalid"
    ev = db_session.query(ProviderUsageEvent).filter_by(provider="openai").one()
    assert ev.result_code == "malformed"
    assert db_session.query(ProviderUsageReservation).one().status == "settled"


def test_timeout_and_5xx(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    sid = _session(client)
    net.set("api.openai.com", exc=httpx.ReadTimeout("t"))
    r = _extract(client, sid)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_timeout"
    assert db_session.query(ProviderUsageReservation).one().status == "settled"  # 届いた可能性(見込みで数える)
    net.set("api.openai.com", 503, None)
    r = _extract(client, sid)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "provider_unavailable"
    assert db_session.query(ProviderUsageReservation).filter_by(status="released").count() == 1


def test_ai_call_quota_and_cap_are_enforced_per_consult(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user, "journey")  # [Gate F07-4] AI 10回 / 相談(価格の版 2026-11-02.1)
    sid = _session(client)
    for _ in range(10):
        assert _extract(client, sid).status_code == 200
    r = _extract(client, sid)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "feature_quota_exceeded"
    assert len(net.requests) == 10
    acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="consult").one()
    assert Decimal(acc.settled_jpy) <= Decimal(acc.cap_jpy) == Decimal(50)


def test_places_route_then_draft_moves_usage_and_closes_consult(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    sid = _session(client)
    assert _extract(client, sid).status_code == 200
    r = client.post("/api/v1/trip-intents/ai/places-search",
                    json={"session_id": sid, "query": "温泉", "latitude": 35.6, "longitude": 134.8},
                    headers={"Idempotency-Key": uuid.uuid4().hex})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["name"] == "城崎温泉" and r.json()["attribution"] == "Google"
    r = client.post("/api/v1/trip-intents/ai/route",
                    json={"session_id": sid, "origin_latitude": 34.81, "origin_longitude": 135.65,
                          "dest_latitude": 35.62, "dest_longitude": 134.81, "mode": "driving"},
                    headers={"Idempotency-Key": uuid.uuid4().hex})
    assert r.status_code == 200 and r.json()["result"] == {"duration_minutes": 150.0, "distance_km": 180.0}
    used = Decimal(r.json()["usage"]["plan_used"])
    r = client.post("/api/v1/trip-intents/ai/route", json={"session_id": sid, "origin_latitude": 999,
                                                           "origin_longitude": 1, "dest_latitude": 1,
                                                           "dest_longitude": 1},
                    headers={"Idempotency-Key": uuid.uuid4().hex})
    assert r.status_code == 422 and len(net.requests) == 3
    d = client.post("/api/v1/trip-intents/draft", json={
        "area": {"name": "城崎温泉"}, "intent": {"nights": 1}, "consult_session_id": sid})
    assert d.status_code == 201, d.text
    plan_id = uuid.UUID(d.json()["plan_id"])
    plan_acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="plan", scope_id=plan_id).one()
    assert Decimal(plan_acc.settled_jpy) == used
    assert plan_acc.counts.get("ai_calls_per_plan") == 1 and plan_acc.counted_month
    assert db_session.query(ProviderUsageEvent).filter(ProviderUsageEvent.plan_id == plan_id).count() == 3
    assert db_session.get(TravelPlan, plan_id) is not None
    r = _extract(client, sid)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "consult_closed"
    assert len(net.requests) == 3
    # 閉じた相談・他の人の相談の ID を付けても下書きは作れる(使った額は二度移さない)
    d2 = client.post("/api/v1/trip-intents/draft", json={
        "area": {"name": "伊勢"}, "intent": {"nights": 0}, "consult_session_id": sid})
    assert d2.status_code == 201
    acc2 = db_session.query(UsageBudgetAccount).filter_by(scope_type="plan",
                                                          scope_id=uuid.UUID(d2.json()["plan_id"])).first()
    assert acc2 is None


def test_stub_answers_are_deterministic_and_refused_in_production(monkeypatch):
    req = httpx.Request("POST", "https://api.openai.com/v1/responses", json={
        "input": consult_ai.input_text(TEXT, {}), "text": {"format": consult_ai.TEXT_FORMAT}})
    data = consult_ai.parse_output(provider_stub.handler(req).json())
    assert data is not None and data["party_size"]["value"] == 4 and data["areas_suggested"]
    out = consult_ai.merge(TEXT, {}, data)
    assert any(i["source"] == "ai" for i in out["items"])
    monkeypatch.setattr(settings, "PROVIDER_HTTP_STUB", True)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with pytest.raises(RuntimeError):
        provider_stub.install()
    monkeypatch.setattr(settings, "PROVIDER_HTTP_STUB", False)
    assert provider_stub.install() is False


# ===================================================================== [監査 A02/A03] 二重送信・usage 不明

def _committed_consult(tier="journey"):
    """実の PostgreSQL へ commit した会員・相談(並行の試験は別々の接続を使うため、試験の transaction の外に置く)。"""
    from app.core.database import SessionLocal
    from app.api.v1.auth import hash_password  # noqa: E402
    from app.models.models import User, UserType
    s = SessionLocal()
    user = User(id=uuid.uuid4(), email=f"cc_{uuid.uuid4().hex[:10]}@example.com",
                username=f"cc_{uuid.uuid4().hex[:10]}",
                hashed_password=hash_password("TestPass123!"), user_type=UserType.REGISTERED, is_active=True,
                is_verified=True)
    s.add(user)
    s.flush()
    s.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=user.id,
                      feature_key=cg.FEATURE_PREFIX + "class." + tier, status="active", source="admin"))
    sess = TripConsultSession(id=uuid.uuid4(), user_id=user.id, expires_at=cg._now() + cg.timedelta(days=1))
    s.add(sess)
    s.commit()
    ids = (user.id, sess.id)
    s.close()
    return ids


def _cleanup(user_id, consult_id):
    from sqlalchemy import text as _t
    from app.core.database import engine
    with engine.begin() as conn:
        conn.execute(_t("DELETE FROM provider_usage_events WHERE user_id = :u"), {"u": user_id})
        conn.execute(_t("DELETE FROM provider_usage_reservations WHERE user_id = :u"), {"u": user_id})
        conn.execute(_t("DELETE FROM usage_budget_accounts WHERE scope_id IN (:u, :c)"),
                     {"u": user_id, "c": consult_id})
        conn.execute(_t("DELETE FROM entitlements WHERE subject_id = :u"), {"u": user_id})
        conn.execute(_t("DELETE FROM users WHERE id = :u"), {"u": user_id})


def test_concurrent_same_key_sends_once_on_real_postgres():
    """同じ Idempotency-Key の2つの要求を、別々の DB 接続で同時に送る → 外部送信 1回・予約 1件・確定 1回。"""
    import threading
    import time
    from app.core.database import SessionLocal
    from app.models.models import User

    cg.register_provider("fake_concurrency", ["ai.generate"])
    user_id, consult_id = _committed_consult()
    sent = []
    barrier = threading.Barrier(2)
    outcomes = []

    def call(units):
        sent.append(1)
        time.sleep(0.5)  # 1つ目が送っている間に2つ目が来る
        return cg.ProviderResult(units={"input_tokens": 100, "output_tokens": 50})

    def worker():
        db = SessionLocal()
        try:
            caller = db.get(User, user_id)
            barrier.wait()
            cg.run(db, None, caller, "ai.generate", "fake_concurrency", {"input_tokens": 500, "output_tokens": 200},
                   "same-key-concurrent", call, consult_id=consult_id, fingerprint="fp-1")
            outcomes.append("ok")
        except cg.CostGuardError as error:
            outcomes.append(error.code)
        finally:
            db.close()
    try:
        threads = [threading.Thread(target=worker) for _ in range(2)]
        [t.start() for t in threads]
        [t.join(30) for t in threads]
        assert len(sent) == 1, outcomes
        assert sorted(outcomes) == ["ok", "request_in_progress"] or sorted(outcomes) == ["idempotent_replay", "ok"]
        db = SessionLocal()
        rows = db.query(ProviderUsageReservation).filter_by(user_id=user_id).all()
        assert len(rows) == 1 and rows[0].status == "settled" and rows[0].sent_at is not None
        assert db.query(ProviderUsageEvent).filter_by(user_id=user_id).count() == 1
        acc = db.query(UsageBudgetAccount).filter_by(scope_type="consult", scope_id=consult_id).one()
        assert acc.counts.get("ai_calls_per_plan") == 1 and Decimal(acc.reserved_jpy) == 0
        db.close()
        # 同じキーで違う内容 → 衝突(送らない)
        db = SessionLocal()
        try:
            cg.run(db, None, db.get(User, user_id), "ai.generate", "fake_concurrency",
                   {"input_tokens": 500, "output_tokens": 200}, "same-key-concurrent", call, consult_id=consult_id,
                   fingerprint="fp-other")
            raise AssertionError("衝突にならなかった")
        except cg.CostGuardError as error:
            assert error.code == "idempotency_conflict"
        finally:
            db.close()
        assert len(sent) == 1
    finally:
        cg.unregister_provider("fake_concurrency")
        _cleanup(user_id, consult_id)


@pytest.mark.parametrize("usage", [None, {}, {"input_tokens": -1, "output_tokens": 5},
                                   {"input_tokens": "10", "output_tokens": 5}])
def test_unknown_usage_is_settled_at_the_reserved_amount(admin, db_session, net, usage):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    body = _ai_body(GOOD)
    if usage is None:
        body.pop("usage")
    else:
        body["usage"] = usage
    net.set("api.openai.com", 200, body)
    r = _extract(client, _session(client))
    assert r.status_code == 200, r.text
    row = db_session.query(ProviderUsageReservation).one()
    ev = db_session.query(ProviderUsageEvent).filter_by(provider="openai").one()
    assert ev.result_code == "usage_unknown"
    assert ev.input_tokens == row.units["input_tokens"] and ev.output_tokens == row.units["output_tokens"]
    assert Decimal(ev.estimated_cost_jpy) == Decimal(row.max_cost_jpy)  # 0 円にしない


def test_local_error_after_send_is_not_released(admin, db_session, net, monkeypatch):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)

    def boom(_body):
        raise RuntimeError("parse bug")
    monkeypatch.setattr(consult_ai, "parse_output", boom)
    with pytest.raises(RuntimeError):
        _extract(client, _session(client))
    row = db_session.query(ProviderUsageReservation).one()
    assert row.status == "settled"
    assert db_session.query(ProviderUsageEvent).filter_by(provider="openai").one().result_code == "local_error"


def test_budget_meaning_and_other_wishes_are_kept():
    """[監査 A07/A08] 旅行全体の額を宿泊費にしない・分類できない希望(その他)を捨てない"""
    from app.services import trip_intent as ti
    rule = {i["key"]: i for i in ti.extract("大人4人。予算は旅行全体で8万円。", {})["items"]}
    assert rule["budget"]["label"] == "予算" and rule["budget"]["value"]["target"] == "trip_total"
    data = dict(GOOD)
    data["budget"] = {"min_yen": 80000, "max_yen": 80000, "scope": None, "target": "trip_total",
                      "period": "whole_trip", "kind": "cap", "evidence": None}
    data["other_wishes"] = ["何もしない時間もほしい", "地元の市場", "何もしない時間もほしい"]
    out = consult_ai.merge("大阪から家族でゆっくり。温泉と地元の市場。何もしない時間もほしい。予算は旅行全体で8万円。", {}, data)
    budget = next(i for i in out["items"] if i["key"] == "budget")
    assert budget["value"]["target"] == "trip_total" and budget["value"]["kind"] == "cap"
    assert out["notes"] == ["何もしない時間もほしい", "地元の市場"]


def test_draft_keeps_budget_meaning_and_notes(auth_client, db_session):
    client, _user = auth_client
    r = client.post("/api/v1/trip-intents/draft", json={"area": {"name": "城崎温泉"}, "intent": {
        "nights": 1, "budget_min": 80000, "budget_max": 80000, "budget_scope": "total", "budget_target": "trip_total",
        "budget_period": "whole_trip", "budget_kind": "cap", "notes": ["何もしない時間", " 何もしない時間 ", "市場"]}})
    assert r.status_code == 201, r.text
    d = client.get(f"/api/v1/plans/{r.json()['plan_id']}/trip-intent").json()
    assert d["intent"]["budget_target"] == "trip_total" and d["intent"]["notes"] == ["何もしない時間", "市場"]
    bad = client.post("/api/v1/trip-intents/draft", json={"area": {"name": "城崎"}, "intent": {
        "nights": 1, "budget_target": "hotel"}})
    assert bad.status_code == 422


def test_contradictions_are_returned_not_resolved():
    """[Gate AdminUAT U05] 食い違う希望は片方に決めず、確かめてほしいこととして返す(重複・長すぎ・型違いは捨てる)"""
    assert "contradictions" in consult_ai.SCHEMA["required"]
    assert "片方に決めず" in consult_ai.INSTRUCTIONS
    data = dict(GOOD)
    data["nights"] = {"value": None, "evidence": None}
    data["contradictions"] = ["日帰りと1泊が食い違っています。どちらですか", "日帰りと1泊が食い違っています。どちらですか", 3]
    out = consult_ai.merge("日帰りがいい。でも1泊したい。", {}, data)
    assert out["contradictions"] == ["日帰りと1泊が食い違っています。どちらですか"]
    nights = next(i for i in out["items"] if i["key"] == "nights")
    assert nights["value"] in (None, 0) or nights["source"] != "ai"
    assert consult_ai.merge(TEXT, {}, dict(GOOD))["contradictions"] == []


def test_stub_reports_contradiction_for_day_trip_and_overnight():
    ans = provider_stub._ai_answer("【相談の文章】\n日帰りか1泊かは迷っています")
    assert ans["contradictions"] and "食い違" in ans["contradictions"][0]
    assert provider_stub._ai_answer("【相談の文章】\n1泊2日")["contradictions"] == []


def test_places_resend_after_lost_response_sends_once_and_uses_radius(admin, db_session, net):
    """[Gate SearchUAT F03/F04] 応答を受け取れなかった後に同じ Idempotency-Key で送り直しても、Google へは1回だけ・
    確定は1回(済んだ要求として断る)。画面の検索範囲は locationBias の半径として送る"""
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    sid = _session(client)
    key = uuid.uuid4().hex
    body = {"session_id": sid, "query": "伊勢 食べ物", "latitude": 34.4875, "longitude": 136.7091, "radius_km": 5}
    first = client.post("/api/v1/trip-intents/ai/places-search", json=body, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.text  # 画面には届かなかった(通信が切れた)と考える
    sent = [r for r in net.requests if r.url.host == "places.googleapis.com"]
    assert len(sent) == 1
    bias = json.loads(sent[0].content)["locationBias"]["circle"]
    assert bias["radius"] == 5000.0 and bias["center"] == {"latitude": 34.4875, "longitude": 136.7091}
    again = client.post("/api/v1/trip-intents/ai/places-search", json=body, headers={"Idempotency-Key": key})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "idempotent_replay"
    assert len([r for r in net.requests if r.url.host == "places.googleapis.com"]) == 1
    rows = db_session.query(ProviderUsageReservation).filter(
        ProviderUsageReservation.provider == "google_places").all()
    assert len(rows) == 1 and rows[0].status == "settled"
    # 違う範囲は違う要求(同じキーでは使えない)
    other = client.post("/api/v1/trip-intents/ai/places-search", json={**body, "radius_km": 10},
                        headers={"Idempotency-Key": key})
    assert other.status_code == 409 and other.json()["detail"]["code"] == "idempotency_conflict"
    bad = client.post("/api/v1/trip-intents/ai/places-search", json={**body, "radius_km": 99},
                      headers={"Idempotency-Key": uuid.uuid4().hex})
    assert bad.status_code == 422


# ============================================================ [Gate AreaSpots / AreaAI3]

def _fake_resolve(monkeypatch, seen):
    from app.services import spot_resolver
    from datetime import datetime, timezone

    async def fake(spots, lat, lng, pref=None, client=None):
        seen.append([s["name"] for s in spots])
        return [{"provider": "wikipedia", "external_id": "geo/1", "name": "伊勢神宮", "category": "shrine_temple",
                 "latitude": 34.455, "longitude": 136.725, "address": None,
                 "raw_payload": {"pageid": 1, "_tc": {
                     "kind": "shrine_temple", "thumbnail_url": None, "description": "神社", "ai_note": "内宮",
                     "ai_why": "歴史", "length": 150000}},
                 "source_url": "https://ja.wikipedia.org/?curid=1", "retrieved_at": datetime.now(timezone.utc)}]
    monkeypatch.setattr(spot_resolver, "resolve", fake)


def test_spots_resolve_is_free_and_returns_candidates(admin, db_session, net, monkeypatch):
    client, _ = admin
    seen = []
    _fake_resolve(monkeypatch, seen)
    r = client.post("/api/v1/trip-intents/spots/resolve", json={
        "area": "伊勢", "pref": "三重県", "latitude": 34.4875, "longitude": 136.7091,
        "spots": [{"name": "伊勢神宮", "kind": "shrine_temple", "note": "内宮と外宮"}]})
    assert r.status_code == 200, r.text
    c = r.json()["candidates"][0]
    assert c["name"] == "伊勢神宮" and c["kind"] == "shrine_temple" and c["ai_note"] == "内宮" and c["popularity"] == 150000
    assert c["distance_m"] > 3000 and uuid.UUID(c["id"]) and not net.requests and seen == [["伊勢神宮"]]
    assert client.post("/api/v1/trip-intents/spots/resolve", json={
        "area": "伊勢", "latitude": 34.4, "longitude": 136.7, "spots": []}).status_code == 422


def test_ai_spots_needs_consent_and_uses_one_ai_call(admin, db_session, net, monkeypatch):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    seen = []
    _fake_resolve(monkeypatch, seen)
    net.set("api.openai.com", 200, _ai_body({"spots": [
        {"name": "伊勢神宮", "kind": "shrine_temple", "note": "内宮と外宮", "why": "歴史"},
        {"name": "おかげ横丁", "kind": "bad_kind", "note": "食べ歩き", "why": "食"}]}))
    sid = _session(client)
    r = client.post("/api/v1/trip-intents/ai/spots", json={
        "session_id": sid, "area": "伊勢", "pref": "三重県", "latitude": 34.4875, "longitude": 136.7091,
        "preferences": ["culture"], "nights": 1, "party_size": 4}, headers={"Idempotency-Key": uuid.uuid4().hex})
    assert r.status_code == 200, r.text
    assert r.json()["suggested"] == 2 and r.json()["candidates"][0]["name"] == "伊勢神宮"
    assert seen == [["伊勢神宮", "おかげ横丁"]]
    sent = [q for q in net.requests if q.url.host == "api.openai.com"]
    assert len(sent) == 1 and "伊勢" in sent[0].content.decode() and "歴史・文化" in sent[0].content.decode()
    _tier(db_session, user, consent=False)
    r = client.post("/api/v1/trip-intents/ai/spots", json={
        "session_id": sid, "area": "伊勢", "latitude": 34.4, "longitude": 136.7}, headers={"Idempotency-Key": "k2"})
    assert r.status_code == 403


def test_extract_asks_second_call_for_proposals_only_when_needed(admin, db_session, net):
    client, user = admin
    _ready(client, db_session, user, net)
    _tier(db_session, user)
    sid = _session(client)
    body = {**GOOD, "areas_mentioned": [], "areas_suggested": []}
    net.set("api.openai.com", 200, _ai_body(body))
    r = _extract(client, sid, text="枚方から車で片道3時間。関西で候補を4つ挙げて")
    assert r.status_code == 200, r.text
    sent = [q for q in net.requests if q.url.host == "api.openai.com"]
    assert len(sent) == 2  # 1回目に目安つきの案が無い → 条件だけを渡して提案を頼む
    second = sent[1].content.decode()
    assert "trip_areas" in second and "地域: 関西" in second and "件数: 4" in second
