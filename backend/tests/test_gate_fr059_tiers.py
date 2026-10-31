"""
[Gate FR059-Tiers] 会員の機能クラス Free / Trip / Journey / Explorer
(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §3.2〜§3.5)。

検証する主な性質(provider は fake。外へつながない):
- 機能の表: クラスに含まない操作は provider の前で 403 ``tier_feature_not_included``(口座・予約を作らない)。
  Free は AI・有料の検索なし、Trip は AI なし、Journey は Web 検索なし、Explorer は全て
- 価格の版 2026-10-31.1: 全ての回数の上限を同時に使った額が 1旅行 50円以下(Trip 28.23・Journey 29.60・Explorer 49.55)。
  月の枠 × 旅行の数 の最大が月の上限以下
- 40円の警告・45円の運用の知らせ・ちょうど 50円の許可・50円を越える見込みの拒否は全てのクラスで同じ
- 解決の順: Pro の契約 > Explorer > Journey > Trip > Plus > Family > Free。旧クラス(Plus・Trip Pass)は一律に変えない
- 管理の付与は二者の承認(4つのクラスも申請できる)。開発環境の試験の切り替えは理由・監査・24時間・本番では断る
- 機械が読む policy(membership_tiers)・価格の版・API の応答・運用コンソールの表が一致する
"""
import threading
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.api.v1 import admin_ops
from app.api.v1 import planning_usage as pu_api
from app.core.config import settings
from app.core.database import engine
from app.models.models import (
    Entitlement, ProviderUsageEvent, ProviderUsageReservation, TravelPlan, UsageBudgetAccount, UsagePolicyProfile,
    User, UserType,
)
from app.services import cost_guard as cg
from app.services import membership_tiers as mt

