"""[Gate SpotInfo] 行きたい場所の電話・URL・写真・食事の情報、予定の食事の情報

- spots: phone(40 文字)・urls(JSONB [{url,label}] 最大 5)・photo(JSONB 写真の出典 {provider, provider_id, title, author,
  license, license_url, source_page_url})・dining(JSONB 食事の情報)
- travel_events: dining(JSONB)
NULL を許す列の追加だけ(既存の行は変えない)。

Revision ID: d8a4c2f6b1e9
Revises: c5f2a8d1e7b3
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd8a4c2f6b1e9'
down_revision: Union[str, Sequence[str], None] = 'c5f2a8d1e7b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('spots', sa.Column('phone', sa.String(length=40), nullable=True))
    op.add_column('spots', sa.Column('urls', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('spots', sa.Column('photo', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('spots', sa.Column('dining', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('travel_events', sa.Column('dining', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('travel_events', 'dining')
    op.drop_column('spots', 'dining')
    op.drop_column('spots', 'photo')
    op.drop_column('spots', 'urls')
    op.drop_column('spots', 'phone')
