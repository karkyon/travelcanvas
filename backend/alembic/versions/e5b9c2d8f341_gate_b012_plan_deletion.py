"""gate_b012_plan_deletion

Revision ID: e5b9c2d8f341
Revises: c3e8a1f47d20
Create Date: 2026-09-26 22:30:00.000000

[Gate B-012] プラン削除の2段階化(論理削除 → 猶予期間 → 完全削除)と外部キーの削除方針。

B-012: 日程を1件でも持つプランの `DELETE /travel-plans/{id}` が500になっていた
(change_sets・予約・区間・文書・共有アクセスログ・通知・QuickDraft等の外部キーが
全て NO ACTION で、削除時の扱いが定義されていなかった)。

1. travel_plans に deleted_at / deleted_by_user_id / purge_after を追加(論理削除と猶予期限)。
   既存行はすべて未削除(NULL)のまま。backfill不要。
2. 外部キーの削除方針を明示する(DOC-05「FKは削除方針を明示」)。
   - CASCADE: プランが所有するデータ(プランの完全削除で一緒に消す)
   - SET NULL: プラン外のデータ(通知・QuickDraft・共有アクセスログは残し参照だけ外す)
   - DEFERRABLE INITIALLY IMMEDIATE: プラン内の横の参照。通常は従来どおり即時検査し、
     完全削除のときだけ `SET CONSTRAINTS ALL DEFERRED` でコミット時まで検査を遅らせる
     (PostgreSQLは連鎖削除をテーブルごとの内部文で順に実行し、NO ACTIONの検査も
     内部文ごとに行うため、横の参照が先に検査されて失敗する。SET NULLは区間端点の
     XOR CHECKを壊し、個別削除の挙動も変えるため使わない)。

制約名は環境差(例: fk_travel_segments_reservation_id_reservations)を吸収するため、
(テーブル, 列)から実際の名前を引いて同じ名前で作り直す。

downgrade: 外部キーを元の NO ACTION・即時検査へ戻し、追加列を削除する。
論理削除中のプランは downgrade 後に再び表示される(データは削除しない)。
"""
from typing import Sequence, Tuple, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e5b9c2d8f341'
down_revision: Union[str, Sequence[str], None] = 'c3e8a1f47d20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (子テーブル, 列, 親テーブル)
CASCADE: Tuple[Tuple[str, str, str], ...] = (
    ("travel_days", "plan_id", "travel_plans"),
    ("travel_events", "plan_id", "travel_plans"),
    ("travel_events", "day_id", "travel_days"),
    ("change_sets", "plan_id", "travel_plans"),
    ("change_items", "change_set_id", "change_sets"),
    ("plan_versions", "plan_id", "travel_plans"),
    ("plan_share_links", "plan_id", "travel_plans"),
    ("plan_collaborators", "plan_id", "travel_plans"),
    ("reservations", "plan_id", "travel_plans"),
    ("event_reservations", "reservation_id", "reservations"),
    ("reservation_participants", "reservation_id", "reservations"),
    ("tickets", "reservation_id", "reservations"),
    ("travel_segments", "plan_id", "travel_plans"),
    ("route_options", "plan_id", "travel_plans"),
    ("route_legs", "route_option_id", "route_options"),
    ("documents", "plan_id", "travel_plans"),
    ("document_links", "document_id", "documents"),
    ("import_jobs", "plan_id", "travel_plans"),
    ("extraction_candidates", "import_job_id", "import_jobs"),
    ("event_links", "event_id", "travel_events"),
)
SET_NULL: Tuple[Tuple[str, str, str], ...] = (
    ("notifications", "related_plan_id", "travel_plans"),
    ("quick_drafts", "promoted_plan_id", "travel_plans"),
    ("share_access_logs", "share_id", "plan_share_links"),
)
DEFERRABLE: Tuple[Tuple[str, str, str], ...] = (
    ("reservations", "event_id", "travel_events"),
    ("event_reservations", "event_id", "travel_events"),
    ("travel_segments", "from_event_id", "travel_events"),
    ("travel_segments", "to_event_id", "travel_events"),
    ("travel_segments", "reservation_id", "reservations"),
    ("travel_segments", "route_option_id", "route_options"),
    ("route_options", "from_event_id", "travel_events"),
    ("route_options", "to_event_id", "travel_events"),
    ("reservation_participants", "plan_member_id", "plan_collaborators"),
    ("tickets", "holder_member_id", "plan_collaborators"),
    ("import_jobs", "document_id", "documents"),
    ("import_jobs", "result_reservation_id", "reservations"),
)


def _fk_name(table: str, column: str, parent: str) -> str:
    name = op.get_bind().execute(sa.text(
        """
        SELECT c.conname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.conrelid = CAST(:t AS regclass) AND a.attname = :c
          AND c.confrelid = CAST(:p AS regclass) AND array_length(c.conkey, 1) = 1
        """
    ), {"t": table, "c": column, "p": parent}).scalar()
    if not name:
        raise RuntimeError(f"外部キーが見つかりません: {table}.{column} -> {parent}")
    return name


def _recreate(table: str, column: str, parent: str, clause: str) -> None:
    name = _fk_name(table, column, parent)
    op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"')
    op.execute(f'ALTER TABLE {table} ADD CONSTRAINT "{name}" FOREIGN KEY ({column}) REFERENCES {parent}(id) {clause}')


def upgrade() -> None:
    op.add_column('travel_plans', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('travel_plans', sa.Column('deleted_by_user_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('travel_plans', sa.Column('purge_after', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        'fk_travel_plans_deleted_by_user_id_users', 'travel_plans', 'users',
        ['deleted_by_user_id'], ['id'], ondelete='SET NULL',
    )
    op.create_check_constraint(
        'ck_travel_plans_deleted_consistency', 'travel_plans',
        '(deleted_at IS NULL AND purge_after IS NULL) OR (deleted_at IS NOT NULL AND purge_after IS NOT NULL)',
    )
    op.create_index(
        'ix_travel_plans_purge_after', 'travel_plans', ['purge_after'],
        postgresql_where=sa.text('deleted_at IS NOT NULL'),
    )

    for table, column, parent in CASCADE:
        _recreate(table, column, parent, 'ON DELETE CASCADE')
    for table, column, parent in SET_NULL:
        _recreate(table, column, parent, 'ON DELETE SET NULL')
    for table, column, parent in DEFERRABLE:
        _recreate(table, column, parent, 'DEFERRABLE INITIALLY IMMEDIATE')


def downgrade() -> None:
    for table, column, parent in CASCADE + SET_NULL + DEFERRABLE:
        _recreate(table, column, parent, '')

    op.drop_index('ix_travel_plans_purge_after', table_name='travel_plans')
    op.drop_constraint('ck_travel_plans_deleted_consistency', 'travel_plans', type_='check')
    op.drop_constraint('fk_travel_plans_deleted_by_user_id_users', 'travel_plans', type_='foreignkey')
    op.drop_column('travel_plans', 'purge_after')
    op.drop_column('travel_plans', 'deleted_by_user_id')
    op.drop_column('travel_plans', 'deleted_at')
