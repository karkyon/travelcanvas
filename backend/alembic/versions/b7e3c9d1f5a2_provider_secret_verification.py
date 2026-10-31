"""provider_secret_verification

Revision ID: b7e3c9d1f5a2
Revises: a1d3f5b7c9e2
Create Date: 2026-11-01 06:00:00.000000

[Gate ProviderConnect] 外部 API の鍵の「候補 → 有効性の確認 → 有効化」と、確認の運用の予算。

- provider_secrets に候補(pending)の状態と、提供元の確認の結果(provider_auth・verify_code・確認の時刻・期限・
  確認した設定の hash・提供元ごとの結果)を足す。既存の行は provider_auth='unverified'(無条件に確認済みへ上げない)
- provider_secret_verifications: 確認の1回ごとの記録(見込みの額・結果)。管理の確認は旅行の 50円とは別の日の枠で数える
- 鍵の値は増やさない(暗号文は provider_secrets の既存の列だけ)。downgrade は候補の行を disabled にしてから戻す
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b7e3c9d1f5a2'
down_revision: Union[str, Sequence[str], None] = 'a1d3f5b7c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column('provider_secrets', sa.Column('provider_auth', sa.String(16), nullable=False,
                                                server_default='unverified'))
    op.add_column('provider_secrets', sa.Column('verify_code', sa.String(40), nullable=True))
    op.add_column('provider_secrets', sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('provider_secrets', sa.Column('verify_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('provider_secrets', sa.Column('verified_config', sa.String(64), nullable=True))
    op.add_column('provider_secrets', sa.Column('capabilities', postgresql.JSONB(), nullable=True))
    op.drop_constraint('ck_provider_secrets_status', 'provider_secrets', type_='check')
    op.create_check_constraint('ck_provider_secrets_status', 'provider_secrets',
                               "status IN ('active', 'pending', 'superseded', 'disabled')")
    op.create_check_constraint('ck_provider_secrets_provider_auth', 'provider_secrets',
                               "provider_auth IN ('unverified', 'accepted', 'rejected', 'inconclusive')")
    op.create_index('uq_provider_secrets_one_pending', 'provider_secrets', ['slot'], unique=True,
                    postgresql_where=sa.text("status = 'pending'"))

    op.create_table(
        'provider_secret_verifications',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('slot', sa.String(40), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(40), nullable=False),
        sa.Column('operation', sa.String(40), nullable=False),
        sa.Column('status', sa.String(12), nullable=False, server_default='reserved'),
        sa.Column('result_code', sa.String(40), nullable=True),
        sa.Column('estimated_cost_jpy', sa.Numeric(12, 4), nullable=False),
        sa.Column('ops_day', sa.String(10), nullable=False),
        sa.Column('actor_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('reserved', 'finished')", name='ck_provider_secret_verifications_status'),
    )
    op.create_index('ix_provider_secret_verifications_actor_id', 'provider_secret_verifications', ['actor_id'])
    op.create_index('ix_provider_secret_verifications_ops_day', 'provider_secret_verifications', ['ops_day'])
    op.create_index('ix_provider_secret_verifications_slot_created', 'provider_secret_verifications',
                    ['slot', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_provider_secret_verifications_slot_created', table_name='provider_secret_verifications')
    op.drop_index('ix_provider_secret_verifications_ops_day', table_name='provider_secret_verifications')
    op.drop_index('ix_provider_secret_verifications_actor_id', table_name='provider_secret_verifications')
    op.drop_table('provider_secret_verifications')
    op.drop_index('uq_provider_secrets_one_pending', table_name='provider_secrets')
    op.execute("UPDATE provider_secrets SET status = 'disabled', disabled_at = now() WHERE status = 'pending'")
    op.drop_constraint('ck_provider_secrets_provider_auth', 'provider_secrets', type_='check')
    op.drop_constraint('ck_provider_secrets_status', 'provider_secrets', type_='check')
    op.create_check_constraint('ck_provider_secrets_status', 'provider_secrets',
                               "status IN ('active', 'superseded', 'disabled')")
    for column in ('capabilities', 'verified_config', 'verify_expires_at', 'verified_at', 'verify_code',
                   'provider_auth'):
        op.drop_column('provider_secrets', column)
