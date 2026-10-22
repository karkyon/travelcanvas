"""gate_g2_member_field_policy

Revision ID: f3c9e5b7a2d1
Revises: f2b8d4a1c6e3
Create Date: 2026-10-21 16:00:00.000000

[Gate G2] FR-045 同行者(旅行の参加者)向けの項目の規則(app/services/member_policy.py が正本)。

- travel_plans.member_field_policy: 役割ごと(editor・viewer)の既定 {"version":1,"roles":{"viewer":[...]}}。
  NULL は本Gate以前の旅行(何も隠さない)
- plan_collaborators.field_policy: 参加者1人ずつの上書き {"version":1,"hidden":[...]}。NULL は役割の既定に従う

downgrade: 2つの列を消す(隠す設定は失われ、本Gate以前と同じく参加者に全て見える)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f3c9e5b7a2d1'
down_revision: Union[str, Sequence[str], None] = 'f2b8d4a1c6e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_plans', sa.Column('member_field_policy', postgresql.JSONB(), nullable=True))
    op.add_column('plan_collaborators', sa.Column('field_policy', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('plan_collaborators', 'field_policy')
    op.drop_column('travel_plans', 'member_field_policy')
