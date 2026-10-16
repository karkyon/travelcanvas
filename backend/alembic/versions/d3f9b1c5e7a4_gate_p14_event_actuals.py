"""gate_p14_event_actuals

Revision ID: d3f9b1c5e7a4
Revises: c1e7a9b3d5f2
Create Date: 2026-10-16 11:00:00.000000

[Gate P14] FR-054 Plan-to-Memory・FR-053 旅の達成指標(DOC-15 CA-011/012、DOC-04 SC-42)。

新規テーブル event_actuals を1つ追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
- 予定の実績(行った/行かなかった・実際の到着と出発)を予定とは別の行で持つ(予定を実績で上書きしない)。
- 予定(event_id)には外部キーを張らない(B-013の個別削除を妨げないため)。plan_id は ON DELETE CASCADE(B-012)。

downgrade はテーブルを削除する(記録した実績は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd3f9b1c5e7a4'
down_revision: Union[str, Sequence[str], None] = 'c1e7a9b3d5f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'event_actuals',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_id', UUID, nullable=False),
        sa.Column('status', sa.String(length=7), nullable=False),
        sa.Column('actual_start_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('actual_end_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source', sa.String(length=9), nullable=False),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('recorded_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('plan_id', 'event_id', name='uq_event_actuals_plan_event'),
        sa.CheckConstraint("status IN ('visited','skipped')", name='ck_event_actuals_status'),
        sa.CheckConstraint("source IN ('manual','suggested')", name='ck_event_actuals_source'),
        sa.CheckConstraint(
            "status = 'visited' OR (actual_start_at IS NULL AND actual_end_at IS NULL)",
            name='ck_event_actuals_skipped_times',
        ),
        sa.CheckConstraint(
            "actual_start_at IS NULL OR actual_end_at IS NULL OR actual_end_at >= actual_start_at",
            name='ck_event_actuals_time_order',
        ),
    )
    op.create_index('ix_event_actuals_id', 'event_actuals', ['id'])


def downgrade() -> None:
    op.drop_index('ix_event_actuals_id', table_name='event_actuals')
    op.drop_table('event_actuals')
