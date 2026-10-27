"""gate_g8_branches_ownership_corrections_jobs

Revision ID: f4d8a2c6e9b1
Revises: e8b2c6d0f4a7
Create Date: 2026-10-27 10:00:00.000000

[Gate G8] 外部の判断の要らない残り(分岐・所有者の移譲・訂正・定期の処理の記録)。

- FR-019 案の中で予約・移動区間を変える分岐: itinerary_branches.resources(変更と、その基準にした本案の区間・予約)
- FR-021・FR-039 所有者の移譲: plan_ownership_transfers(旅行ごとに手続き中は1件。部分の一意の索引)
- FR-039 出典・確認・履歴つきの訂正: data_corrections(本人の訂正・所有者への訂正の申し出。値は暗号文だけ)
- FR-004・O02 定期の処理の記録: ops_job_runs(最後の成功の時刻。件数だけ)

downgrade: 足した表・列を消す(分岐の予約・区間の変更、移譲の手続き、訂正の履歴、処理の記録は失われる。所有者の移譲の
結果(travel_plans.user_id)は残る)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'f4d8a2c6e9b1'
down_revision: Union[str, Sequence[str], None] = 'e8b2c6d0f4a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column('itinerary_branches', sa.Column('resources', sa.JSON(), nullable=True))

    op.create_table(
        'plan_ownership_transfers',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('from_user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('to_user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('status', sa.String(9), nullable=False, server_default='pending'),
        sa.Column('keep_role', sa.String(6), nullable=False, server_default='editor'),
        sa.Column('message', sa.String(500), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('pending','accepted','declined','cancelled')",
                           name='ck_plan_ownership_transfers_status'),
        sa.CheckConstraint("keep_role IN ('editor','viewer','none')", name='ck_plan_ownership_transfers_keep_role'),
        sa.CheckConstraint('from_user_id <> to_user_id', name='ck_plan_ownership_transfers_distinct'),
        sa.CheckConstraint("(status = 'pending') = (responded_at IS NULL)",
                           name='ck_plan_ownership_transfers_responded'),
    )
    op.create_index('uq_plan_ownership_transfers_pending', 'plan_ownership_transfers', ['plan_id'], unique=True,
                    postgresql_where=sa.text("status = 'pending'"))

    op.create_table(
        'data_corrections',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('kind', sa.String(7), nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('field', sa.String(40), nullable=False),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('verification', sa.String(8), nullable=False),
        sa.Column('payload_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('resolution_note_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('resolved_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
                  index=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('self','request')", name='ck_data_corrections_kind'),
        sa.CheckConstraint("source IN ('self_statement','official_document','booking_document','other')",
                           name='ck_data_corrections_source'),
        sa.CheckConstraint("verification IN ('password','session')", name='ck_data_corrections_verification'),
        sa.CheckConstraint(
            "(kind = 'self' AND status IN ('applied','reverted') AND plan_id IS NULL) OR "
            "(kind = 'request' AND status IN ('open','resolved','declined') AND plan_id IS NOT NULL)",
            name='ck_data_corrections_kind_status',
        ),
        sa.CheckConstraint("(status IN ('applied','open')) = (resolved_at IS NULL)",
                           name='ck_data_corrections_resolved'),
    )

    op.create_table(
        'ops_job_runs',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('job', sa.String(40), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ok', sa.Boolean(), nullable=True),
        sa.Column('summary', postgresql.JSONB(), nullable=True),
        sa.Column('error_code', sa.String(80), nullable=True),
    )
    op.create_index('ix_ops_job_runs_job_started', 'ops_job_runs', ['job', 'started_at'])


def downgrade() -> None:
    op.drop_index('ix_ops_job_runs_job_started', table_name='ops_job_runs')
    op.drop_table('ops_job_runs')
    op.drop_table('data_corrections')
    op.drop_index('uq_plan_ownership_transfers_pending', table_name='plan_ownership_transfers')
    op.drop_table('plan_ownership_transfers')
    op.drop_column('itinerary_branches', 'resources')