FAKE = "fake_paid_tiers"
UNITS = {
    "ai.generate": {"input_tokens": 10000, "output_tokens": 2000},
    "ai.web_search": {"requests": 1},
    "places.search": {"requests": 1},
    "places.details": {"requests": 1},
    "places.photo": {"requests": 1},
    "routes.element": {"elements": 1},
    "map.load": {"loads": 1},
}


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(pu_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(cg, "_audit", lambda *a, **kw: None)
    cg.register_provider(FAKE, list(cg.OPERATIONS))
    yield
    cg.unregister_provider(FAKE)


def _user(db, kind=UserType.REGISTERED):
    u = User(id=uuid.uuid4(), email=f"tier_{uuid.uuid4().hex[:10]}@example.com",
             username=f"tier{uuid.uuid4().hex[:10]}", hashed_password="x", user_type=kind, is_active=True,
             is_verified=True)
    db.add(u)
    db.flush()
    return u


def _plan(db, owner):
    p = TravelPlan(id=uuid.uuid4(), user_id=owner.id, title="クラスの試験")
    db.add(p)
    db.flush()
    return p


def _grant(db, subject_id, klass, subject_type="user", status="active", ends_at=None, source="admin"):
    g = Entitlement(id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
                    feature_key=cg.FEATURE_PREFIX + "class." + klass, status=status, source=source, ends_at=ends_at)
    db.add(g)
    db.flush()
    return g


def _member(db, tier):
    u = _user(db)
    if tier != "free":
        _grant(db, u.id, tier)
    return u


def _key():
    return uuid.uuid4().hex


# ===================================================================== policy・価格の版

def test_policy_profiles_match_machine_readable_policy(db_session):
    expected_worst = {"free": Decimal(0), "trip": Decimal("28.2348"), "journey": Decimal("29.6010"),
                      "explorer": Decimal("49.5480")}
    for tier in mt.TIERS:
        profile = cg.load_profile(db_session, tier)
        assert profile.version == mt.TIER_POLICY_VERSION == cg.TIER_POLICY_VERSION
        assert dict(profile.feature_quotas) == mt.TIER_QUOTAS[tier], tier
        plan_cap, monthly_cap, per_month = mt.TIER_CAPS[tier]
        assert Decimal(profile.plan_cap_jpy) == Decimal(plan_cap) == Decimal(50)
        assert (Decimal(profile.monthly_cap_jpy) if profile.monthly_cap_jpy is not None else None) == \
            (Decimal(monthly_cap) if monthly_cap is not None else None)
        assert profile.plans_per_month == per_month
        worst = cg.worst_case_plan_cost(profile)
        assert abs(worst - expected_worst[tier]) < Decimal("0.01"), (tier, worst)
        assert worst <= Decimal(50)
        if monthly_cap is not None:
            assert worst * per_month <= Decimal(monthly_cap), tier  # 月の旅行の数を全て上限まで使っても月の枠に収まる
        # 含まない操作の回数の上限は 0(policy と価格の版が食い違わない)
        for op, spec in cg.OPERATIONS.items():
            limit = int(profile.feature_quotas.get(spec["count"][0], 0))
            assert (limit > 0) == (op in mt.TIER_OPERATIONS[tier]), (tier, op)
    # 段階: 上のクラスは下のクラスの操作を全て含む
    for lower, upper in zip(mt.TIERS, mt.TIERS[1:]):
        assert set(mt.TIER_OPERATIONS[lower]) <= set(mt.TIER_OPERATIONS[upper])
    # 価格(単価・為替・税・安全係数)は以前の版と同じ
    legacy = db_session.query(UsagePolicyProfile).filter_by(profile_key="free", version=cg.POLICY_VERSION).one()
    assert legacy.status == "retired"  # 以前の Free(AI 5回)は使わない。行は残す
    tier_free = cg.load_profile(db_session, "free")
    assert tier_free.provider_price_snapshot == legacy.provider_price_snapshot
    assert (tier_free.fx_rate, tier_free.tax_factor, tier_free.safety_factor) == \
        (legacy.fx_rate, legacy.tax_factor, legacy.safety_factor)


@pytest.mark.parametrize("tier", mt.TIERS)
def test_class_matrix_allows_and_denies_before_provider(db_session, tier):
    member = _member(db_session, tier)
    plan = _plan(db_session, member)
    for op in cg.OPERATIONS:
        allowed = op in mt.TIER_OPERATIONS[tier]
        est = cg.estimate(db_session, plan, member, op, UNITS[op])
        assert est["allowed"] is allowed, (tier, op)
        if allowed:
            row = cg.reserve(db_session, plan, member, op, FAKE, UNITS[op], _key())
            assert row.status == "reserved" and row.profile_key == tier and row.policy_version == mt.TIER_POLICY_VERSION
        else:
            assert est["reason"] == "tier_feature_not_included"
            before = db_session.query(ProviderUsageReservation).filter_by(plan_id=plan.id).count()
            with pytest.raises(cg.CostGuardError) as e:
                cg.reserve(db_session, plan, member, op, FAKE, UNITS[op], _key())
            assert e.value.code == "tier_feature_not_included" and e.value.status == 403
            d = e.value.detail()
            assert d["class"] == tier and d["operation"] == op and "手での編集" in d["message"]
            assert d["fallbacks"] == ["USE_SAVED_CANDIDATES", "CONTINUE_MANUALLY"]
            assert db_session.query(ProviderUsageReservation).filter_by(plan_id=plan.id).count() == before
    summary = cg.plan_summary(db_session, plan, member)
    assert summary["class"] == tier and summary["tier"]["key"] == tier
    assert {c["operation"] for c in summary["calls"] if c["included"]} == set(mt.TIER_OPERATIONS[tier])
    assert summary["tier"]["ai"] is (tier in ("journey", "explorer"))
    assert summary["state"] == ("manual_only" if tier == "free" else "ok")


def test_run_never_calls_provider_for_excluded_operation(db_session):
    member = _member(db_session, "trip")
    plan = _plan(db_session, member)
    called = []
    with pytest.raises(cg.CostGuardError) as e:
        cg.run(db_session, plan, member, "ai.generate", FAKE, UNITS["ai.generate"], _key(),
               lambda u: called.append(u) or cg.ProviderResult(units=u))
    assert e.value.code == "tier_feature_not_included" and called == []


# ===================================================================== 50円の境界(全てのクラスで同じ)

@pytest.mark.parametrize("tier", ("trip", "journey", "explorer"))
def test_thresholds_40_45_50_same_for_every_class(db_session, tier):
    member = _member(db_session, tier)
    plan = _plan(db_session, member)
    acc = cg._account(db_session, "plan", plan.id, "plan", cg.resolve(db_session, plan, member), Decimal(50))
    acc.settled_jpy = Decimal(40)
    db_session.flush()
    assert cg.plan_summary(db_session, plan, member)["state"] == "warning"  # 40円(80%)で利用者の警告
    assert cg.estimate(db_session, plan, member, "map.load", {"loads": 1})["needs_confirmation"] is True
    acc.settled_jpy = Decimal(50) - Decimal("1.5939")
    db_session.flush()
    assert cg.reserve(db_session, plan, member, "map.load", FAKE, {"loads": 1}, _key()).status == "reserved"  # ちょうど 50円
    assert cg.plan_summary(db_session, plan, member)["state"] == "limit_reached"
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "routes.element", FAKE, {"elements": 1}, _key())
    assert e.value.code == "plan_cost_limit_reached" and e.value.status == 429


