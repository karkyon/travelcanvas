"""
[FR059-B] 外部 API の原価上限(1旅行 50円)と利用者クラス別 quota
(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §11 の受入条件 1〜8・10〜12)。

検証する主な性質(provider は fake。外へつながない):
- 価格の版の検算: 全ての回数の上限を同時に使っても 50円以下(49.55円)。単価の無い操作は呼ばない(503)
- クラス: Guest は 403、Free は月1旅行・Plus は月5旅行(6つ目は 429、月が変わると再開)、Trip Pass は割り当てた旅行だけ、
  Family/Group は4人でも1旅行 50円、Pro の例外は二者の承認の後だけ。user_type・要求の本文では増えない
- 境界: 残り 12円に 15円は 429(例の usage と fallbacks)、ちょうど 50円は許可。回数・token の上限は provider の前で断る
- 冪等: 同じ Idempotency-Key は同じ予約、違う操作は 409。確定・解放は二度目に何もしない。期限切れは解放
- 同時の予約(別の接続の2本)でも上限を越えない。provider の再試行は1回まで、失敗は解放、見込みの超過と照合の差で止める
- 使用の記録に入力の文章・鍵を持たない。利用者の削除で付与・口座を消し、記録の利用者を外す
"""
import threading
import uuid
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.api.v1 import planning_usage as pu_api
from app.core.auth import AuthResult, get_current_user
from app.core.config import settings
from app.core.database import engine
from app.main import app
from app.models.models import (
    Entitlement, PlanCollaborator, ProviderUsageEvent, ProviderUsageReservation, TravelPlan, UsageBudgetAccount,
    UsagePolicyProfile, User, UserType,
)
from app.services import cost_guard as cg

FAKE = "fake_paid"


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(pu_api, "record_audit_event", lambda **kw: None)
    monkeypatch.setattr(cg, "_audit", lambda *a, **kw: None)
    cg.register_provider(FAKE, list(cg.OPERATIONS))
    yield
    cg.unregister_provider(FAKE)


def _user(db, kind=UserType.REGISTERED):
    u = User(id=uuid.uuid4(), email=f"cg_{uuid.uuid4().hex[:10]}@example.com", username=f"cg{uuid.uuid4().hex[:10]}",
             hashed_password="x", user_type=kind, is_active=True, is_verified=True)
    db.add(u)
    db.flush()
    return u


def _plan(db, owner, title="原価の試験"):
    p = TravelPlan(id=uuid.uuid4(), user_id=owner.id, title=title)
    db.add(p)
    db.flush()
    return p


def _grant(db, subject_type, subject_id, feature, quota=None, source="admin"):
    g = Entitlement(id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
                    feature_key=cg.FEATURE_PREFIX + feature, status="active", quota=quota, source=source)
    db.add(g)
    db.flush()
    return g


def _key():
    return uuid.uuid4().hex


def _ai(db, plan, caller, i=2000, o=500):
    return cg.reserve(db, plan, caller, "ai.generate", FAKE, {"input_tokens": i, "output_tokens": o}, _key())


# ===================================================================== 価格の版

def test_price_profile_fits_cap_and_unknown_price_fails_closed(db_session):
    for key in ("free", "plus", "family", "trip_pass", "pro"):
        profile = cg.load_profile(db_session, key)
        worst = cg.worst_case_plan_cost(profile)
        assert worst <= Decimal(profile.plan_cap_jpy) == Decimal(50), key
        assert Decimal("49.5") <= worst <= Decimal("49.6")  # 追補の検算 49.55円(切り上げの誤差の内)
    assert cg.worst_case_plan_cost(cg.load_profile(db_session, "guest")) == 0
    profile = cg.load_profile(db_session, "free")
    assert profile.version == cg.POLICY_VERSION
    broken = UsagePolicyProfile(profile_key="free", version="x", plan_cap_jpy=50, feature_quotas={}, fx_rate=180,
                                tax_factor=Decimal("1.1"), safety_factor=Decimal("1.15"),
                                provider_price_snapshot={"currency": "USD", "operations": {}})
    with pytest.raises(cg.CostGuardError) as e:
        cg.unit_prices(broken, "places.search")
    assert e.value.code == "cost_profile_unavailable" and e.value.status == 503


# ===================================================================== クラス

