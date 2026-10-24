"""gate_g6_offline_location_memory

Revision ID: d7f1b5c9e2a6
Revises: c6e0a4b8d3f5
Create Date: 2026-10-23 14:00:00.000000

[Gate G6] 外部の判断の要らない残り(オフライン・位置・記録)。

- OFF-01 オフラインの鍵: offline_devices(端末ごとの鍵の登録・失効。鍵そのものは保存しない)
- OFF-02 オフラインの編集: sync_operations の対象に日程(day)・予定の並び(order)・予約(reservation。常にオンラインへ)を足し、
  操作に並べ替え(reorder)を足す(列の長さと検査の制約を広げる)
- LOC-02 位置のぼかし: privacy_zones(自宅・職場などの、書き出し・公開から外す範囲。中心の座標は利用者のデータ鍵で暗号化)
- MEM-01 旅行記の公開: memory_publications(公開の写し・失効)・memory_trash(記録の削除を元に戻すための一時の保管。本文は暗号化)

downgrade: 足した表を消す。sync_operations の新しい対象・操作の行は消してから制約を戻す(その記録は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd7f1b5c9e2a6'
down_revision: Union[str, Sequence[str], None] = 'c6e0a4b8d3f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    # ---- OFF-01
    op.create_table(
        'offline_devices',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('device_id', sa.String(64), nullable=False),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_key_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_reason', sa.String(20), nullable=True),
        sa.UniqueConstraint('user_id', 'device_id', name='uq_offline_devices_user_device'),
        sa.CheckConstraint("(revoked_at IS NULL) = (revoked_reason IS NULL)", name='ck_offline_devices_revoked'),
    )
    # ---- OFF-02
    op.drop_constraint('ck_sync_operations_entity_type', 'sync_operations', type_='check')
    op.drop_constraint('ck_sync_operations_action', 'sync_operations', type_='check')
    op.alter_column('sync_operations', 'entity_type', type_=sa.String(16), existing_type=sa.String(10),
                    existing_nullable=False)
    op.alter_column('sync_operations', 'action', type_=sa.String(8), existing_type=sa.String(6),
                    existing_nullable=False)
    op.create_check_constraint('ck_sync_operations_entity_type', 'sync_operations',
                               "entity_type IN ('event', 'day', 'order', 'reservation')")
    op.create_check_constraint('ck_sync_operations_action', 'sync_operations',
                               "action IN ('create', 'update', 'delete', 'reorder')")
    # ---- LOC-02
    op.create_table(
        'privacy_zones',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('label', sa.String(50), nullable=False),
        sa.Column('center_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('radius_m', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("radius_m BETWEEN 100 AND 5000", name='ck_privacy_zones_radius'),
    )
    # ---- MEM-01
    op.create_table(
        'memory_publications',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('token_prefix', sa.String(8), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('location_level', sa.String(6), nullable=False, server_default='none'),
        sa.Column('include_photos', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('photo_ids', sa.JSON(), nullable=False),
        sa.Column('acknowledged', sa.JSON(), nullable=False),
        sa.Column('view_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("location_level IN ('none', 'area')", name='ck_memory_publications_location'),
    )
    op.create_table(
        'memory_trash',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('memory_id', UUID, nullable=False, unique=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('deleted_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False,
                  index=True),
        sa.Column('author_user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('row_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('storage_key', sa.String(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_memory_trash_expires', 'memory_trash', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_memory_trash_expires', table_name='memory_trash')
    op.drop_table('memory_trash')
    op.drop_table('memory_publications')
    op.drop_table('privacy_zones')
    op.execute("DELETE FROM sync_operations WHERE entity_type <> 'event' OR action NOT IN ('create', 'update', 'delete')")
    op.drop_constraint('ck_sync_operations_action', 'sync_operations', type_='check')
    op.drop_constraint('ck_sync_operations_entity_type', 'sync_operations', type_='check')
    op.alter_column('sync_operations', 'action', type_=sa.String(6), existing_type=sa.String(8),
                    existing_nullable=False)
    op.alter_column('sync_operations', 'entity_type', type_=sa.String(10), existing_type=sa.String(16),
                    existing_nullable=False)
    op.create_check_constraint('ck_sync_operations_action', 'sync_operations', "action IN ('create','update','delete')")
    op.create_check_constraint('ck_sync_operations_entity_type', 'sync_operations', "entity_type IN ('event')")
    op.drop_table('offline_devices')
