"""gate_c2_candidates_places

Revision ID: c4f2a8e1d9b6
Revises: b3e8f1c6d2a4
Create Date: 2026-10-20 10:00:00.000000

[Gate C2] FR-007 候補箱・FR-008 場所の一元管理(DOC-02、DOC-04 SC-08/09)。

- plan_candidates(新規): 旅行ごとの候補(出典・登録した人・優先度・状態・予定への配置・統合先)。plan_id は CASCADE(B-012)。
- places(列の追加): 別名・電話・Web・入口・階・予約の要否・価格帯・アクセシビリティ・休業日・メモ・版。いずれも NULL 可
  (既存の行はそのまま)。revision は既存の行を 1 にする。

downgrade: 追加した列・表を消す(候補箱の内容と、場所の追加の項目は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c4f2a8e1d9b6'
down_revision: Union[str, Sequence[str], None] = 'b3e8f1c6d2a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
PLACE_COLUMNS = [
    ('aliases', postgresql.JSONB()), ('phone', sa.String(40)), ('website', sa.String(2000)),
    ('entrance_note', sa.String(500)), ('floor', sa.String(40)), ('reservation_required', sa.Boolean()),
    ('price_range', sa.String(40)), ('accessibility_note', sa.String(1000)), ('closed_days', sa.String(200)),
    ('note', sa.String(2000)),
]


def upgrade() -> None:
    for name, type_ in PLACE_COLUMNS:
        op.add_column('places', sa.Column(name, type_, nullable=True))
    op.add_column('places', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))
    op.create_table(
        'plan_candidates',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('note', sa.String(2000), nullable=True),
        sa.Column('source_kind', sa.String(8), nullable=False),
        sa.Column('source_url', sa.String(2000), nullable=True),
        sa.Column('provider', sa.String(40), nullable=True),
        sa.Column('external_id', sa.String(200), nullable=True),
        sa.Column('retrieved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('place_id', UUID, sa.ForeignKey('places.id', ondelete='SET NULL'), nullable=True),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('address', sa.String(500), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='2'),
        sa.Column('status', sa.String(9), nullable=False, server_default='open'),
        sa.Column('scheduled_event_id', UUID, nullable=True),
        sa.Column('merged_into_id', UUID, nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source_kind IN ('url','text','manual','search')", name='ck_plan_candidates_source_kind'),
        sa.CheckConstraint("status IN ('open','scheduled','dismissed')", name='ck_plan_candidates_status'),
        sa.CheckConstraint('priority BETWEEN 1 AND 3', name='ck_plan_candidates_priority'),
        sa.CheckConstraint('(latitude IS NULL) = (longitude IS NULL)', name='ck_plan_candidates_location_pair'),
        sa.CheckConstraint("(status = 'scheduled') = (scheduled_event_id IS NOT NULL)",
                           name='ck_plan_candidates_scheduled'),
    )
    op.create_index('ix_plan_candidates_plan', 'plan_candidates', ['plan_id', 'status'])


def downgrade() -> None:
    op.drop_index('ix_plan_candidates_plan', table_name='plan_candidates')
    op.drop_table('plan_candidates')
    op.drop_column('places', 'revision')
    for name, _type in reversed(PLACE_COLUMNS):
        op.drop_column('places', name)