def test_guest_is_zero_and_free_is_one_plan_per_month(db_session, monkeypatch):
    guest = _user(db_session, UserType.GUEST)
    gplan = _plan(db_session, guest)
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, gplan, guest)
    assert e.value.code == "guest_provider_forbidden" and e.value.status == 403
    member = _user(db_session)
    shared = _plan(db_session, member)
    with pytest.raises(cg.CostGuardError):
        _ai(db_session, shared, guest)  # ゲストは他人の旅行からも呼べない
    assert cg.user_summary(db_session, guest)["class"] == "guest"

    a, b = _plan(db_session, member), _plan(db_session, member)
    assert _ai(db_session, a, member).status == "reserved"
    assert _ai(db_session, a, member).status == "reserved"  # 同じ旅行は数を増やさない
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, b, member)
    assert e.value.code == "monthly_plan_quota_exceeded" and e.value.status == 429 and e.value.retry_after
    monkeypatch.setattr(cg, "month_key", lambda now=None: "2099-01")
    assert _ai(db_session, b, member).status == "reserved"  # 月が変わると再開
    summary = cg.user_summary(db_session, member)
    assert summary["class"] == "free" and summary["plans_per_month"] == 1 and summary["plan_cap_jpy"] == "50.0000"


def test_plus_five_plans_then_sixth_denied_and_user_type_does_not_raise(db_session, monkeypatch):
    member = _user(db_session)
    _grant(db_session, "user", member.id, "class.plus")
    plans = [_plan(db_session, member, f"P{i}") for i in range(6)]
    for p in plans[:5]:
        assert _ai(db_session, p, member).status == "reserved"
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, plans[5], member)
    assert e.value.code == "monthly_plan_quota_exceeded"
    monkeypatch.setattr(cg, "month_key", lambda now=None: "2099-02")
    assert _ai(db_session, plans[5], member).status == "reserved"
    # user_type は quota の根拠にしない(付与の無い利用者は Free のまま)
    premium = _user(db_session, UserType.PREMIUM)  # 古い user_type の「premium」も枠を増やさない
    assert cg.user_class(db_session, premium)[0] == "free"
    assert cg.resolve(db_session, _plan(db_session, premium), premium).plan_cap == 50
    # 期限の切れた付与・pending の付与は効かない
    pending = _user(db_session)
    g = _grant(db_session, "user", pending.id, "class.plus")
    g.status = "pending"
    db_session.flush()
    assert cg.user_class(db_session, pending)[0] == "free"


def test_trip_pass_only_for_assigned_plan(db_session):
    member = _user(db_session)
    first, passed, other = _plan(db_session, member), _plan(db_session, member), _plan(db_session, member)
    _grant(db_session, "plan", passed.id, "class.trip_pass", source="trip_pass")
    assert _ai(db_session, first, member).status == "reserved"  # Free の今月の1旅行
    r = _ai(db_session, passed, member)
    assert r.status == "reserved" and r.profile_key == "trip_pass" and r.monthly_account_id is None
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, other, member)  # Pass を割り当てていない旅行は Free(今月は使い切った)
    assert e.value.code == "monthly_plan_quota_exceeded"
    assert cg.plan_summary(db_session, passed, member)["class"] == "trip_pass"


def test_family_four_members_share_one_fifty_yen_cap(db_session):
    owner = _user(db_session)
    _grant(db_session, "user", owner.id, "class.family")
    plan = _plan(db_session, owner)
    members = [_user(db_session) for _ in range(3)]
    for m in members:
        db_session.add(PlanCollaborator(plan_id=plan.id, user_id=m.id, email=m.email, role="editor", status="accepted"))
    db_session.flush()
    callers = [owner] + members
    # 場所の検索 3回 + 詳細 2回 + 写真 2回 + 経路 4 + 地図 1 + AI 5回 + Web 検索 2回 = 全ての上限(49.55円)
    ops = [("places.search", {"requests": 1})] * 3 + [("places.details", {"requests": 1})] * 2 + \
        [("places.photo", {"requests": 1})] * 2 + [("routes.element", {"elements": 4}), ("map.load", {"loads": 1})] + \
        [("ai.generate", {"input_tokens": 10000, "output_tokens": 2000})] * 5 + [("ai.web_search", {"requests": 1})] * 2
    for i, (op, units) in enumerate(ops):
        cg.reserve(db_session, plan, callers[i % 4], op, FAKE, units, _key())
    acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="plan", scope_id=plan.id).one()
    assert Decimal("49.5") <= Decimal(acc.reserved_jpy) <= Decimal(50)
    assert Decimal(acc.cap_jpy) == 50  # 4人でも 200円にならない
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, members[0], "places.search", FAKE, {"requests": 1}, _key())
    assert e.value.code == "feature_quota_exceeded"
    # 月の枠は支払う人(所有者)に集まる(メンバーの月の口座は作らない)
    member_ids = [m.id for m in members]
    assert db_session.query(UsageBudgetAccount).filter(UsageBudgetAccount.scope_type == "user",
                                                       UsageBudgetAccount.scope_id.in_(member_ids)).count() == 0
    monthly = db_session.query(UsageBudgetAccount).filter_by(scope_type="user", scope_id=owner.id).one()
    assert monthly.plans_used == 1 and Decimal(monthly.reserved_jpy) == Decimal(acc.reserved_jpy)


