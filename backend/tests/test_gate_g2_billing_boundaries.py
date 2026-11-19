"""[Gate② G2-BILL] 会員・Stripe(テストモード)の境界の追加試験。外へは送らない(httpx.MockTransport)。

既存の test_gate_remaining4_billing.py が見ていない所:
- 他人の購読を取り消し・再開できない(404 で、相手の購読は変わらない)
- 他人の Checkout の結果を同期できない(404)
- 署名の無い Webhook は 400(署名の確認を飛ばせない)
- 非管理者は管理者の料金・返金の API を使えない
- 期限の切れた付与は会員のクラスに効かない(Free に戻る)
- 売り止めの商品は買えない
"""
import json
from datetime import timedelta

import pytest

from app.core.auth import get_current_user
from app.main import app
from app.models.models import Entitlement
from app.services import cost_guard

# 既存の試験の部品を使う(Stripe の模擬・署名つき Webhook・合成の Checkout の結果)
from tests.test_gate_remaining4_billing import (  # noqa: F401
    WHSEC, _completed, _hook, _no_audit, _product, stripe)


def _buy_subscription(client, db, user, code="journey_month", sub="sub_b1", evt="evt_b1"):
    from app.core.config import settings

    origin = settings.cors_allowed_origins[-1].rstrip("/")
    r = client.post("/api/v1/billing/checkout", json={"product_id": str(_product(db, code).id)},
                    headers={"Origin": origin})
    assert r.status_code == 200, r.text
    ev = {"id": evt, "type": "checkout.session.completed",
          "data": {"object": _completed(r.json()["payment_id"], subscription=sub, invoice="in_" + evt, pi="pi_" + evt,
                                        id=f"cs_test_{evt}")}}
    assert _hook(client, ev).json()["result"] == "subscription_started"
    return r.json()


def _as(user):
    from app.core.auth import AuthResult

    app.dependency_overrides[get_current_user] = lambda: AuthResult(user=user, is_authenticated=True, is_guest=False)


def test_other_user_cannot_cancel_or_resume_my_subscription(auth_client, db_session, stripe, make_user):
    client, owner = auth_client
    _buy_subscription(client, db_session, owner)
    sub = client.get("/api/v1/billing/me").json()["subscriptions"][0]
    other, _pw = make_user()
    _as(other)
    for path in ("cancel", "resume"):
        body = {} if path == "cancel" else None
        r = client.post(f"/api/v1/billing/subscriptions/{sub['id']}/{path}", **({"json": body} if body is not None else {}))
        assert r.status_code == 404 and r.json()["detail"]["code"] == "subscription_not_found"
    # 相手の購読は変わらず、Stripe へ取り消しも送られていない
    assert not any(c[1].startswith("/v1/subscriptions/") for c in stripe["calls"])
    _as(owner)
    mine = client.get("/api/v1/billing/me").json()["subscriptions"][0]
    assert mine["cancel_at_period_end"] is False and mine["usable"] is True
    assert cost_guard.user_class(db_session, owner) == ("journey", "subscription")
    assert cost_guard.user_class(db_session, other) == ("free", "default")


def test_other_user_cannot_sync_my_checkout_session(auth_client, db_session, stripe, make_user):
    client, owner = auth_client
    res = _buy_subscription(client, db_session, owner)
    other, _pw = make_user()
    _as(other)
    from app.models.models import BillingPayment

    row = db_session.query(BillingPayment).filter(BillingPayment.user_id == owner.id).first()
    sid = row.stripe_checkout_session_id
    r = client.post(f"/api/v1/billing/checkout/{sid}/sync")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "payment_not_found"
    assert res["payment_id"]


def test_webhook_without_or_with_garbled_signature_is_400(auth_client, stripe):
    client, _user = auth_client
    payload = json.dumps({"id": "evt_n", "type": "invoice.paid", "data": {"object": {}}}).encode()
    r = client.post("/api/v1/billing/stripe/webhook", content=payload, headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "bad_signature"
    r = client.post("/api/v1/billing/stripe/webhook", content=payload,
                    headers={"Stripe-Signature": "t=abc,v1=zz", "Content-Type": "application/json"})
    assert r.status_code == 400


@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/v1/admin/billing/products", None),
    ("get", "/api/v1/admin/billing/payments", None),
    ("post", "/api/v1/admin/billing/payments/00000000-0000-0000-0000-000000000000/refund", {"reason": "x"}),
])
def test_non_admin_cannot_use_admin_billing(auth_client, stripe, method, path, body):
    client, _user = auth_client
    r = getattr(client, method)(path, **({"json": body} if body is not None else {}))
    assert r.status_code in (401, 403), r.text


def test_expired_entitlement_returns_to_free(auth_client, db_session, stripe):
    client, user = auth_client
    _buy_subscription(client, db_session, user)
    assert cost_guard.user_class(db_session, user) == ("journey", "subscription")
    rows = db_session.query(Entitlement).filter(Entitlement.subject_id == user.id).all()
    assert rows
    now = cost_guard._now()
    for r in rows:
        r.ends_at = now - timedelta(seconds=1)
    db_session.commit()
    assert cost_guard.user_class(db_session, user) == ("free", "default")


def test_inactive_product_cannot_be_bought(auth_client, db_session, stripe):
    client, _user = auth_client
    product = _product(db_session, "trip_month")
    product.active = False
    db_session.commit()
    r = client.post("/api/v1/billing/checkout", json={"product_id": str(product.id)})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "product_not_found"
    assert not stripe["calls"]
