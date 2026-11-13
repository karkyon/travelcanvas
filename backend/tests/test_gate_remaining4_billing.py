"""
[Gate Remaining-4] FR-058 料金・決済(Stripe のテストモード)。外へは送らない(httpx.MockTransport)。

検証する主な性質:
- 鍵が無い・本番の鍵(sk_live_)の時は送らずに 409 billing_unavailable
- 購入: 仮の価格で Checkout を作る(カードは受け取らない)。ゲストは買えない。購読中は 2 つ目を買えない。
  Trip Pass は自分の旅行だけ・同じ旅行に 2 枚は買えない
- 結果の反映(Webhook・問い合わせ): 購読は Entitlement(user・source=subscription)、Trip Pass は Entitlement(plan)。
  同じイベントは 1 回だけ。署名が違う・古い Webhook は 400
- 取り消し: 期間の終わりで止める → 使える。止まった(canceled)→ Entitlement を revoked。続ける(resume)
- 請求書(invoice.paid)は最初の支払いと同じ行。返金(一部・全額)、Trip Pass の全額の返金は付与を外す
- 管理者: 仮の価格の変更(revision)・販売の停止。cost_guard のクラスの解決に購読が効く
"""
import json
import uuid

import httpx
import pytest

from app.models.models import BillingPayment, BillingProduct, Entitlement, TravelPlan
from app.services import cost_guard
from app.services import provider_secrets as ps
from app.services import stripe_client as sc

KEY = "sk_test_unit_0123456789abcdefghij"
WHSEC = "whsec_unit_0123456789abcdefghij"


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    from app.api.v1 import billing as billing_api

    monkeypatch.setattr(billing_api, "record_audit_event", lambda **kw: None)


@pytest.fixture()
def stripe(monkeypatch):
    calls = []
    state = {"session": None}

    def resolve(db, slot):
        if slot == "stripe_secret_key":
            return state.get("key", KEY)
        if slot == "stripe_webhook_secret":
            return WHSEC
        raise ps.SecretUnavailable("secret_missing")

    monkeypatch.setattr(ps, "resolve", resolve)

    def handler(request: httpx.Request):
        body = dict(httpx.QueryParams(request.content.decode())) if request.content else {}
        calls.append((request.method, request.url.path, body))
        if request.url.path == "/v1/checkout/sessions" and request.method == "POST":
            sid = f"cs_test_{len(calls)}"
            state["session"] = {"id": sid, "url": f"https://checkout.stripe.com/c/pay/{sid}", **body}
            return httpx.Response(200, json={"id": sid, "url": f"https://checkout.stripe.com/c/pay/{sid}"})
        if request.url.path.startswith("/v1/checkout/sessions/"):
            return httpx.Response(200, json=state["completed"])
        if request.url.path.startswith("/v1/subscriptions/"):
            sid = request.url.path.rsplit("/", 1)[1]
            if request.method == "DELETE":
                return httpx.Response(200, json={"id": sid, "status": "canceled", "cancel_at_period_end": False})
            end = body.get("cancel_at_period_end") == "true"
            return httpx.Response(200, json={"id": sid, "status": "active", "cancel_at_period_end": end,
                                             "current_period_end": 1798761600})
        if request.url.path == "/v1/refunds":
            return httpx.Response(200, json={"id": "re_1", "amount": int(body["amount"])})
        return httpx.Response(404, json={"error": {"type": "invalid_request_error"}})

    sc.set_transport(httpx.MockTransport(handler))
    yield {"calls": calls, "state": state}
    sc.set_transport(None)


def _registered(user, db):
    """make_user は登録済みの人(UserType.REGISTERED)"""
    assert not str(user.user_type).lower().endswith("guest")


def _product(db, code):
    return db.query(BillingProduct).filter(BillingProduct.code == code).one()


def _hook(client, event, secret=WHSEC, sig=None):
    payload = json.dumps(event).encode()
    headers = {"Stripe-Signature": sig or sc.sign(payload, secret), "Content-Type": "application/json"}
    return client.post("/api/v1/billing/stripe/webhook", content=payload, headers=headers)


def _completed(payment_id, **kw):
    return {"id": kw.get("id", "cs_test_x"), "status": "complete", "payment_status": "paid",
            "metadata": {"tc_payment_id": payment_id}, "client_reference_id": payment_id,
            "amount_total": kw.get("amount", 680), "customer": "cus_1", "subscription": kw.get("subscription"),
            "payment_intent": kw.get("pi"), "invoice": kw.get("invoice")}