def test_pro_contract_exception_only_after_approval(db_session):
    pro = _user(db_session)
    plan = _plan(db_session, pro)
    _grant(db_session, "user", pro.id, "class.pro", source="contract")
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, plan, pro)  # 契約の月の枠が無い間は 0円(fail closed)
    assert e.value.code in ("monthly_plan_quota_exceeded", "monthly_quota_exceeded")
    g = _grant(db_session, "user", pro.id, "cost_jpy_per_month", quota=10000, source="contract")
    _grant(db_session, "user", pro.id, "plans_per_month", quota=100, source="contract")
    assert _ai(db_session, plan, pro).status == "reserved"
    g.status = "revoked"
    db_session.flush()
    with pytest.raises(cg.CostGuardError):
        _ai(db_session, _plan(db_session, pro), pro)


# ===================================================================== 境界・回数

def test_boundary_429_payload(db_session):
    member = _user(db_session)
    _grant(db_session, "user", member.id, "class.plus")
    plan = _plan(db_session, member)
    acc = cg._account(db_session, "plan", plan.id, "plan", cg.resolve(db_session, plan, member), Decimal(50))
    acc.settled_jpy = Decimal(38)  # 残り 12円
    db_session.flush()
    profile = cg.load_profile(db_session, "plus")
    assert cg.cost_of(profile, "ai.generate", {"input_tokens": 10000, "output_tokens": 2000}) == Decimal("0.4554")
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 2}, _key())  # 15.939円 > 12円
    err = e.value
    assert err.code == "plan_cost_limit_reached" and err.status == 429
    d = err.detail()
    assert d["usage"]["plan_cap"] == "50.0000" and d["usage"]["plan_used"] == "38.0000"
    assert d["usage"]["plan_remaining"] == "12.0000" and d["usage"]["requested_max"] == "15.9390"
    assert d["fallbacks"] == ["USE_SAVED_CANDIDATES", "CONTINUE_MANUALLY"]
    assert db_session.query(ProviderUsageReservation).filter_by(plan_id=plan.id).count() == 0
    assert "手動編集と保存済み候補は引き続き利用できます" in d["message"]


def test_exactly_fifty_is_allowed(db_session):
    member = _user(db_session)
    _grant(db_session, "user", member.id, "class.plus")
    plan = _plan(db_session, member)
    acc = cg._account(db_session, "plan", plan.id, "plan", cg.resolve(db_session, plan, member), Decimal(50))
    acc.settled_jpy = Decimal(50) - Decimal("7.9695")
    db_session.flush()
    assert cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 1}, _key()).status == "reserved"
    assert cg.plan_summary(db_session, plan, member)["state"] == "limit_reached"
    with pytest.raises(cg.CostGuardError):
        cg.reserve(db_session, plan, member, "ai.generate", FAKE, {"input_tokens": 1, "output_tokens": 1}, _key())


