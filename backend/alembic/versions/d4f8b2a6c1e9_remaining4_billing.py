"""[Gate Remaining-4] FR-058 料金・決済(Stripe のテストモード)の表。

- billing_products: 売る物(会員のクラスの月額・年額と Trip Pass)。価格は仮で、管理者が画面で変える(revision)。
  初めの値(2026-11-13 利用者「仮の価格で仕組みだけ」): Trip 月 300 円・Journey 月 680 円・Explorer 月 980 円・Trip Pass 500 円
- billing_customers: 利用者 ↔ Stripe の顧客
- billing_subscriptions: 購読(状態・期間の終わり・期間の終わりで止めるか)と、付与した Entitlement
- billing_payments: 支払い(Checkout・請求書)と返金。Trip Pass は旅行(plan_id)に付く
- billing_events: Stripe の Webhook のイベントの ID(同じイベントを 2 回処理しない)
- カードの番号は持たない(Stripe の画面で入れる)。downgrade は表を消す(付与した Entitlement は残る)
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d4f8b2a6c1e9"
down_revision = "c1e7a3b9d5f2"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)
SEED = [
    ("trip_month", "subscription", "trip", "Trip(月額)", 300, "month"),
    ("journey_month", "subscription", "journey", "Journey(月額)", 680, "month"),
    ("explorer_month", "subscription", "explorer", "Explorer(月額)", 980, "month"),
    ("trip_pass", "trip_pass", "trip_pass", "Trip Pass(1 旅行)", 500, None),
]


def upgrade() -> None:
    products = op.create_table(
        "billing_products",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("tier_key", sa.String(16), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("price_jpy", sa.Integer(), nullable=False),
        sa.Column("interval", sa.String(8), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("code", name="uq_billing_products_code"),
        sa.CheckConstraint("kind IN ('subscription', 'trip_pass')", name="ck_billing_products_kind"),
        sa.CheckConstraint("tier_key IN ('trip', 'journey', 'explorer', 'trip_pass')", name="ck_billing_products_tier"),
        sa.CheckConstraint("price_jpy BETWEEN 50 AND 1000000", name="ck_billing_products_price"),
        sa.CheckConstraint("(kind = 'subscription') = (interval IS NOT NULL) AND "
                           "(interval IS NULL OR interval IN ('month', 'year'))", name="ck_billing_products_interval"),
        sa.CheckConstraint("(kind = 'trip_pass') = (tier_key = 'trip_pass')", name="ck_billing_products_kind_tier"),
    )
    op.create_index("ix_billing_products_updated_by", "billing_products", ["updated_by"])
    op.bulk_insert(products, [
        {"id": uuid.uuid4(), "code": c, "kind": k, "tier_key": t, "name": n, "price_jpy": p, "interval": i,
         "description": "仮の価格(テストモード)。管理者が変えられます"}
        for c, k, t, n, p, i in SEED
    ])
    op.create_table(
        "billing_customers",
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("stripe_customer_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("stripe_customer_id", name="uq_billing_customers_stripe"),
    )
    op.create_table(
        "billing_subscriptions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", UUID, sa.ForeignKey("billing_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stripe_subscription_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="incomplete"),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price_jpy", sa.Integer(), nullable=False),
        sa.Column("entitlement_id", UUID, sa.ForeignKey("entitlements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("stripe_subscription_id", name="uq_billing_subscriptions_stripe"),
        sa.CheckConstraint("status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', "
                           "'canceled', 'unpaid', 'paused')", name="ck_billing_subscriptions_status"),
    )
    op.create_index("ix_billing_subscriptions_user", "billing_subscriptions", ["user_id"])
    op.create_index("ix_billing_subscriptions_product", "billing_subscriptions", ["product_id"])
    op.create_index("ix_billing_subscriptions_entitlement", "billing_subscriptions", ["entitlement_id"])
    op.create_table(
        "billing_payments",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", UUID, sa.ForeignKey("billing_products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("plan_id", UUID, sa.ForeignKey("travel_plans.id", ondelete="SET NULL"), nullable=True),
        sa.Column("subscription_id", UUID, sa.ForeignKey("billing_subscriptions.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("amount_jpy", sa.Integer(), nullable=False),
        sa.Column("refunded_jpy", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stripe_checkout_session_id", sa.String(100), nullable=True),
        sa.Column("stripe_payment_intent_id", sa.String(100), nullable=True),
        sa.Column("stripe_invoice_id", sa.String(100), nullable=True),
        sa.Column("receipt_url", sa.String(500), nullable=True),
        sa.Column("entitlement_id", UUID, sa.ForeignKey("entitlements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("refund_reason", sa.String(200), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("stripe_checkout_session_id", name="uq_billing_payments_session"),
        sa.UniqueConstraint("stripe_invoice_id", name="uq_billing_payments_invoice"),
        sa.CheckConstraint("kind IN ('subscription', 'trip_pass', 'invoice')", name="ck_billing_payments_kind"),
        sa.CheckConstraint("status IN ('pending', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded')",
                           name="ck_billing_payments_status"),
        sa.CheckConstraint("amount_jpy >= 0 AND refunded_jpy >= 0 AND refunded_jpy <= amount_jpy",
                           name="ck_billing_payments_amounts"),
    )
    for col in ("user_id", "product_id", "plan_id", "subscription_id", "entitlement_id", "stripe_payment_intent_id"):
        op.create_index(f"ix_billing_payments_{col}", "billing_payments", [col])
    op.create_table(
        "billing_events",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("type", sa.String(80), nullable=False),
        sa.Column("result", sa.String(40), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("billing_events")
    for col in ("user_id", "product_id", "plan_id", "subscription_id", "entitlement_id", "stripe_payment_intent_id"):
        op.drop_index(f"ix_billing_payments_{col}", table_name="billing_payments")
    op.drop_table("billing_payments")
    op.drop_index("ix_billing_subscriptions_entitlement", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_product", table_name="billing_subscriptions")
    op.drop_index("ix_billing_subscriptions_user", table_name="billing_subscriptions")
    op.drop_table("billing_subscriptions")
    op.drop_table("billing_customers")
    op.drop_index("ix_billing_products_updated_by", table_name="billing_products")
    op.drop_table("billing_products")
