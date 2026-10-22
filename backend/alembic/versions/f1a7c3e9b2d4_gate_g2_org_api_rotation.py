"""gate_g2_org_api_rotation

Revision ID: f1a7c3e9b2d4
Revises: e6b4c8d2f3a5
Create Date: 2026-10-21 14:00:00.000000

[Gate G2] FR-042 外部 API の書き込み・鍵の切り替え・Webhook の自動の再送と dead-letter。

- org_api_clients: 前の秘密(previous_secret_hash)と、その期限(previous_secret_expires_at)。切り替えの猶予の間は
  前の秘密でもトークンを取れる。秘密の版(secret_version)
- org_webhooks: 前の署名の鍵(暗号化)とその期限。猶予の間は新旧の両方で署名する。止めた理由(disabled_reason)
- org_webhook_deliveries: 次に送る時刻(next_attempt_at)。状態に dead(送り直しの上限に達した。手で送り直せる)を足す
- org_api_idempotency(新しい表): 外部 API の書き込みの Idempotency-Key(クライアントごと)

downgrade: 足した列・表を消す(dead の送信は failed に戻す)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f1a7c3e9b2d4'
down_revision: Union[str, Sequence[str], None] = 'e6b4c8d2f3a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB()


def upgrade() -> None:
    op.add_column('org_api_clients', sa.Column('previous_secret_hash', sa.String(64), nullable=True))
    op.add_column('org_api_clients', sa.Column('previous_secret_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('org_api_clients', sa.Column('secret_version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('org_api_clients', sa.Column('secret_rotated_at', sa.DateTime(timezone=True), nullable=True))

    op.add_column('org_webhooks', sa.Column('previous_secret_ciphertext', sa.LargeBinary(), nullable=True))
    op.add_column('org_webhooks', sa.Column('previous_secret_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('org_webhooks', sa.Column('secret_version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('org_webhooks', sa.Column('disabled_reason', sa.String(40), nullable=True))

    op.add_column('org_webhook_deliveries', sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint('ck_org_webhook_deliveries_status', 'org_webhook_deliveries', type_='check')
    op.create_check_constraint('ck_org_webhook_deliveries_status', 'org_webhook_deliveries',
                               "status IN ('pending','delivered','failed','dead')")
    op.create_index('ix_org_webhook_deliveries_due', 'org_webhook_deliveries', ['status', 'next_attempt_at'])

    op.create_table(
        'org_api_idempotency',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('client_id', UUID, sa.ForeignKey('org_api_clients.id', ondelete='CASCADE'), nullable=False),
        sa.Column('key', sa.String(100), nullable=False),
        sa.Column('route', sa.String(120), nullable=False),
        sa.Column('payload_hash', sa.String(64), nullable=False),
        sa.Column('response_status', sa.Integer(), nullable=False),
        sa.Column('response_json', JSONB, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('client_id', 'key', name='uq_org_api_idempotency_client_key'),
    )
    op.create_index('ix_org_api_idempotency_id', 'org_api_idempotency', ['id'])
    op.create_index('ix_org_api_idempotency_expires_at', 'org_api_idempotency', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_org_api_idempotency_expires_at', table_name='org_api_idempotency')
    op.drop_index('ix_org_api_idempotency_id', table_name='org_api_idempotency')
    op.drop_table('org_api_idempotency')
    op.drop_index('ix_org_webhook_deliveries_due', table_name='org_webhook_deliveries')
    op.execute("UPDATE org_webhook_deliveries SET status = 'failed' WHERE status = 'dead'")
    op.drop_constraint('ck_org_webhook_deliveries_status', 'org_webhook_deliveries', type_='check')
    op.create_check_constraint('ck_org_webhook_deliveries_status', 'org_webhook_deliveries',
                               "status IN ('pending','delivered','failed')")
    op.drop_column('org_webhook_deliveries', 'next_attempt_at')
    for col in ('disabled_reason', 'secret_version', 'previous_secret_expires_at', 'previous_secret_ciphertext'):
        op.drop_column('org_webhooks', col)
    for col in ('secret_rotated_at', 'secret_version', 'previous_secret_expires_at', 'previous_secret_hash'):
        op.drop_column('org_api_clients', col)
