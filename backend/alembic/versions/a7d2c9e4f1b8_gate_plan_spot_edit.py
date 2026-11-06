"""[Gate PlanSpotEdit] 予定(スポット)の電話番号

予定の場所の電話番号を持つ(住所と同じく、予定ごとの値)。場所の情報の取得(OpenStreetMap)や手入力で入れる。
NULL を許す列の追加だけ(既存の行は変えない)。

Revision ID: a7d2c9e4f1b8
Revises: e6b3d9a1c7f2
Create Date: 2026-11-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7d2c9e4f1b8'
down_revision: Union[str, Sequence[str], None] = 'e6b3d9a1c7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_events', sa.Column('phone', sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column('travel_events', 'phone')