def test_not_configured_and_live_key_refused(auth_client, db_session, monkeypatch):
    client, user = auth_client
    _registered(user, db_session)
    monkeypatch.setattr(ps, "resolve", lambda db, slot: (_ for _ in ()).throw(ps.SecretUnavailable("secret_missing")))
    body = client.get("/api/v1/billing/products").json()
    assert body["configured"] is False and {p["code"] for p in body["products"]} >= {"trip_month", "trip_pass"}
    pid = _product(db_session, "journey_month").id
    r = client.post("/api/v1/billing/checkout", json={"product_id": str(pid)})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "billing_unavailable"
    monkeypatch.setattr(ps, "resolve", lambda db, slot: "sk_live_should_never_be_used_123")
    r = client.post("/api/v1/billing/checkout", json={"product_id": str(pid)})
    assert r.status_code == 409 and r.json()["detail"]["reason"] == "live_key_refused"
    assert db_session.query(BillingPayment).filter(BillingPayment.user_id == user.id).count() == 0


def test_subscription_flow_grants_and_revokes(auth_client, db_session, stripe):
    client, user = auth_client
    _registered(user, db_session)
    product = _product(db_session, "journey_month")
    from app.core.config import settings

    origin = settings.cors_allowed_origins[-1].rstrip("/")
    r = client.post("/api/v1/billing/checkout", json={"product_id": str(product.id)}, headers={"Origin": origin})
    assert r.status_code == 200, r.text
    assert r.json()["url"].startswith("https://checkout.stripe.com/")
    _m, path, sent = stripe["calls"][0]
    assert sent["mode"] == "subscription" and sent["line_items[0][price_data][unit_amount]"] == "680"
    assert sent["line_items[0][price_data][recurring][interval]"] == "month"
    assert sent["success_url"].startswith(f"{origin}/settings/billing?session=")
    assert not any("card" in k for k in sent)
    pay_id = r.json()["payment_id"]
    # 購読中(手続き中)でも 2 つ目は始められる(まだ払っていない)。払った後は断る
    ev = {"id": "evt_1", "type": "checkout.session.completed",
          "data": {"object": _completed(pay_id, subscription="sub_1", invoice="in_1", pi="pi_1")}}
    assert _hook(client, ev).json()["result"] == "subscription_started"
    assert _hook(client, ev).json()["result"] == "duplicate"
    assert cost_guard.user_class(db_session, user) == ("journey", "subscription")
    again = client.post("/api/v1/billing/checkout", json={"product_id": str(_product(db_session, "trip_month").id)})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_subscribed"
    # 最初の請求書は同じ行(2 行にしない)
    inv = {"id": "evt_2", "type": "invoice.paid", "data": {"object": {
        "id": "in_1", "subscription": "sub_1", "status": "paid", "amount_paid": 680,
        "hosted_invoice_url": "https://invoice.stripe.com/i/x"}}}
    assert _hook(client, inv).json()["result"] == "invoice_paid"
    me = client.get("/api/v1/billing/me").json()
    assert me["class"] == "journey" and len(me["payments"]) == 1
    assert me["payments"][0]["receipt_url"] == "https://invoice.stripe.com/i/x"
    sub = me["subscriptions"][0]
    # 期間の終わりで止める → まだ使える → 続ける
    r = client.post(f"/api/v1/billing/subscriptions/{sub['id']}/cancel", json={})
    assert r.json()["cancel_at_period_end"] is True and r.json()["usable"] is True
    assert client.post(f"/api/v1/billing/subscriptions/{sub['id']}/resume").json()["cancel_at_period_end"] is False
    # 止まった(Stripe から)→ Free に戻る
    ended = {"id": "evt_3", "type": "customer.subscription.deleted",
             "data": {"object": {"id": "sub_1", "status": "canceled", "cancel_at_period_end": False}}}
    assert _hook(client, ended).json()["result"] == "ended"
    assert cost_guard.user_class(db_session, user) == ("free", "default")


