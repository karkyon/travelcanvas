"""fr059_membership_tiers

Revision ID: a1d3f5b7c9e2
Revises: f2a6d8c4b9e1
Create Date: 2026-10-31 09:00:00.000000

[Gate FR059-Tiers] 会員の機能クラス Free / Trip / Journey / Explorer の価格の版 ``2026-10-31.1``
(docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §3.2〜§3.5)。

- usage_policy_profiles に free・trip・journey・explorer の版 2026-10-31.1 を足す(単価・為替・税・安全係数は 2026-10-29.1 と同じ)
- 以前の free(2026-10-29.1: AI 5回・月1旅行)は retired にする(行は残す。以前の予約の確定は版で引くので消さない)
- 表・列は変えない。downgrade は 2026-10-31.1 の行を消し、以前の free を active に戻す
"""
import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1d3f5b7c9e2'
down_revision: Union[str, Sequence[str], None] = 'f2a6d8c4b9e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TIER_VERSION = "2026-10-31.1"
LEGACY_VERSION = "2026-10-29.1"

# membership_tiers.TIER_QUOTAS / TIER_CAPS と同じ値(migration はアプリのコードを import しない)
ZERO = {"ai_calls_per_plan": 0, "ai_input_tokens_per_call": 0, "ai_output_tokens_per_call": 0,
        "web_searches_per_plan": 0, "places_searches_per_plan": 0, "place_details_per_plan": 0, "photos_per_plan": 0,
        "route_elements_per_plan": 0, "dynamic_map_loads_per_plan": 0}
TRIP = {**ZERO, "places_searches_per_plan": 2, "place_details_per_plan": 1, "photos_per_plan": 1,
        "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1}
JOURNEY = {**TRIP, "ai_calls_per_plan": 3, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000}
EXPLORER = {"ai_calls_per_plan": 5, "ai_input_tokens_per_call": 10000, "ai_output_tokens_per_call": 2000,
            "web_searches_per_plan": 2, "places_searches_per_plan": 3, "place_details_per_plan": 2, "photos_per_plan": 2,
            "route_elements_per_plan": 4, "dynamic_map_loads_per_plan": 1}
# (profile_key, plan_cap, monthly_cap, plans_per_month, features)
PROFILES = (
    ("free", "50", None, None, ZERO),
    ("trip", "50", "150", 5, TRIP),
    ("journey", "50", "150", 5, JOURNEY),
    ("explorer", "50", "250", 5, EXPLORER),
)

profiles_table = sa.table(
    'usage_policy_profiles',
    sa.column('id', postgresql.UUID(as_uuid=True)), sa.column('profile_key', sa.String),
    sa.column('version', sa.String), sa.column('currency', sa.String), sa.column('plan_cap_jpy', sa.Numeric),
    sa.column('monthly_cap_jpy', sa.Numeric), sa.column('plans_per_month', sa.Integer),
    sa.column('feature_quotas', postgresql.JSONB), sa.column('fx_rate', sa.Numeric), sa.column('tax_factor', sa.Numeric),
    sa.column('safety_factor', sa.Numeric), sa.column('provider_price_snapshot', postgresql.JSONB),
    sa.column('status', sa.String),
)


def upgrade() -> None:
    bind = op.get_bind()
    legacy = bind.execute(sa.text(
        "SELECT fx_rate, tax_factor, safety_factor, provider_price_snapshot FROM usage_policy_profiles "
        "WHERE profile_key = 'free' AND version = :v"), {"v": LEGACY_VERSION}).first()
    if legacy is None:
        raise RuntimeError("usage_policy_profiles に free %s がありません(d5f9b2c8e1a3 の後に流します)" % LEGACY_VERSION)
    fx, tax, safety, snapshot = legacy
    op.bulk_insert(profiles_table, [
        {"id": uuid.uuid4(), "profile_key": key, "version": TIER_VERSION, "currency": "JPY",
         "plan_cap_jpy": plan_cap, "monthly_cap_jpy": monthly_cap, "plans_per_month": per_month,
         "feature_quotas": json.loads(json.dumps(features)), "fx_rate": fx, "tax_factor": tax,
         "safety_factor": safety, "provider_price_snapshot": snapshot, "status": "active"}
        for key, plan_cap, monthly_cap, per_month, features in PROFILES
    ])
    bind.execute(sa.text("UPDATE usage_policy_profiles SET status = 'retired' "
                         "WHERE profile_key = 'free' AND version = :v"), {"v": LEGACY_VERSION})


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM usage_policy_profiles WHERE version = :v"), {"v": TIER_VERSION})
    bind.execute(sa.text("UPDATE usage_policy_profiles SET status = 'active' "
                         "WHERE profile_key = 'free' AND version = :v"), {"v": LEGACY_VERSION})
