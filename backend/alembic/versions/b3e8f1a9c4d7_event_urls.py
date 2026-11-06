"""[Gate SpotLinks] 予定(スポット)の URL(最大 5 件)

予定の場所の公式サイト・予約のページ・SNS などの URL を持つ(JSONB の配列 [{"url", "label"}])。
NULL を許す列の追加だけ(既存の行は変えない)。

Revision ID: b3e8f1a9c4d7
Revises: a7d2c9e4f1b8
Create Date: 2026-11-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b3e8f1a9c4d7'
down_revision: Union[str, Sequence[str], None] = 'a7d2c9e4f1b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_events', sa.Column('urls', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('travel_events', 'urls')
