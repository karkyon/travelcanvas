"""gate_p10_alerts_replans

Revision ID: f7a3d1c8e2b5
Revises: e6c1a9d3b7f2
Create Date: 2026-10-15 16:00:00.000000

[Gate P10] FR-030 外部状況(アラート)・FR-031 安全な再計画(DOC-04 SC-24、DOC-13 AlertReceived/ReplanReady/ReplanApplied)。

新規テーブル plan_alerts・replans を2つ追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
- plan_alerts: 遅延・運休・休業・天候。情報源・取得時刻・確度を持つ。影響を受ける予定・日には外部キーを張らない
  (B-013の個別削除を妨げないため。使う時に存在を確認する)。
- replans: アラートを起点にした案A/B(JSON)。承認時に1つの変更セット(change_sets、ON DELETE SET NULL)として適用する。
- plan_id は ON DELETE CASCADE(B-012の外部キー方針)。replans.alert_id も CASCADE。

downgrade はテーブルを削除する(アラート・再計画案は失われる。適用済みの変更は本案の変更履歴に残る)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f7a3d1c8e2b5'
down_revision: Union[str, Sequence[str], None] = 'e6c1a9d3b7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'plan_alerts',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(length=12), nullable=False),
        sa.Column('source', sa.String(length=12), nullable=False),
        sa.Column('source_label', sa.String(length=100), nullable=True),
        sa.Column('confidence', sa.String(length=9), nullable=False),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('event_id', UUID, nullable=True),
        sa.Column('day_id', UUID, nullable=True),
        sa.Column('delay_minutes', sa.Integer(), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('status', sa.String(length=9), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('delay','cancellation','closure','weather')", name='ck_plan_alerts_kind'),
        sa.CheckConstraint("source IN ('user_report','route_status')", name='ck_plan_alerts_source'),
        sa.CheckConstraint("confidence IN ('confirmed','reported')", name='ck_plan_alerts_confidence'),
        sa.CheckConstraint("status IN ('active','resolved','dismissed')", name='ck_plan_alerts_status'),
        sa.CheckConstraint("(status = 'active') = (resolved_at IS NULL)", name='ck_plan_alerts_resolved_at'),
        sa.CheckConstraint(
            "delay_minutes IS NULL OR delay_minutes BETWEEN 15 AND 720", name='ck_plan_alerts_delay_minutes',
        ),
        sa.CheckConstraint(
            "(kind IN ('delay','cancellation')) = (delay_minutes IS NOT NULL)", name='ck_plan_alerts_delay_kind',
        ),
        sa.CheckConstraint("event_id IS NOT NULL OR day_id IS NOT NULL", name='ck_plan_alerts_target'),
    )
    op.create_index('ix_plan_alerts_id', 'plan_alerts', ['id'])
    op.create_index('ix_plan_alerts_plan_status', 'plan_alerts', ['plan_id', 'status'])

    op.create_table(
        'replans',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('alert_id', UUID, sa.ForeignKey('plan_alerts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('base_revision', sa.Integer(), nullable=False),
        sa.Column('base_snapshot', sa.JSON(), nullable=False),
        sa.Column('candidates', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=8), nullable=False),
        sa.Column('applied_candidate', sa.String(length=1), nullable=True),
        sa.Column('applied_change_set_id', UUID, sa.ForeignKey('change_sets.id', ondelete='SET NULL'), nullable=True),
        sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('applied_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('proposed','applied','rejected')", name='ck_replans_status'),
        sa.CheckConstraint(
            "(status = 'applied') = (applied_at IS NOT NULL AND applied_candidate IS NOT NULL)",
            name='ck_replans_applied',
        ),
        sa.CheckConstraint("applied_candidate IS NULL OR applied_candidate IN ('A','B')", name='ck_replans_candidate'),
    )
    op.create_index('ix_replans_id', 'replans', ['id'])
    op.create_index('ix_replans_plan_alert', 'replans', ['plan_id', 'alert_id'])


def downgrade() -> None:
    op.drop_index('ix_replans_plan_alert', table_name='replans')
    op.drop_index('ix_replans_id', table_name='replans')
    op.drop_table('replans')
    op.drop_index('ix_plan_alerts_plan_status', table_name='plan_alerts')
    op.drop_index('ix_plan_alerts_id', table_name='plan_alerts')
    op.drop_table('plan_alerts')
