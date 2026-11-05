"""[Gate BookletPatterns] しおりのデザインを 12 パターンへ増やす

Revision ID: e6b3d9a1c7f2
Revises: c4e8a2f6d1b3
Create Date: 2026-11-05
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e6b3d9a1c7f2'
down_revision: Union[str, Sequence[str], None] = 'c4e8a2f6d1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "'cute','simple','family','school','business','accessible','mono'"
NEW = OLD + ",'functional','friends','wild','lovers','elegant','calm','solo','space'"


def upgrade() -> None:
    op.drop_constraint('ck_booklet_exports_theme', 'booklet_exports', type_='check')
    op.create_check_constraint('ck_booklet_exports_theme', 'booklet_exports', f"theme IN ({NEW})")


def downgrade() -> None:
    # 新しいデザインの版は、見た目が近い以前のデザインへ戻す
    op.execute("UPDATE booklet_exports SET theme = 'simple' "
               "WHERE theme IN ('functional','friends','wild','lovers','elegant','calm','solo','space')")
    op.drop_constraint('ck_booklet_exports_theme', 'booklet_exports', type_='check')
    op.create_check_constraint('ck_booklet_exports_theme', 'booklet_exports', f"theme IN ({OLD})")
