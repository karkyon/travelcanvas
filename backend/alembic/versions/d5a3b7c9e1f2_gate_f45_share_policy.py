"""gate_f45_share_policy

Revision ID: d5a3b7c9e1f2
Revises: c4f2a8e1d9b6
Create Date: 2026-10-20 12:00:00.000000

[Gate F45] FR-045(CA-003)項目単位の共有の規則。

- plan_share_links.policy(JSONB, NULL 可): 共有リンクで見せる項目({"version":1,"fields":[...],"preset":...})。
  既存の行は NULL のまま(= 本Gate以前と同じ標準の項目。app/services/share_policy.py fields_of)。

downgrade: 列を消す(各リンクで選んだ項目は失われ、全リンクが本Gate以前の表示に戻る)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd5a3b7c9e1f2'
down_revision: Union[str, Sequence[str], None] = 'c4f2a8e1d9b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('plan_share_links', sa.Column('policy', postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('plan_share_links', 'policy')
