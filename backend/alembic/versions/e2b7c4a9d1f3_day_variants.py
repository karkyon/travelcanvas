"""[Gate PlanB-P2] 日ごとの案(プランB): 同じ日付の日の行を案として持つ・切り替えの記録

Revision ID: e2b7c4a9d1f3
Revises: d6e1a9f3b7c2
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'e2b7c4a9d1f3'
down_revision: Union[str, Sequence[str], None] = 'd6e1a9f3b7c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('travel_days', sa.Column('variant_status', sa.String(8), nullable=False, server_default='active'))
    op.add_column('travel_days', sa.Column('variant_label', sa.String(1), nullable=False, server_default='A'))
    op.add_column('travel_days', sa.Column('variant_name', sa.String(40), nullable=True))
    op.add_column('travel_days', sa.Column('variant_reason', sa.String(12), nullable=True))
    op.add_column('travel_days', sa.Column('variant_conditions', postgresql.JSONB(), nullable=True))
    op.add_column('travel_days', sa.Column('variant_group_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('travel_days', sa.Column('copied_from_day_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_travel_days_copied_from', 'travel_days', 'travel_days', ['copied_from_day_id'], ['id'],
                          ondelete='SET NULL')
    op.create_index('ix_travel_days_copied_from_day_id', 'travel_days', ['copied_from_day_id'])
    op.create_check_constraint('ck_travel_days_variant_status', 'travel_days',
                               "variant_status IN ('active','standby','archived')")
    op.create_check_constraint('ck_travel_days_variant_label', 'travel_days', "variant_label IN ('A','B','C','D','E')")
    op.create_check_constraint(
        'ck_travel_days_variant_reason', 'travel_days',
        "variant_reason IS NULL OR variant_reason IN "
        "('rain','party','transport','delay','fatigue','budget','closure','other')")
    op.drop_constraint('uq_travel_days_plan_date', 'travel_days', type_='unique')
    op.create_index('uq_travel_days_plan_date_active', 'travel_days', ['plan_id', 'local_date'], unique=True,
                    postgresql_where=sa.text("variant_status = 'active'"))
    op.create_index('uq_travel_days_plan_date_label', 'travel_days', ['plan_id', 'local_date', 'variant_label'],
                    unique=True)
    op.add_column('travel_events', sa.Column('variant_standby', sa.Boolean(), nullable=False, server_default='false'))
    op.create_index('ix_travel_events_variant_standby', 'travel_events', ['plan_id', 'variant_standby'])
    op.add_column('travel_segments', sa.Column('variant_standby', sa.Boolean(), nullable=False, server_default='false'))
    op.create_table(
        'day_variant_switches',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_plans.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('local_date', sa.Date(), nullable=False),
        sa.Column('from_day_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('to_day_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('from_label', sa.String(1), nullable=True),
        sa.Column('to_label', sa.String(1), nullable=True),
        sa.Column('from_name', sa.String(40), nullable=True),
        sa.Column('to_name', sa.String(40), nullable=True),
        sa.Column('switched_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('switched_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('reason', sa.String(12), nullable=True),
        sa.Column('note', sa.String(200), nullable=True),
        sa.Column('phase', sa.String(8), nullable=False, server_default='planning'),
        sa.Column('join_event_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('done_event_ids', postgresql.JSONB(), nullable=True),
        sa.Column('place_label', sa.String(80), nullable=True),
        sa.Column('change_set_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('change_sets.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('undone_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("phase IN ('planning','during','after')", name='ck_day_variant_switches_phase'),
    )
    op.create_index('ix_day_variant_switches_plan', 'day_variant_switches', ['plan_id', 'switched_at'])
    op.create_index('ix_day_variant_switches_user', 'day_variant_switches', ['switched_by_user_id'])
    op.create_index('ix_day_variant_switches_change_set', 'day_variant_switches', ['change_set_id'])


def downgrade() -> None:
    op.drop_index('ix_day_variant_switches_change_set', table_name='day_variant_switches')
    op.drop_index('ix_day_variant_switches_user', table_name='day_variant_switches')
    op.drop_index('ix_day_variant_switches_plan', table_name='day_variant_switches')
    op.drop_table('day_variant_switches')
    # 控え・しまった案(日の行)を消してから一意の制約を戻す(予定は日の行と一緒に消える)
    op.execute("DELETE FROM travel_days WHERE variant_status <> 'active'")
    op.drop_column('travel_segments', 'variant_standby')
    op.drop_index('ix_travel_events_variant_standby', table_name='travel_events')
    op.drop_column('travel_events', 'variant_standby')
    op.drop_index('uq_travel_days_plan_date_label', table_name='travel_days')
    op.drop_index('uq_travel_days_plan_date_active', table_name='travel_days')
    op.create_unique_constraint('uq_travel_days_plan_date', 'travel_days', ['plan_id', 'local_date'])
    op.drop_constraint('ck_travel_days_variant_reason', 'travel_days', type_='check')
    op.drop_constraint('ck_travel_days_variant_label', 'travel_days', type_='check')
    op.drop_constraint('ck_travel_days_variant_status', 'travel_days', type_='check')
    op.drop_index('ix_travel_days_copied_from_day_id', table_name='travel_days')
    op.drop_constraint('fk_travel_days_copied_from', 'travel_days', type_='foreignkey')
    for c in ('copied_from_day_id', 'variant_group_id', 'variant_conditions', 'variant_reason', 'variant_name',
              'variant_label', 'variant_status'):
        op.drop_column('travel_days', c)