def test_feature_quotas_checked_before_provider(db_session):
    member = _user(db_session)
    plan = _plan(db_session, member)
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, plan, member, i=10001)
    assert e.value.code == "feature_quota_exceeded" and e.value.extra["feature"].endswith("ai_input_tokens_per_call")
    with pytest.raises(cg.CostGuardError):
        _ai(db_session, plan, member, o=2001)
    for _ in range(5):
        _ai(db_session, plan, member)
    with pytest.raises(cg.CostGuardError) as e:
        _ai(db_session, plan, member)
    assert e.value.extra["feature"].endswith("ai_calls_per_plan")
    for op, units, n in (("ai.web_search", {"requests": 1}, 2), ("places.details", {"requests": 1}, 2),
                         ("places.photo", {"requests": 1}, 2), ("map.load", {"loads": 1}, 1)):
        for _ in range(n):
            cg.reserve(db_session, plan, member, op, FAKE, units, _key())
        with pytest.raises(cg.CostGuardError) as e:
            cg.reserve(db_session, plan, member, op, FAKE, units, _key())
        assert e.value.code == "feature_quota_exceeded", op
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "routes.element", FAKE, {"elements": 5}, _key())
    assert e.value.code == "feature_quota_exceeded"
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "ai.generate", FAKE, {"input_tokens": "旅程の全文", "output_tokens": 1},
                   _key())
    assert e.value.code == "invalid_planning_units"  # 量は整数だけ(文章を台帳へ入れない)


# ===================================================================== 冪等・確定・解放・期限

def test_idempotency_settle_release_and_expiry(db_session):
    member = _user(db_session)
    plan = _plan(db_session, member)
    key = _key()
    r1 = cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 1}, key)
    r2 = cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 1}, key)
    assert r1.id == r2.id
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "places.details", FAKE, {"requests": 1}, key)
    assert e.value.code == "idempotency_conflict" and e.value.status == 409
    acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="plan", scope_id=plan.id).one()
    cg.settle(db_session, r1.id, {"requests": 1})
    cg.settle(db_session, r1.id, {"requests": 1})  # 二度目は何もしない
    db_session.refresh(acc)
    assert Decimal(acc.settled_jpy) == Decimal("7.9695") and Decimal(acc.reserved_jpy) == 0
    r3 = cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 1}, _key())
    cg.release(db_session, r3.id, "provider_error")
    cg.release(db_session, r3.id, "provider_error")
    db_session.refresh(acc)
    assert Decimal(acc.reserved_jpy) == 0 and acc.counts["places_searches_per_plan"] == 1  # 解放で回数も戻る
    r4 = cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 1}, _key())
    r4.expires_at = r4.created_at
    db_session.flush()
    assert cg.release_expired(db_session, plan.id) == 1
    db_session.refresh(acc)
    assert Decimal(acc.reserved_jpy) == 0 and Decimal(acc.settled_jpy) >= 0
    events = db_session.query(ProviderUsageEvent).filter_by(plan_id=plan.id).all()
    assert sorted(e.result_code for e in events) == ["expired", "ok", "provider_error"]
    for e in events:  # 使用の記録は数と金額だけ
        assert e.provider == FAKE and e.sku and e.price_version == cg.POLICY_VERSION
        assert e.estimated_cost_jpy >= 0


def test_run_retry_once_release_on_failure_and_suspend(db_session):
    member = _user(db_session)
    plan = _plan(db_session, member)
    calls = []

    def flaky(units):
        calls.append(units)
        if len(calls) == 1:
            raise cg.ProviderTransientError("timeout", retry_safe=True)
        return cg.ProviderResult(units={"requests": 1}, payload={"places": 3})

    payload, usage = cg.run(db_session, plan, member, "places.search", FAKE, {"requests": 1}, _key(), flaky)
    assert payload == {"places": 3} and len(calls) == 2 and usage["reservation_status"] == "settled"

    def always(units):
        raise cg.ProviderTransientError("timeout", retry_safe=True)

    with pytest.raises(cg.CostGuardError) as e:
        cg.run(db_session, plan, member, "places.details", FAKE, {"requests": 1}, _key(), always)
    assert e.value.code == "provider_unavailable"
    unsafe = []

    def not_safe(units):
        unsafe.append(1)
        raise cg.ProviderTransientError("lost", retry_safe=False)

    with pytest.raises(cg.CostGuardError):
        cg.run(db_session, plan, member, "places.photo", FAKE, {"requests": 1}, _key(), not_safe)
    assert len(unsafe) == 1  # 二重の課金の恐れがある時は再送しない
    acc = db_session.query(UsageBudgetAccount).filter_by(scope_type="plan", scope_id=plan.id).one()
    assert Decimal(acc.reserved_jpy) == 0 and Decimal(acc.settled_jpy) == Decimal("7.9695")

    def over(units):
        return cg.ProviderResult(units={"requests": 2})  # 予約した1件を越えて報告

    cg.run(db_session, plan, member, "places.photo", FAKE, {"requests": 1}, _key(), over)
    assert cg.is_suspended(FAKE)
    with pytest.raises(cg.CostGuardError) as e:
        cg.reserve(db_session, plan, member, "map.load", FAKE, {"loads": 1}, _key())
    assert e.value.code == "provider_suspended" and e.value.status == 503
    cg.resume_provider(FAKE)
    cg.unregister_provider(FAKE)
    with pytest.raises(cg.CostGuardError) as e:
        cg.run(db_session, plan, member, "map.load", FAKE, {"loads": 1}, _key(), over)
    assert e.value.code == "provider_not_connected"


