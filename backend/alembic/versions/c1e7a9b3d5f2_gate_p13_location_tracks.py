"""gate_p13_location_tracks

Revision ID: c1e7a9b3d5f2
Revises: b9d5f3a7c1e4
Create Date: 2026-10-16 09:00:00.000000

[Gate P13] FR-038 任意の位置軌跡(DOC-15 CA-013/014、DOC-04 SC-43)。

新規テーブル location_tracks・location_point_batches を追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
- location_tracks.plan_id は ON DELETE CASCADE(B-012の外部キー方針)。点のまとまりは軌跡の削除で連鎖して消える。
- 座標は location_point_batches.points_ciphertext に暗号化して保存する(平文の列は持たない)。

downgrade はテーブルを削除する(記録した軌跡は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1e7a9b3d5f2'
down_revision: Union[str, Sequence[str], None] = 'b9d5f3a7c1e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'location_tracks',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('mode', sa.String(length=11), nullable=False),
        sa.Column('precision', sa.String(length=9), nullable=False),
        sa.Column('status', sa.String(length=9), nullable=False),
        sa.Column('stopped_reason', sa.String(length=20), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('auto_stop_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('stopped_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('point_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('device_only','synced')", name='ck_location_tracks_mode'),
        sa.CheckConstraint("precision IN ('high','standard','low')", name='ck_location_tracks_precision'),
        sa.CheckConstraint("status IN ('recording','paused','stopped')", name='ck_location_tracks_status'),
        sa.CheckConstraint("(status = 'stopped') = (stopped_at IS NOT NULL)", name='ck_location_tracks_stopped_at'),
        sa.CheckConstraint("mode = 'synced' OR point_count = 0", name='ck_location_tracks_device_only_points'),
    )
    op.create_index('ix_location_tracks_id', 'location_tracks', ['id'])
    op.create_index('ix_location_tracks_plan_user', 'location_tracks', ['plan_id', 'user_id'])
    op.create_table(
        'location_point_batches',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('track_id', UUID, sa.ForeignKey('location_tracks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('batch_id', UUID, nullable=False),
        sa.Column('points_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('point_count', sa.Integer(), nullable=False),
        sa.Column('first_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.UniqueConstraint('track_id', 'batch_id', name='uq_location_point_batches_track_batch'),
        sa.CheckConstraint('point_count >= 0', name='ck_location_point_batches_count'),
    )
    op.create_index('ix_location_point_batches_track_first', 'location_point_batches', ['track_id', 'first_at'])


def downgrade() -> None:
    op.drop_index('ix_location_point_batches_track_first', table_name='location_point_batches')
    op.drop_table('location_point_batches')
    op.drop_index('ix_location_tracks_plan_user', table_name='location_tracks')
    op.drop_index('ix_location_tracks_id', table_name='location_tracks')
    op.drop_table('location_tracks')
