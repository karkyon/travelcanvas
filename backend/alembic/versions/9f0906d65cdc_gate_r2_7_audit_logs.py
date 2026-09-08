"""gate_r2_7_audit_logs

Revision ID: 9f0906d65cdc
Revises: a3f8c2e91b07
Create Date: 2026-09-08 00:00:00.000000

[Gate R2-7] audit/metric基盤(監査イベントの永続化)。

docs/trace/gate-r2-trace.md のR2-5行が「未達」としていた4項目のうち、
R2-6でPlaywright browser E2E・CIへのE2E blocking追加の2件を解消済み。
本Gateは残る2件のうち「audit/metric基盤」を実装する。

追加: audit_logs テーブル(schemas.AuditLog/AuditLogResponseに対応する
永続化実体。既存スキーマは定義済みだが対応テーブルが存在しなかった)。

このmigrationは追加のみ(additive only)であり、既存テーブル・既存データへの
変更は一切含まない。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '9f0906d65cdc'
down_revision: Union[str, Sequence[str], None] = 'a3f8c2e91b07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'audit_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'user_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id'), nullable=True,
        ),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('resource_type', sa.String(), nullable=False),
        sa.Column('resource_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_audit_logs_id', 'audit_logs', ['id'])
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])
    op.create_index('ix_audit_logs_resource_type', 'audit_logs', ['resource_type'])
    op.create_index('ix_audit_logs_resource_id', 'audit_logs', ['resource_id'])
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])
    # 管理画面の代表的な絞り込み(対象種別+期間の新しい順)を高速化する複合index
    op.create_index(
        'ix_audit_logs_resource_type_created_at',
        'audit_logs', ['resource_type', 'created_at'],
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_audit_logs_resource_type_created_at', table_name='audit_logs')
    op.drop_index('ix_audit_logs_created_at', table_name='audit_logs')
    op.drop_index('ix_audit_logs_resource_id', table_name='audit_logs')
    op.drop_index('ix_audit_logs_resource_type', table_name='audit_logs')
    op.drop_index('ix_audit_logs_action', table_name='audit_logs')
    op.drop_index('ix_audit_logs_user_id', table_name='audit_logs')
    op.drop_index('ix_audit_logs_id', table_name='audit_logs')
    op.drop_table('audit_logs')
