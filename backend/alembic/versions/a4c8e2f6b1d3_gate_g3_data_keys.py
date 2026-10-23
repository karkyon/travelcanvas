"""gate_g3_data_keys

Revision ID: a4c8e2f6b1d3
Revises: f3c9e5b7a2d1
Create Date: 2026-10-22 13:00:00.000000

[Gate G3] SEC-F5 鍵の破棄による削除(cryptographic erasure)。旅行ごと・利用者ごとのデータ鍵(DEK)。

- data_keys: 対象(subject_type = plan / user、subject_id)ごとのデータ鍵。鍵は ENCRYPTION_KEY(鍵を包む鍵)で
  包んで wrapped_key_ciphertext に持つ(名前が *_ciphertext のため、鍵の切り替え `tcops.py keys rekey` が包み直す)。
  破棄すると wrapped_key_ciphertext を NULL にし、destroyed_at・destroy_reason だけを残す(中身は残さない)。
- 対象ごとに使える鍵は1つ(破棄していない物)。部分一意索引 uq_data_keys_active。
- 外部キーは付けない(旅行・利用者を消した後も、破棄した記録を残すため)。
- [Gate G3] CI-05 外部キーの列の索引: 索引の無かった外部キー(単一列)に索引を足す(旅行の予定の一覧・旅行の完全削除の
  連鎖の削除・通知・セッション等が、件数に比例して遅くなっていた)。tests/test_gate_g3_perf.py が「索引の無い外部キー 0」を確かめる。
- mfa_reset_requests: [Gate G3] SEC-F6 多要素認証の解除の申請と承認(二者の確認)。申請した管理者と承認する管理者を分け、
  対象の本人は申請も承認もできない。24時間で期限切れ。

downgrade: 2つの表を消す。先に `python -m app.ops.rekey convert --to legacy` でデータ鍵の暗号文を ENCRYPTION_KEY の
暗号文へ戻すこと(パッチの戻しはこの順で行う)。戻さずに消すと、データ鍵で暗号化した値が読めなくなる。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a4c8e2f6b1d3'
down_revision: Union[str, Sequence[str], None] = 'f3c9e5b7a2d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FK_INDEXES = [
    ('booklet_exports', 'created_by_user_id'),
    ('budgets', 'created_by_user_id'),
    ('budgets', 'member_user_id'),
    ('change_items', 'change_set_id'),
    ('change_sets', 'actor_user_id'),
    ('change_sets', 'plan_id'),
    ('comments', 'author_user_id'),
    ('comments', 'parent_id'),
    ('constraints', 'owner_user_id'),
    ('documents', 'owner_user_id'),
    ('event_actuals', 'recorded_by_user_id'),
    ('event_links', 'event_id'),
    ('expense_shares', 'user_id'),
    ('expenses', 'created_by_user_id'),
    ('expenses', 'paid_by_user_id'),
    ('expenses', 'refund_of_expense_id'),
    ('extraction_candidates', 'reviewed_by_user_id'),
    ('field_sources', 'place_id'),
    ('field_sources', 'source_record_id'),
    ('idempotency_records', 'device_id'),
    ('idempotency_records', 'user_id'),
    ('import_jobs', 'created_by_user_id'),
    ('import_jobs', 'document_id'),
    ('import_jobs', 'result_reservation_id'),
    ('itinerary_branches', 'adopted_by_user_id'),
    ('itinerary_branches', 'adopted_change_set_id'),
    ('itinerary_branches', 'created_by_user_id'),
    ('location_area_cells', 'user_id'),
    ('location_tracks', 'user_id'),
    ('memories', 'author_user_id'),
    ('mfa_reset_requests', 'approved_by_user_id'),
    ('mfa_reset_requests', 'requested_by_user_id'),
    ('notifications', 'related_plan_id'),
    ('notifications', 'user_id'),
    ('opening_hours', 'place_id'),
    ('opening_hours', 'source_record_id'),
    ('optimization_results', 'travel_id'),
    ('org_api_clients', 'created_by'),
    ('org_distribution_acks', 'user_id'),
    ('org_distributions', 'published_by'),
    ('org_distributions', 'source_plan_id'),
    ('org_webhooks', 'created_by'),
    ('organizations', 'created_by'),
    ('packing_items', 'assignee_user_id'),
    ('packing_items', 'owner_user_id'),
    ('places', 'adopted_from_candidate_id'),
    ('places', 'created_by'),
    ('plan_alerts', 'created_by_user_id'),
    ('plan_candidates', 'created_by_user_id'),
    ('plan_candidates', 'place_id'),
    ('plan_collaborators', 'plan_id'),
    ('plan_collaborators', 'user_id'),
    ('plan_share_links', 'plan_id'),
    ('polls', 'created_by_user_id'),
    ('preparation_tasks', 'assignee_user_id'),
    ('preparation_tasks', 'completed_by_user_id'),
    ('preparation_tasks', 'created_by_user_id'),
    ('quick_drafts', 'promoted_plan_id'),
    ('replans', 'alert_id'),
    ('replans', 'applied_by_user_id'),
    ('replans', 'applied_change_set_id'),
    ('replans', 'created_by_user_id'),
    ('reservation_participants', 'plan_member_id'),
    ('reservations', 'place_id'),
    ('route_options', 'from_event_id'),
    ('route_options', 'from_place_id'),
    ('route_options', 'to_event_id'),
    ('route_options', 'to_place_id'),
    ('search_candidates', 'searched_by_user_id'),
    ('settlements', 'created_by_user_id'),
    ('settlements', 'from_user_id'),
    ('settlements', 'to_user_id'),
    ('share_access_logs', 'share_id'),
    ('source_records', 'candidate_id'),
    ('source_records', 'place_id'),
    ('spots', 'created_by'),
    ('support_grants', 'last_accessed_by'),
    ('tickets', 'holder_member_id'),
    ('travel_events', 'day_id'),
    ('travel_events', 'place_id'),
    ('travel_events', 'plan_id'),
    ('travel_events', 'spot_id'),
    ('travel_plans', 'deleted_by_user_id'),
    ('travel_plans', 'user_id'),
    ('travel_segments', 'from_event_id'),
    ('travel_segments', 'from_place_id'),
    ('travel_segments', 'reservation_id'),
    ('travel_segments', 'route_option_id'),
    ('travel_segments', 'to_event_id'),
    ('travel_segments', 'to_place_id'),
    ('travels', 'owner_id'),
    ('trip_location_settings', 'user_id'),
    ('user_sessions', 'user_id'),
    ('user_spot_favorites', 'spot_id'),
    ('user_spot_favorites', 'user_id'),
    ('user_spot_visits', 'spot_id'),
    ('user_spot_visits', 'user_id'),
    ('validation_issues', 'constraint_id'),
    ('validation_runs', 'created_by_user_id'),
    ('votes', 'resolved_by_user_id'),
    ('votes', 'user_id'),
]


def _ix(table: str, column: str) -> str:
    return ("ix_fk_%s_%s" % (table, column))[:63]


def upgrade() -> None:
    op.create_table(
        'data_keys',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('subject_type', sa.String(8), nullable=False),
        sa.Column('subject_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('wrapped_key_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('destroyed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('destroy_reason', sa.String(40), nullable=True),
        sa.CheckConstraint("subject_type IN ('plan', 'user')", name='ck_data_keys_subject_type'),
        sa.CheckConstraint("(destroyed_at IS NULL) = (wrapped_key_ciphertext IS NOT NULL)",
                           name='ck_data_keys_destroyed_has_no_key'),
    )
    op.create_index('ix_data_keys_subject', 'data_keys', ['subject_type', 'subject_id'])
    op.create_index('uq_data_keys_active', 'data_keys', ['subject_type', 'subject_id'], unique=True,
                    postgresql_where=sa.text('destroyed_at IS NULL'))
    op.create_table(
        'mfa_reset_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('target_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('requested_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.String(200), nullable=False),
        sa.Column('status', sa.String(12), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('single_operator', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("status IN ('pending', 'approved', 'cancelled', 'expired')",
                           name='ck_mfa_reset_requests_status'),
    )
    for table, column in FK_INDEXES:
        op.execute('CREATE INDEX IF NOT EXISTS "%s" ON "%s" ("%s")' % (_ix(table, column), table, column))


def downgrade() -> None:
    for table, column in FK_INDEXES:
        if table != 'mfa_reset_requests':
            op.execute('DROP INDEX IF EXISTS "%s"' % _ix(table, column))
    op.drop_table('mfa_reset_requests')
    op.drop_index('uq_data_keys_active', table_name='data_keys')
    op.drop_index('ix_data_keys_subject', table_name='data_keys')
    op.drop_table('data_keys')
