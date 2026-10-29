"""[FR059-B] 外部 API の原価上限(1旅行 50円)と利用者クラス別 quota。

正本: docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md(§2 上限と価格・§3 クラス・§4 クラスの決め方・§5 流れ)。

- クラスはサーバーだけが決める(``resolve``)。``user_type`` や画面の値を quota の根拠にしない
- provider を呼ぶ前に、最大の見込み額を旅行・月の口座へ予約する(``reserve``)。口座の行を ``SELECT … FOR UPDATE`` で
  押さえるので、同じ旅行への同時の要求でも上限を越えない。ちょうど上限は許可(``<=``)
- 予約を commit してから provider を呼び、結果で確定(``settle``)か解放(``release``)する。どちらも冪等
- 価格が分からない・provider が止められている時は呼ばない(fail closed)。再試行は1回まで(``run``)
- 金額は Decimal(小数 4 桁)。表示は円の切り上げ。使用の記録に入力の文章・旅程・鍵を残さない
"""
from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import (
    Entitlement, ProviderUsageEvent, ProviderUsageReservation, TravelPlan, UsageBudgetAccount, UsagePolicyProfile, User,
)

logger = logging.getLogger(__name__)

POLICY_VERSION = "2026-10-29.1"
Q4 = Decimal("0.0001")
WARN_RATIO = Decimal("0.8")
ALERT_RATIO = Decimal("0.9")
CLASS_PRIORITY = ("pro", "plus", "family", "free")  # 最も有利な順(同じ feature を足し合わせない)
USER_CLASSES = ("free", "plus", "family", "pro")
PLAN_CLASSES = ("trip_pass",)
CLASS_LABEL = {"guest": "Guest", "free": "Free", "trip_pass": "Trip Pass", "plus": "Plus", "family": "Family/Group",
               "pro": "Pro/B2B"}
QUOTA_FEATURES = ("cost_jpy_per_plan", "cost_jpy_per_month", "plans_per_month", "ai_calls_per_plan",
                  "ai_input_tokens_per_call", "ai_output_tokens_per_call", "web_searches_per_plan",
                  "places_searches_per_plan", "place_details_per_plan", "photos_per_plan", "route_elements_per_plan",
                  "dynamic_map_loads_per_plan")
FEATURE_PREFIX = "trip_planning."

# 操作 → (単位の名前, 使う quota, 1回の単位の上限の quota)。§2.2
OPERATIONS: Dict[str, Dict[str, Any]] = {
    "ai.generate": {"units": ("input_tokens", "output_tokens"), "count": ("ai_calls_per_plan", None),
                    "per_call": {"input_tokens": "ai_input_tokens_per_call",
                                 "output_tokens": "ai_output_tokens_per_call"},
                    "label": "AI の案の作成"},
    "ai.web_search": {"units": ("requests", "input_tokens"), "count": ("web_searches_per_plan", "requests"),
                      "per_call": {}, "fixed": {"input_tokens": 8000}, "label": "AI の Web 検索"},
    "places.search": {"units": ("requests",), "count": ("places_searches_per_plan", "requests"), "per_call": {},
                      "label": "場所の検索"},
    "places.details": {"units": ("requests",), "count": ("place_details_per_plan", "requests"), "per_call": {},
                       "label": "場所の詳細"},
    "places.photo": {"units": ("requests",), "count": ("photos_per_plan", "requests"), "per_call": {},
                     "label": "場所の写真"},
    "routes.element": {"units": ("elements",), "count": ("route_elements_per_plan", "elements"), "per_call": {},
                       "label": "経路の確認"},
    "map.load": {"units": ("loads",), "count": ("dynamic_map_loads_per_plan", "loads"), "per_call": {},
                 "label": "地図の表示"},
}
FALLBACKS = ["USE_SAVED_CANDIDATES", "CONTINUE_MANUALLY"]


