"""fr059_cost_guard

Revision ID: d5f9b2c8e1a3
Revises: c4e8a1f3b7d2
Create Date: 2026-10-29 19:00:00.000000

[FR059-B] 外部 API の原価上限(1旅行 50円)と利用者クラス別 quota(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §7)。

- entitlements: クラスの付与・quota の上書き(管理者が作ると pending、別の管理者の承認で active)
- usage_policy_profiles: クラスごとの上限と価格の版(policy 2026-10-29.1 を入れる)
- usage_budget_accounts: 旅行・月の口座(行の鍵で原子的に予約する)
- provider_usage_reservations / provider_usage_events: 予約と使用の記録(入力の文章・鍵は持たない)

既存の表・列は変えない。downgrade は5つの表を消す(使用の記録も消える)。
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd5f9b2c8e1a3'
down_revision: Union[str, Sequence[str], None] = 'c4e8a1f3b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB
POLICY_VERSION = "2026-10-29.1"

PRICE_SNAPSHOT = {
    "currency": "USD",
    "checked_at": "2026-10-29",
    "operations": {
        "ai.generate": {"provider_kind": "ai", "sku": "ai-text-small",
                        "unit_prices": {"input_tokens": "0.0000001", "output_tokens": "0.0000005"}},
        "ai.web_search": {"provider_kind": "ai", "sku": "ai-web-search",
                          "unit_prices": {"requests": "0.01", "input_tokens": "0.0000001"}},
        "places.search": {"provider_kind": "places", "sku": "places-text-search-enterprise",
                          "unit_prices": {"requests": "0.035"}},
        "places.details": {"provider_kind": "places", "sku": "places-details-enterprise",
                           "unit_prices": {"requests": "0.02"}},
        "places.photo": {"provider_kind": "places", "sku": "places-photo", "unit_prices": {"requests": "0.007"}},
        "routes.element": {"provider_kind": "routes", "sku": "routes-essentials", "unit_prices": {"elements": "0.005"}},
        "map.load": {"provider_kind": "maps", "sku": "dynamic-maps", "unit_prices": {"loads": "0.007"}},
    },
}
FEATURES = {
    "ai_calls_per_plan": 5, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000,
    "web_searches_per_plan": 2, "places_searches_per_plan": 3, "place_details_per_plan": 2, "photos_per_plan": 2,
    "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1,
}
ZERO = {k: 0 for k in FEATURES}
# (profile_key, plan_cap, monthly_cap, plans_per_month, features)
PROFILES = (
    ("guest", "0", "0", 0, ZERO),
    ("free", "50", "50", 1, FEATURES),
    ("trip_pass", "50", None, None, FEATURES),
    ("plus", "50", "250", 5, FEATURES),
    ("family", "50", "250", 5, FEATURES),
    ("pro", "50", "0", 0, FEATURES),
)


def upgrade() -> None:
    op.create_table(
        'entitlements',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('subject_type', sa.String(12), nullable=False),
        sa.Column('subject_id', UUID, nullable=False),
        sa.Column('feature_key', sa.String(64), nullable=False),
        sa.Column('status', sa.String(10), nullable=False, server_default='pending'),
        sa.Column('quota', sa.BigInteger(), nullable=True),
        sa.Column('starts_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source', sa.String(16), nullable=False, server_default='admin'),
        sa.Column('reason', sa.String(200), nullable=True),
        sa.Column('requested_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('approved_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("subject_type IN ('user', 'plan', 'organization')", name='ck_entitlements_subject'),
        sa.CheckConstraint("status IN ('pending', 'active', 'revoked')", name='ck_entitlements_status'),
        sa.CheckConstraint("source IN ('default', 'admin', 'contract', 'trip_pass', 'subscription')",
                           name='ck_entitlements_source'),
        sa.CheckConstraint("quota IS NULL OR quota >= 0", name='ck_entitlements_quota'),
        sa.CheckConstraint("approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by",
                           name='ck_entitlements_two_person'),
    )
    op.create_index('ix_entitlements_subject', 'entitlements', ['subject_type', 'subject_id', 'feature_key'])

    profiles = op.create_table(
        'usage_policy_profiles',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('profile_key', sa.String(16), nullable=False),
        sa.Column('version', sa.String(32), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='JPY'),
        sa.Column('plan_cap_jpy', sa.Numeric(12, 4), nullable=False),
        sa.Column('monthly_cap_jpy', sa.Numeric(12, 4), nullable=True),
        sa.Column('plans_per_month', sa.Integer(), nullable=True),
        sa.Column('feature_quotas', JSONB, nullable=False),
        sa.Column('fx_rate', sa.Numeric(12, 4), nullable=False),
        sa.Column('tax_factor', sa.Numeric(6, 4), nullable=False),
        sa.Column('safety_factor', sa.Numeric(6, 4), nullable=False),
        sa.Column('provider_price_snapshot', JSONB, nullable=False),
        sa.Column('status', sa.String(10), nullable=False, server_default='active'),
        sa.Column('effective_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('profile_key', 'version', name='uq_usage_policy_profiles_key_version'),
        sa.CheckConstraint("status IN ('draft', 'active', 'retired')", name='ck_usage_policy_profiles_status'),
        sa.CheckConstraint("plan_cap_jpy >= 0 AND (monthly_cap_jpy IS NULL OR monthly_cap_jpy >= 0)",
                           name='ck_usage_policy_profiles_caps'),
    )

    op.create_table(
        'usage_budget_accounts',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('scope_type', sa.String(12), nullable=False),
        sa.Column('scope_id', UUID, nullable=False),
        sa.Column('period_key', sa.String(7), nullable=False),
        sa.Column('policy_version', sa.String(32), nullable=False),
        sa.Column('profile_key', sa.String(16), nullable=False),
        sa.Column('cap_jpy', sa.Numeric(12, 4), nullable=False),
        sa.Column('reserved_jpy', sa.Numeric(12, 4), nullable=False, server_default='0'),
        sa.Column('settled_jpy', sa.Numeric(12, 4), nullable=False, server_default='0'),
        sa.Column('plans_used', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('counted_month', sa.String(7), nullable=True),
        sa.Column('counts', JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('scope_type', 'scope_id', 'period_key', name='uq_usage_budget_accounts_scope'),
        sa.CheckConstraint("scope_type IN ('plan', 'user', 'organization')", name='ck_usage_budget_accounts_scope'),
        sa.CheckConstraint("period_key = 'plan' OR period_key ~ '^[0-9]{4}-[0-9]{2}$'",
                           name='ck_usage_budget_accounts_period'),
        sa.CheckConstraint("reserved_jpy >= 0 AND settled_jpy >= 0 AND cap_jpy >= 0 AND plans_used >= 0",
                           name='ck_usage_budget_accounts_amounts'),
    )

    op.create_table(
        'provider_usage_reservations',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('idempotency_key', sa.String(80), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('billable_owner_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
                  index=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('organization_id', UUID, nullable=True),
        sa.Column('provider', sa.String(40), nullable=False),
        sa.Column('operation', sa.String(32), nullable=False),
        sa.Column('units', JSONB, nullable=False),
        sa.Column('counts', JSONB, nullable=False),
        sa.Column('max_cost_jpy', sa.Numeric(12, 4), nullable=False),
        sa.Column('status', sa.String(10), nullable=False, server_default='reserved'),
        sa.Column('profile_key', sa.String(16), nullable=False),
        sa.Column('policy_version', sa.String(32), nullable=False),
        sa.Column('plan_account_id', UUID, sa.ForeignKey('usage_budget_accounts.id', ondelete='SET NULL'),
                  nullable=True, index=True),
        sa.Column('monthly_account_id', UUID, sa.ForeignKey('usage_budget_accounts.id', ondelete='SET NULL'),
                  nullable=True, index=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_provider_usage_reservations_idem'),
        sa.CheckConstraint("status IN ('reserved', 'settled', 'released')",
                           name='ck_provider_usage_reservations_status'),
        sa.CheckConstraint("max_cost_jpy >= 0", name='ck_provider_usage_reservations_cost'),
    )
    op.create_index('ix_provider_usage_reservations_open', 'provider_usage_reservations', ['status', 'expires_at'])

    op.create_table(
        'provider_usage_events',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('reservation_id', UUID, sa.ForeignKey('provider_usage_reservations.id', ondelete='SET NULL'),
                  nullable=True, index=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('organization_id', UUID, nullable=True),
        sa.Column('class_snapshot', sa.String(16), nullable=False),
        sa.Column('provider', sa.String(40), nullable=False),
        sa.Column('model', sa.String(80), nullable=True),
        sa.Column('sku', sa.String(80), nullable=True),
        sa.Column('operation', sa.String(32), nullable=False),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('request_count', sa.Integer(), nullable=True),
        sa.Column('matrix_elements', sa.Integer(), nullable=True),
        sa.Column('raw_cost', sa.Numeric(14, 8), nullable=True),
        sa.Column('raw_currency', sa.String(3), nullable=True),
        sa.Column('fx_rate', sa.Numeric(12, 4), nullable=True),
        sa.Column('tax_factor', sa.Numeric(6, 4), nullable=True),
        sa.Column('estimated_cost_jpy', sa.Numeric(12, 4), nullable=False),
        sa.Column('actual_cost_jpy', sa.Numeric(12, 4), nullable=True),
        sa.Column('price_version', sa.String(32), nullable=False),
        sa.Column('result_code', sa.String(32), nullable=False),
        sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_provider_usage_events_provider_time', 'provider_usage_events', ['provider', 'occurred_at'])

    import uuid as _uuid

    op.bulk_insert(profiles, [
        {"id": _uuid.uuid4(), "profile_key": key, "version": POLICY_VERSION, "currency": "JPY",
         "plan_cap_jpy": plan_cap, "monthly_cap_jpy": monthly_cap, "plans_per_month": per_month,
         "feature_quotas": json.loads(json.dumps(features)), "fx_rate": "180", "tax_factor": "1.10",
         "safety_factor": "1.15", "provider_price_snapshot": json.loads(json.dumps(PRICE_SNAPSHOT)),
         "status": "active"}
        for key, plan_cap, monthly_cap, per_month, features in PROFILES
    ])


def downgrade() -> None:
    op.drop_index('ix_provider_usage_events_provider_time', table_name='provider_usage_events')
    op.drop_table('provider_usage_events')
    op.drop_index('ix_provider_usage_reservations_open', table_name='provider_usage_reservations')
    op.drop_table('provider_usage_reservations')
    op.drop_table('usage_budget_accounts')
    op.drop_table('usage_policy_profiles')
    op.drop_index('ix_entitlements_subject', table_name='entitlements')
    op.drop_table('entitlements')