def test_explorer_full_use_stays_under_cap_and_alerts_at_45(db_session, caplog):
    member = _member(db_session, "explorer")
    plan = _plan(db_session, member)
    ops = [("places.search", {"requests": 1})] * 3 + [("places.details", {"requests": 1})] * 2 + \
        [("places.photo", {"requests": 1})] * 2 + [("routes.element", {"elements": 4}), ("map.load", {"loads": 1})] + \
        [("ai.generate", UNITS["ai.generate"])] * 5 + [("ai.web_search", {"requests": 1})] * 2
    caplog.set_level("WARNING")
    for op, units in ops:
        cg.reserve(db_session, plan, member, op, FAKE, units, _key())
    acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="plan", scope_id=plan.id).one()
    assert Decimal("49.5") <= Decimal(acc.reserved_jpy) <= Decimal(50)
    assert any("90%" in r.getMessage() for r in caplog.records)  # 45円(90%)で運用の知らせ
    for op, units in ops:
        with pytest.raises(cg.CostGuardError):
            cg.reserve(db_session, plan, member, op, FAKE, units, _key())


def test_journey_and_trip_per_plan_quotas(db_session):
    member = _member(db_session, "journey")
    plan = _plan(db_session, member)
    for _ in range(3):
        cg.reserve(db_session, plan, member, "ai.generate", FAKE, UNITS["ai.generate"], _key())
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "ai.generate", FAKE, UNITS["ai.generate"], _key())
    assert e.value.code == "feature_quota_exceeded" and e.value.extra["limit"] == 3
    trip = _member(db_session, "trip")
    tplan = _plan(db_session, trip)
    for _ in range(2):
        cg.reserve(db_session, tplan, trip, "places.search", FAKE, {"requests": 1}, _key())
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, tplan, trip, "places.search", FAKE, {"requests": 1}, _key())
    assert e.value.code == "feature_quota_exceeded" and e.value.extra["limit"] == 2


def test_trip_monthly_plans_and_reset(db_session, monkeypatch):
    member = _member(db_session, "trip")
    plans = [_plan(db_session, member) for _ in range(6)]
    for p in plans[:5]:
        cg.reserve(db_session, p, member, "map.load", FAKE, {"loads": 1}, _key())
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plans[5], member, "map.load", FAKE, {"loads": 1}, _key())
    assert e.value.code == "monthly_plan_quota_exceeded" and e.value.retry_after
    monkeypatch.setattr(cg, "month_key", lambda now=None: "2099-03")
    assert cg.reserve(db_session, plans[5], member, "map.load", FAKE, {"loads": 1}, _key()).status == "reserved"


# ===================================================================== 解決の順・旧クラス

