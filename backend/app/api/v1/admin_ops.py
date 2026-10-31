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
                                          (外へは何も送らない。本番の環境では断る)。``tier`` で Free/Trip/Journey/Explorer を選ぶ
- GET  /admin/ops/tiers                 : [Gate FR059-Tiers] 4つのクラスの機能・回数・月の枠・最大の見込み額・旧クラスの移行の表
- POST /admin/ops/test-tier             : [Gate FR059-Tiers] 開発環境だけ、利用者(既定は自分)のクラスを試験のために切り替える
                                          (理由が必須・24時間で切れる・監査。本番・staging では断る。有料の提供元はつながない)

鍵の平文を返す API は作らない(設定の有無の真偽だけ)。管理者の多要素認証(require_admin)を全てに掛ける。
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.admin import require_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.models import AuditLog
from app.models.models import (
    Entitlement, ProviderUsageEvent, ProviderUsageReservation, TravelPlan, UsageBudgetAccount, User, UserType,
)
from app.services import cost_guard as cg
from app.services import membership_tiers as mt
from app.services import free_usage
from app.services import provider_secrets as ps
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/admin/ops", tags=["admin-ops"])

FAKE_PROVIDER = "fake"
# 利用者の確定した金額の閾値(FR-059: 50円の 80%・90%)
USER_WARN_JPY = Decimal(40)
OPS_ALERT_JPY = Decimal(45)
HARD_CAP_JPY = Decimal(50)

# [Gate OpsSecrets-Clarity] 有料の提供元へ実際に送るコード(adapter)が入っている提供元。今は無い。
# 鍵・登録・価格が揃っても、ここに無い提供元は「送信: 無効」(fail closed)。adapter を入れる Gate でここへ足す
ADAPTERS_IMPLEMENTED: frozenset = frozenset()

# 鍵の保存先(画面に出す言葉)。運用コンソールで登録した鍵はアプリの DB に入る(GCP Secret Manager ではない)
SECRET_STORAGE = {
    "cms": "アプリの DB(provider_secrets 表・ENCRYPTION_KEY で暗号化)",
}

