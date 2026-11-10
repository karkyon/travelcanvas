"""[Gate JourneyMove] 出発地・帰着地との移動手段と所要時間(travel_plans.journey_*_mode / *_minutes)

列の追加だけ(既存の行は変えない。どれも任意)。

Revision ID: c5d2f8a1e7b4
Revises: b8e4f2a6c3d9
Create Date: 2026-11-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c5d2f8a1e7b4'
down_revision: Union[str, Sequence[str], None] = 'b8e4f2a6c3d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_plans', sa.Column('journey_start_mode', sa.String(length=20), nullable=True))
    op.add_column('travel_plans', sa.Column('journey_start_minutes', sa.SmallInteger(), nullable=True))
    op.add_column('travel_plans', sa.Column('journey_end_mode', sa.String(length=20), nullable=True))
    op.add_column('travel_plans', sa.Column('journey_end_minutes', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    for name in ('journey_end_minutes', 'journey_end_mode', 'journey_start_minutes', 'journey_start_mode'):
        op.drop_column('travel_plans', name)
