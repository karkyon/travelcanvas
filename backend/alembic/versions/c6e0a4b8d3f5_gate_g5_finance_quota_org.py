"""gate_g5_finance_quota_org

Revision ID: c6e0a4b8d3f5
Revises: b5d9f3a7c2e4
Create Date: 2026-10-22 20:00:00.000000

[Gate G5] 外部の判断の要らない残り(費用・使用量の上限・組織)。

- FIN-01 予算: budget_versions(当初・更新・確定・実績の版。上書きしない写し)、fx_rates(為替の記録。出典・取得時刻・基準日。
  手入力または提供元)、expenses.fx_rate_id(使ったレートの記録。過去のレートで再現する)
- FIN-02 精算: expenses.voided_at・void_reason・voided_by_user_id(取消。消さずに集計から外す)、
  plan_finance_settings.rounding_mode・remainder_to(端数の規則)・locked_at・locked_by_user_id(精算の締め。締めた後は変えない)、
  settlements.idempotency_key(同時の精算の二重の記録を防ぐ)
- BILL-02 使用量: usage_counters(利用者・組織ごと・月ごとの使用量。soft/hard の上限、管理者の上書き)
- ORG-01 組織: organizations.logo_png・logo_sha256(検査して PNG に作り直したロゴ。DB に置き、保存ファイルの鍵の点検の対象にしない)・seat_limit(席の上限)、organization_domains(独自のドメインの所有の確認)、
  organization_seat_events(席の記録)

downgrade: 足した表・列を消す(予算の版・為替の記録・使用量・ドメイン・ロゴ・取消の記録は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c6e0a4b8d3f5'
down_revision: Union[str, Sequence[str], None] = 'b5d9f3a7c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    # ---- FIN-01
    op.create_table(
        'fx_rates',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('base_currency', sa.String(3), nullable=False),
        sa.Column('rate', sa.Numeric(18, 8), nullable=False),
        sa.Column('rate_date', sa.Date(), nullable=False),
        sa.Column('source', sa.String(100), nullable=False),
        sa.Column('retrieved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("rate > 0", name='ck_fx_rates_rate'),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$' AND base_currency ~ '^[A-Z]{3}$' AND currency <> base_currency",
                           name='ck_fx_rates_currency'),
    )
    op.create_index('ix_fx_rates_lookup', 'fx_rates', ['plan_id', 'currency', 'base_currency', 'rate_date'])
    op.create_table(
        'budget_versions',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('kind', sa.String(9), nullable=False),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('base_currency', sa.String(3), nullable=False),
        sa.Column('total_amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('lines', sa.JSON(), nullable=False),
        sa.Column('unconverted', sa.JSON(), nullable=True),
        sa.Column('note', sa.String(200), nullable=True),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('initial', 'revised', 'committed', 'actual')", name='ck_budget_versions_kind'),
    )
    op.add_column('expenses', sa.Column('fx_rate_id', UUID, sa.ForeignKey('fx_rates.id', ondelete='SET NULL'),
                                        nullable=True))
    op.create_index('ix_fk_expenses_fx_rate_id', 'expenses', ['fx_rate_id'])
    # ---- FIN-02
    op.add_column('expenses', sa.Column('voided_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('expenses', sa.Column('void_reason', sa.String(200), nullable=True))
    op.add_column('expenses', sa.Column('voided_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'),
                                        nullable=True))
    op.create_index('ix_fk_expenses_voided_by_user_id', 'expenses', ['voided_by_user_id'])
    op.create_check_constraint('ck_expenses_void', 'expenses', '(voided_at IS NULL) = (void_reason IS NULL)')
    op.add_column('plan_finance_settings', sa.Column('rounding_mode', sa.String(8), nullable=False,
                                                     server_default='half_up'))
    op.add_column('plan_finance_settings', sa.Column('remainder_to', sa.String(8), nullable=False,
                                                     server_default='largest'))
    op.add_column('plan_finance_settings', sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('plan_finance_settings', sa.Column('locked_by_user_id', UUID,
                                                     sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_fk_plan_finance_settings_locked_by_user_id', 'plan_finance_settings', ['locked_by_user_id'])
    op.create_check_constraint('ck_plan_finance_settings_rounding', 'plan_finance_settings',
                               "rounding_mode IN ('half_up', 'down', 'up')")
    op.create_check_constraint('ck_plan_finance_settings_remainder', 'plan_finance_settings',
                               "remainder_to IN ('largest', 'payer', 'first')")
    op.add_column('settlements', sa.Column('idempotency_key', sa.String(100), nullable=True))
    op.create_index('uq_settlements_idempotency', 'settlements', ['plan_id', 'created_by_user_id', 'idempotency_key'],
                    unique=True, postgresql_where=sa.text('idempotency_key IS NOT NULL'))
    # ---- BILL-02
    op.create_table(
        'usage_counters',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('subject_type', sa.String(4), nullable=False),
        sa.Column('subject_id', UUID, nullable=False),
        sa.Column('metric', sa.String(24), nullable=False),
        sa.Column('period', sa.String(7), nullable=False),
        sa.Column('used', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('override_limit', sa.BigInteger(), nullable=True),
        sa.Column('override_reason', sa.String(200), nullable=True),
        sa.Column('override_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('warned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('subject_type', 'subject_id', 'metric', 'period', name='uq_usage_counters_key'),
        sa.CheckConstraint("subject_type IN ('user', 'org')", name='ck_usage_counters_subject'),
        sa.CheckConstraint("used >= 0", name='ck_usage_counters_used'),
        sa.CheckConstraint("period ~ '^[0-9]{4}-[0-9]{2}$'", name='ck_usage_counters_period'),
    )
    # ---- ORG-01
    op.add_column('organizations', sa.Column('logo_png', sa.LargeBinary(), nullable=True))
    op.add_column('organizations', sa.Column('logo_sha256', sa.String(64), nullable=True))
    op.add_column('organizations', sa.Column('logo_updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('organizations', sa.Column('seat_limit', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_organizations_seat_limit', 'organizations', 'seat_limit IS NULL OR seat_limit >= 1')
    op.create_table(
        'organization_domains',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('organization_id', UUID, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False,
                  index=True),
        sa.Column('domain', sa.String(253), nullable=False),
        sa.Column('token', sa.String(64), nullable=False),
        sa.Column('status', sa.String(8), nullable=False, server_default='pending'),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.String(100), nullable=True),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
                  index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending', 'verified', 'failed', 'revoked')",
                           name='ck_organization_domains_status'),
        sa.UniqueConstraint('organization_id', 'domain', name='uq_organization_domains_org_domain'),
    )
    # 確認済みのドメインは1つの組織だけ(乗っ取りの防止)
    op.create_index('uq_organization_domains_verified', 'organization_domains', ['domain'], unique=True,
                    postgresql_where=sa.text("status = 'verified'"))
    op.create_table(
        'organization_seat_events',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('organization_id', UUID, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False,
                  index=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('event', sa.String(8), nullable=False),
        sa.Column('seats_after', sa.Integer(), nullable=False),
        sa.Column('actor_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("event IN ('join', 'leave', 'limit')", name='ck_organization_seat_events_event'),
    )


def downgrade() -> None:
    op.drop_table('organization_seat_events')
    op.drop_index('uq_organization_domains_verified', table_name='organization_domains')
    op.drop_table('organization_domains')
    op.drop_constraint('ck_organizations_seat_limit', 'organizations', type_='check')
    for col in ('seat_limit', 'logo_updated_at', 'logo_sha256', 'logo_png'):
        op.drop_column('organizations', col)
    op.drop_table('usage_counters')
    op.drop_index('uq_settlements_idempotency', table_name='settlements')
    op.drop_column('settlements', 'idempotency_key')
    op.drop_constraint('ck_plan_finance_settings_remainder', 'plan_finance_settings', type_='check')
    op.drop_constraint('ck_plan_finance_settings_rounding', 'plan_finance_settings', type_='check')
    op.drop_index('ix_fk_plan_finance_settings_locked_by_user_id', table_name='plan_finance_settings')
    for col in ('locked_by_user_id', 'locked_at', 'remainder_to', 'rounding_mode'):
        op.drop_column('plan_finance_settings', col)
    op.drop_constraint('ck_expenses_void', 'expenses', type_='check')
    op.drop_index('ix_fk_expenses_voided_by_user_id', table_name='expenses')
    for col in ('voided_by_user_id', 'void_reason', 'voided_at'):
        op.drop_column('expenses', col)
    op.drop_index('ix_fk_expenses_fx_rate_id', table_name='expenses')
    op.drop_column('expenses', 'fx_rate_id')
    op.drop_table('budget_versions')
    op.drop_index('ix_fx_rates_lookup', table_name='fx_rates')
    op.drop_table('fx_rates')
