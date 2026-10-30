"""
[Gate OpsCMS] 運用コンソール(管理者だけ): 外部 API の接続の状態・旅行ごとの原価の台帳・Cloud の環境・Fake の家族旅行の試験。

正本: FR-059(1旅行 50円・40円で利用者の警告・45円で運用の知らせ・超える見込みは provider へ送る前に断る)と
利用者の指示「TravelCanvas API運用CMS・テスト基盤: Claude実装指示 2026-10-30」の Phase 0(有料の API を使わない)。

- GET  /admin/ops/overview              : 原価の要約(Fake と実の提供元を分ける)・閾値・止めている提供元・取れない値は unavailable
- GET  /admin/ops/providers             : 提供元ごとの用途・登録・停止・価格の版・鍵の設定の有無(値は返さない)・live の可否
- POST /admin/ops/providers/{name}/suspend | resume : 提供元を止める・戻す(理由が要る。監査)
- GET  /admin/ops/ledger                : 旅行ごとの口座(確定・予約中・残り・状態・提供元別)。旅行の題・相談の文章は返さない
- GET  /admin/ops/cloud                 : 実行環境から読める値だけ(GCP の請求・予算・有効な API はアプリから取得していない=unavailable)
- POST /admin/ops/test-runs/family-fake : 枚方発・大人4人の家族旅行の条件で、Fake の提供元に原価の予約→確定を上限まで繰り返す
                                          (外へは何も送らない。本番の環境では断る)

鍵の平文を返す API は作らない(設定の有無の真偽だけ)。管理者の多要素認証(require_admin)を全てに掛ける。
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.admin import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.models import (
    ProviderUsageEvent, ProviderUsageReservation, TravelPlan, UsageBudgetAccount, User, UserType,
)
from app.services import cost_guard as cg
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/admin/ops", tags=["admin-ops"])

FAKE_PROVIDER = "fake"
# 利用者の確定した金額の閾値(FR-059: 50円の 80%・90%)
USER_WARN_JPY = Decimal(40)
OPS_ALERT_JPY = Decimal(45)
HARD_CAP_JPY = Decimal(50)

# 提供元の一覧(用途と、使う鍵の設定の名前)。鍵の値は読まない・返さない(設定の有無だけ)
PROVIDER_CATALOG: List[Dict[str, Any]] = [
    {"name": "openai", "label": "OpenAI · Responses API", "purpose": "旅行相談・案の作成",
     "operations": ["ai.generate", "ai.web_search"], "secret_setting": "OPENAI_API_KEY",
     "notes": "ChatGPT の契約と API の課金は別。API の組織・プロジェクト・支出の上限は OpenAI Platform で確認する"},
    {"name": "google_maps_js", "label": "Google Maps JavaScript API", "purpose": "ブラウザの地図の表示",
     "operations": ["map.load"], "secret_setting": None,
     "notes": "ブラウザ用の鍵は HTTP referrer と許可 API で制限する(この版のコードに鍵の設定の項目は無い)"},
    {"name": "google_places", "label": "Places API (New)", "purpose": "候補の検索・詳細・写真",
     "operations": ["places.search", "places.details", "places.photo"], "secret_setting": None,
     "notes": "Field Mask と SKU を固定してから有効にする(この版のコードにサーバー用の鍵の設定の項目は無い)"},
    {"name": "google_routes", "label": "Routes API", "purpose": "車の経路・所要時間",
     "operations": ["routes.element"], "secret_setting": None,
     "notes": "経路の要素の数を旅行の上限に入れて予約する(この版のコードに鍵の設定の項目は無い)"},
    {"name": FAKE_PROVIDER, "label": "Fake Provider", "purpose": "上限・quota・失敗の試験(課金なし)",
     "operations": list(cg.OPERATIONS), "secret_setting": None,
     "notes": "外へは何も送らない。使用の額は試験の値で、実の請求とは混ぜない"},
]

# 家族旅行の試験の条件(利用者の確定した条件)
FAMILY_CASE = {
    "origin": "大阪府枚方市", "travelers": "大人4人", "transport": "自家用車・高速道路", "nights": "1泊2日",
    "max_one_way": "片道3時間以内", "lodging_budget_jpy": [60000, 80000], "candidates": "3〜5件",
    "replans": "2〜3回", "note": "宿泊費など旅行の予算(FR-027)と、API の原価の枠(FR-059)は別に数える",
}


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.replace(microsecond=0).isoformat() if value else None


def _audit(request: Request, admin: User, action: str, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="ops_console", user_id=admin.id, resource_id=admin.id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255], details=details)


def _reason(payload: Any) -> str:
    reason = payload.get("reason") if isinstance(payload, dict) else None
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 200:
        raise _bad("ops_reason_required", "理由を200文字までで入力してください")
    return reason.strip()


def _price_state(db: Session) -> Dict[str, Any]:
    """価格の版(free の有効な版)で、操作ごとに単価が分かるか。読めなければ unavailable。"""
    try:
        profile = cg.load_profile(db, "free")
    except cg.CostGuardError:
        return {"policy_version": None, "known": {}}
    known: Dict[str, bool] = {}
    for op in cg.OPERATIONS:
        try:
            cg.unit_prices(profile, op)
            known[op] = True
        except cg.CostGuardError:
            known[op] = False
    return {"policy_version": profile.version, "known": known,
            "fx_rate": str(profile.fx_rate), "tax_factor": str(profile.tax_factor),
            "safety_factor": str(profile.safety_factor)}


def _event_totals(db: Session, since: Optional[datetime] = None) -> Dict[str, Dict[str, Any]]:
    q = db.query(ProviderUsageEvent.provider, func.count(ProviderUsageEvent.id),
                 func.coalesce(func.sum(ProviderUsageEvent.estimated_cost_jpy), 0),
                 func.coalesce(func.sum(ProviderUsageEvent.actual_cost_jpy), 0))
    if since is not None:
        q = q.filter(ProviderUsageEvent.occurred_at >= since)
    out: Dict[str, Dict[str, Any]] = {}
    for provider, n, est, act in q.group_by(ProviderUsageEvent.provider).all():
        out[provider] = {"events": int(n), "estimated_jpy": cg.money(Decimal(est)),
                         "actual_jpy": cg.money(Decimal(act))}
    return out


def _state_of(total: Decimal, cap: Decimal) -> str:
    if cap <= 0:
        return "no_budget"
    if total > cap:
        return "over_cap"
    if total >= cap:
        return "limit_reached"
    if total >= cap * cg.ALERT_RATIO:
        return "ops_alert"
    if total >= cap * cg.WARN_RATIO:
        return "user_warning"
    return "ok"


# ===================================================================== 概要

@router.get("/overview")
def ops_overview(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    totals = _event_totals(db, month_start)
    fake = totals.get(FAKE_PROVIDER, {"events": 0, "estimated_jpy": cg.money(Decimal(0)),
                                      "actual_jpy": cg.money(Decimal(0))})
    live = {k: v for k, v in totals.items() if k != FAKE_PROVIDER and not k.startswith("fake")}
    live_est = sum((Decimal(v["estimated_jpy"]) for v in live.values()), Decimal(0))
    accounts = db.query(UsageBudgetAccount).filter(UsageBudgetAccount.scope_type == "plan").all()
    states: Dict[str, int] = {}
    for acc in accounts:
        s = _state_of(Decimal(acc.settled_jpy) + Decimal(acc.reserved_jpy), Decimal(acc.cap_jpy))
        states[s] = states.get(s, 0) + 1
    open_res = db.query(ProviderUsageReservation).filter(ProviderUsageReservation.status == "reserved").count()
    price = _price_state(db)
    return {
        "as_of": _iso(now), "environment": (settings.APP_ENV or "development"),
        "policy_version": price["policy_version"] or cg.POLICY_VERSION,
        "thresholds": {"user_warning_jpy": cg.money(USER_WARN_JPY), "ops_alert_jpy": cg.money(OPS_ALERT_JPY),
                       "hard_cap_jpy": cg.money(HARD_CAP_JPY)},
        "month": cg.month_key(now),
        "fake_usage": {**fake, "label": "Fake の試験の額(実の請求ではない)"},
        "live_usage": {"providers": live, "estimated_jpy": cg.money(live_est),
                       "label": "アプリの見込みの原価(実の請求とは別。照合は請求の明細が届いてから)"},
        "connected_paid_providers": sorted(cg.paid_providers()),
        "suspended_providers": cg.suspended_providers(),
        "plan_accounts": {"total": len(accounts), "by_state": states},
        "open_reservations": open_res,
        "cloud_billing": {"status": "unavailable",
                          "message": "Cloud Billing の請求額・予算はアプリから取得していません(Cloud Console で確認)"},
    }


# ===================================================================== 提供元

@router.get("/providers")
def ops_providers(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    price = _price_state(db)
    registered = cg.paid_providers()
    suspended = cg.suspended_providers()
    month_start = _now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    totals = _event_totals(db, month_start)
    rows = []
    for p in PROVIDER_CATALOG:
        name = p["name"]
        setting = p["secret_setting"]
        if setting is None:
            secret = "not_defined" if name != FAKE_PROVIDER else "not_needed"
        else:
            secret = "configured" if getattr(settings, setting, None) else "missing"
        ops_known = [price["known"].get(op, False) for op in p["operations"]]
        price_state = "unavailable" if not price["known"] else ("known" if all(ops_known) else "partial")
        is_fake = name == FAKE_PROVIDER
        live_ready = (not is_fake) and name in registered and secret == "configured" and price_state == "known" \
            and name not in suspended
        rows.append({
            "name": name, "label": p["label"], "purpose": p["purpose"], "operations": p["operations"],
            "kind": "fake" if is_fake else "paid",
            "registered": is_fake or name in registered,
            "suspended": name in suspended, "suspended_reason": suspended.get(name),
            "contract": "not_billable" if is_fake else "unverified",
            "secret": secret, "secret_setting": setting,
            "price_profile": price_state, "policy_version": price["policy_version"],
            "live_calls": "test_only" if is_fake else ("ready" if live_ready else "disabled"),
            "month_usage": totals.get(name),
            "notes": p["notes"],
        })
    return {"as_of": _iso(_now()), "providers": rows,
            "rule": "契約の確認・価格の版・鍵・提供元の登録の全てが揃うまで、有料の提供元へは送らない(fail closed)"}


@router.post("/providers/{name}/suspend")
def ops_suspend(name: str, request: Request, payload: Dict[str, Any] = Body(...),
                admin: User = Depends(require_admin)):
    if name not in {p["name"] for p in PROVIDER_CATALOG}:
        raise _bad("unknown_provider", "知らない提供元です", 404)
    reason = _reason(payload)
    shared = cg.suspend_provider(name, "ops_console")
    _audit(request, admin, "ops_provider_suspended", {"provider": name, "reason": reason[:200], "shared": shared})
    return {"provider": name, "suspended": True, "shared": shared}


@router.post("/providers/{name}/resume")
def ops_resume(name: str, request: Request, payload: Dict[str, Any] = Body(...),
               admin: User = Depends(require_admin)):
    if name not in {p["name"] for p in PROVIDER_CATALOG}:
        raise _bad("unknown_provider", "知らない提供元です", 404)
    reason = _reason(payload)
    shared = cg.resume_provider(name, reason)
    _audit(request, admin, "ops_provider_resumed", {"provider": name, "reason": reason[:200], "shared": shared})
    return {"provider": name, "suspended": cg.is_suspended(name), "shared": shared}


# ===================================================================== 原価の台帳

@router.get("/ledger")
def ops_ledger(limit: int = Query(50, ge=1, le=200), admin: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    accounts = (db.query(UsageBudgetAccount).filter(UsageBudgetAccount.scope_type == "plan")
                .order_by(UsageBudgetAccount.updated_at.desc()).limit(limit).all())
    ids = [a.scope_id for a in accounts]
    per: Dict[uuid.UUID, Dict[str, Any]] = {}
    if ids:
        q = (db.query(ProviderUsageEvent.plan_id, ProviderUsageEvent.provider, ProviderUsageEvent.result_code,
                      func.count(ProviderUsageEvent.id),
                      func.coalesce(func.sum(ProviderUsageEvent.estimated_cost_jpy), 0))
             .filter(ProviderUsageEvent.plan_id.in_(ids))
             .group_by(ProviderUsageEvent.plan_id, ProviderUsageEvent.provider, ProviderUsageEvent.result_code))
        for plan_id, provider, code, n, est in q.all():
            b = per.setdefault(plan_id, {"providers": {}, "released": 0, "settled": 0})
            pb = b["providers"].setdefault(provider, {"events": 0, "estimated_jpy": Decimal(0)})
            pb["events"] += int(n)
            pb["estimated_jpy"] += Decimal(est)
            if code in ("released", "provider_error"):
                b["released"] += int(n)
            else:
                b["settled"] += int(n)
    rows = []
    for a in accounts:
        total = Decimal(a.settled_jpy) + Decimal(a.reserved_jpy)
        info = per.get(a.scope_id, {"providers": {}, "released": 0, "settled": 0})
        providers = {k: {"events": v["events"], "estimated_jpy": cg.money(v["estimated_jpy"])}
                     for k, v in info["providers"].items()}
        rows.append({
            "plan_ref": str(a.scope_id)[:8], "plan_id": str(a.scope_id), "class": a.profile_key,
            "policy_version": a.policy_version, "cap_jpy": cg.money(a.cap_jpy),
            "settled_jpy": cg.money(a.settled_jpy), "reserved_jpy": cg.money(a.reserved_jpy),
            "max_total_jpy": cg.money(total),
            "remaining_jpy": cg.money(max(Decimal(0), Decimal(a.cap_jpy) - total)),
            "state": _state_of(total, Decimal(a.cap_jpy)), "counts": a.counts or {},
            "providers": providers, "settled_events": info["settled"], "released_events": info["released"],
            "fake_only": bool(providers) and all(k == FAKE_PROVIDER or k.startswith("fake") for k in providers),
            "updated_at": _iso(a.updated_at),
        })
    return {"as_of": _iso(_now()), "rows": rows,
            "note": "旅行の題・相談の文章・旅程・予約の内容・鍵は台帳に持たない(旅行の ID だけ)"}


# ===================================================================== Cloud の環境

@router.get("/cloud")
def ops_cloud(admin: User = Depends(require_admin)):
    def env(name: str) -> Optional[str]:
        value = os.environ.get(name)
        return value if value else None

    running_on = "cloud_run" if env("K_SERVICE") else "other"
    items: List[Dict[str, Any]] = [
        {"key": "runtime", "label": "実行環境",
         "value": "Cloud Run" if running_on == "cloud_run" else "Cloud Run 以外(開発の機械・Docker など)",
         "source": "environment"},
        {"key": "cloud_run_service", "label": "Cloud Run のサービス", "value": env("K_SERVICE"), "source": "environment"},
        {"key": "cloud_run_revision", "label": "Cloud Run の版", "value": env("K_REVISION"), "source": "environment"},
        {"key": "project_id", "label": "GCP のプロジェクト ID",
         "value": env("GOOGLE_CLOUD_PROJECT") or env("GCP_PROJECT_ID"), "source": "environment"},
        {"key": "app_env", "label": "APP_ENV", "value": settings.APP_ENV or None, "source": "settings"},
        {"key": "database", "label": "DB の接続", "value": "設定あり" if getattr(settings, "DATABASE_URL", None) else None,
         "source": "settings"},
        {"key": "redis", "label": "Redis の接続", "value": "設定あり" if getattr(settings, "REDIS_URL", None) else None,
         "source": "settings"},
    ]
    for it in items:
        it["status"] = "known" if it["value"] else "unavailable"
    unavailable = [
        {"key": "billing", "label": "Cloud Billing の請求額・予算", "reason": "アプリから Cloud Billing API を読んでいません"},
        {"key": "services", "label": "有効な Google の API", "reason": "アプリから Service Usage API を読んでいません"},
        {"key": "secrets", "label": "Secret Manager の版", "reason": "アプリから Secret Manager の一覧を読んでいません"},
    ]
    return {"as_of": _iso(_now()), "items": items, "unavailable": unavailable,
            "note": "GCP の予算は通知で、課金を自動で止める上限ではありません"}


# ===================================================================== Fake の家族旅行の試験

def _fake_units(operation: str, quotas: Dict[str, Any]) -> Dict[str, int]:
    if operation == "ai.generate":
        return {"input_tokens": int(quotas.get("ai_input_tokens_per_call", 2000) or 2000),
                "output_tokens": int(quotas.get("ai_output_tokens_per_call", 500) or 500)}
    if operation == "routes.element":
        return {"elements": 2}
    if operation == "map.load":
        return {"loads": 1}
    return {"requests": 1}


@router.post("/test-runs/family-fake", status_code=201)
def ops_family_fake_run(request: Request, payload: Dict[str, Any] = Body(default={}),
                        admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Fake の提供元で、原価の予約→確定を上限まで繰り返し、40円・45円・50円の境界の振る舞いを記録する(外へ送らない)。"""
    if settings.is_production:
        raise _bad("fake_test_disabled", "本番・staging の環境では Fake の試験を実行しません", 403)
    reason = _reason(payload)
    tester = User(id=uuid.uuid4(), email=f"ops-fake-{uuid.uuid4().hex[:12]}@ops.invalid",
                  username=f"opsfake{uuid.uuid4().hex[:10]}", hashed_password="!", user_type=UserType.REGISTERED,
                  is_active=False, is_verified=False)
    db.add(tester)
    db.flush()
    plan = TravelPlan(id=uuid.uuid4(), user_id=tester.id, title="[運用の試験] 家族旅行(Fake)")
    db.add(plan)
    db.commit()
    res = cg.resolve(db, plan, tester)
    cycle = ["ai.generate", "places.search", "routes.element", "places.details", "ai.web_search", "places.photo",
             "map.load"]
    steps: List[Dict[str, Any]] = []
    denied_streak = 0
    first_key: Optional[str] = None
    first_id: Optional[str] = None
    for i in range(60):
        op = cycle[i % len(cycle)]
        units = _fake_units(op, res.quotas)
        key = f"ops-fake-{plan.id.hex[:12]}-{i}"
        step: Dict[str, Any] = {"n": i + 1, "operation": op, "label": cg.OPERATIONS[op]["label"], "units": units}
        try:
            row = cg.reserve(db, plan, tester, op, FAKE_PROVIDER, units, key)
            step["max_cost_jpy"] = cg.money(row.max_cost_jpy)
            cg.settle(db, row.id, dict(row.units), "ok", model="fake")
            step["result"] = "settled"
            denied_streak = 0
            if first_key is None:
                first_key, first_id = key, str(row.id)
        except cg.CostGuardError as error:
            step["result"] = "denied"
            step["reason"] = error.code
            denied_streak += 1
        acc = cg._peek(db, "plan", plan.id, "plan")
        total = (Decimal(acc.settled_jpy) + Decimal(acc.reserved_jpy)) if acc else Decimal(0)
        step["plan_total_jpy"] = cg.money(total)
        step["state"] = _state_of(total, res.plan_cap)
        steps.append(step)
        if denied_streak >= len(cycle):
            break
    replay: Dict[str, Any] = {"checked": False}
    if first_key is not None:
        acc_before = cg._peek(db, "plan", plan.id, "plan")
        before = Decimal(acc_before.settled_jpy) if acc_before else Decimal(0)
        again = cg.reserve(db, plan, tester, cycle[0], FAKE_PROVIDER, _fake_units(cycle[0], res.quotas), first_key)
        acc_after = cg._peek(db, "plan", plan.id, "plan")
        after = Decimal(acc_after.settled_jpy) if acc_after else Decimal(0)
        replay = {"checked": True, "same_reservation": str(again.id) == first_id, "status": again.status,
                  "double_counted": after != before}
    final_acc = cg._peek(db, "plan", plan.id, "plan")
    final_total = (Decimal(final_acc.settled_jpy) + Decimal(final_acc.reserved_jpy)) if final_acc else Decimal(0)
    first_warn = next((s["n"] for s in steps if s["state"] in ("user_warning", "ops_alert", "limit_reached")), None)
    first_alert = next((s["n"] for s in steps if s["state"] in ("ops_alert", "limit_reached")), None)
    first_denial = next((s for s in steps if s["result"] == "denied"), None)
    summary = {
        "plan_id": str(plan.id), "class": res.profile_key, "policy_version": res.policy_version,
        "plan_cap_jpy": cg.money(res.plan_cap), "final_total_jpy": cg.money(final_total),
        "never_over_cap": final_total <= res.plan_cap,
        "first_user_warning_step": first_warn, "first_ops_alert_step": first_alert,
        "first_denial": None if first_denial is None else {"n": first_denial["n"], "reason": first_denial["reason"]},
        "settled_steps": sum(1 for s in steps if s["result"] == "settled"),
        "denied_steps": sum(1 for s in steps if s["result"] == "denied"),
        "idempotency_replay": replay, "provider": FAKE_PROVIDER, "external_calls": 0,
    }
    _audit(request, admin, "ops_fake_test_run", {
        "plan_id": str(plan.id), "reason": reason[:200], "final_total_jpy": summary["final_total_jpy"],
        "settled_steps": summary["settled_steps"], "denied_steps": summary["denied_steps"]})
    return {"as_of": _iso(_now()), "case": FAMILY_CASE, "summary": summary, "steps": steps,
            "note": "Fake の提供元の試験です。外部の API へは送っていません。額は価格の版での見込みで、実の請求ではありません"}
