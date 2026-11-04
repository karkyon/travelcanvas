"""[Gate BookletWeb] しおりの版を Web のページとして公開する(公開の鍵・公開した日時)

Revision ID: b7d2f4a6c8e1
Revises: e9c1a5d3f7b2
Create Date: 2026-11-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b7d2f4a6c8e1'
down_revision: Union[str, Sequence[str], None] = 'e9c1a5d3f7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('booklet_exports', sa.Column('public_token_hash', sa.String(length=64), nullable=True))
    op.add_column('booklet_exports', sa.Column('published_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_booklet_exports_public_token_hash', 'booklet_exports', ['public_token_hash'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_booklet_exports_public_token_hash', table_name='booklet_exports')
    op.drop_column('booklet_exports', 'published_at')
    op.drop_column('booklet_exports', 'public_token_hash')