def test_reconcile_delta_suspends_provider(db_session):
    member = _user(db_session)
    plan = _plan(db_session, member)
    payload, _ = cg.run(db_session, plan, member, "places.search", FAKE, {"requests": 1}, _key(),
                        lambda u: cg.ProviderResult(units={"requests": 1}))
    rid = db_session.query(ProviderUsageReservation).filter_by(plan_id=plan.id).one().id
    assert cg.reconcile(db_session, FAKE, [{"reservation_id": str(rid), "actual_cost_jpy": "8.2"}]) == \
        {"flagged": 0, "suspended": False}
    assert cg.reconcile(db_session, FAKE, [{"reservation_id": str(rid), "actual_cost_jpy": "20"}])["suspended"]
    cg.resume_provider(FAKE)


# ===================================================================== 同時の予約(別の接続)

def test_concurrent_reservations_never_exceed_cap():
    setup = Session(bind=engine)
    tag = uuid.uuid4().hex[:8]
    owner = User(id=uuid.uuid4(), email=f"cgc_{tag}@example.com", username=f"cgc{tag}",
                 hashed_password="x", user_type=UserType.REGISTERED, is_active=True, is_verified=True)
    setup.add(owner)
    setup.flush()
    plan = TravelPlan(id=uuid.uuid4(), user_id=owner.id, title="同時")
    setup.add(plan)
    setup.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=owner.id,
                          feature_key="trip_planning.class.plus", status="active", source="admin"))
    setup.commit()
    plan_id, owner_id = plan.id, owner.id
    setup.close()
    results = []
    barrier = threading.Barrier(8)

    def worker():
        s = Session(bind=engine)
        try:
            p = s.get(TravelPlan, plan_id)
            u = s.get(User, owner_id)
            barrier.wait()
            cg.reserve(s, p, u, "places.search", FAKE, {"requests": 1}, uuid.uuid4().hex)
            results.append("ok")
        except cg.CostGuardError as error:
            results.append(error.code)
        finally:
            s.close()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    try:
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
        assert results.count("ok") == 3  # 場所の検索は1旅行3回まで(8本が同時でも越えない)
        check = Session(bind=engine)
        acc = check.query(UsageBudgetAccount).filter_by(scope_type="plan", scope_id=plan_id).one()
        assert Decimal(acc.reserved_jpy) == Decimal("7.9695") * 3 <= Decimal(50)
        assert acc.counts["places_searches_per_plan"] == 3
        check.close()
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


# ===================================================================== API

def test_api_entitlements_usage_estimate_and_roles(auth_client, make_user, db_session):
    client, owner = auth_client
    plan = client.post("/api/v1/travel-plans/", json={"title": "利用枠"}).json()["id"]
    me = client.get("/api/v1/entitlements").json()
    assert me["class"] == "free" and me["plan_cap_jpy"] == "50.0000" and me["monthly_cap_jpy"] == "50.0000"
    assert me["providers_connected"] is True  # 試験では fake を登録している
    usage = client.get(f"/api/v1/plans/{plan}/planning-usage").json()
    assert usage["plan_used_yen_ceil"] == 0 and usage["plan_cap_yen"] == 50 and usage["state"] == "ok"
    assert {c["operation"] for c in usage["calls"]} == set(cg.OPERATIONS)
    est = client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                      json={"operation": "places.search", "units": {"requests": 1}}).json()
    assert est["max_cost_jpy"] == "7.9695" and est["max_cost_yen_ceil"] == 8 and est["allowed"] is True
    assert client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                       json={"operation": "places.search", "plan_cap": "9999"}).status_code == 422
    assert client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                       json={"operation": "rocket"}).status_code == 422
    assert db_session.query(ProviderUsageReservation).count() == 0  # 見積もりは予約しない
    viewer, _ = make_user()
    db_session.add(PlanCollaborator(plan_id=uuid.UUID(plan), user_id=viewer.id, email=viewer.email, role="viewer",
                                    status="accepted"))
    db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=viewer, is_authenticated=True, is_guest=False)
    assert client.get(f"/api/v1/plans/{plan}/planning-usage").status_code == 200
    assert client.post(f"/api/v1/plans/{plan}/planning-actions/estimate",
                       json={"operation": "map.load"}).status_code == 403
    stranger, _ = make_user()
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=stranger, is_authenticated=True,
                                                                    is_guest=False)
    assert client.get(f"/api/v1/plans/{plan}/planning-usage").status_code == 403


