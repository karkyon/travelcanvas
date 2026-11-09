"""[Gate JourneyEnds] 旅の出発・到着(travel_plans.journey_*)

- journey_enabled: 旅程の最初・最後に出発・到着を出すか(既定 false = 今までと同じ)
- journey_start_place / journey_start_time: 出発の場所(短い名前)・時刻("HH:MM")
- journey_end_place / journey_end_time: 到着(旅の終わり)の場所・時刻
列の追加だけ(既存の行は変えない。journey_enabled は false で埋まる)。

Revision ID: a7d3e9c1f5b2
Revises: e4c7a9d2b6f1
Create Date: 2026-11-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7d3e9c1f5b2'
down_revision: Union[str, Sequence[str], None] = 'e4c7a9d2b6f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_plans', sa.Column('journey_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('travel_plans', sa.Column('journey_start_place', sa.String(length=120), nullable=True))
    op.add_column('travel_plans', sa.Column('journey_start_time', sa.String(length=5), nullable=True))
    op.add_column('travel_plans', sa.Column('journey_end_place', sa.String(length=120), nullable=True))
    op.add_column('travel_plans', sa.Column('journey_end_time', sa.String(length=5), nullable=True))


def downgrade() -> None:
    for name in ('journey_end_time', 'journey_end_place', 'journey_start_time', 'journey_start_place', 'journey_enabled'):
        op.drop_column('travel_plans', name)
