"""gate_r3_1_reservation_participants

Revision ID: d2f6b385c917
Revises: c1e9a274b56d
Create Date: 2026-09-09 01:00:00.000000

[Gate R3-1] FR-010予約管理: 予約参加者(reservation_participants)。

DOC-05 §6.3の`reservation_participants`(reservation_id、plan_member_id、
name_ciphertext、seat_ciphertext、special_request_ciphertext)のうち、
name/seat/special_requestは平文カラムとする(理由はapp/models/models.pyの
ReservationParticipantクラス直上コメント参照)。

追加のみ(additive only)。既存テーブル・既存データへの変更は一切含まない。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd2f6b385c917'
down_revision: Union[str, Sequence[str], None] = 'c1e9a274b56d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'reservation_participants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'reservation_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('reservations.id'), nullable=False,
        ),
        sa.Column(
            'plan_member_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('plan_collaborators.id'), nullable=True,
        ),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('seat', sa.String(), nullable=True),
        sa.Column('special_request', sa.Text(), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_reservation_participants_id', 'reservation_participants', ['id'])
    op.create_index(
        'ix_reservation_participants_reservation_id',
        'reservation_participants', ['reservation_id'],
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_reservation_participants_reservation_id', table_name='reservation_participants')
    op.drop_index('ix_reservation_participants_id', table_name='reservation_participants')
    op.drop_table('reservation_participants')
