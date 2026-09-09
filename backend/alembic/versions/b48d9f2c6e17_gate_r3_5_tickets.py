"""gate_r3_5_tickets

Revision ID: b48d9f2c6e17
Revises: a7c3e561f890
Create Date: 2026-09-09 05:00:00.000000

[Gate R3-5] FR-012 QR・チケット: ticketsテーブル新規追加。

DOC-05 §6.4の tickets(id、reservation_id、ticket_type、holder_member_id、
payload_ciphertext、barcode_format、display_document_id、valid_from/to、
status、offline_allowed、share_policy、key_version)を追加する。

display_document_idはdocumentsテーブル未実装のためFK制約無し(スコープ
限定の理由はapp/models/models.pyのTicketクラス直上コメント参照)。

追加のみ(additive only)。既存テーブル・既存データへの変更は一切含まない。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b48d9f2c6e17'
down_revision: Union[str, Sequence[str], None] = 'a7c3e561f890'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'tickets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'reservation_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('reservations.id'), nullable=False,
        ),
        sa.Column('ticket_type', sa.String(), nullable=False),
        sa.Column(
            'holder_member_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('plan_collaborators.id'), nullable=True,
        ),
        sa.Column('payload_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('barcode_format', sa.String(), nullable=True),
        # [スコープ限定] documentsテーブル未実装のためFK制約無し(単なるUUID列)。
        sa.Column('display_document_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('valid_from', sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('offline_allowed', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('share_policy', sa.String(), nullable=False, server_default='owner_editor'),
        sa.Column('key_version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        # [DOC-05 §8 制約] valid_from < valid_to (両方設定されている場合のみ)。
        sa.CheckConstraint(
            'valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to',
            name='ck_tickets_valid_from_before_valid_to',
        ),
    )
    op.create_index('ix_tickets_id', 'tickets', ['id'])
    op.create_index('ix_tickets_reservation_id', 'tickets', ['reservation_id'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_tickets_reservation_id', table_name='tickets')
    op.drop_index('ix_tickets_id', table_name='tickets')
    op.drop_table('tickets')
