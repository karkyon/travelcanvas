"""[Gate Remaining-4] FR-058 料金・決済(Stripe のテストモード)。購入・取り消し・返金・請求の記録・Entitlement の付与。

- 価格は仮(billing_products)。管理者が変えると revision が上がる。変えた後の購入から新しい価格(Checkout で
  price_data をその場で渡すため、Stripe の側で価格を作り直さない)。既にある購読は Stripe の元の価格のまま
- 購読(会員のクラス): 支払いが済むと Entitlement(user・trip_planning.class.<tier>・source=subscription)を active で付ける。
  止めた・払われない(canceled・unpaid・incomplete_expired)時は revoked にする。期間の終わりで止める設定は期間の終わりまで使える
- Trip Pass: 旅行(plan)に Entitlement(plan・trip_planning.class.trip_pass・source=trip_pass)。全額の返金で revoked
- 同じ Stripe のイベントは 1 回だけ処理する(billing_events)。Webhook が来ない環境でも、戻ってきた画面から
  Checkout の結果を問い合わせて同じ処理をする(sync_session)
- 金額は円(整数)。カードの番号・住所は持たない
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    BillingCustomer, BillingEvent, BillingPayment, BillingProduct, BillingSubscription, Entitlement, TravelPlan, User,
)
from app.services import stripe_client as sc

FEATURE_PREFIX = "trip_planning.class."
ENDED = {"canceled", "unpaid", "incomplete_expired"}
USABLE = {"active", "trialing", "past_due"}


class BillingError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _ts(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None
    except (TypeError, ValueError, OverflowError):
        return None


# ===================================================================== 表示

def product_view(p: BillingProduct) -> Dict[str, Any]:
    return {"id": str(p.id), "code": p.code, "kind": p.kind, "tier_key": p.tier_key, "name": p.name,
            "description": p.description, "price_jpy": p.price_jpy, "interval": p.interval, "active": p.active,
            "revision": p.revision, "updated_at": _iso(p.updated_at)}


def subscription_view(db: Session, s: BillingSubscription) -> Dict[str, Any]:
    p = db.get(BillingProduct, s.product_id)
    return {"id": str(s.id), "product": product_view(p) if p else None, "status": s.status,
            "cancel_at_period_end": s.cancel_at_period_end, "current_period_end": _iso(s.current_period_end),
            "price_jpy": s.price_jpy, "usable": s.status in USABLE, "created_at": _iso(s.created_at)}


def payment_view(db: Session, x: BillingPayment) -> Dict[str, Any]:
    p = db.get(BillingProduct, x.product_id) if x.product_id else None
    plan = db.get(TravelPlan, x.plan_id) if x.plan_id else None
    return {"id": str(x.id), "kind": x.kind, "status": x.status, "amount_jpy": x.amount_jpy,
            "refunded_jpy": x.refunded_jpy, "product_name": p.name if p else None,
            "plan_id": str(x.plan_id) if x.plan_id else None, "plan_title": plan.title if plan else None,
            "receipt_url": x.receipt_url, "paid_at": _iso(x.paid_at), "created_at": _iso(x.created_at),
            "user_id": str(x.user_id), "refund_reason": x.refund_reason}


# ===================================================================== Entitlement

def _grant(db: Session, subject_type: str, subject_id: Any, tier: str, source: str, reason: str) -> Entitlement:
    now = _now()
    e = Entitlement(id=uuid.uuid4(), subject_type=subject_type, subject_id=subject_id,
                    feature_key=FEATURE_PREFIX + tier, status="active", starts_at=now, source=source,
                    reason=reason[:200], approved_at=now, created_at=now, updated_at=now)
    db.add(e)
    db.flush()
    return e


def _revoke(db: Session, entitlement_id: Any) -> None:
    if not entitlement_id:
        return
    e = db.get(Entitlement, entitlement_id)
    if e is not None and e.status == "active":
        e.status = "revoked"
        e.ends_at = _now()
        e.updated_at = _now()


# ===================================================================== 購入

def _origin_ok(origin: Optional[str], allowed: List[str]) -> str:
    if origin and origin.rstrip("/") in [a.rstrip("/") for a in allowed]:
        return origin.rstrip("/")
    return (allowed[0] if allowed else "http://localhost:4173").rstrip("/")


def start_checkout(db: Session, user: User, product_id: str, plan_id: Optional[str], origin: str) -> Dict[str, Any]:
    if str(getattr(user, "user_type", "") or "").lower().endswith("guest") or not getattr(user, "email", None):
        raise BillingError(403, "guest_cannot_buy", "購入にはアカウントの登録が必要です")
    sc.secret_key(db)  # 鍵が無い・本番の鍵の時は何も記録せずに断る(NotConfigured)
    try:
        product = db.get(BillingProduct, uuid.UUID(str(product_id)))
    except ValueError:
        product = None
    if product is None or not product.active:
        raise BillingError(404, "product_not_found", "その商品はありません")
    plan: Optional[TravelPlan] = None
    if product.kind == "trip_pass":
        try:
            plan = db.get(TravelPlan, uuid.UUID(str(plan_id))) if plan_id else None
        except ValueError:
            plan = None
        if plan is None or plan.deleted_at is not None or plan.user_id != user.id:
            raise BillingError(422, "plan_required", "Trip Pass は自分の旅行を選んで買ってください")
        has = db.query(Entitlement).filter(Entitlement.subject_type == "plan", Entitlement.subject_id == plan.id,
                                           Entitlement.feature_key == FEATURE_PREFIX + "trip_pass",
                                           Entitlement.status == "active").first()
        if has is not None:
            raise BillingError(409, "already_has_pass", "この旅行には Trip Pass があります")
    else:
        live = db.query(BillingSubscription).filter(BillingSubscription.user_id == user.id,
                                                    BillingSubscription.status.in_(list(USABLE))).first()
        if live is not None:
            raise BillingError(409, "already_subscribed", "購読中です。変える時は今の購読を止めてから選んでください")
    payment = BillingPayment(id=uuid.uuid4(), user_id=user.id, product_id=product.id,
                             plan_id=plan.id if plan else None,
                             kind="trip_pass" if product.kind == "trip_pass" else "subscription",
                             status="pending", amount_jpy=product.price_jpy)
    db.add(payment)
    db.flush()
    price_data: Dict[str, Any] = {"currency": "jpy", "unit_amount": product.price_jpy,
                                  "product_data": {"name": f"TravelCanvas {product.name}"}}
    if product.kind == "subscription":
        price_data["recurring"] = {"interval": product.interval}
    meta = {"tc_payment_id": str(payment.id), "tc_user_id": str(user.id), "tc_product_id": str(product.id),
            "tc_plan_id": str(plan.id) if plan else ""}
    params: Dict[str, Any] = {
        "mode": "subscription" if product.kind == "subscription" else "payment",
        "line_items": [{"price_data": price_data, "quantity": 1}],
        "success_url": f"{origin}/settings/billing?session={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{origin}/settings/billing?canceled=1",
        "client_reference_id": str(payment.id),
        "metadata": meta,
    }
    cust = db.get(BillingCustomer, user.id)
    if cust is not None:
        params["customer"] = cust.stripe_customer_id
    else:
        params["customer_email"] = user.email
    if product.kind == "subscription":
        params["subscription_data"] = {"metadata": meta}
    else:
        params["payment_intent_data"] = {"metadata": meta}
    try:
        session = sc.call(db, "POST", "/checkout/sessions", params, idempotency_key=f"tc-checkout-{payment.id}")
    except (sc.NotConfigured, sc.StripeError):
        payment.status = "failed"
        db.commit()
        raise
    payment.stripe_checkout_session_id = str(session.get("id") or "")[:100] or None
    db.commit()
    return {"url": session.get("url"), "payment_id": str(payment.id), "session_id": payment.stripe_checkout_session_id}


# ===================================================================== Stripe の結果の反映

def _customer(db: Session, user_id: Any, customer_id: Optional[str]) -> None:
    if not customer_id:
        return
    if db.get(BillingCustomer, user_id) is None and db.query(BillingCustomer).filter(
            BillingCustomer.stripe_customer_id == customer_id).first() is None:
        db.add(BillingCustomer(user_id=user_id, stripe_customer_id=str(customer_id)[:64]))


def apply_session(db: Session, session: Dict[str, Any]) -> str:
    """checkout.session.completed(または問い合わせた Checkout)を反映する。何度呼んでも同じ結果"""
    pid = (session.get("metadata") or {}).get("tc_payment_id") or session.get("client_reference_id")
    try:
        payment = db.get(BillingPayment, uuid.UUID(str(pid))) if pid else None
    except ValueError:
        payment = None
    if payment is None:
        return "unknown_payment"
    if session.get("status") == "expired":
        if payment.status == "pending":
            payment.status = "expired"
        return "expired"
    if session.get("payment_status") not in ("paid", "no_payment_required") and session.get("status") != "complete":
        return "not_paid"
    if payment.status != "pending":
        return "already"
    product = db.get(BillingProduct, payment.product_id) if payment.product_id else None
    _customer(db, payment.user_id, session.get("customer"))
    now = _now()
    payment.status = "paid"
    payment.paid_at = now
    payment.updated_at = now
    total = session.get("amount_total")
    if isinstance(total, int) and total >= 0:
        payment.amount_jpy = total
    payment.stripe_payment_intent_id = (str(session.get("payment_intent") or "")[:100] or
                                        payment.stripe_payment_intent_id)
    inv = str(session.get("invoice") or "")[:100]
    if inv and payment.stripe_invoice_id is None and db.query(BillingPayment).filter(
            BillingPayment.stripe_invoice_id == inv).first() is None:
        # 購読の最初の請求書は、この支払いと同じ物として記録する(invoice.paid で 2 行にしない)
        payment.stripe_invoice_id = inv
    if payment.kind == "trip_pass" and payment.plan_id:
        e = _grant(db, "plan", payment.plan_id, "trip_pass", "trip_pass", "Trip Pass(Stripe テストモード)")
        payment.entitlement_id = e.id
        return "trip_pass_granted"
    if product is not None and product.kind == "subscription":
        sub_id = str(session.get("subscription") or "")[:64] or None
        sub = (db.query(BillingSubscription).filter(BillingSubscription.stripe_subscription_id == sub_id).first()
               if sub_id else None)
        if sub is None:
            sub = BillingSubscription(id=uuid.uuid4(), user_id=payment.user_id, product_id=product.id,
                                      stripe_subscription_id=sub_id, status="active", price_jpy=payment.amount_jpy)
            db.add(sub)
            db.flush()
        sub.status = "active"
        if sub.entitlement_id is None:
            e = _grant(db, "user", payment.user_id, product.tier_key, "subscription",
                       f"{product.name} の購読(Stripe テストモード)")
            sub.entitlement_id = e.id
            payment.entitlement_id = e.id
        payment.subscription_id = sub.id
        return "subscription_started"
    return "paid"


def apply_subscription(db: Session, obj: Dict[str, Any]) -> str:
    """customer.subscription.updated / deleted"""
    sid = str(obj.get("id") or "")
    sub = db.query(BillingSubscription).filter(BillingSubscription.stripe_subscription_id == sid).first()
    if sub is None:
        return "unknown_subscription"
    status = str(obj.get("status") or sub.status)
    if status in ("incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"):
        sub.status = status
    sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
    end = _ts(obj.get("current_period_end") or ((obj.get("items") or {}).get("data") or [{}])[0].get(
        "current_period_end"))
    if end:
        sub.current_period_end = end
    sub.updated_at = _now()
    if sub.status in ENDED or sub.status == "paused":
        _revoke(db, sub.entitlement_id)
        return "ended"
    if sub.status in USABLE and sub.entitlement_id is not None:
        e = db.get(Entitlement, sub.entitlement_id)
        if e is not None and e.status == "revoked":
            product = db.get(BillingProduct, sub.product_id)
            ne = _grant(db, "user", sub.user_id, product.tier_key if product else "trip", "subscription",
                        "購読の再開(Stripe テストモード)")
            sub.entitlement_id = ne.id
    return "updated"


def apply_invoice(db: Session, inv: Dict[str, Any]) -> str:
    """invoice.paid / invoice.payment_failed: 請求の記録(購読の毎月の請求)"""
    iid = str(inv.get("id") or "")[:100]
    details = (inv.get("parent") or {}).get("subscription_details") or {}
    sid = str(inv.get("subscription") or details.get("subscription") or "")
    sub = (db.query(BillingSubscription).filter(BillingSubscription.stripe_subscription_id == sid).first()
           if sid else None)
    if sub is None or not iid:
        return "unknown_subscription"
    row = db.query(BillingPayment).filter(BillingPayment.stripe_invoice_id == iid).first()
    paid = inv.get("status") == "paid" or bool(inv.get("paid"))
    amount = inv.get("amount_paid") if paid else inv.get("amount_due")
    if row is None:
        row = BillingPayment(id=uuid.uuid4(), user_id=sub.user_id, product_id=sub.product_id, kind="invoice",
                             subscription_id=sub.id, status="pending", amount_jpy=int(amount or 0),
                             stripe_invoice_id=iid)
        db.add(row)
    row.status = "paid" if paid else "failed"
    row.amount_jpy = max(int(amount or 0), row.refunded_jpy)
    row.receipt_url = str(inv.get("hosted_invoice_url") or "")[:500] or row.receipt_url
    row.stripe_payment_intent_id = str(inv.get("payment_intent") or "")[:100] or row.stripe_payment_intent_id
    if paid and row.paid_at is None:
        row.paid_at = _now()
    row.updated_at = _now()
    return "invoice_paid" if paid else "invoice_failed"


def apply_refund(db: Session, charge: Dict[str, Any]) -> str:
    """charge.refunded: 返金の額を反映する。Trip Pass の全額の返金は付与を外す"""
    pi = str(charge.get("payment_intent") or "")
    row = db.query(BillingPayment).filter(BillingPayment.stripe_payment_intent_id == pi).first() if pi else None
    if row is None:
        return "unknown_payment"
    refunded = int(charge.get("amount_refunded") or 0)
    row.refunded_jpy = min(max(refunded, row.refunded_jpy), row.amount_jpy)
    if row.refunded_jpy >= row.amount_jpy:
        row.status = "refunded"
    elif row.refunded_jpy:
        row.status = "partially_refunded"
    row.updated_at = _now()
    if row.status == "refunded" and row.kind == "trip_pass":
        _revoke(db, row.entitlement_id)
    return row.status


def handle_event(db: Session, event: Dict[str, Any]) -> str:
    """Webhook のイベント。同じ ID は 1 回だけ"""
    eid = str(event.get("id"))[:100]
    if db.get(BillingEvent, eid) is not None:
        return "duplicate"
    etype = str(event.get("type"))
    obj = ((event.get("data") or {}).get("object")) or {}
    if etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"):
        result = apply_session(db, obj)
    elif etype in ("customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.created"):
        result = apply_subscription(db, obj)
    elif etype in ("invoice.paid", "invoice.payment_failed"):
        result = apply_invoice(db, obj)
    elif etype == "charge.refunded":
        result = apply_refund(db, obj)
    else:
        result = "ignored"
    db.add(BillingEvent(id=eid, type=etype[:80], result=result[:40]))
    db.commit()
    return result


def sync_session(db: Session, user: User, session_id: str) -> Dict[str, Any]:
    """戻ってきた画面から Checkout の結果を問い合わせて反映する(Webhook の代わり・重ねても同じ)"""
    row = db.query(BillingPayment).filter(BillingPayment.stripe_checkout_session_id == session_id[:100]).first()
    if row is None or row.user_id != user.id:
        raise BillingError(404, "payment_not_found", "その支払いはありません")
    session = sc.call(db, "GET", f"/checkout/sessions/{row.stripe_checkout_session_id}")
    result = apply_session(db, session)
    db.commit()
    return {"result": result, "payment": payment_view(db, row)}


# ===================================================================== 取り消し・返金

def cancel_subscription(db: Session, user: User, sub_id: str, at_period_end: bool) -> Dict[str, Any]:
    sub = _own_sub(db, user, sub_id)
    if sub.status not in USABLE or not sub.stripe_subscription_id:
        raise BillingError(409, "not_active", "この購読は使える状態ではありません")
    if at_period_end:
        obj = sc.call(db, "POST", f"/subscriptions/{sub.stripe_subscription_id}", {"cancel_at_period_end": True},
                      idempotency_key=f"tc-cancel-end-{sub.id}-{sub.updated_at.timestamp() if sub.updated_at else 0}")
    else:
        obj = sc.call(db, "DELETE", f"/subscriptions/{sub.stripe_subscription_id}")
    apply_subscription(db, obj)
    db.commit()
    return subscription_view(db, sub)


def resume_subscription(db: Session, user: User, sub_id: str) -> Dict[str, Any]:
    sub = _own_sub(db, user, sub_id)
    if sub.status not in USABLE or not sub.cancel_at_period_end or not sub.stripe_subscription_id:
        raise BillingError(409, "not_cancelling", "止める予定の購読ではありません")
    obj = sc.call(db, "POST", f"/subscriptions/{sub.stripe_subscription_id}", {"cancel_at_period_end": False})
    apply_subscription(db, obj)
    db.commit()
    return subscription_view(db, sub)


def _own_sub(db: Session, user: User, sub_id: str) -> BillingSubscription:
    try:
        sub = db.get(BillingSubscription, uuid.UUID(str(sub_id)))
    except ValueError:
        sub = None
    if sub is None or sub.user_id != user.id:
        raise BillingError(404, "subscription_not_found", "その購読はありません")
    return sub


def refund(db: Session, payment_id: str, amount_jpy: Optional[int], reason: str) -> Dict[str, Any]:
    try:
        row = db.get(BillingPayment, uuid.UUID(str(payment_id)))
    except ValueError:
        row = None
    if row is None:
        raise BillingError(404, "payment_not_found", "その支払いはありません")
    if row.status not in ("paid", "partially_refunded") or not row.stripe_payment_intent_id:
        raise BillingError(409, "not_refundable", "返金できる支払いではありません")
    left = row.amount_jpy - row.refunded_jpy
    amount = left if amount_jpy is None else int(amount_jpy)
    if amount <= 0 or amount > left:
        raise BillingError(422, "bad_amount", f"返金の額は 1〜{left} 円です")
    sc.call(db, "POST", "/refunds", {"payment_intent": row.stripe_payment_intent_id, "amount": amount,
                                     "metadata": {"tc_payment_id": str(row.id)}},
            idempotency_key=f"tc-refund-{row.id}-{row.refunded_jpy}-{amount}")
    row.refund_reason = reason[:200]
    apply_refund(db, {"payment_intent": row.stripe_payment_intent_id, "amount_refunded": row.refunded_jpy + amount})
    db.commit()
    return payment_view(db, row)
