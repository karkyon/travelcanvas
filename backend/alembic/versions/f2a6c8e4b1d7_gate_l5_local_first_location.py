"""gate_l5_local_first_location

Revision ID: f2a6c8e4b1d7
Revises: e8b4c2a6d1f9
Create Date: 2026-10-19 07:00:00.000000

[Gate L5] FR-055 Local-first Location(DOC-15 CA-013)・FR-056 適応型GPS(CA-014)。

- trip_location_settings(新規): 旅行ごと・利用者ごとの位置の扱い(記録しない / この端末だけ / 訪問地域だけ同期 /
  暗号化してサーバーへ)。plan_id は ON DELETE CASCADE(B-012)。
- location_area_cells(新規): 「訪問地域だけ同期」の軌跡で、端末が集計した区画(0.1度 ≒ 11km)と滞在時間だけを持つ。
  生の座標は持たない。軌跡の削除・旅行の完全削除で連鎖して消える。
- location_tracks: mode に areas_only を追加(検査制約の作り直し)、sampling(端末の記録の観測値: 電池・欠測率・
  取得の間隔の内訳。座標を含まない)を追加。

downgrade: areas_only の軌跡は device_only に戻し(区画は消える)、追加した列・表を消す。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f2a6c8e4b1d7'
down_revision: Union[str, Sequence[str], None] = 'e8b4c2a6d1f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'trip_location_settings',
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), primary_key=True,
                  nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, nullable=False),
        sa.Column('mode', sa.String(length=11), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('off','device_only','areas_only','synced')",
                           name='ck_trip_location_settings_mode'),
    )
    op.create_table(
        'location_area_cells',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('track_id', UUID, sa.ForeignKey('location_tracks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('cell_key', sa.String(length=24), nullable=False),
        sa.Column('first_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('dwell_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('samples', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('track_id', 'cell_key', name='uq_location_area_cells_track_cell'),
        sa.CheckConstraint('last_at >= first_at', name='ck_location_area_cells_time_order'),
        sa.CheckConstraint('dwell_seconds >= 0 AND samples >= 0', name='ck_location_area_cells_nonnegative'),
    )
    op.create_index('ix_location_area_cells_plan_user', 'location_area_cells', ['plan_id', 'user_id'])
    op.add_column('location_tracks', sa.Column('sampling', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.drop_constraint('ck_location_tracks_mode', 'location_tracks', type_='check')
    op.create_check_constraint('ck_location_tracks_mode', 'location_tracks',
                               "mode IN ('device_only','areas_only','synced')")


def downgrade() -> None:
    op.execute("UPDATE location_tracks SET mode = 'device_only' WHERE mode = 'areas_only'")
    op.drop_constraint('ck_location_tracks_mode', 'location_tracks', type_='check')
    op.create_check_constraint('ck_location_tracks_mode', 'location_tracks', "mode IN ('device_only','synced')")
    op.drop_column('location_tracks', 'sampling')
    op.drop_index('ix_location_area_cells_plan_user', table_name='location_area_cells')
    op.drop_table('location_area_cells')
    op.drop_table('trip_location_settings')
