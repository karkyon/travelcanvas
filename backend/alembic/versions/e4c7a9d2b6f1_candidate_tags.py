"""[Gate CandidateFilters] 候補箱の候補のタグ(plan_candidates.tags)

- plan_candidates: tags(JSONB の文字列の配列。最大 10 個・1 つ 20 文字。並べ替え・絞り込みに使う)
NULL を許す列の追加だけ(既存の行は変えない)。

Revision ID: e4c7a9d2b6f1
Revises: d8a4c2f6b1e9
Create Date: 2026-11-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'e4c7a9d2b6f1'
down_revision: Union[str, Sequence[str], None] = 'd8a4c2f6b1e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('plan_candidates', sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('plan_candidates', 'tags')