def test_admin_two_person_approval(auth_client, make_user, db_session, monkeypatch):
    client, first = auth_client
    second, _ = make_user()
    target, _ = make_user()
    monkeypatch.setattr(settings, "ADMIN_MFA_REQUIRED", False)
    body = {"subject_type": "user", "subject_id": str(target.id), "feature_key": "trip_planning.class.plus",
            "reason": "年間の利用の契約"}
    assert client.post("/api/v1/admin/entitlements", json=body).status_code == 403  # 管理者でない
    for u in (first, second):
        u.user_type = "admin"
    db_session.flush()
    assert client.post("/api/v1/admin/entitlements", json={**body, "reason": ""}).status_code == 422
    assert client.post("/api/v1/admin/entitlements",
                       json={**body, "feature_key": "trip_planning.class.trip_pass"}).status_code == 422
    over = {**body, "feature_key": "trip_planning.cost_jpy_per_plan", "quota": 500}
    r = client.post("/api/v1/admin/entitlements", json=over)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "quota_override_requires_pro"
    r = client.post("/api/v1/admin/entitlements", json=body)
    assert r.status_code == 201 and r.json()["status"] == "pending"
    gid = r.json()["id"]
    assert cg.user_class(db_session, target)[0] == "free"  # pending は効かない
    r = client.post(f"/api/v1/admin/entitlements/{gid}/approve")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "two_person_required"
    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=second, is_authenticated=True, is_guest=False)
    r = client.post(f"/api/v1/admin/entitlements/{gid}/approve")
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["approved_by"] == str(second.id)
    assert cg.user_class(db_session, target)[0] == "plus"
    listing = client.get("/api/v1/admin/entitlements", params={"subject_type": "user", "subject_id": str(target.id)})
    assert listing.json()["effective"]["class"] == "plus"
    assert client.post(f"/api/v1/admin/entitlements/{gid}/revoke", json={}).status_code == 422
    assert client.post(f"/api/v1/admin/entitlements/{gid}/revoke", json={"reason": "解約"}).json()["status"] == "revoked"
    assert cg.user_class(db_session, target)[0] == "free"
    plan = TravelPlan(id=uuid.uuid4(), user_id=target.id, title="Pass")
    db_session.add(plan)
    db_session.flush()
    pass_body = {"subject_type": "plan", "subject_id": str(plan.id), "feature_key": "trip_planning.class.trip_pass",
                 "reason": "Trip Pass の割り当て"}
    assert client.post("/api/v1/admin/entitlements", json=pass_body).status_code == 201
    r = client.post("/api/v1/admin/entitlements", json=pass_body)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "trip_pass_already_assigned"
    assert client.get("/api/v1/admin/planning-usage", params={"plan_id": str(plan.id)}).json()["account"] is None


def test_account_deletion_clears_grants_and_accounts(db_session):
    from app.services import account_deletion

    member = _user(db_session)
    plan = _plan(db_session, member)
    _grant(db_session, "user", member.id, "class.plus")
    r = cg.reserve(db_session, plan, member, "places.search", FAKE, {"requests": 1}, _key())
    cg.settle(db_session, r.id, {"requests": 1})
    account_deletion.scrub_provider_usage(db_session, member.id)
    assert db_session.query(Entitlement).filter_by(subject_id=member.id).count() == 0
    assert db_session.query(UsageBudgetAccount).filter_by(scope_type="user", scope_id=member.id).count() == 0
    ev = db_session.query(ProviderUsageEvent).filter_by(plan_id=plan.id).one()
    assert ev.user_id is None and Decimal(ev.estimated_cost_jpy) == Decimal("7.9695")  # 会計の整合は残す
    res = db_session.get(ProviderUsageReservation, r.id)
    db_session.refresh(res)
    assert res.user_id is None and res.billable_owner_user_id is None
