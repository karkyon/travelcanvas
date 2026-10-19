"""gate_v2_visit_assessment

Revision ID: b3e8f1c6d2a4
Revises: a9d4e7c2f8b3
Create Date: 2026-10-19 21:30:00.000000

[Gate V2] FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・Privacy除外(DOC-15 CA-007〜009)。

- visit_assessments(新規): 旅行・予定・本人ごとの訪問の判定(状態・自動の判定・信頼度・根拠・アルゴリズムの版・出どころ・
  非表示・版)。根拠に座標を入れない。plan_id は ON DELETE CASCADE(B-012)、user_id も CASCADE。予定への外部キーは張らない。

保護エリア(自宅・職場など)は端末の中だけに置く(DOC-15 CA-009「端末側で設定」)ため DB に持たない。

downgrade: 表を消す(判定は軌跡・記録からやり直せる。本人の訂正は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b3e8f1c6d2a4'
down_revision: Union[str, Sequence[str], None] = 'a9d4e7c2f8b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
STATES = "('VERIFIED_VISIT','LIKELY_VISIT','PASS_THROUGH','PLANNED_ONLY','MANUAL','REJECTED')"


def upgrade() -> None:
    op.create_table(
        'visit_assessments',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_id', UUID, nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('state', sa.String(length=14), nullable=False),
        sa.Column('auto_state', sa.String(length=14), nullable=True),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('reasons', postgresql.JSONB(), nullable=True),
        sa.Column('algorithm_version', sa.String(length=16), nullable=False),
        sa.Column('source', sa.String(length=6), nullable=False),
        sa.Column('hidden', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('assessed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('corrected_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('plan_id', 'event_id', 'user_id', name='uq_visit_assessments_plan_event_user'),
        sa.CheckConstraint(f"state IN {STATES}", name='ck_visit_assessments_state'),
        sa.CheckConstraint(f"auto_state IS NULL OR auto_state IN {STATES}", name='ck_visit_assessments_auto_state'),
        sa.CheckConstraint("source IN ('auto','device','user')", name='ck_visit_assessments_source'),
        sa.CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
                           name='ck_visit_assessments_confidence'),
    )
    op.create_index('ix_visit_assessments_plan_user', 'visit_assessments', ['plan_id', 'user_id'])
    op.create_index('ix_visit_assessments_user', 'visit_assessments', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_visit_assessments_user', table_name='visit_assessments')
    op.drop_index('ix_visit_assessments_plan_user', table_name='visit_assessments')
    op.drop_table('visit_assessments')
