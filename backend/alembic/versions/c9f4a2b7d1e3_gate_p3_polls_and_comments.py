"""gate_p3_polls_and_comments

Revision ID: c9f4a2b7d1e3
Revises: b8e3f1a6c2d9
Create Date: 2026-10-02 22:00:00.000000

[Gate P3] FR-022 合意形成 / FR-024 コメント(DOC-05 §8.4 votes / concerns / comments)。

新規テーブル4つ(polls / poll_options / votes / comments)を追加するだけの完全にadditiveな変更で、
既存テーブル・既存データには一切触れない(backfill不要)。

- votes は選択肢ごとに1人1票(UNIQUE)。懸念・不可は理由必須(CHECK)、解決の記録は懸念・不可だけが持てる。
- polls.veto_policy で「不可」の扱いを旅行ごとに決める(block / block_with_alternative / advisory)。
- comments は対象(plan/event/reservation/poll/expense)と返信(parent_id)を持つ。対象は外部キーにしない
  (B-013の個別削除を妨げないため)。返信の親は同じ表への外部キー(ON DELETE CASCADE)。
- plan_id は全て ON DELETE CASCADE(B-012の外部キー方針の試験が検査する)。

downgrade はテーブルを削除する(投票・コメントのデータは失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c9f4a2b7d1e3'
down_revision: Union[str, Sequence[str], None] = 'b8e3f1a6c2d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'polls',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.String(length=1000), nullable=True),
        sa.Column('deadline_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=6), nullable=False),
        sa.Column('veto_policy', sa.String(length=24), nullable=False),
        sa.Column('is_anonymous', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('decided_option_id', UUID, nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('open','closed')", name='ck_polls_status'),
        sa.CheckConstraint("(status = 'closed') = (closed_at IS NOT NULL)", name='ck_polls_closed_at'),
        sa.CheckConstraint("veto_policy IN ('block','block_with_alternative','advisory')", name='ck_polls_veto_policy'),
    )
    op.create_index('ix_polls_id', 'polls', ['id'])
    op.create_index('ix_polls_plan_deleted', 'polls', ['plan_id', 'deleted_at'])

    op.create_table(
        'poll_options',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('poll_id', UUID, sa.ForeignKey('polls.id', ondelete='CASCADE'), nullable=False),
        sa.Column('label', sa.String(length=200), nullable=False),
        sa.Column('event_id', UUID, nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    )
    op.create_index('ix_poll_options_id', 'poll_options', ['id'])
    op.create_index('ix_poll_options_poll', 'poll_options', ['poll_id', 'sort_order'])

    op.create_table(
        'votes',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('poll_id', UUID, sa.ForeignKey('polls.id', ondelete='CASCADE'), nullable=False),
        sa.Column('option_id', UUID, sa.ForeignKey('poll_options.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('value', sa.String(length=8), nullable=False),
        sa.Column('reason', sa.String(length=500), nullable=True),
        sa.Column('alternative', sa.String(length=200), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolution_note', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('option_id', 'user_id', name='uq_votes_option_user'),
        sa.CheckConstraint("value IN ('love','ok','concern','veto','abstain')", name='ck_votes_value'),
        sa.CheckConstraint("value NOT IN ('concern','veto') OR reason IS NOT NULL", name='ck_votes_reason_required'),
        sa.CheckConstraint("resolved_at IS NULL OR value IN ('concern','veto')", name='ck_votes_resolution_kind'),
    )
    op.create_index('ix_votes_id', 'votes', ['id'])
    op.create_index('ix_votes_poll', 'votes', ['poll_id'])

    op.create_table(
        'comments',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('author_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('target_type', sa.String(length=12), nullable=False),
        sa.Column('target_id', UUID, nullable=True),
        sa.Column('parent_id', UUID, sa.ForeignKey('comments.id', ondelete='CASCADE'), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('mentions', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=8), nullable=False),
        sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "target_type IN ('plan','event','reservation','poll','expense')", name='ck_comments_target_type',
        ),
        sa.CheckConstraint("(target_type = 'plan') = (target_id IS NULL)", name='ck_comments_target_id'),
        sa.CheckConstraint("status IN ('open','resolved')", name='ck_comments_status'),
        sa.CheckConstraint('char_length(body) BETWEEN 1 AND 2000', name='ck_comments_body_length'),
    )
    op.create_index('ix_comments_id', 'comments', ['id'])
    op.create_index('ix_comments_plan_target', 'comments', ['plan_id', 'target_type', 'target_id'])


def downgrade() -> None:
    op.drop_index('ix_comments_plan_target', table_name='comments')
    op.drop_index('ix_comments_id', table_name='comments')
    op.drop_table('comments')
    op.drop_index('ix_votes_poll', table_name='votes')
    op.drop_index('ix_votes_id', table_name='votes')
    op.drop_table('votes')
    op.drop_index('ix_poll_options_poll', table_name='poll_options')
    op.drop_index('ix_poll_options_id', table_name='poll_options')
    op.drop_table('poll_options')
    op.drop_index('ix_polls_plan_deleted', table_name='polls')
    op.drop_index('ix_polls_id', table_name='polls')
    op.drop_table('polls')
