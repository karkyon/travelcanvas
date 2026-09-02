"""add_user_spot_visits

Revision ID: 8066c01fd64b
Revises: 86408a6a940f
Create Date: 2026-09-02 00:00:00.000000

[Gate #19] user_spot_favoritesと対になる新規テーブルの追加のみ。
既存テーブルへのALTER/DROPは一切行わない(追加のみの安全なマイグレーション)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8066c01fd64b'
down_revision: Union[str, Sequence[str], None] = '86408a6a940f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('user_spot_visits',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('spot_id', sa.UUID(), nullable=False),
    sa.Column('visit_note', sa.Text(), nullable=True),
    sa.Column('visited_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['spot_id'], ['spots.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_spot_visits_id'), 'user_spot_visits', ['id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_user_spot_visits_id'), table_name='user_spot_visits')
    op.drop_table('user_spot_visits')
