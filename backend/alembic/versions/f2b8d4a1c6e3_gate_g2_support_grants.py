"""gate_g2_support_grants

Revision ID: f2b8d4a1c6e3
Revises: f1a7c3e9b2d4
Create Date: 2026-10-21 14:10:00.000000

[Gate G2] FR-040 サポート閲覧(本人の同意・目的・期限つき・読み取りだけ・全ての閲覧を監査)。

- support_grants(新しい表): 利用者が自分で作る「サポートが見てよい」許可。対象(1つの旅行。NULL ならアカウントの概要と
  全ての旅行の一覧)・目的・期限・取り消し・閲覧の回数と最後の閲覧。利用者を消すと一緒に消える。

downgrade: 表を消す(許可は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f2b8d4a1c6e3'
down_revision: Union[str, Sequence[str], None] = 'f1a7c3e9b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'support_grants',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=True),
        sa.Column('purpose', sa.String(200), nullable=False),
        sa.Column('ticket_ref', sa.String(40), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('access_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_accessed_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_support_grants_id', 'support_grants', ['id'])
    op.create_index('ix_support_grants_user_id', 'support_grants', ['user_id'])
    op.create_index('ix_support_grants_plan_id', 'support_grants', ['plan_id'])
    op.create_index('ix_support_grants_expires_at', 'support_grants', ['expires_at'])


def downgrade() -> None:
    for ix in ('ix_support_grants_expires_at', 'ix_support_grants_plan_id', 'ix_support_grants_user_id',
               'ix_support_grants_id'):
        op.drop_index(ix, table_name='support_grants')
    op.drop_table('support_grants')