# 提供元の一覧(用途と、使う鍵の設定の名前)。鍵の値は読まない・返さない(設定の有無だけ)
PROVIDER_CATALOG: List[Dict[str, Any]] = [
    {"name": "openai", "label": "OpenAI · Responses API", "purpose": "旅行相談・案の作成",
     "operations": ["ai.generate", "ai.web_search"], "secret_setting": "OPENAI_API_KEY",
     "notes": "ChatGPT の契約と API の課金は別。API の組織・プロジェクト・支出の上限は OpenAI Platform で確認する"},
    {"name": "google_maps_js", "label": "Google Maps JavaScript API", "purpose": "ブラウザの地図の表示",
     "operations": ["map.load"], "secret_setting": None,
     "notes": "アプリの画面は今 Google Maps を読み込まない(地図は OpenStreetMap)。ブラウザ用の鍵を画面へ配る経路が無いため、"
              "登録しても使われない。使う時はブラウザに見える公開の鍵として HTTP referrer と許可 API で制限する"},
    {"name": "google_places", "label": "Places API (New)", "purpose": "候補の検索・詳細・写真",
     "operations": ["places.search", "places.details", "places.photo"], "secret_setting": None,
     "notes": "Field Mask と SKU を固定してから有効にする(サーバー用の鍵は「秘密情報・権限」で登録)"},
    {"name": "google_routes", "label": "Routes API", "purpose": "車の経路・所要時間",
     "operations": ["routes.element"], "secret_setting": None,
     "notes": "経路の要素の数を旅行の上限に入れて予約する(サーバー用の鍵は Places と共通)"},
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


def _audit_in_tx(request: Request, admin: User, action: str, base: Dict[str, Any]):
    """鍵の変更と同じ transaction で監査を書く hook(監査が書けなければ鍵も変えない)。"""
    def hook(db: Session, row: Any) -> None:
        db.add(AuditLog(id=uuid.uuid4(), user_id=admin.id, action=action, resource_type="ops_console",
                        resource_id=admin.id, ip_address=request.client.host if request.client else None,
                        user_agent=request.headers.get("user-agent", "")[:255],
                        details={**base, "version": row.version}))
    return hook


_SECRET_ERROR_STATUS = {"secret_backend_unavailable": 503, "secret_encryption_unavailable": 503,
                        "audit_unavailable": 503, "secret_conflict": 409}


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
                 func.coalesce(func.sum(ProviderUsageEvent.actual_cost_jpy), 0),
                 func.coalesce(func.sum(func.coalesce(ProviderUsageEvent.request_count, 1)), 0))
    if since is not None:
        q = q.filter(ProviderUsageEvent.occurred_at >= since)
    out: Dict[str, Dict[str, Any]] = {}
    for provider, n, est, act, reqs in q.group_by(ProviderUsageEvent.provider).all():
        out[provider] = {"events": int(n), "estimated_jpy": cg.money(Decimal(est)),
                         "actual_jpy": cg.money(Decimal(act)), "requests": int(reqs)}
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
    free = {k: v for k, v in totals.items() if k in free_usage.FREE_PROVIDERS}
    live = {k: v for k, v in totals.items() if k != FAKE_PROVIDER and not k.startswith("fake") and k not in free}
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
        # [Gate FR059-D11] 無料の provider へ送った回数(0円。50円の枠には入れない。利用規約・回数の制限の確認用)
        "free_usage": {"providers": {k: {"requests": v["requests"], "events": v["events"]} for k, v in free.items()},
                       "requests": sum(v["requests"] for v in free.values()),
                       "label": "無料の provider(OpenStreetMap・Wikipedia・Wikimedia・oEmbed)へ送った回数。0円で、50円の枠には入れない"},
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
        slot = ps.slot_for_provider(name)
        if slot is None:
            secret, secret_info, setting = "not_needed", None, None
        else:
            secret_info = ps.state(db, slot)
            secret = secret_info["status"]
            setting = ps.SLOTS[slot]["env"]
        ops_known = [price["known"].get(op, False) for op in p["operations"]]
        price_state = "unavailable" if not price["known"] else ("known" if all(ops_known) else "partial")
        is_fake = name == FAKE_PROVIDER
        adapter = "fake" if is_fake else ("implemented" if name in ADAPTERS_IMPLEMENTED else "not_implemented")
        live_ready = (not is_fake) and adapter == "implemented" and name in registered and secret == "configured" \
            and price_state == "known" and name not in suspended
        rows.append({
            "name": name, "label": p["label"], "purpose": p["purpose"], "operations": p["operations"],
            "kind": "fake" if is_fake else "paid",
            "registered": is_fake or name in registered,
            "suspended": name in suspended, "suspended_reason": suspended.get(name),
            "contract": "not_billable" if is_fake else "unverified",
            "secret": secret, "secret_setting": setting, "secret_slot": slot,
            "secret_source": secret_info["source"] if secret_info else None,
            "secret_version": secret_info["version"] if secret_info else None,
            "secret_last4": secret_info["last4"] if secret_info else None,
            "secret_storage": (SECRET_STORAGE.get(secret_info["source"])
                               if secret_info and secret_info["source"] else None),
            "secret_format": secret_info["format"] if secret_info else None,
            "secret_provider_auth": secret_info["provider_auth"] if secret_info else None,
            "adapter": adapter,
            "price_profile": price_state, "policy_version": price["policy_version"],
            "live_calls": "test_only" if is_fake else ("ready" if live_ready else "disabled"),
            "month_usage": totals.get(name),
            "notes": p["notes"],
        })
    return {"as_of": _iso(_now()), "providers": rows,
            "rule": "契約の確認・価格の版・鍵・提供元の接続(adapter)・提供元の登録の全てが揃うまで、有料の提供元へは送らない"
                    "(fail closed)。鍵があるだけでは接続していません"}


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
        {"key": "secrets", "label": "Secret Manager の版",
         "reason": "アプリから Secret Manager の一覧を読んでいません(この画面で登録した鍵は「秘密情報・権限」)"},
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
    tier = payload.get("tier", "explorer") if isinstance(payload, dict) else "explorer"
    if tier not in mt.TIERS:
        raise _bad("invalid_tier", "tier は free・trip・journey・explorer のどれかです")
    tester = User(id=uuid.uuid4(), email=f"ops-fake-{uuid.uuid4().hex[:12]}@ops.invalid",
                  username=f"opsfake{uuid.uuid4().hex[:10]}", hashed_password="!", user_type=UserType.REGISTERED,
                  is_active=False, is_verified=False)
    db.add(tester)
    db.flush()
    if tier != "free":
        # 試験だけの利用者(ログインできない)に、選んだクラスを付ける。実在の利用者の付与は二者の承認の経路だけ
        db.add(Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=tester.id,
                           feature_key=cg.FEATURE_PREFIX + "class." + tier, status="active", source="admin",
                           reason="[ops fake] 試験の利用者", requested_by=admin.id))
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
    first_op = cycle[0]
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
                first_key, first_id, first_op = key, str(row.id), op
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
        # 最初に確定した操作と同じ内容で同じ鍵を送る(クラスによって最初に確定する操作が違う)
        again = cg.reserve(db, plan, tester, first_op, FAKE_PROVIDER, _fake_units(first_op, res.quotas), first_key)
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
        "plan_id": str(plan.id), "class": res.profile_key, "policy_version": res.policy_version, "tier": tier,
        "included_operations": list(mt.operations_for(res.profile_key)),
        "plan_cap_jpy": cg.money(res.plan_cap), "final_total_jpy": cg.money(final_total),
        "never_over_cap": final_total <= res.plan_cap,
        "first_user_warning_step": first_warn, "first_ops_alert_step": first_alert,
        "first_denial": None if first_denial is None else {"n": first_denial["n"], "reason": first_denial["reason"]},
        "settled_steps": sum(1 for s in steps if s["result"] == "settled"),
        "denied_steps": sum(1 for s in steps if s["result"] == "denied"),
        "idempotency_replay": replay, "provider": FAKE_PROVIDER, "external_calls": 0,
    }
    _audit(request, admin, "ops_fake_test_run", {
        "plan_id": str(plan.id), "reason": reason[:200], "tier": tier, "final_total_jpy": summary["final_total_jpy"],
        "settled_steps": summary["settled_steps"], "denied_steps": summary["denied_steps"]})
    return {"as_of": _iso(_now()), "case": FAMILY_CASE, "summary": summary, "steps": steps,
            "note": "Fake の提供元の試験です。外部の API へは送っていません。額は価格の版での見込みで、実の請求ではありません"}


