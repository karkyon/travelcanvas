"""gate_b1_organizations_api

Revision ID: e6b4c8d2f3a5
Revises: d5a3b7c9e1f2
Create Date: 2026-10-20 14:00:00.000000

[Gate B1] FR-041 組織・B2B(最小形)/ FR-042 API・Webhook(最小形)。新しい表の追加だけ(既存の表は変えない)。

- organizations / organization_members(owner・admin・member)
- org_distributions(配布する旅程の写し。版つき)/ org_distribution_acks(閲覧確認)
- org_api_clients(client_credentials。秘密はハッシュ)/ org_api_tokens(短命トークンのハッシュ)
- org_webhooks(署名の鍵は暗号化)/ org_webhook_deliveries(送信の記録)

downgrade: 追加した表を消す(組織・配布・確認・外部連携の設定は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e6b4c8d2f3a5'
down_revision: Union[str, Sequence[str], None] = 'd5a3b7c9e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB()


def _ts(name, nullable=True, default=False):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable,
                     server_default=sa.text('now()') if default else None)


def upgrade() -> None:
    op.create_table(
        'organizations',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('brand_color', sa.String(7), nullable=True),
        sa.Column('created_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        _ts('created_at', default=True), _ts('updated_at'), _ts('deleted_at'),
    )
    op.create_index('ix_organizations_id', 'organizations', ['id'])
    op.create_table(
        'organization_members',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('organization_id', UUID, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(6), nullable=False, server_default='member'),
        _ts('created_at', default=True),
        sa.UniqueConstraint('organization_id', 'user_id', name='uq_organization_members_org_user'),
        sa.CheckConstraint("role IN ('owner','admin','member')", name='ck_organization_members_role'),
    )
    op.create_index('ix_organization_members_id', 'organization_members', ['id'])
    op.create_index('ix_organization_members_user_id', 'organization_members', ['user_id'])
    op.create_table(
        'org_distributions',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('organization_id', UUID, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='SET NULL'), nullable=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('snapshot', JSONB, nullable=False),
        sa.Column('change_note', sa.String(500), nullable=True),
        sa.Column('published_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        _ts('published_at', nullable=False), _ts('created_at', default=True), _ts('revoked_at'),
    )
    op.create_index('ix_org_distributions_id', 'org_distributions', ['id'])
    op.create_index('ix_org_distributions_organization_id', 'org_distributions', ['organization_id'])
    op.create_table(
        'org_distribution_acks',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('distribution_id', UUID, sa.ForeignKey('org_distributions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        _ts('acked_at', default=True),
        sa.UniqueConstraint('distribution_id', 'user_id', 'version', name='uq_org_distribution_acks_once'),
    )
    op.create_index('ix_org_distribution_acks_id', 'org_distribution_acks', ['id'])
    op.create_index('ix_org_distribution_acks_distribution_id', 'org_distribution_acks', ['distribution_id'])
    op.create_table(
        'org_api_clients',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('organization_id', UUID, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('client_id', sa.String(40), nullable=False),
        sa.Column('secret_hash', sa.String(64), nullable=False),
        sa.Column('scopes', JSONB, nullable=False),
        sa.Column('created_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        _ts('created_at', default=True), _ts('last_used_at'), _ts('revoked_at'),
    )
    op.create_index('ix_org_api_clients_id', 'org_api_clients', ['id'])
    op.create_index('ix_org_api_clients_organization_id', 'org_api_clients', ['organization_id'])
    op.create_index('ix_org_api_clients_client_id', 'org_api_clients', ['client_id'], unique=True)
    op.create_table(
        'org_api_tokens',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('client_id', UUID, sa.ForeignKey('org_api_clients.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('scopes', JSONB, nullable=False),
        _ts('expires_at', nullable=False), _ts('created_at', default=True),
    )
    op.create_index('ix_org_api_tokens_id', 'org_api_tokens', ['id'])
    op.create_index('ix_org_api_tokens_client_id', 'org_api_tokens', ['client_id'])
    op.create_index('ix_org_api_tokens_token_hash', 'org_api_tokens', ['token_hash'], unique=True)
    op.create_table(
        'org_webhooks',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('organization_id', UUID, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('url', sa.String(2000), nullable=False),
        sa.Column('secret_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('events', JSONB, nullable=False),
        sa.Column('created_by', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        _ts('created_at', default=True), _ts('revoked_at'),
    )
    op.create_index('ix_org_webhooks_id', 'org_webhooks', ['id'])
    op.create_index('ix_org_webhooks_organization_id', 'org_webhooks', ['organization_id'])
    op.create_table(
        'org_webhook_deliveries',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('webhook_id', UUID, sa.ForeignKey('org_webhooks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_id', UUID, nullable=False),
        sa.Column('event_type', sa.String(40), nullable=False),
        sa.Column('payload', JSONB, nullable=False),
        sa.Column('status', sa.String(9), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_status_code', sa.Integer(), nullable=True),
        sa.Column('last_error', sa.String(40), nullable=True),
        _ts('created_at', default=True), _ts('delivered_at'),
        sa.CheckConstraint("status IN ('pending','delivered','failed')", name='ck_org_webhook_deliveries_status'),
    )
    op.create_index('ix_org_webhook_deliveries_id', 'org_webhook_deliveries', ['id'])
    op.create_index('ix_org_webhook_deliveries_webhook_id', 'org_webhook_deliveries', ['webhook_id'])


def downgrade() -> None:
    for t in ('org_webhook_deliveries', 'org_webhooks', 'org_api_tokens', 'org_api_clients',
              'org_distribution_acks', 'org_distributions', 'organization_members', 'organizations'):
        op.drop_table(t)