def test_resolution_order_and_legacy_classes_unchanged(db_session):
    plus = _user(db_session)
    _grant(db_session, plus.id, "plus")
    assert cg.user_class(db_session, plus)[0] == "plus"  # Plus を Journey・Explorer へ一律に変えない
    pplan = _plan(db_session, plus)
    assert cg.reserve(db_session, pplan, plus, "ai.web_search", FAKE, {"requests": 1}, _key()).profile_key == "plus"
    _grant(db_session, plus.id, "journey")
    assert cg.user_class(db_session, plus)[0] == "journey"  # 管理者が新しいクラスを付けた時だけ
    _grant(db_session, plus.id, "explorer")
    assert cg.user_class(db_session, plus)[0] == "explorer"
    _grant(db_session, plus.id, "pro", source="contract")
    assert cg.user_class(db_session, plus)[0] == "pro"  # 契約が最優先(契約の枠が無い間は fail closed)
    family = _user(db_session)
    _grant(db_session, family.id, "family")
    _grant(db_session, family.id, "trip")
    assert cg.user_class(db_session, family)[0] == "trip"
    # 期限切れ・pending・取り消しの付与は効かない
    m = _user(db_session)
    _grant(db_session, m.id, "explorer", status="pending")
    _grant(db_session, m.id, "journey", ends_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    _grant(db_session, m.id, "trip", status="revoked")
    assert cg.user_class(db_session, m)[0] == "free"
    # user_type(premium)では上がらない
    premium = _user(db_session, UserType.PREMIUM)
    assert cg.user_class(db_session, premium)[0] == "free"
    # ゲストは新しいクラスを付けても Guest(0円)
    guest = _user(db_session, UserType.GUEST)
    _grant(db_session, guest.id, "explorer")
    gplan = _plan(db_session, guest)
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, gplan, guest, "map.load", FAKE, {"loads": 1}, _key())
    assert e.value.code == "guest_provider_forbidden"


def test_trip_pass_plan_keeps_legacy_quota_for_free_member(db_session):
    member = _member(db_session, "free")
    passed, other = _plan(db_session, member), _plan(db_session, member)
    _grant(db_session, passed.id, "trip_pass", subject_type="plan", source="trip_pass")
    assert cg.reserve(db_session, passed, member, "ai.web_search", FAKE, {"requests": 1}, _key()).profile_key == \
        "trip_pass"
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, other, member, "ai.web_search", FAKE, {"requests": 1}, _key())
    assert e.value.code == "tier_feature_not_included"


def test_family_members_do_not_multiply_explorer_cap(db_session):
    from app.models.models import PlanCollaborator

    owner = _member(db_session, "explorer")
    plan = _plan(db_session, owner)
    members = [_member(db_session, "free") for _ in range(3)]
    for m in members:
        db_session.add(PlanCollaborator(plan_id=plan.id, user_id=m.id, email=m.email, role="editor", status="accepted"))
    db_session.flush()
    # 共同編集の人(Free)が呼んでも、所有者(Explorer)の枠・旅行の台帳を使う。人数で増えない
    for i in range(3):
        r = cg.reserve(db_session, plan, members[i], "places.search", FAKE, {"requests": 1}, _key())
        assert r.profile_key == "explorer" and r.billable_owner_user_id == owner.id
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, members[0], "places.search", FAKE, {"requests": 1}, _key())
    assert e.value.code == "feature_quota_exceeded"


def test_concurrent_journey_reservations_never_exceed_quota():
    setup = Session(bind=engine)
    tag = uuid.uuid4().hex[:8]
    owner = User(id=uuid.uuid4(), email=f"tierc_{tag}@example.com", username=f"tierc{tag}", hashed_password="x",
                 user_type=UserType.REGISTERED, is_active=True, is_verified=True)
    setup.add(owner)
    setup.flush()
    plan = TravelPlan(id=uuid.uuid4(), user_id=owner.id, title="同時")
    setup.add(plan)
    setup.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=owner.id,
                          feature_key="trip_planning.class.journey", status="active", source="admin"))
    setup.commit()
    plan_id, owner_id = plan.id, owner.id
    setup.close()
    results = []
    barrier = threading.Barrier(6)

    def worker():
        s = Session(bind=engine)
        try:
            p, u = s.get(TravelPlan, plan_id), s.get(User, owner_id)
            barrier.wait()
            cg.reserve(s, p, u, "ai.generate", FAKE, UNITS["ai.generate"], uuid.uuid4().hex)
            results.append("ok")
        except cg.CostGuardError as error:
            results.append(error.code)
        finally:
            s.close()

    threads = [threading.Thread(target=worker) for _ in range(6)]
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        assert results.count("ok") == 3 and results.count("feature_quota_exceeded") == 3
    finally:
        clean = Session(bind=engine)
        clean.query(ProviderUsageEvent).filter_by(plan_id=plan_id).delete()
        clean.query(ProviderUsageReservation).filter_by(plan_id=plan_id).delete()
        clean.query(UsageBudgetAccount).filter(UsageBudgetAccount.scope_id.in_([plan_id, owner_id])).delete()
        clean.query(Entitlement).filter_by(subject_id=owner_id).delete()
        clean.query(TravelPlan).filter_by(id=plan_id).delete()
        clean.query(User).filter_by(id=owner_id).delete()
        clean.commit()
        clean.close()