# ===================================================================== 会員の機能クラス(Gate FR059-Tiers)

TEST_TIER_TAG = "[test-tier]"
TEST_TIER_HOURS = 24


@router.get("/tiers")
def ops_tiers(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return {"as_of": _iso(_now()), **cg.tier_matrix(db),
            "test_switch": {"enabled": not settings.is_production, "hours": TEST_TIER_HOURS,
                            "note": "開発環境の試験だけ。実在の利用者の正式な付与は「管理の画面 → 利用枠(クラス)」の二者の承認"}}


def _test_tier_grants(db: Session, user_id: uuid.UUID) -> List[Entitlement]:
    keys = [cg.FEATURE_PREFIX + "class." + t for t in mt.TIERS]
    return (db.query(Entitlement)
            .filter(Entitlement.subject_type == "user", Entitlement.subject_id == user_id,
                    Entitlement.feature_key.in_(keys), Entitlement.status == "active",
                    Entitlement.reason.like(TEST_TIER_TAG + "%"))
            .with_for_update().all())


@router.post("/test-tier")
def ops_test_tier(request: Request, payload: Dict[str, Any] = Body(...), admin: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    """開発環境だけ: 利用者(既定は自分)の機能クラスを試験のために切り替える。以前の試験の付与は取り消す。

    有料の提供元の接続・価格・1旅行 50円は変えない(Fake・無料の提供元だけで差を確かめる)。家族の旅行のデータは消さない。
    """
    if settings.is_production:
        raise _bad("test_tier_disabled", "本番・staging の環境ではクラスの試験の切り替えをしません", 403)
    reason = _reason(payload)
    tier = payload.get("tier")
    if tier not in mt.TIERS:
        raise _bad("invalid_tier", "tier は free・trip・journey・explorer のどれかです")
    raw_user = payload.get("user_id")
    try:
        target_id = uuid.UUID(str(raw_user)) if raw_user else admin.id
    except ValueError:
        raise _bad("invalid_user", "user_id が正しくありません")
    target = db.get(User, target_id)
    if target is None:
        raise _bad("user_not_found", "利用者が見つかりません", 404)
    before = cg.user_class(db, target)[0]
    now = _now()
    revoked = 0
    for g in _test_tier_grants(db, target.id):
        g.status = "revoked"
        g.updated_at = now
        revoked += 1
    grant_id: Optional[str] = None
    if tier != "free":
        g = Entitlement(id=uuid.uuid4(), subject_type="user", subject_id=target.id,
                        feature_key=cg.FEATURE_PREFIX + "class." + tier, status="active", source="admin",
                        reason=f"{TEST_TIER_TAG} {reason}"[:200], requested_by=admin.id,
                        ends_at=now + timedelta(hours=TEST_TIER_HOURS))
        db.add(g)
        grant_id = str(g.id)
    db.commit()
    effective = cg.user_summary(db, target)
    _audit(request, admin, "ops_test_tier_switched", {
        "target_user_id": str(target.id), "tier": tier, "before": before, "after": effective["class"],
        "revoked_test_grants": revoked, "grant_id": grant_id, "reason": reason[:200]})
    note = ("新しいクラスの試験の付与は 24時間で切れます。" if tier != "free" else "試験の付与を外しました。")
    if effective["class"] != tier:
        note += f"今の有効なクラスは {effective['class_label']}(他の正式な付与が優先されています)"
    return {"user_id": str(target.id), "requested": tier, "before": before, "effective": effective,
            "revoked_test_grants": revoked, "expires_in_hours": TEST_TIER_HOURS if tier != "free" else None,
            "note": note}


# ===================================================================== 鍵の登録(Gate OpsSecrets)

@router.get("/secrets")
def ops_secrets(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """鍵の状態(値は返さない)。出典は cms(この画面で登録)か env(.env)。"""
    slots = []
    for slot, spec in ps.SLOTS.items():
        used_by = [p for p in spec["providers"] if p in ADAPTERS_IMPLEMENTED]
        slots.append({"slot": slot, "label": spec["label"], "providers": spec["providers"], "env": spec["env"],
                      "hint": spec["hint"], **ps.state(db, slot), "history": ps.history(db, slot),
                      "in_use": bool(used_by),
                      "in_use_note": ("使っている提供元: " + "・".join(used_by)) if used_by
                      else "アプリはまだこの鍵を使いません(提供元の接続 adapter が未実装。外へは送りません)"})
    return {"as_of": _iso(_now()), "slots": slots,
            "backend": ps.backend(),
            "backend_note": ("暫定: ENCRYPTION_KEY で暗号化して DB に保管しています。最終の正本は GCP Secret Manager で、"
                             "実行ID・最小権限・版の固定が整うまでは「高セキュリティ移行完了」ではありません。"
                             "有料の提供元へは adapter が未接続のため、鍵を登録しても送信しません"
                             if ps.backend() == "db_encrypted" else
                             "保管先(SECRET_BACKEND)が未設定・未接続・不正です。鍵は取得せず、どの提供元へも送りません"
                             "(DB・.env へは自動で切り替えません)"),
            "note": "鍵の値は画面・応答・ログ・監査に出しません(末尾4文字と版だけ)。取得元はこの画面で登録した有効な版だけです(.env へは戻りません)。「登録済み」は提供元が鍵を認めたという意味ではありません",
            "storage": {
                "location": SECRET_STORAGE["cms"],
                "not_secret_manager": "GCP Secret Manager には登録しません。Secret Manager の鍵は Cloud Run の環境変数として"
                                      "読み込む別の経路です(この画面からは見えません)",
                "backup": "DB のバックアップには暗号文が入ります。ENCRYPTION_KEY を失うと復号できないため、ENCRYPTION_KEY は"
                          "DB と別の場所に保管します",
                "rotation": "ENCRYPTION_KEY の入れ替えは tcops の鍵の掛け直し(暗号化した全ての *_ciphertext 列)が"
                            "provider_secrets も対象にします",
                "fallback": "無効にしても .env の値へは戻りません(無効化は保持され、その提供元へは送りません)。旧 .env の鍵を使う時は「旧 .env から取り込む」を明示操作します",
            }}


@router.post("/secrets/{slot}", status_code=201)
def ops_register_secret(slot: str, request: Request, payload: Dict[str, Any] = Body(...),
                        admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if slot not in ps.SLOTS:
        raise _bad("unknown_secret_slot", "知らない鍵の種類です", 404)
    reason = _reason(payload)
    try:
        ps.register(db, slot, payload.get("value") if isinstance(payload, dict) else None, reason, admin.id,
                    _audit_in_tx(request, admin, "ops_secret_registered", {"slot": slot, "reason": reason[:200]}))
    except ps.SecretError as error:
        raise _bad(error.code, error.message, _SECRET_ERROR_STATUS.get(error.code, 422))
    return {"slot": slot, **ps.state(db, slot)}


@router.post("/secrets/{slot}/import-env", status_code=201)
def ops_import_env_secret(slot: str, request: Request, payload: Dict[str, Any] = Body(...),
                          admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """旧 .env の値を新しい版として取り込む(明示操作)。サンプル値は拒否。.env の値は消さず、応答に出さない。"""
    if slot not in ps.SLOTS:
        raise _bad("unknown_secret_slot", "知らない鍵の種類です", 404)
    reason = _reason(payload)
    try:
        ps.import_from_env(db, slot, reason, admin.id,
                           _audit_in_tx(request, admin, "ops_secret_imported_from_env",
                                        {"slot": slot, "reason": reason[:200]}))
    except ps.SecretError as error:
        raise _bad(error.code, error.message, _SECRET_ERROR_STATUS.get(error.code, 422))
    return {"slot": slot, **ps.state(db, slot)}


@router.post("/secrets/{slot}/disable")
def ops_disable_secret(slot: str, request: Request, payload: Dict[str, Any] = Body(...),
                       admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if slot not in ps.SLOTS:
        raise _bad("unknown_secret_slot", "知らない鍵の種類です", 404)
    reason = _reason(payload)
    try:
        row = ps.disable(db, slot, admin.id,
                         _audit_in_tx(request, admin, "ops_secret_disabled", {"slot": slot, "reason": reason[:200]}))
    except ps.SecretError as error:
        raise _bad(error.code, error.message, _SECRET_ERROR_STATUS.get(error.code, 422))
    if row is None:
        raise _bad("secret_not_registered", "この画面で登録した有効な鍵はありません", 409)
    return {"slot": slot, **ps.state(db, slot)}
