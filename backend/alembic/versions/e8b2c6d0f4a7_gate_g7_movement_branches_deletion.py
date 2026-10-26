"""gate_g7_movement_branches_deletion

Revision ID: e8b2c6d0f4a7
Revises: d7f1b5c9e2a6
Create Date: 2026-10-26 15:00:00.000000

[Gate G7] 外部の判断の要らない残り(移動・最適化・分岐の比較・思い出・猶予つきの削除)。

- MOVE-03 移動・滞在の既定: plan_movement_settings(旅行ごとの既定の滞在・休憩の規則・同行者の属性)
- MOVE-03 最終の便: travel_segments.last_departure_at(利用者が入れる終電・最終便の出発時刻)
- FR-039 猶予つきのアカウント削除: users.deletion_requested_at / deletion_due_at(取り消せる間の印)

downgrade: 足した表・列を消す(移動の既定・最終の便の時刻・削除の申し込みは失われる。削除の申し込みが残っている
利用者は、戻した後は自動では削除されない)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e8b2c6d0f4a7'
down_revision: Union[str, Sequence[str], None] = 'd7f1b5c9e2a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'plan_movement_settings',
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('settings', postgresql.JSONB(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('updated_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
                  index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column('travel_segments', sa.Column('last_departure_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('deletion_requested_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('deletion_due_at', sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        'ck_users_deletion_schedule', 'users',
        '(deletion_requested_at IS NULL) = (deletion_due_at IS NULL)',
    )
    op.create_index('ix_users_deletion_due_at', 'users', ['deletion_due_at'],
                    postgresql_where=sa.text('deletion_due_at IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('ix_users_deletion_due_at', table_name='users')
    op.drop_constraint('ck_users_deletion_schedule', 'users', type_='check')
    op.drop_column('users', 'deletion_due_at')
    op.drop_column('users', 'deletion_requested_at')
    op.drop_column('travel_segments', 'last_departure_at')
    op.drop_table('plan_movement_settings')
