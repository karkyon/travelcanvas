"""add_visit_detection_metadata

Revision ID: f1a3c9d7b2e4
Revises: e5b81f4a9c26
Create Date: 2026-09-06 00:00:00.000000

[Gate #37] Visited Area Layer: GPS自動判定による訪問記録に対応するため、
user_spot_visitsへ3列を追加のみ行う(既存列のALTER/DROPは一切行わない)。

- source: 'manual'(既定・既存行はこの値のまま) / 'auto_gps'
- confidence: GPS自動判定時の信頼度(0.0〜1.0)。手動記録ではNULL。
- detected_accuracy_meters: 判定時点のGPS測位精度(メートル)。手動記録ではNULL。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a3c9d7b2e4'
down_revision: Union[str, Sequence[str], None] = 'e5b81f4a9c26'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'user_spot_visits',
        sa.Column('source', sa.String(), nullable=False, server_default='manual'),
    )
    op.add_column(
        'user_spot_visits',
        sa.Column('confidence', sa.Float(), nullable=True),
    )
    op.add_column(
        'user_spot_visits',
        sa.Column('detected_accuracy_meters', sa.Float(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user_spot_visits', 'detected_accuracy_meters')
    op.drop_column('user_spot_visits', 'confidence')
    op.drop_column('user_spot_visits', 'source')
