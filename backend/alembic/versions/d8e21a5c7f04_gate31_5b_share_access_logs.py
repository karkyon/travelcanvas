"""gate31_5b_share_access_logs

Revision ID: d8e21a5c7f04
Revises: c4a7f0e2b913
Create Date: 2026-09-04 00:00:00.000000

[Gate #31.5B] 公開共有リンク解決への全アクセス試行を記録する
share_access_logs テーブルを新規追加する(既存テーブルへのALTER/DROPは
一切行わない、追加のみの安全なマイグレーション)。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd8e21a5c7f04'
down_revision: Union[str, Sequence[str], None] = 'c4a7f0e2b913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'share_access_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('share_id', sa.UUID(), nullable=True),
        sa.Column('token_hash', sa.String(), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('result', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['share_id'], ['plan_share_links.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_share_access_logs_id'), 'share_access_logs', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_share_access_logs_id'), table_name='share_access_logs')
    op.drop_table('share_access_logs')
