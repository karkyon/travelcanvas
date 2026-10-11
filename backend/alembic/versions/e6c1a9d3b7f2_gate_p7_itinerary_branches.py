"""gate_p7_itinerary_branches

Revision ID: e6c1a9d3b7f2
Revises: d2a7c5e9f4b1
Create Date: 2026-10-11 20:00:00.000000

[Gate P7] FR-019 What-if・旅程ブランチ(DOC-05 §7.6 itinerary_branches)。

新規テーブル itinerary_branches を1つ追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
- base_snapshot(作成時点の本案の予定)と content(分岐案の予定)をJSONで持つ。予定(events)への外部キーは張らない
  (B-013の個別削除を妨げないため。採用時に存在を確認する)。
- 採用した変更セット(change_sets)は ON DELETE SET NULL。plan_id は ON DELETE CASCADE(B-012の外部キー方針)。

downgrade はテーブルを削除する(分岐案は失われる。本案の予定には影響しない)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e6c1a9d3b7f2'
down_revision: Union[str, Sequence[str], None] = 'd2a7c5e9f4b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'itinerary_branches',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('scenario_type', sa.String(length=10), nullable=False),
        sa.Column('assumptions', sa.JSON(), nullable=False),
        sa.Column('base_revision', sa.Integer(), nullable=False),
        sa.Column('base_snapshot', sa.JSON(), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=9), nullable=False),
        sa.Column('adopted_change_set_id', UUID, sa.ForeignKey('change_sets.id', ondelete='SET NULL'), nullable=True),
        sa.Column('adopted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('adopted_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "scenario_type IN ('rain','delay','absence','budget','fatigue','custom')",
            name='ck_itinerary_branches_scenario',
        ),
        sa.CheckConstraint("status IN ('draft','adopted','discarded')", name='ck_itinerary_branches_status'),
        sa.CheckConstraint("(status = 'adopted') = (adopted_at IS NOT NULL)", name='ck_itinerary_branches_adopted_at'),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 200", name='ck_itinerary_branches_title'),
    )
    op.create_index('ix_itinerary_branches_id', 'itinerary_branches', ['id'])
    op.create_index('ix_itinerary_branches_plan_deleted', 'itinerary_branches', ['plan_id', 'deleted_at'])


def downgrade() -> None:
    op.drop_index('ix_itinerary_branches_plan_deleted', table_name='itinerary_branches')
    op.drop_index('ix_itinerary_branches_id', table_name='itinerary_branches')
    op.drop_table('itinerary_branches')
