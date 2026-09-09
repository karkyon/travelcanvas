"""gate_r3_3_event_reservations

Revision ID: a7c3e561f890
Revises: d2f6b385c917
Create Date: 2026-09-09 03:00:00.000000

[Gate R3-3] FR-010予約管理: event_reservations中間表(複数イベント紐付け)。

DOC-05 §6.2のevent_reservations(event_id、reservation_id、
relation_type(primary/required/related)、is_locked)を追加する。

追加のみ(additive only)。既存の`reservations.event_id`列は削除・変更
しない(後方互換。理由はapp/models/models.pyのEventReservationクラス
直上コメント参照)。

データバックフィル: 既存のreservations.event_id(NOT NULL)を持つ行に
ついて、relation_type='primary'のevent_reservationsリンクを1件ずつ
作成する(Gate R3-0/R3-1時点で作成された予約とfrontendの単一イベント
表示との後方互換を保つため)。
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a7c3e561f890'
down_revision: Union[str, Sequence[str], None] = 'd2f6b385c917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'event_reservations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'event_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_events.id'), nullable=False,
        ),
        sa.Column(
            'reservation_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('reservations.id'), nullable=False,
        ),
        sa.Column('relation_type', sa.String(), nullable=False, server_default='primary'),
        sa.Column('is_locked', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('event_id', 'reservation_id', name='uq_event_reservations_event_reservation'),
    )
    op.create_index('ix_event_reservations_id', 'event_reservations', ['id'])
    op.create_index('ix_event_reservations_event_id', 'event_reservations', ['event_id'])
    op.create_index('ix_event_reservations_reservation_id', 'event_reservations', ['reservation_id'])

    # [データバックフィル] 既存reservations.event_idからprimaryリンクを生成する。
    # reservations.event_idはnullable(§Reservationモデル)であり、NULLの行は
    # 対象外とする。deleted_atが設定済み(soft delete済み)の予約も、リンクの
    # 整合性を保つため対象に含める(リンク自体はsoft delete概念を持たないため、
    # 予約が削除されていてもリンク行の存在自体は害がない。取得系APIは常に
    # reservations.deleted_at IS NULLで絞り込むため実害はない)。
    #
    # 既存Gate(#29等)の慣習に合わせ、gen_random_uuid()等のDB拡張機能に
    # 依存せずPython側(uuid.uuid4())でIDを採番し、SQLAlchemy Core経由で
    # バルクinsertする。
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, event_id FROM reservations WHERE event_id IS NOT NULL")
    ).fetchall()

    if rows:
        event_reservations_table = sa.table(
            "event_reservations",
            sa.column("id", postgresql.UUID(as_uuid=True)),
            sa.column("event_id", postgresql.UUID(as_uuid=True)),
            sa.column("reservation_id", postgresql.UUID(as_uuid=True)),
            sa.column("relation_type", sa.String()),
            sa.column("is_locked", sa.Boolean()),
        )
        bind.execute(
            event_reservations_table.insert(),
            [
                {
                    "id": uuid.uuid4(),
                    "event_id": row.event_id,
                    "reservation_id": row.id,
                    "relation_type": "primary",
                    "is_locked": False,
                }
                for row in rows
            ],
        )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_event_reservations_reservation_id', table_name='event_reservations')
    op.drop_index('ix_event_reservations_event_id', table_name='event_reservations')
    op.drop_index('ix_event_reservations_id', table_name='event_reservations')
    op.drop_table('event_reservations')
