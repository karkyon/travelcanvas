"""[Gate Remaining-4] FR-058 料金・決済(Stripe のテストモード)。

利用者:
- GET  /billing/products                       : 売っている物(仮の価格)と、決済が使えるか
- GET  /billing/me                             : 自分のクラス・購読・支払い(返金を含む)の一覧・Trip Pass の付いた旅行
- POST /billing/checkout                       : 購入を始める(Stripe の Checkout の URL を返す。カードは Stripe の画面で入れる)
- POST /billing/checkout/{session_id}/sync     : 戻ってきた画面から結果を問い合わせて反映する(Webhook の代わり・重ねても同じ)
- POST /billing/subscriptions/{id}/cancel      : 購読を止める(既定は期間の終わりで。at_period_end=false ですぐ)
- POST /billing/subscriptions/{id}/resume      : 期間の終わりで止める予定を取り消す
- POST /billing/stripe/webhook                 : Stripe からの知らせ(署名を確かめる。同じイベントは 1 回だけ)
管理者(require_admin):
- GET/POST /admin/billing/products・PATCH /admin/billing/products/{id} : 仮の価格の追加・変更・販売の停止(revision)
- GET  /admin/billing/payments                 : 最近の支払い
- POST /admin/billing/payments/{id}/refund     : 返金(全額・一部。理由は必須)

監査に金額・カードは残さない(種類・件数・ID だけ)。
"""
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1.admin import require_admin
from app.core.auth import get_current_user_or_guest
from app.core.config import settings
from app.core.database import get_db
from app.models.models import BillingPayment, BillingProduct, BillingSubscription, Entitlement, TravelPlan, User
from app.services import billing as bl
from app.services import cost_guard
from app.services import stripe_client as sc
from app.services.audit_service import record_audit_event

router = APIRouter(tags=["billing"])


def _err(e: Exception) -> HTTPException:
    if isinstance(e, bl.BillingError):
        return HTTPException(status_code=e.status, detail={"code": e.code, "message": e.message})
    if isinstance(e, sc.NotConfigured):
        msg = ("決済はテストモードの鍵だけ使えます(本番の鍵は使いません)" if e.code == "live_key_refused"
               else "決済の設定がありません(管理者が Stripe のテストモードの鍵を登録すると使えます)")
        return HTTPException(status_code=409, detail={"code": "billing_unavailable", "reason": e.code, "message": msg})
    if isinstance(e, sc.StripeError):
        return HTTPException(status_code=502 if e.status >= 500 else 422,
                             detail={"code": "stripe_error", "reason": e.code, "message": e.message})
    raise e


def _audit(action: str, user_id: Any, details: Dict[str, Any]) -> None:
    record_audit_event(action=action, resource_type="billing", user_id=user_id, resource_id=user_id, details=details)


@router.get("/billing/products")
def products(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    rows = db.query(BillingProduct).filter(BillingProduct.active.is_(True)).order_by(
        BillingProduct.kind.desc(), BillingProduct.price_jpy).all()
    return {"configured": sc.configured(db), "test_mode": True, "products": [bl.product_view(p) for p in rows],
            "note": "仮の価格です(テストモード。実際には請求されません。テスト用のカード 4242 4242 4242 4242 で試せます)"}


@router.get("/billing/me")
def me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    key, source = cost_guard.user_class(db, current_user)
    subs = db.query(BillingSubscription).filter(BillingSubscription.user_id == current_user.id).order_by(
        BillingSubscription.created_at.desc()).limit(20).all()
    pays = db.query(BillingPayment).filter(BillingPayment.user_id == current_user.id,
                                           BillingPayment.status != "pending").order_by(
        BillingPayment.created_at.desc()).limit(100).all()
    passes = (db.query(Entitlement, TravelPlan).join(TravelPlan, TravelPlan.id == Entitlement.subject_id)
              .filter(Entitlement.subject_type == "plan", Entitlement.status == "active",
                      Entitlement.feature_key == bl.FEATURE_PREFIX + "trip_pass",
                      TravelPlan.user_id == current_user.id).all())
    return {"class": key, "class_label": cost_guard.CLASS_LABEL.get(key, key), "class_source": source,
            "subscriptions": [bl.subscription_view(db, s) for s in subs],
            "payments": [bl.payment_view(db, p) for p in pays],
            "trip_passes": [{"plan_id": str(p.id), "plan_title": p.title} for _e, p in passes],
            "configured": sc.configured(db)}


class CheckoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: str
    plan_id: Optional[str] = None


@router.post("/billing/checkout")
def checkout(body: CheckoutIn, request: Request, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user_or_guest)):
    origin = bl._origin_ok(request.headers.get("origin"), list(settings.cors_allowed_origins))
    try:
        out = bl.start_checkout(db, current_user, body.product_id, body.plan_id, origin)
    except (bl.BillingError, sc.NotConfigured, sc.StripeError) as e:
        raise _err(e)
    _audit("billing.checkout_started", current_user.id, {"payment_id": out["payment_id"]})
    return out


