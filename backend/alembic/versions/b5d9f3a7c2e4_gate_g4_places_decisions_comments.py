"""gate_g4_places_decisions_comments

Revision ID: b5d9f3a7c2e4
Revises: a4c8e2f6b1d3
Create Date: 2026-10-22 16:00:00.000000

[Gate G4] 外部の判断の要らない機能の残り(検索・場所・合意・コメント・共有・管理)。

- MAP-02 場所: opening_hours.last_entry・last_order(最終入場・ラストオーダー)、place_special_hours(日付ごとの例外の営業。
  曜日の営業時間より優先)、place_entrances(入口ごとの地点)
- MAP-03 検索のコマンド: command_runs(実行の記録。Idempotency-Key ごとに1件、元に戻す対象の変更セット・作った物)
- COL-02 合意: polls.quorum(決定に要る回答者数)・closed_reason・reminder_sent_at・adopted_at・adopted_by_user_id・
  adopted_change_set_id(採用の変更セット)、poll_options.candidate_id(候補箱の候補)
- COL-03 通知: notification_preferences(旅行ごと・全体の通知の量とメールのまとめ)、email_outbox(送るメールの記録・再送)、
  notifications.target_type・target_id(コメントの対象への移動)
- COL-05 共有: plan_share_links.allow_clone(受け取った人が自分の旅行へ複製してよい)、revoked_reason
- FC-097 濫用: abuse_reports(公開の共有への通報と、管理者の対応)

downgrade: 足した表・列を消す(例外の日・入口・最終入場・コマンドの記録・通知の設定・送信待ちのメール・通報は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b5d9f3a7c2e4'
down_revision: Union[str, Sequence[str], None] = 'a4c8e2f6b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- MAP-02
    op.add_column('opening_hours', sa.Column('last_entry', sa.String(5), nullable=True))
    op.add_column('opening_hours', sa.Column('last_order', sa.String(5), nullable=True))
    op.create_table(
        'place_special_hours',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('place_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('places.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('local_date', sa.Date(), nullable=False),
        sa.Column('kind', sa.String(8), nullable=False),
        sa.Column('open_time', sa.String(5), nullable=True),
        sa.Column('close_time', sa.String(5), nullable=True),
        sa.Column('last_entry', sa.String(5), nullable=True),
        sa.Column('last_order', sa.String(5), nullable=True),
        sa.Column('note', sa.String(200), nullable=True),
        sa.Column('source_record_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('source_records.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('closed', 'open')", name='ck_place_special_hours_kind'),
        sa.CheckConstraint("(kind = 'closed') = (open_time IS NULL AND close_time IS NULL)",
                           name='ck_place_special_hours_times'),
    )
    op.create_index('ix_place_special_hours_place_date', 'place_special_hours', ['place_id', 'local_date'])
    op.create_table(
        'place_entrances',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('place_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('places.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('label', sa.String(100), nullable=False),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('note', sa.String(300), nullable=True),
        sa.Column('accessible', sa.Boolean(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('source_record_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('source_records.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


    # ---- MAP-03
    op.create_table(
        'command_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_plans.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('command', sa.String(32), nullable=False),
        sa.Column('idempotency_key', sa.String(100), nullable=False),
        sa.Column('target_type', sa.String(24), nullable=True),
        sa.Column('target_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('change_set_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('change_sets.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('status', sa.String(8), nullable=False, server_default='executed'),
        sa.Column('response_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('undone_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_command_runs_user_key'),
        sa.CheckConstraint("status IN ('executed', 'undone')", name='ck_command_runs_status'),
    )
    # ---- COL-02
    op.add_column('polls', sa.Column('quorum', sa.Integer(), nullable=True))
    op.add_column('polls', sa.Column('closed_reason', sa.String(10), nullable=True))
    op.add_column('polls', sa.Column('reminder_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('polls', sa.Column('adopted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('polls', sa.Column('adopted_by_user_id', postgresql.UUID(as_uuid=True),
                                     sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.add_column('polls', sa.Column('adopted_change_set_id', postgresql.UUID(as_uuid=True),
                                     sa.ForeignKey('change_sets.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_fk_polls_adopted_by_user_id', 'polls', ['adopted_by_user_id'])
    op.create_index('ix_fk_polls_adopted_change_set_id', 'polls', ['adopted_change_set_id'])
    op.create_check_constraint('ck_polls_quorum', 'polls', 'quorum IS NULL OR quorum BETWEEN 1 AND 100')
    op.create_check_constraint('ck_polls_closed_reason', 'polls',
                               "closed_reason IS NULL OR closed_reason IN ('manual', 'deadline', 'decided')")
    op.add_column('poll_options', sa.Column('candidate_id', postgresql.UUID(as_uuid=True),
                                            sa.ForeignKey('plan_candidates.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_fk_poll_options_candidate_id', 'poll_options', ['candidate_id'])
    op.create_index('ix_polls_open_deadline', 'polls', ['deadline_at'],
                    postgresql_where=sa.text("status = 'open' AND deleted_at IS NULL AND deadline_at IS NOT NULL"))
    # ---- COL-03
    op.create_table(
        'notification_preferences',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_plans.id', ondelete='CASCADE'),
                  nullable=True, index=True),
        sa.Column('level', sa.String(10), nullable=False, server_default='all'),
        sa.Column('email_digest', sa.String(8), nullable=False, server_default='off'),
        sa.Column('last_digest_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("level IN ('all', 'mentions', 'none')", name='ck_notification_preferences_level'),
        sa.CheckConstraint("email_digest IN ('off', 'daily')", name='ck_notification_preferences_digest'),
    )
    op.create_index('uq_notification_preferences_user_plan', 'notification_preferences', ['user_id', 'plan_id'],
                    unique=True, postgresql_where=sa.text('plan_id IS NOT NULL'))
    op.create_index('uq_notification_preferences_user_global', 'notification_preferences', ['user_id'],
                    unique=True, postgresql_where=sa.text('plan_id IS NULL'))
    op.create_table(
        'email_outbox',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('kind', sa.String(24), nullable=False),
        sa.Column('subject', sa.String(200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(8), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_error', sa.String(200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'sent', 'failed', 'dead')", name='ck_email_outbox_status'),
    )
    op.create_index('ix_email_outbox_due', 'email_outbox', ['next_attempt_at'],
                    postgresql_where=sa.text("status IN ('pending', 'failed')"))
    op.add_column('notifications', sa.Column('target_type', sa.String(12), nullable=True))
    op.add_column('notifications', sa.Column('target_id', postgresql.UUID(as_uuid=True), nullable=True))
    # ---- COL-05
    op.add_column('plan_share_links', sa.Column('allow_clone', sa.Boolean(), nullable=False,
                                                server_default=sa.text('false')))
    op.add_column('plan_share_links', sa.Column('revoked_reason', sa.String(16), nullable=True))
    # ---- FC-097
    op.create_table(
        'abuse_reports',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('share_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('plan_share_links.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_plans.id', ondelete='SET NULL'),
                  nullable=True, index=True),
        sa.Column('source', sa.String(8), nullable=False, server_default='report'),
        sa.Column('reason', sa.String(10), nullable=False),
        sa.Column('note', sa.String(500), nullable=True),
        sa.Column('reporter_hash', sa.String(64), nullable=True),
        sa.Column('status', sa.String(10), nullable=False, server_default='open'),
        sa.Column('handled_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'),
                  nullable=True, index=True),
        sa.Column('handled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("reason IN ('phishing', 'malware', 'spam', 'scraping', 'privacy', 'other')",
                           name='ck_abuse_reports_reason'),
        sa.CheckConstraint("source IN ('report', 'auto')", name='ck_abuse_reports_source'),
        sa.CheckConstraint("status IN ('open', 'dismissed', 'actioned')", name='ck_abuse_reports_status'),
    )
    op.create_index('ix_abuse_reports_status_created', 'abuse_reports', ['status', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_abuse_reports_status_created', table_name='abuse_reports')
    op.drop_table('abuse_reports')
    op.drop_column('plan_share_links', 'revoked_reason')
    op.drop_column('plan_share_links', 'allow_clone')
    op.drop_column('notifications', 'target_id')
    op.drop_column('notifications', 'target_type')
    op.drop_index('ix_email_outbox_due', table_name='email_outbox')
    op.drop_table('email_outbox')
    op.drop_index('uq_notification_preferences_user_global', table_name='notification_preferences')
    op.drop_index('uq_notification_preferences_user_plan', table_name='notification_preferences')
    op.drop_table('notification_preferences')
    op.drop_index('ix_polls_open_deadline', table_name='polls')
    op.drop_index('ix_fk_poll_options_candidate_id', table_name='poll_options')
    op.drop_column('poll_options', 'candidate_id')
    op.drop_constraint('ck_polls_closed_reason', 'polls', type_='check')
    op.drop_constraint('ck_polls_quorum', 'polls', type_='check')
    op.drop_index('ix_fk_polls_adopted_change_set_id', table_name='polls')
    op.drop_index('ix_fk_polls_adopted_by_user_id', table_name='polls')
    for col in ('adopted_change_set_id', 'adopted_by_user_id', 'adopted_at', 'reminder_sent_at', 'closed_reason',
                'quorum'):
        op.drop_column('polls', col)
    op.drop_table('command_runs')
    op.drop_table('place_entrances')
    op.drop_index('ix_place_special_hours_place_date', table_name='place_special_hours')
    op.drop_table('place_special_hours')
    op.drop_column('opening_hours', 'last_order')
    op.drop_column('opening_hours', 'last_entry')
