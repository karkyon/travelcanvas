"""gate_p11_sync_operations

Revision ID: a8c4e2f6d9b3
Revises: f7a3d1c8e2b5
Create Date: 2026-10-15 18:00:00.000000

[Gate P11] FR-033 オフライン編集・同期(DOC-06 §13・§30、DOC-13 Operation ID / Conflict)。

新規テーブル sync_operations を1つ追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
- 端末の operation_id を利用者ごとに一意にし、再送を二重に適用しない(uq_sync_operations_user_operation)。
- 予定(entity_id)には外部キーを張らない(B-013の個別削除を妨げないため)。plan_id は ON DELETE CASCADE(B-012の外部キー方針)。

downgrade はテーブルを削除する(受領記録と未解決の競合は失われる。適用済みの変更は本案の変更履歴に残る)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a8c4e2f6d9b3'
down_revision: Union[str, Sequence[str], None] = 'f7a3d1c8e2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'sync_operations',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('operation_id', UUID, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=True),
        sa.Column('entity_type', sa.String(length=10), nullable=False),
        sa.Column('action', sa.String(length=6), nullable=False),
        sa.Column('entity_id', UUID, nullable=True),
        sa.Column('temp_id', sa.String(length=64), nullable=True),
        sa.Column('base_revision', sa.Integer(), nullable=True),
        sa.Column('fields', sa.JSON(), nullable=True),
        sa.Column('client_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=15), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=True),
        sa.Column('conflict', sa.JSON(), nullable=True),
        sa.Column('resulting_revision', sa.Integer(), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.UniqueConstraint('user_id', 'operation_id', name='uq_sync_operations_user_operation'),
        sa.CheckConstraint("entity_type IN ('event')", name='ck_sync_operations_entity_type'),
        sa.CheckConstraint("action IN ('create','update','delete')", name='ck_sync_operations_action'),
        sa.CheckConstraint(
            "status IN ('applied','conflicted','rejected','resolved_mine','resolved_server')",
            name='ck_sync_operations_status',
        ),
        sa.CheckConstraint(
            "(status IN ('resolved_mine','resolved_server')) = (resolved_at IS NOT NULL)",
            name='ck_sync_operations_resolved_at',
        ),
    )
    op.create_index('ix_sync_operations_id', 'sync_operations', ['id'])
    op.create_index('ix_sync_operations_plan_user_status', 'sync_operations', ['plan_id', 'user_id', 'status'])
    op.create_index('ix_sync_operations_plan_user_temp', 'sync_operations', ['plan_id', 'user_id', 'temp_id'])


def downgrade() -> None:
    op.drop_index('ix_sync_operations_plan_user_temp', table_name='sync_operations')
    op.drop_index('ix_sync_operations_plan_user_status', table_name='sync_operations')
    op.drop_index('ix_sync_operations_id', table_name='sync_operations')
    op.drop_table('sync_operations')