# ===================================================================== API・管理

def test_api_entitlements_show_tier(auth_client, db_session):
    client, owner = auth_client
    me = client.get("/api/v1/entitlements").json()
    assert me["class"] == "free" and me["tier"] == {**mt.tier_info("free")}
    _grant(db_session, owner.id, "journey")
    me = client.get("/api/v1/entitlements").json()
    assert me["class"] == "journey" and me["class_label"] == "Journey" and me["tier"]["subtitle"] == "計画を一緒に考える"
    assert me["tier"]["operations"] == list(mt.TIER_OPERATIONS["journey"])
    plan = client.post("/api/v1/travel-plans/", json={"title": "Journey"}).json()["id"]
    est = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate", json={"operation": "ai.web_search"}).json()
    assert est["allowed"] is False and est["reason"] == "tier_feature_not_included"
    # 本文でクラスを指定しても変わらない
    r = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                    json={"operation": "ai.web_search", "class": "explorer"})
    assert r.status_code == 422


def test_admin_two_person_approval_for_tiers(auth_client, make_user, db_session, monkeypatch):
    client, first = auth_client
    second, _ = make_user()
    target, _ = make_user()
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    for u in (first, second):
        u.user_type = "admin"
    db_session.flush()
    for tier in ("trip", "journey", "explorer"):
        body = {"subject_type": "user", "subject_id": str(target.id),
                "feature_key": f"trip_planning.class.{tier}", "reason": "家族旅行の試験"}
        r = client.post("/api/v1/admin/entitlements", json=body)
        assert r.status_code == 201 and r.json()["status"] == "pending", tier
    assert cg.user_class(db_session, target)[0] == "free"  # 承認まで効かない
    r = client.post("/api/v1/admin/entitlements", json={"subject_type": "plan", "subject_id": str(uuid.uuid4()),
                                                        "feature_key": "trip_planning.class.explorer", "reason": "x"})
    assert r.status_code == 422  # 旅行には Trip Pass だけ


@pytest.fixture()
def ops_audits(monkeypatch):
    seen = []
    monkeypatch.setattr(admin_ops, "record_audit_event", lambda **kw: seen.append(kw))
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    return seen


def test_ops_tiers_matrix(auth_client, db_session, ops_audits):
    client, user = auth_client
    assert client.get("/api/v1/admin/ops/tiers").status_code == 403
    user.user_type = "admin"
    db_session.flush()
    body = client.get("/api/v1/admin/ops/tiers").json()
    assert body["policy_version"] == mt.TIER_POLICY_VERSION
    assert [t["key"] for t in body["tiers"]] == list(mt.TIERS)
    for t in body["tiers"]:
        assert t["profile"] == "known" and t["fits_plan_cap"] is True and t["plan_cap_jpy"] == "50.0000"
        assert t["operations"] == list(mt.TIER_OPERATIONS[t["key"]])
    assert {f["key"] for f in body["features"]} >= {"ai_planning", "places_search", "booking_payment"}
    assert all(f[t] in ("○", "△", "—") for f in body["features"] for t in mt.TIERS)
    assert body["thresholds"] == {"user_warning_jpy": "40.0000", "ops_alert_jpy": "45.0000", "hard_cap_jpy": "50.0000"}
    assert any(row["legacy"].startswith("Plus") for row in body["legacy"])
    assert body["test_switch"]["enabled"] is True


