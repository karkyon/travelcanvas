"""[Gate BookletTiers] しおりのデザインに「リゾート」を加える

Revision ID: c5f2a8d1e7b3
Revises: b3e8f1a9c4d7
Create Date: 2026-11-06
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c5f2a8d1e7b3'
down_revision: Union[str, Sequence[str], None] = 'b3e8f1a9c4d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = ("'cute','simple','family','school','business','accessible','mono',"
       "'functional','friends','wild','lovers','elegant','calm','solo','space'")
NEW = OLD + ",'resort'"


def upgrade() -> None:
    op.drop_constraint('ck_booklet_exports_theme', 'booklet_exports', type_='check')
    op.create_check_constraint('ck_booklet_exports_theme', 'booklet_exports', f"theme IN ({NEW})")


def downgrade() -> None:
    # リゾートの版は、見た目が近い「簡潔」へ戻す
    op.execute("UPDATE booklet_exports SET theme = 'simple' WHERE theme = 'resort'")
    op.drop_constraint('ck_booklet_exports_theme', 'booklet_exports', type_='check')
    op.create_check_constraint('ck_booklet_exports_theme', 'booklet_exports', f"theme IN ({OLD})")
