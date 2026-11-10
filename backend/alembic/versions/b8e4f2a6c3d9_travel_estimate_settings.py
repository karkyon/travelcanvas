"""[Gate TravelEstimate] 移動の見積もりの条件(travel_estimate_settings)

全体で 1 行(id=1)。表を足すだけ(既存の表・行は変えない)。行が無い時は既定の条件で計算する。

Revision ID: b8e4f2a6c3d9
Revises: a7d3e9c1f5b2
Create Date: 2026-11-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b8e4f2a6c3d9'
down_revision: Union[str, Sequence[str], None] = 'a7d3e9c1f5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'travel_estimate_settings',
        sa.Column('id', sa.SmallInteger(), primary_key=True),
        sa.Column('params', postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_travel_estimate_settings_updated_by_user_id', 'travel_estimate_settings', ['updated_by_user_id'])


def downgrade() -> None:
    op.drop_index('ix_travel_estimate_settings_updated_by_user_id', table_name='travel_estimate_settings')
    op.drop_table('travel_estimate_settings')