class CostGuardError(Exception):
    """断る理由(code)と HTTP の状態。provider へは何も送っていない。"""

    def __init__(self, code: str, status: int, message: str, usage: Optional[Dict[str, Any]] = None,
                 retry_after: Optional[int] = None, extra: Optional[Dict[str, Any]] = None):
        super().__init__(code)
        self.code, self.status, self.message = code, status, message
        self.usage, self.retry_after, self.extra = usage, retry_after, extra or {}

    def detail(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.usage is not None:
            body["usage"] = self.usage
        if self.status == 429:
            body["fallbacks"] = list(FALLBACKS)
        body.update(self.extra)
        return body


class ProviderTransientError(Exception):
    """provider の一時的な失敗(時間切れ・5xx)。``retry_safe`` が真なら同じ予約の中で1回だけ再試行してよい。"""

    def __init__(self, message: str = "provider error", retry_safe: bool = False):
        super().__init__(message)
        self.retry_safe = retry_safe


@dataclass
class ProviderResult:
    """provider が実際に使った単位(token・回数など)。課金の明細の値があれば raw_cost(provider の通貨)。"""
    units: Dict[str, int]
    result_code: str = "ok"
    payload: Any = None
    model: Optional[str] = None
    raw_cost: Optional[Decimal] = None


@dataclass
class Resolution:
    profile_key: str
    policy_version: str
    plan_cap: Decimal
    monthly_cap: Optional[Decimal]
    plans_per_month: Optional[int]
    quotas: Dict[str, int]
    payer_id: Optional[uuid.UUID]
    monthly_scope: Optional[Tuple[str, uuid.UUID]]
    class_source: str
    profile: UsagePolicyProfile = field(repr=False)


# ===================================================================== provider の登録(有料)

_providers_lock = threading.Lock()
_paid_providers: Dict[str, Dict[str, Any]] = {}
_suspended: Dict[str, str] = {}


def register_provider(name: str, operations: List[str]) -> None:
    """有料の provider を登録する(Gate B の合格の後、各 provider の Gate で使う。試験は fake を登録する)。"""
    unknown = [op for op in operations if op not in OPERATIONS]
    if unknown:
        raise ValueError("unknown operation: %s" % unknown)
    with _providers_lock:
        _paid_providers[name] = {"operations": list(operations)}


def unregister_provider(name: str) -> None:
    with _providers_lock:
        _paid_providers.pop(name, None)
        _suspended.pop(name, None)


def paid_providers() -> Dict[str, Dict[str, Any]]:
    with _providers_lock:
        return {k: dict(v) for k, v in _paid_providers.items()}


def suspend_provider(name: str, reason: str) -> None:
    """請求の照合の差・見込みの超過で止める(運用者が原因を確かめて ``resume_provider`` で戻す)。"""
    with _providers_lock:
        _suspended[name] = reason[:80]
    _count("provider_suspended")
    _audit("provider_usage_suspended", {"provider": name, "reason": reason[:80]})


def resume_provider(name: str) -> None:
    with _providers_lock:
        _suspended.pop(name, None)


def is_suspended(name: str) -> bool:
    with _providers_lock:
        return name in _suspended


# ===================================================================== 小さな道具

def _now() -> datetime:
    return datetime.now(timezone.utc)


def month_key(now: Optional[datetime] = None) -> str:
    """月の口座の期間(UTC。BILL-02 と同じ)。"""
    return (now or _now()).strftime("%Y-%m")


def seconds_to_next_month(now: Optional[datetime] = None) -> int:
    now = now or _now()
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return max(1, int((nxt - now).total_seconds()))


def money(value: Decimal) -> str:
    return str(Decimal(value).quantize(Q4, rounding=ROUND_HALF_UP))


def yen_ceil(value: Decimal) -> int:
    return int(Decimal(value).to_integral_value(rounding=ROUND_CEILING))


def _count(kind: str) -> None:
    try:
        from app.ops import metrics

        metrics.registry.count_security_event(kind)
    except Exception:  # noqa: BLE001
        pass


def _add_metric(name: str, operation: str, value: Decimal) -> None:
    try:
        from app.ops import metrics

        metrics.registry.add_provider_usage(name, operation, float(value))
    except Exception:  # noqa: BLE001
        pass


def _audit(action: str, details: Dict[str, Any], user_id: Any = None, resource_id: Any = None) -> None:
    try:
        from app.services.audit_service import record_audit_event

        record_audit_event(action=action, resource_type="provider_usage", user_id=user_id, resource_id=resource_id,
                           details=details)
    except Exception:  # noqa: BLE001
        pass


# ===================================================================== 価格の版

def load_profile(db: Session, profile_key: str) -> UsagePolicyProfile:
    """有効な最新の版(effective_at が今以前)。無ければ 503(価格の版が無いまま呼ばない)。"""
    row = (db.query(UsagePolicyProfile)
           .filter(UsagePolicyProfile.profile_key == profile_key, UsagePolicyProfile.status == "active",
                   UsagePolicyProfile.effective_at <= _now())
           .order_by(UsagePolicyProfile.effective_at.desc(), UsagePolicyProfile.created_at.desc()).first())
    if row is None:
        raise CostGuardError("cost_profile_unavailable", 503,
                             "利用枠の設定(価格の版)を読めないため、外部の提供元を呼びません。手で続けられます")
    return row


def _profile_by_version(db: Session, profile_key: str, version: str) -> UsagePolicyProfile:
    row = (db.query(UsagePolicyProfile)
           .filter(UsagePolicyProfile.profile_key == profile_key, UsagePolicyProfile.version == version).first())
    if row is None:
        raise CostGuardError("cost_profile_unavailable", 503, "予約の時の価格の版が見つかりません")
    return row


def _jpy_factor(profile: UsagePolicyProfile) -> Decimal:
    return Decimal(profile.fx_rate) * Decimal(profile.tax_factor) * Decimal(profile.safety_factor)


def unit_prices(profile: UsagePolicyProfile, operation: str) -> Dict[str, Decimal]:
    snap = profile.provider_price_snapshot or {}
    op = (snap.get("operations") or {}).get(operation)
    spec = OPERATIONS.get(operation)
    if not op or not spec or snap.get("currency") != "USD":
        raise CostGuardError("cost_profile_unavailable", 503,
                             "この操作の単価が分からないため、外部の提供元を呼びません")
    prices = op.get("unit_prices") or {}
    out: Dict[str, Decimal] = {}
    for unit in spec["units"]:
        raw = prices.get(unit)
        if raw is None:
            raise CostGuardError("cost_profile_unavailable", 503,
                                 "この操作の単価が分からないため、外部の提供元を呼びません")
        try:
            value = Decimal(str(raw))
        except ArithmeticError:
            raise CostGuardError("cost_profile_unavailable", 503, "単価の形が正しくありません")
        if value < 0 or not value.is_finite():
            raise CostGuardError("cost_profile_unavailable", 503, "単価の形が正しくありません")
        out[unit] = value
    return out


def sku_of(profile: UsagePolicyProfile, operation: str) -> Optional[str]:
    op = ((profile.provider_price_snapshot or {}).get("operations") or {}).get(operation) or {}
    return op.get("sku")


def normalize_units(operation: str, units: Dict[str, Any]) -> Dict[str, int]:
    spec = OPERATIONS.get(operation)
    if spec is None:
        raise CostGuardError("unknown_planning_operation", 422, "知らない操作です")
    out: Dict[str, int] = {}
    fixed = spec.get("fixed", {})
    for unit in spec["units"]:
        if unit in fixed:
            out[unit] = int(fixed[unit])
            continue
        value = (units or {}).get(unit, 1 if unit in ("requests", "elements", "loads") else None)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 10_000_000:
            raise CostGuardError("invalid_planning_units", 422, "操作の量(%s)を 0 以上の整数で指定してください" % unit)
        out[unit] = value
    if operation == "ai.web_search":
        # 検索1回の結果の入力は 8,000 token まで予算化する(§2.2)。回数に比例する
        out["requests"] = max(1, out["requests"])
        out["input_tokens"] = int(fixed["input_tokens"]) * out["requests"]
    return out


def cost_of(profile: UsagePolicyProfile, operation: str, units: Dict[str, int]) -> Decimal:
    prices = unit_prices(profile, operation)
    usd = sum((prices[u] * Decimal(int(units.get(u, 0))) for u in prices), Decimal(0))
    return (usd * _jpy_factor(profile)).quantize(Q4, rounding=ROUND_CEILING)


def counts_for(operation: str, units: Dict[str, int]) -> Dict[str, int]:
    key, unit = OPERATIONS[operation]["count"]
    return {key: 1 if unit is None else int(units.get(unit, 0))}


def worst_case_plan_cost(profile: UsagePolicyProfile) -> Decimal:
    """全ての回数の上限を同時に使った時の額(§2.2 の検算。50円を越える版は有効にしない)。"""
    q = profile.feature_quotas or {}
    total = Decimal(0)
    for operation, spec in OPERATIONS.items():
        key, unit = spec["count"]
        n = int(q.get(key, 0))
        if n <= 0:
            continue
        if operation == "ai.generate":
            per = {"input_tokens": int(q.get("ai_input_tokens_per_call", 0)),
                   "output_tokens": int(q.get("ai_output_tokens_per_call", 0))}
            total += cost_of(profile, operation, per) * n
        else:
            per = normalize_units(operation, {unit: n} if unit else {})
            total += cost_of(profile, operation, per)
    return total


# ===================================================================== クラスの解決(§4)

def _active(q, now: datetime):
    return q.filter(Entitlement.status == "active", Entitlement.starts_at <= now,
                    or_(Entitlement.ends_at.is_(None), Entitlement.ends_at > now))


def _is_guest(user: Optional[User]) -> bool:
    return user is None or str(getattr(user, "user_type", "") or "").lower().endswith("guest")


def user_class(db: Session, user: Optional[User], now: Optional[datetime] = None) -> Tuple[str, str]:
    """(クラス, 出典)。付与の無い会員は Free、ゲストは Guest。"""
    if _is_guest(user):
        return "guest", "default"
    now = now or _now()
    assert user is not None
    rows = _active(db.query(Entitlement).filter(
        Entitlement.subject_type == "user", Entitlement.subject_id == user.id,
        Entitlement.feature_key.like(FEATURE_PREFIX + "class.%")), now).all()
    granted = {r.feature_key[len(FEATURE_PREFIX + "class."):]: r.source for r in rows}
    for key in CLASS_PRIORITY:
        if key in granted:
            return key, granted[key]
    return "free", "default"


def _overrides(db: Session, user_id: uuid.UUID, now: datetime) -> Dict[str, int]:
    rows = _active(db.query(Entitlement).filter(
        Entitlement.subject_type == "user", Entitlement.subject_id == user_id,
        Entitlement.feature_key.in_([FEATURE_PREFIX + k for k in QUOTA_FEATURES]),
        Entitlement.quota.isnot(None)), now).all()
    out: Dict[str, int] = {}
    for r in sorted(rows, key=lambda r: r.created_at):
        if r.quota is not None:
            out[r.feature_key[len(FEATURE_PREFIX):]] = int(r.quota)
    return out


def resolve(db: Session, plan: Optional[TravelPlan], caller: Optional[User],
            now: Optional[datetime] = None) -> Resolution:
    now = now or _now()
    owner: Optional[User] = None
    if plan is not None:
        owner = db.get(User, plan.user_id) if plan.user_id else None
    else:
        owner = caller
    if _is_guest(caller) or _is_guest(owner):
        profile = load_profile(db, "guest")
        return Resolution("guest", profile.version, Decimal(0), Decimal(0), 0, dict(profile.feature_quotas or {}),
                          owner.id if owner else None, None, "default", profile)
    assert owner is not None
    if plan is not None:
        has_pass = _active(db.query(Entitlement).filter(
            Entitlement.subject_type == "plan", Entitlement.subject_id == plan.id,
            Entitlement.feature_key == FEATURE_PREFIX + "class.trip_pass"), now).first()
        if has_pass is not None:
            profile = load_profile(db, "trip_pass")
            return Resolution("trip_pass", profile.version, Decimal(profile.plan_cap_jpy), None, None,
                              dict(profile.feature_quotas or {}), owner.id, None, has_pass.source, profile)
    key, source = user_class(db, owner, now)
    profile = load_profile(db, key)
    quotas = dict(profile.feature_quotas or {})
    plan_cap = Decimal(profile.plan_cap_jpy)
    monthly_cap = Decimal(profile.monthly_cap_jpy) if profile.monthly_cap_jpy is not None else None
    per_month = profile.plans_per_month
    if key == "pro":
        # 契約の例外(二者の承認で active になった付与)だけが既定を変える(§3)
        for name, value in _overrides(db, owner.id, now).items():
            if name == "cost_jpy_per_plan":
                plan_cap = Decimal(value)
            elif name == "cost_jpy_per_month":
                monthly_cap = Decimal(value)
            elif name == "plans_per_month":
                per_month = value
            else:
                quotas[name] = value
    return Resolution(key, profile.version, plan_cap, monthly_cap, per_month, quotas, owner.id,
                      ("user", owner.id), source, profile)


# ===================================================================== 口座

def _account(db: Session, scope_type: str, scope_id: uuid.UUID, period: str, res: Resolution,
             cap: Decimal) -> UsageBudgetAccount:
    db.execute(text(
        "INSERT INTO usage_budget_accounts "
        "(id, scope_type, scope_id, period_key, policy_version, profile_key, cap_jpy) "
        "VALUES (:id, :t, :s, :p, :v, :k, :c) ON CONFLICT (scope_type, scope_id, period_key) DO NOTHING"),
        {"id": uuid.uuid4(), "t": scope_type, "s": scope_id, "p": period, "v": res.policy_version,
         "k": res.profile_key, "c": cap})
    row = (db.query(UsageBudgetAccount)
           .filter(UsageBudgetAccount.scope_type == scope_type, UsageBudgetAccount.scope_id == scope_id,
                   UsageBudgetAccount.period_key == period)
           .with_for_update().populate_existing().one())
    return row


def _peek(db: Session, scope_type: str, scope_id: uuid.UUID, period: str) -> Optional[UsageBudgetAccount]:
    return (db.query(UsageBudgetAccount)
            .filter(UsageBudgetAccount.scope_type == scope_type, UsageBudgetAccount.scope_id == scope_id,
                    UsageBudgetAccount.period_key == period).first())


def _usage_body(res: Resolution, plan_acc: Optional[UsageBudgetAccount], requested: Optional[Decimal] = None,
                monthly_acc: Optional[UsageBudgetAccount] = None) -> Dict[str, Any]:
    used = Decimal(plan_acc.settled_jpy) if plan_acc else Decimal(0)
    reserved = Decimal(plan_acc.reserved_jpy) if plan_acc else Decimal(0)
    remaining = max(Decimal(0), res.plan_cap - used - reserved)
    body: Dict[str, Any] = {
        "currency": "JPY", "plan_cap": money(res.plan_cap), "plan_used": money(used), "plan_reserved": money(reserved),
        "plan_remaining": money(remaining), "policy_version": res.policy_version, "class": res.profile_key,
    }
    if requested is not None:
        body["requested_max"] = money(requested)
    if res.monthly_cap is not None:
        m_used = Decimal(monthly_acc.settled_jpy) + Decimal(monthly_acc.reserved_jpy) if monthly_acc else Decimal(0)
        body["monthly_cap"] = money(res.monthly_cap)
        body["monthly_remaining"] = money(max(Decimal(0), res.monthly_cap - m_used))
    return body


def release_expired(db: Session, plan_id: Optional[uuid.UUID] = None, now: Optional[datetime] = None) -> int:
    """期限を過ぎた予約を解放する(provider の応答が消えた時の回復)。解放した数。"""
    now = now or _now()
    q = db.query(ProviderUsageReservation.id).filter(ProviderUsageReservation.status == "reserved",
                                                     ProviderUsageReservation.expires_at < now)
    if plan_id is not None:
        q = q.filter(ProviderUsageReservation.plan_id == plan_id)
    ids = [r[0] for r in q.limit(200).all()]
    for rid in ids:
        release(db, rid, "expired")
    return len(ids)


# ===================================================================== 予約・確定・解放(§5)

def _check_quotas(res: Resolution, operation: str, units: Dict[str, int], need: Dict[str, int],
                  plan_acc: Optional[UsageBudgetAccount]) -> Optional[CostGuardError]:
    for unit, qkey in OPERATIONS[operation]["per_call"].items():
        limit = int(res.quotas.get(qkey, 0))
        if units.get(unit, 0) > limit:
            return CostGuardError("feature_quota_exceeded", 429, "1回の量の上限(%s %d)を越えています" % (unit, limit),
                                  extra={"feature": FEATURE_PREFIX + qkey, "limit": limit})
    counts = (plan_acc.counts or {}) if plan_acc else {}
    for qkey, n in need.items():
        limit = int(res.quotas.get(qkey, 0))
        used = int(counts.get(qkey, 0))
        if used + n > limit:
            return CostGuardError("feature_quota_exceeded", 429,
                                  "この旅行の「%s」の回数の上限(%d)に達しました。保存した候補と手での編集は続けられます"
                                  % (OPERATIONS[operation]["label"], limit),
                                  extra={"feature": FEATURE_PREFIX + qkey, "limit": limit, "used": used})
    return None


def _denial(db: Session, res: Resolution, plan: TravelPlan, operation: str, units: Dict[str, int], need: Dict[str, int],
            cost: Decimal, plan_acc: Optional[UsageBudgetAccount], monthly_acc: Optional[UsageBudgetAccount],
            month: str) -> Optional[CostGuardError]:
    """断る理由(無ければ None)。§5 の 4 の順。"""
    if res.profile_key == "guest":
        return CostGuardError("guest_provider_forbidden", 403,
                              "ゲスト・共有の閲覧からは外部の AI・有料の検索を使いません。会員になると使えます")
    quota = _check_quotas(res, operation, units, need, plan_acc)
    if quota is not None:
        quota.usage = _usage_body(res, plan_acc, cost, monthly_acc)
        return quota
    used = (Decimal(plan_acc.settled_jpy) + Decimal(plan_acc.reserved_jpy)) if plan_acc else Decimal(0)
    if used + cost > res.plan_cap:
        return CostGuardError("plan_cost_limit_reached", 429,
                              "この旅行の旅程相談 API 利用枠に達しました。手動編集と保存済み候補は引き続き利用できます",
                              usage=_usage_body(res, plan_acc, cost, monthly_acc))
    if res.monthly_cap is not None:
        new_plan = plan_acc is None or plan_acc.counted_month != month
        plans_used = int(monthly_acc.plans_used) if monthly_acc else 0
        if new_plan and res.plans_per_month is not None and plans_used + 1 > res.plans_per_month:
            return CostGuardError("monthly_plan_quota_exceeded", 429,
                                  "今月 AI 旅程相談を使える旅行の数(%d)に達しました。来月まで待つか、手で続けてください"
                                  % res.plans_per_month, usage=_usage_body(res, plan_acc, cost, monthly_acc),
                                  retry_after=seconds_to_next_month(),
                                  extra={"plans_per_month": res.plans_per_month, "plans_used": plans_used})
        m_used = (Decimal(monthly_acc.settled_jpy) + Decimal(monthly_acc.reserved_jpy)) if monthly_acc else Decimal(0)
        if m_used + cost > res.monthly_cap:
            return CostGuardError("monthly_quota_exceeded", 429,
                                  "今月の旅程相談 API 利用枠に達しました。来月まで待つか、手で続けてください",
                                  usage=_usage_body(res, plan_acc, cost, monthly_acc),
                                  retry_after=seconds_to_next_month())
    return None


def estimate(db: Session, plan: TravelPlan, caller: User, operation: str, units: Dict[str, Any]) -> Dict[str, Any]:
    """provider を呼ばずに、最大の見込み額と今の残りで許されるかを返す(予約しない)。"""
    res = resolve(db, plan, caller)
    norm = normalize_units(operation, units)
    cost = cost_of(res.profile, operation, norm)
    month = month_key()
    plan_acc = _peek(db, "plan", plan.id, "plan")
    monthly_acc = _peek(db, res.monthly_scope[0], res.monthly_scope[1], month) if res.monthly_scope else None
    denial = _denial(db, res, plan, operation, norm, counts_for(operation, norm), cost, plan_acc, monthly_acc, month)
    usage = _usage_body(res, plan_acc, cost, monthly_acc)
    remaining_after = Decimal(usage["plan_remaining"]) - cost
    return {
        "action": operation, "label": OPERATIONS[operation]["label"], "units": norm, "max_cost_jpy": money(cost),
        "max_cost_yen_ceil": yen_ceil(cost), "remaining_after_jpy": money(max(Decimal(0), remaining_after)),
        "allowed": denial is None, "reason": denial.code if denial else None,
        "needs_confirmation": denial is None and (Decimal(usage["plan_used"]) + Decimal(usage["plan_reserved"]) + cost)
        >= res.plan_cap * WARN_RATIO,
        "connected": any(operation in p["operations"] for p in paid_providers().values()),
        "usage": usage,
    }


def reserve(db: Session, plan: TravelPlan, caller: User, operation: str, provider: str, units: Dict[str, Any],
            idempotency_key: str) -> ProviderUsageReservation:
    """最大の見込み額を予約して commit する。断る時は CostGuardError(何も変えない)。"""
    if not idempotency_key or len(idempotency_key) > 80:
        raise CostGuardError("idempotency_key_required", 422, "Idempotency-Key(80文字まで)が要ります")
    if is_suspended(provider):
        raise CostGuardError("provider_suspended", 503,
                             "この提供元は費用の確認のため止めています。手で続けられます")
    norm = normalize_units(operation, units)
    existing = (db.query(ProviderUsageReservation)
                .filter(ProviderUsageReservation.user_id == caller.id,
                        ProviderUsageReservation.idempotency_key == idempotency_key).first())
    if existing is not None:
        if existing.plan_id != plan.id or existing.operation != operation or existing.units != norm:
            raise CostGuardError("idempotency_conflict", 409, "同じ Idempotency-Key で違う操作が送られました")
        return existing
    res = resolve(db, plan, caller)
    cost = cost_of(res.profile, operation, norm)
    need = counts_for(operation, norm)
    release_expired(db, plan.id)
    month = month_key()
    monthly_acc = None
    if res.monthly_scope is not None and res.profile_key != "guest":
        monthly_acc = _account(db, res.monthly_scope[0], res.monthly_scope[1], month, res,
                               res.monthly_cap or Decimal(0))
    plan_acc = _account(db, "plan", plan.id, "plan", res, res.plan_cap) if res.profile_key != "guest" else None
    denial = _denial(db, res, plan, operation, norm, need, cost, plan_acc, monthly_acc, month)
    if denial is not None:
        db.commit()  # 口座の行の鍵を外す(作った空の口座は残してよい。要求の他の変更はまだ無い)
        _count("provider_usage_denied")
        _add_metric("denied_total", operation, Decimal(1))
        raise denial
    assert plan_acc is not None
    plan_acc.reserved_jpy = Decimal(plan_acc.reserved_jpy) + cost
    plan_acc.cap_jpy = res.plan_cap
    plan_acc.profile_key, plan_acc.policy_version = res.profile_key, res.policy_version
    counts = dict(plan_acc.counts or {})
    for k, n in need.items():
        counts[k] = int(counts.get(k, 0)) + n
    plan_acc.counts = counts
    plan_acc.revision += 1
    plan_acc.updated_at = _now()
    if monthly_acc is not None:
        monthly_acc.reserved_jpy = Decimal(monthly_acc.reserved_jpy) + cost
        monthly_acc.cap_jpy = res.monthly_cap or Decimal(0)
        monthly_acc.profile_key, monthly_acc.policy_version = res.profile_key, res.policy_version
        if plan_acc.counted_month != month:
            monthly_acc.plans_used += 1
            plan_acc.counted_month = month
        monthly_acc.revision += 1
        monthly_acc.updated_at = _now()
    ttl = int(getattr(settings, "COST_GUARD_RESERVATION_TTL_SECONDS", 600))
    row = ProviderUsageReservation(
        id=uuid.uuid4(), idempotency_key=idempotency_key, user_id=caller.id, billable_owner_user_id=res.payer_id,
        plan_id=plan.id, provider=provider, operation=operation, units=norm, counts=need, max_cost_jpy=cost,
        status="reserved", profile_key=res.profile_key, policy_version=res.policy_version,
        plan_account_id=plan_acc.id, monthly_account_id=monthly_acc.id if monthly_acc else None,
        expires_at=_now() + timedelta(seconds=ttl))
    db.add(row)
    db.commit()
    _add_metric("reserved_jpy", operation, cost)
    used = Decimal(plan_acc.settled_jpy) + Decimal(plan_acc.reserved_jpy)
    if used >= res.plan_cap * ALERT_RATIO and res.plan_cap > 0:
        _count("provider_usage_plan_alert")
        logger.warning("cost_guard: 旅行の利用枠が 90%% を越えました(policy %s・%s)", res.policy_version, operation)
    return row


def _finish(db: Session, reservation_id: uuid.UUID, settle_units: Optional[Dict[str, int]], result_code: str,
            model: Optional[str] = None, raw_cost: Optional[Decimal] = None) -> ProviderUsageReservation:
    row = (db.query(ProviderUsageReservation).filter(ProviderUsageReservation.id == reservation_id)
           .with_for_update().populate_existing().one())
    if row.status != "reserved":
        return row  # 冪等(二度目の確定・解放は何もしない)
    profile = _profile_by_version(db, row.profile_key, row.policy_version)
    max_cost = Decimal(row.max_cost_jpy)
    accounts = [a for a in (row.monthly_account_id, row.plan_account_id) if a is not None]
    rows = (db.query(UsageBudgetAccount).filter(UsageBudgetAccount.id.in_(accounts))
            .order_by(UsageBudgetAccount.scope_type.desc()).with_for_update().populate_existing().all())
    locked = {a.id: a for a in rows}
    if settle_units is None:
        actual = Decimal(0)
        status = "released"
    else:
        actual = cost_of(profile, row.operation, settle_units)
        status = "settled"
    for acc in locked.values():
        acc.reserved_jpy = max(Decimal(0), Decimal(acc.reserved_jpy) - max_cost)
        acc.settled_jpy = Decimal(acc.settled_jpy) + actual
        if status == "released" and acc.scope_type == "plan":
            counts = dict(acc.counts or {})
            for k, n in (row.counts or {}).items():
                counts[k] = max(0, int(counts.get(k, 0)) - int(n))
            acc.counts = counts
        acc.revision += 1
        acc.updated_at = _now()
    row.status = status
    row.finished_at = _now()
    units = settle_units or {}
    db.add(ProviderUsageEvent(
        id=uuid.uuid4(), reservation_id=row.id, user_id=row.user_id, plan_id=row.plan_id,
        organization_id=row.organization_id, class_snapshot=row.profile_key, provider=row.provider, model=model,
        sku=sku_of(profile, row.operation), operation=row.operation, input_tokens=units.get("input_tokens"),
        output_tokens=units.get("output_tokens"),
        request_count=units.get("requests", units.get("loads")), matrix_elements=units.get("elements"),
        raw_cost=raw_cost, raw_currency="USD" if raw_cost is not None else None, fx_rate=Decimal(profile.fx_rate),
        tax_factor=Decimal(profile.tax_factor), estimated_cost_jpy=actual, actual_cost_jpy=None,
        price_version=row.policy_version, result_code=result_code[:32]))
    db.commit()
    if status == "settled":
        _add_metric("estimated_jpy", row.operation, actual)
        if actual > max_cost:
            # 見込みを越えた(単位の報告が予約を越えた)。記録は事実のまま残し、provider を止める
            _count("provider_usage_over_estimate")
            suspend_provider(row.provider, "settled_over_estimate")
    return row


def settle(db: Session, reservation_id: uuid.UUID, units: Dict[str, Any], result_code: str = "ok",
           model: Optional[str] = None, raw_cost: Optional[Decimal] = None) -> ProviderUsageReservation:
    row = db.get(ProviderUsageReservation, reservation_id)
    if row is None:
        raise CostGuardError("reservation_not_found", 404, "予約が見つかりません")
    norm = normalize_units(row.operation, units)
    return _finish(db, reservation_id, norm, result_code, model, raw_cost)


def release(db: Session, reservation_id: uuid.UUID, result_code: str = "released") -> ProviderUsageReservation:
    return _finish(db, reservation_id, None, result_code)


def run(db: Session, plan: TravelPlan, caller: User, operation: str, provider: str, units: Dict[str, Any],
        idempotency_key: str, call: Callable[[Dict[str, int]], ProviderResult]) -> Tuple[Any, Dict[str, Any]]:
    """予約 → 呼び出し → 確定/解放。provider の一時的な失敗は、二重の課金にならない時だけ1回再試行する。"""
    if provider not in paid_providers():
        raise CostGuardError("provider_not_connected", 503, "外部の有料の提供元は未接続です。手で続けられます")
    if operation not in paid_providers()[provider]["operations"]:
        raise CostGuardError("unknown_planning_operation", 422, "この提供元はこの操作を扱いません")
    row = reserve(db, plan, caller, operation, provider, units, idempotency_key)
    if row.status != "reserved":
        raise CostGuardError("idempotent_replay", 409, "同じ操作は既に終わっています(二度目は呼びません)",
                             extra={"reservation_status": row.status})
    attempts = 0
    while True:
        try:
            result = call(dict(row.units))
            break
        except ProviderTransientError as error:
            attempts += 1
            if attempts <= 1 and error.retry_safe:
                _add_metric("retry_total", operation, Decimal(1))
                continue
            release(db, row.id, "provider_error")
            raise CostGuardError("provider_unavailable", 503,
                                 "提供元から応答がありません。枠は使っていません。手で続けられます")
        except Exception:
            release(db, row.id, "provider_error")
            raise
    settled = settle(db, row.id, result.units, result.result_code, result.model, result.raw_cost)
    res = resolve(db, plan, caller)
    plan_acc = _peek(db, "plan", plan.id, "plan")
    usage = _usage_body(res, plan_acc)
    usage["reservation_status"] = settled.status
    return result.payload, usage


# ===================================================================== 照合(請求の明細)

def reconcile(db: Session, provider: str, invoice: List[Dict[str, Any]]) -> Dict[str, Any]:
    """請求の明細(reservation_id・actual_cost_jpy)を使用の記録へ足す。差が 1円と 10% の大きい方を越えたら止める。"""
    flagged = 0
    for line in invoice:
        try:
            rid = uuid.UUID(str(line["reservation_id"]))
            actual = Decimal(str(line["actual_cost_jpy"]))
        except (KeyError, ValueError, ArithmeticError):
            continue
        event = (db.query(ProviderUsageEvent)
                 .filter(ProviderUsageEvent.reservation_id == rid, ProviderUsageEvent.provider == provider).first())
        if event is None:
            continue
        event.actual_cost_jpy = actual
        delta = abs(actual - Decimal(event.estimated_cost_jpy))
        _add_metric("reconciliation_delta_jpy", event.operation, delta)
        limit = max(Decimal(1), Decimal(event.estimated_cost_jpy) * Decimal("0.1"))
        if delta > limit and actual > event.estimated_cost_jpy:
            flagged += 1
        _add_metric("actual_jpy", event.operation, actual)
    db.commit()
    if flagged:
        suspend_provider(provider, "reconciliation_delta")
    return {"flagged": flagged, "suspended": is_suspended(provider)}


# ===================================================================== 表示(§6・§8)

def plan_summary(db: Session, plan: TravelPlan, caller: User) -> Dict[str, Any]:
    res = resolve(db, plan, caller)
    month = month_key()
    plan_acc = _peek(db, "plan", plan.id, "plan")
    monthly_acc = _peek(db, res.monthly_scope[0], res.monthly_scope[1], month) if res.monthly_scope else None
    used = Decimal(plan_acc.settled_jpy) if plan_acc else Decimal(0)
    reserved = Decimal(plan_acc.reserved_jpy) if plan_acc else Decimal(0)
    total = used + reserved
    if res.profile_key == "guest":
        state = "guest"
    elif total >= res.plan_cap:
        state = "limit_reached"
    elif res.monthly_cap is not None and monthly_acc is not None and \
            Decimal(monthly_acc.settled_jpy) + Decimal(monthly_acc.reserved_jpy) >= res.monthly_cap:
        state = "monthly_limit_reached"
    elif (res.monthly_cap is not None and res.plans_per_month is not None
          and (plan_acc is None or plan_acc.counted_month != month)
          and (monthly_acc.plans_used if monthly_acc else 0) >= res.plans_per_month):
        state = "monthly_plans_reached"
    elif res.plan_cap > 0 and total >= res.plan_cap * WARN_RATIO:
        state = "warning"
    else:
        state = "ok"
    counts = (plan_acc.counts or {}) if plan_acc else {}
    calls = []
    for operation, spec in OPERATIONS.items():
        key = spec["count"][0]
        limit = int(res.quotas.get(key, 0))
        calls.append({"operation": operation, "label": spec["label"], "feature": FEATURE_PREFIX + key,
                      "limit": limit, "used": int(counts.get(key, 0)),
                      "remaining": max(0, limit - int(counts.get(key, 0)))})
    connected = sorted({op for p in paid_providers().values() for op in p["operations"]})
    body = {
        "plan_id": str(plan.id), "class": res.profile_key, "class_label": CLASS_LABEL[res.profile_key],
        "class_source": res.class_source, "policy_version": res.policy_version, "currency": "JPY",
        "plan_cap_jpy": money(res.plan_cap), "plan_used_jpy": money(used), "plan_reserved_jpy": money(reserved),
        "plan_remaining_jpy": money(max(Decimal(0), res.plan_cap - total)),
        "plan_used_yen_ceil": yen_ceil(total), "plan_cap_yen": yen_ceil(res.plan_cap),
        "warn_at_jpy": money(res.plan_cap * WARN_RATIO), "state": state,
        "monthly_cap_jpy": money(res.monthly_cap) if res.monthly_cap is not None else None,
        "monthly_used_jpy": money(Decimal(monthly_acc.settled_jpy) + Decimal(monthly_acc.reserved_jpy))
        if monthly_acc else (money(Decimal(0)) if res.monthly_cap is not None else None),
        "plans_per_month": res.plans_per_month,
        "plans_used_this_month": int(monthly_acc.plans_used) if monthly_acc else 0,
        "counted_this_month": bool(plan_acc and plan_acc.counted_month == month),
        "reset_at": (_now() + timedelta(seconds=seconds_to_next_month())).replace(microsecond=0).isoformat()
        if res.monthly_cap is not None else None,
        "calls": calls, "connected_operations": connected, "providers_connected": bool(connected),
        "fallbacks": list(FALLBACKS),
    }
    return body


def user_summary(db: Session, user: User) -> Dict[str, Any]:
    """GET /entitlements: 自分のクラス・feature・quota・今月の使用(旅行に依らない部分)。"""
    res = resolve(db, None, user)
    month = month_key()
    monthly_acc = _peek(db, "user", user.id, month) if res.monthly_scope else None
    features: List[Dict[str, Any]] = [{"feature": FEATURE_PREFIX + "class." + res.profile_key, "quota": None}]
    features += [{"feature": FEATURE_PREFIX + "cost_jpy_per_plan", "quota": yen_ceil(res.plan_cap)}]
    if res.monthly_cap is not None:
        features.append({"feature": FEATURE_PREFIX + "cost_jpy_per_month", "quota": yen_ceil(res.monthly_cap)})
    if res.plans_per_month is not None:
        features.append({"feature": FEATURE_PREFIX + "plans_per_month", "quota": res.plans_per_month})
    features += [{"feature": FEATURE_PREFIX + k, "quota": int(v)} for k, v in sorted(res.quotas.items())]
    return {
        "class": res.profile_key, "class_label": CLASS_LABEL[res.profile_key], "class_source": res.class_source,
        "profile_key": res.profile_key, "policy_version": res.policy_version, "currency": "JPY",
        "plan_cap_jpy": money(res.plan_cap),
        "monthly_cap_jpy": money(res.monthly_cap) if res.monthly_cap is not None else None,
        "monthly_used_jpy": money(Decimal(monthly_acc.settled_jpy) + Decimal(monthly_acc.reserved_jpy))
        if monthly_acc else money(Decimal(0)),
        "plans_per_month": res.plans_per_month,
        "plans_used_this_month": int(monthly_acc.plans_used) if monthly_acc else 0,
        "reset_at": (_now() + timedelta(seconds=seconds_to_next_month())).replace(microsecond=0).isoformat(),
        "features": features, "providers_connected": bool(paid_providers()),
        "as_of": _now().replace(microsecond=0).isoformat(),
    }


def admin_plan_usage(db: Session, plan_id: uuid.UUID) -> Dict[str, Any]:
    plan_acc = _peek(db, "plan", plan_id, "plan")
    rows = (db.query(ProviderUsageEvent).filter(ProviderUsageEvent.plan_id == plan_id)
            .order_by(ProviderUsageEvent.occurred_at.desc()).limit(200).all())
    by_provider: Dict[str, Dict[str, Any]] = {}
    for e in rows:
        b = by_provider.setdefault(e.provider, {"provider": e.provider, "events": 0, "estimated_jpy": Decimal(0),
                                                "actual_jpy": Decimal(0)})
        b["events"] += 1
        b["estimated_jpy"] += Decimal(e.estimated_cost_jpy)
        b["actual_jpy"] += Decimal(e.actual_cost_jpy or 0)
    open_count = (db.query(ProviderUsageReservation)
                  .filter(ProviderUsageReservation.plan_id == plan_id, ProviderUsageReservation.status == "reserved")
                  .count())
    denied = sum(1 for e in rows if e.result_code != "ok")
    return {
        "plan_id": str(plan_id),
        "account": None if plan_acc is None else {
            "class": plan_acc.profile_key, "policy_version": plan_acc.policy_version,
            "cap_jpy": money(plan_acc.cap_jpy),
            "reserved_jpy": money(plan_acc.reserved_jpy), "settled_jpy": money(plan_acc.settled_jpy),
            "counts": plan_acc.counts or {}, "counted_month": plan_acc.counted_month},
        "open_reservations": open_count, "not_ok_events": denied,
        "providers": [{**v, "estimated_jpy": money(v["estimated_jpy"]), "actual_jpy": money(v["actual_jpy"])}
                      for v in by_provider.values()],
        "suspended_providers": sorted(_suspended),
    }