def test_trip_pass_flow_and_refund(auth_client, db_session, stripe, make_user):
    client, user = auth_client
    _registered(user, db_session)
    plan_id = client.post("/api/v1/travel-plans/", json={"title": "Trip Pass の旅"}).json()["id"]
    pass_id = str(_product(db_session, "trip_pass").id)
    assert client.post("/api/v1/billing/checkout", json={"product_id": pass_id}).status_code == 422
    other, _ = make_user()
    other_plan = TravelPlan(id=uuid.uuid4(), user_id=other.id, title="他の人")
    db_session.add(other_plan)
    db_session.commit()
    assert client.post("/api/v1/billing/checkout",
                       json={"product_id": pass_id, "plan_id": str(other_plan.id)}).status_code == 422
    r = client.post("/api/v1/billing/checkout", json={"product_id": pass_id, "plan_id": plan_id})
    assert r.status_code == 200
    assert stripe["calls"][-1][2]["mode"] == "payment"
    # Webhook が来ない環境: 戻った画面から問い合わせる
    session_id = r.json()["session_id"]
    stripe["state"]["completed"] = _completed(r.json()["payment_id"], id=session_id, amount=500, pi="pi_pass")
    synced = client.post(f"/api/v1/billing/checkout/{session_id}/sync").json()
    assert synced["result"] == "trip_pass_granted" and synced["payment"]["status"] == "paid"
    assert client.post(f"/api/v1/billing/checkout/{session_id}/sync").json()["result"] == "already"
    ent = db_session.query(Entitlement).filter(Entitlement.subject_type == "plan",
                                               Entitlement.subject_id == uuid.UUID(plan_id)).one()
    assert ent.status == "active" and ent.source == "trip_pass"
    assert client.post("/api/v1/billing/checkout",
                       json={"product_id": pass_id, "plan_id": plan_id}).json()["detail"]["code"] == "already_has_pass"
    passes = client.get("/api/v1/billing/me").json()["trip_passes"]
    assert passes == [{"plan_id": plan_id, "plan_title": "Trip Pass の旅"}]
    # 返金(一部 → 全額)。全額で付与を外す
    from app.api.v1 import admin as admin_api
    from app.main import app
    app.dependency_overrides[admin_api.require_admin] = lambda: user
    try:
        pay = synced["payment"]["id"]
        part = client.post(f"/api/v1/admin/billing/payments/{pay}/refund", json={"amount_jpy": 200, "reason": "一部"})
        assert part.json()["status"] == "partially_refunded" and part.json()["refunded_jpy"] == 200
        assert client.post(f"/api/v1/admin/billing/payments/{pay}/refund",
                           json={"amount_jpy": 400, "reason": "多すぎ"}).status_code == 422
        full = client.post(f"/api/v1/admin/billing/payments/{pay}/refund", json={"reason": "残り"})
        assert full.json()["status"] == "refunded" and full.json()["refunded_jpy"] == 500
        db_session.refresh(ent)
        assert ent.status == "revoked"
        # 管理者: 仮の価格を変える(revision)・古い版は 409
        prod = client.get("/api/v1/admin/billing/products").json()["products"]
        tp = next(p for p in prod if p["code"] == "trip_pass")
        changed = client.patch(f"/api/v1/admin/billing/products/{tp['id']}",
                               json={"price_jpy": 800, "revision": tp["revision"]})
        assert changed.json()["price_jpy"] == 800 and changed.json()["revision"] == tp["revision"] + 1
        assert client.patch(f"/api/v1/admin/billing/products/{tp['id']}",
                            json={"active": False, "revision": tp["revision"]}).status_code == 409
    finally:
        app.dependency_overrides.pop(admin_api.require_admin, None)


def test_guest_cannot_buy_and_webhook_signature(auth_client, db_session, stripe):
    client, user = auth_client
    from app.models.models import UserType

    user.user_type = UserType.GUEST
    db_session.commit()
    pid = str(_product(db_session, "trip_month").id)
    r = client.post("/api/v1/billing/checkout", json={"product_id": pid})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "guest_cannot_buy"
    ev = {"id": "evt_x", "type": "checkout.session.completed", "data": {"object": {}}}
    assert _hook(client, ev, secret="whsec_wrong").status_code == 400
    old = sc.sign(json.dumps(ev).encode(), WHSEC, ts=1)
    assert _hook(client, ev, sig=old).status_code == 400
    assert _hook(client, ev).json()["result"] == "unknown_payment"


def test_flatten_and_signature_helpers():
    assert sc.flatten({"a": {"b": 1}, "c": [{"d": 2}], "e": True, "f": None}) == [
        ("a[b]", "1"), ("c[0][d]", "2"), ("e", "true")]
    payload = b'{"id":"evt","type":"x"}'
    assert sc.verify_signature(payload, sc.sign(payload, "whsec_a"), "whsec_a")["id"] == "evt"
    with pytest.raises(ValueError):
        sc.verify_signature(payload, sc.sign(payload, "whsec_a"), "whsec_b")