@router.post("/billing/checkout/{session_id}/sync")
def checkout_sync(session_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    try:
        out = bl.sync_session(db, current_user, session_id)
    except (bl.BillingError, sc.NotConfigured, sc.StripeError) as e:
        raise _err(e)
    _audit("billing.checkout_synced", current_user.id, {"result": out["result"]})
    return out


class CancelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_period_end: bool = True


@router.post("/billing/subscriptions/{sub_id}/cancel")
def cancel(sub_id: str, body: CancelIn, db: Session = Depends(get_db),
           current_user: User = Depends(get_current_user_or_guest)):
    try:
        out = bl.cancel_subscription(db, current_user, sub_id, body.at_period_end)
    except (bl.BillingError, sc.NotConfigured, sc.StripeError) as e:
        raise _err(e)
    _audit("billing.subscription_cancel", current_user.id,
           {"subscription_id": sub_id, "at_period_end": body.at_period_end})
    return out


@router.post("/billing/subscriptions/{sub_id}/resume")
def resume(sub_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    try:
        out = bl.resume_subscription(db, current_user, sub_id)
    except (bl.BillingError, sc.NotConfigured, sc.StripeError) as e:
        raise _err(e)
    _audit("billing.subscription_resume", current_user.id, {"subscription_id": sub_id})
    return out


@router.post("/billing/stripe/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    try:
        secret = sc.webhook_secret(db)
    except sc.NotConfigured:
        raise HTTPException(status_code=404, detail="Not Found")
    try:
        event = sc.verify_signature(payload, request.headers.get("stripe-signature"), secret)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail={"code": "bad_signature", "message": "署名が違います"})
    result = bl.handle_event(db, event)
    return {"received": True, "result": result}


# ===================================================================== 管理者

class ProductIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(..., pattern=r"^[a-z0-9_]{2,32}$")
    kind: str = Field(..., pattern=r"^(subscription|trip_pass)$")
    tier_key: str = Field(..., pattern=r"^(trip|journey|explorer|trip_pass)$")
    name: str = Field(..., min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=300)
    price_jpy: int = Field(..., ge=50, le=1_000_000)
    interval: Optional[str] = Field(None, pattern=r"^(month|year)$")


class ProductPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=300)
    price_jpy: Optional[int] = Field(None, ge=50, le=1_000_000)
    active: Optional[bool] = None
    revision: int


@router.get("/admin/billing/products")
def admin_products(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(BillingProduct).order_by(BillingProduct.kind.desc(), BillingProduct.price_jpy).all()
    return {"configured": sc.configured(db), "products": [bl.product_view(p) for p in rows]}


@router.post("/admin/billing/products", status_code=201)
def admin_create_product(body: ProductIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if (body.kind == "subscription") != (body.interval is not None) or (body.kind == "trip_pass") != (
            body.tier_key == "trip_pass"):
        raise HTTPException(status_code=422, detail={"code": "invalid_field",
                                                     "message": "購読は期間(月・年)、Trip Pass は期間なしにしてください"})
    if db.query(BillingProduct).filter(BillingProduct.code == body.code).first() is not None:
        raise HTTPException(status_code=409, detail={"code": "duplicate_code", "message": "同じ記号の商品があります"})
    p = BillingProduct(id=uuid.uuid4(), updated_by=admin.id, **body.model_dump())
    db.add(p)
    db.commit()
    _audit("billing.product_created", admin.id, {"product_id": str(p.id), "code": p.code})
    return bl.product_view(p)


@router.patch("/admin/billing/products/{product_id}")
def admin_update_product(product_id: str, body: ProductPatch, admin: User = Depends(require_admin),
                         db: Session = Depends(get_db)):
    try:
        p = db.get(BillingProduct, uuid.UUID(product_id))
    except ValueError:
        p = None
    if p is None:
        raise HTTPException(status_code=404, detail={"code": "product_not_found", "message": "その商品はありません"})
    if body.revision != p.revision:
        raise HTTPException(status_code=409, detail={"code": "stale", "message": "他の管理者が変えました。読み直してください"})
    changes = body.model_dump(exclude_none=True, exclude={"revision"})
    for k, v in changes.items():
        setattr(p, k, v)
    p.revision += 1
    p.updated_by = admin.id
    p.updated_at = bl._now()
    db.commit()
    _audit("billing.product_updated", admin.id, {"product_id": str(p.id), "fields": sorted(changes)})
    return bl.product_view(p)


@router.get("/admin/billing/payments")
def admin_payments(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(BillingPayment).filter(BillingPayment.status != "pending").order_by(
        BillingPayment.created_at.desc()).limit(200).all()
    return {"configured": sc.configured(db), "payments": [bl.payment_view(db, r) for r in rows]}


class RefundIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_jpy: Optional[int] = Field(None, ge=1)
    reason: str = Field(..., min_length=1, max_length=200)


@router.post("/admin/billing/payments/{payment_id}/refund")
def admin_refund(payment_id: str, body: RefundIn, admin: User = Depends(require_admin),
                 db: Session = Depends(get_db)):
    try:
        out = bl.refund(db, payment_id, body.amount_jpy, body.reason.strip())
    except (bl.BillingError, sc.NotConfigured, sc.StripeError) as e:
        raise _err(e)
    _audit("billing.refund", admin.id, {"payment_id": payment_id, "partial": body.amount_jpy is not None})
    return out