def test_ops_test_tier_switch(auth_client, make_user, db_session, ops_audits, monkeypatch):
    client, admin = auth_client
    admin.user_type = "admin"
    db_session.flush()
    assert client.post("/api/v1/admin/ops/test-tier", json={"tier": "journey"}).status_code == 422  # 理由が要る
    assert client.post("/api/v1/admin/ops/test-tier", json={"tier": "gold", "reason": "x"}).status_code == 422
    r = client.post("/api/v1/admin/ops/test-tier", json={"tier": "journey", "reason": "家族旅行の確認"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["effective"]["class"] == "journey" and body["before"] == "free" and body["expires_in_hours"] == 24
    grant = db_session.query(Entitlement).filter_by(subject_id=admin.id, status="active").one()
    assert grant.reason.startswith("[test-tier]") and grant.ends_at is not None and grant.approved_by is None
    r = client.post("/api/v1/admin/ops/test-tier", json={"tier": "explorer", "reason": "比べる"})
    assert r.json()["effective"]["class"] == "explorer" and r.json()["revoked_test_grants"] == 1
    r = client.post("/api/v1/admin/ops/test-tier", json={"tier": "free", "reason": "戻す"})
    assert r.json()["effective"]["class"] == "free"
    assert db_session.query(Entitlement).filter_by(subject_id=admin.id, status="active").count() == 0
    # 正式な付与(二者の承認)は試験の切り替えで消さない
    other, _ = make_user()
    _grant(db_session, other.id, "plus")
    r = client.post("/api/v1/admin/ops/test-tier", json={"tier": "free", "reason": "x", "user_id": str(other.id)})
    assert r.json()["effective"]["class"] == "plus" and "優先" in r.json()["note"]
    actions = [a["action"] for a in ops_audits]
    assert actions.count("ops_test_tier_switched") == 4
    assert all("reason" in a["details"] for a in ops_audits if a["action"] == "ops_test_tier_switched")
    # 有料の提供元の接続は変えない(登録されているのは実装済みの adapter と Fake だけ)
    from app.services import provider_calls as pc
    assert set(cg.paid_providers()) <= set(pc.ADAPTERS) | {FAKE}
    monkeypatch.setattr(settings, "APP_ENV", "production")
    r = client.post("/api/v1/admin/ops/test-tier", json={"tier": "journey", "reason": "x"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "test_tier_disabled"


@pytest.mark.parametrize("tier", mt.TIERS)
def test_family_fake_run_per_tier(auth_client, db_session, ops_audits, tier):
    client, user = auth_client
    user.user_type = "admin"
    db_session.flush()
    r = client.post("/api/v1/admin/ops/test-runs/family-fake", json={"reason": "クラスの比較", "tier": tier})
    assert r.status_code == 201, r.text
    s = r.json()["summary"]
    assert s["tier"] == tier and s["class"] == tier and s["external_calls"] == 0 and s["never_over_cap"] is True
    assert s["included_operations"] == list(mt.TIER_OPERATIONS[tier])
    steps = r.json()["steps"]
    settled_ops = {st["operation"] for st in steps if st["result"] == "settled"}
    assert settled_ops <= set(mt.TIER_OPERATIONS[tier])
    if tier == "free":
        assert s["settled_steps"] == 0 and Decimal(s["final_total_jpy"]) == 0
        assert {st["reason"] for st in steps} == {"tier_feature_not_included"}
    else:
        assert s["settled_steps"] >= 1
        excluded = set(cg.OPERATIONS) - set(mt.TIER_OPERATIONS[tier])
        assert all(st["reason"] == "tier_feature_not_included" for st in steps if st["operation"] in excluded)
    if tier == "explorer":
        assert Decimal(s["final_total_jpy"]) >= Decimal("45") and s["first_ops_alert_step"]
    assert client.post("/api/v1/admin/ops/test-runs/family-fake",
                       json={"reason": "x", "tier": "platinum"}).status_code == 422


def test_override_from_client_is_ignored(auth_client):
    client, _owner = auth_client
    plan = client.post("/api/v1/travel-plans/", json={"title": "改ざん"}).json()["id"]
    for key in ("class", "profile_key", "plan_cap"):
        r = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate", json={"operation": "map.load", key: "x"})
        assert r.status_code == 422
