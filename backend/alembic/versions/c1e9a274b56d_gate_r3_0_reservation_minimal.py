"""gate_r3_0_reservation_minimal

Revision ID: c1e9a274b56d
Revises: 9f0906d65cdc
Create Date: 2026-09-09 00:00:00.000000

[Gate R3-0] FR-010予約管理の最小実装(DB)。

独立clone(HEAD 793c8eb)でgrep確認した結果、Reservation実体は
backend/app/schemas/schemas.pyのbooking_url断片(EventCreate/EventUpdate上の
任意フィールド)のみで、専用テーブル・API・書き込み経路は一切存在しなかった。

本migrationはDOC-05 §6.1 reservationsのフル仕様のうち、最小スコープへ
限定した部分集合を追加する(スコープ限定の理由はapp/models/models.pyの
Reservationクラス直上コメントおよびdocs/adr/ADR-reservation-minimal.md参照)。

追加のみ(additive only)。既存テーブル・既存データへの変更は一切含まない。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1e9a274b56d'
down_revision: Union[str, Sequence[str], None] = '9f0906d65cdc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'reservations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id'), nullable=False,
        ),
        sa.Column(
            'event_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_events.id'), nullable=True,
        ),
        sa.Column(
            'place_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('places.id'), nullable=True,
        ),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='confirmed'),
        sa.Column('provider_name', sa.String(), nullable=True),
        sa.Column('confirmation_number_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('confirmation_number_masked', sa.String(), nullable=True),
        sa.Column('pin_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('holder_name', sa.String(), nullable=True),
        sa.Column('guest_count', sa.Integer(), nullable=True),
        sa.Column('start_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('end_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('timezone_id', sa.String(), nullable=True),
        sa.Column('total_amount', sa.Float(), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=True),
        sa.Column('payment_status', sa.String(), nullable=True),
        sa.Column('cancellation_deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('contact_phone', sa.String(), nullable=True),
        sa.Column('contact_url', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_reservations_id', 'reservations', ['id'])
    op.create_index('ix_reservations_plan_id', 'reservations', ['plan_id'])
    op.create_index('ix_reservations_event_id', 'reservations', ['event_id'])
    op.create_index('ix_reservations_plan_start', 'reservations', ['plan_id', 'start_at'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_reservations_plan_start', table_name='reservations')
    op.drop_index('ix_reservations_event_id', table_name='reservations')
    op.drop_index('ix_reservations_plan_id', table_name='reservations')
    op.drop_index('ix_reservations_id', table_name='reservations')
    op.drop_table('reservations')
