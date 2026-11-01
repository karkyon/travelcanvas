"""trip_consult_sessions

Revision ID: c3e5a7b9d1f4
Revises: b7e3c9d1f5a2
Create Date: 2026-11-01 12:00:00.000000

[Gate ConsultAI] 旅行相談で AI・場所の検索・経路を使うための「旅行を作る前の相談」。

- trip_consult_sessions: 相談(利用者・期限・下書きにした旅行)。相談の文章・AI の結果は保存しない
- usage_budget_accounts.scope_type に 'consult' を足す(1相談 = 1旅行と同じ 50円・回数の枠で予約・確定する)
- downgrade は相談の口座を消してから制約を戻す(相談の使用の記録 provider_usage_events は消さない)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c3e5a7b9d1f4'
down_revision: Union[str, Sequence[str], None] = 'b7e3c9d1f5a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'trip_consult_sessions',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_trip_consult_sessions_user_id', 'trip_consult_sessions', ['user_id'])
    op.create_index('ix_trip_consult_sessions_plan_id', 'trip_consult_sessions', ['plan_id'])
    op.drop_constraint('ck_usage_budget_accounts_scope', 'usage_budget_accounts', type_='check')
    op.create_check_constraint('ck_usage_budget_accounts_scope', 'usage_budget_accounts',
                               "scope_type IN ('plan', 'user', 'organization', 'consult')")


def downgrade() -> None:
    op.execute("UPDATE provider_usage_reservations SET plan_account_id = NULL WHERE plan_account_id IN "
               "(SELECT id FROM usage_budget_accounts WHERE scope_type = 'consult')")
    op.execute("DELETE FROM usage_budget_accounts WHERE scope_type = 'consult'")
    op.drop_constraint('ck_usage_budget_accounts_scope', 'usage_budget_accounts', type_='check')
    op.create_check_constraint('ck_usage_budget_accounts_scope', 'usage_budget_accounts',
                               "scope_type IN ('plan', 'user', 'organization')")
    op.drop_index('ix_trip_consult_sessions_plan_id', table_name='trip_consult_sessions')
    op.drop_index('ix_trip_consult_sessions_user_id', table_name='trip_consult_sessions')
    op.drop_table('trip_consult_sessions')
