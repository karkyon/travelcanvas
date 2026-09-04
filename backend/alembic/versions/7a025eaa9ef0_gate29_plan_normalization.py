"""gate29_plan_normalization

Revision ID: 7a025eaa9ef0
Revises: 7564a17b52b0
Create Date: 2026-09-03 20:49:36.162907

[Gate #29] TravelPlan.itinerary(JSON blob)から travel_days/travel_events への
正規化。既存の全プランについて、現行のitinerary形状
{"days": [{"date": "YYYY-MM-DD", "events": [{"id","name"/"title",
"latitude","longitude","address","time"?, ...}]}]} を読み取り、対応する
travel_days/travel_eventsへbackfillする。想定外のキー欠落や形状違いは
1プラン単位でスキップし(他プランの移行を止めない)、スキップ件数を
最後にprintする。itinerary列自体は削除しない(後方互換のため/travel-plans
は引き続きこれを読み書きする)。
"""
from typing import Sequence, Union
import uuid
from datetime import datetime, date as date_cls

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a025eaa9ef0'
down_revision: Union[str, Sequence[str], None] = '7564a17b52b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date_cls):
        return value
    text = str(value)[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def _backfill(connection):
    plans = connection.execute(
        sa.text("SELECT id, itinerary FROM travel_plans WHERE itinerary IS NOT NULL")
    ).fetchall()

    skipped = 0
    migrated_days = 0
    migrated_events = 0

    for plan_id, itinerary in plans:
        savepoint = connection.begin_nested()
        try:
            plan_days_count = 0
            plan_events_count = 0
            days = (itinerary or {}).get("days") or []
            if not isinstance(days, list):
                savepoint.rollback()
                skipped += 1
                continue

            for sort_order, day in enumerate(days):
                if not isinstance(day, dict):
                    continue
                local_date = _parse_date(day.get("date"))
                if local_date is None:
                    # 日付が復元できない日は移行対象外(既存データに無効な
                    # 日付が入っていた場合の防御)。
                    continue

                day_id = uuid.uuid4()
                connection.execute(
                    sa.text(
                        "INSERT INTO travel_days "
                        "(id, plan_id, local_date, timezone_id, title, sort_order) "
                        "VALUES (:id, :plan_id, :local_date, 'UTC', :title, :sort_order) "
                        "ON CONFLICT (plan_id, local_date) DO NOTHING"
                    ),
                    {
                        "id": day_id,
                        "plan_id": plan_id,
                        "local_date": local_date,
                        "title": day.get("title"),
                        "sort_order": sort_order,
                    },
                )
                # [Gate #29] 同一itinerary内に同じ日付が複数回現れるケース
                # (壊れた既存データ)では、ON CONFLICT DO NOTHINGにより上のINSERTが
                # 何もしないことがある。その場合、Python側で生成したday_idは
                # 実際にDBへ存在する行のidと一致しないため、後続のtravel_events
                # 挿入がFK違反になる。常に実際の行idを引き直す。
                actual_day_id = connection.execute(
                    sa.text(
                        "SELECT id FROM travel_days WHERE plan_id = :plan_id AND local_date = :local_date"
                    ),
                    {"plan_id": plan_id, "local_date": local_date},
                ).scalar_one()
                day_id = actual_day_id
                plan_days_count += 1

                events = day.get("events") or []
                if not isinstance(events, list):
                    continue
                for event_sort_order, event in enumerate(events):
                    if not isinstance(event, dict):
                        continue
                    title = event.get("title") or event.get("name") or "無題のイベント"
                    lat = event.get("latitude")
                    lng = event.get("longitude")
                    connection.execute(
                        sa.text(
                            "INSERT INTO travel_events "
                            "(id, plan_id, day_id, title, description, event_type, "
                            " address, latitude, longitude, local_start_time, is_all_day, locked, sort_order) "
                            "VALUES (:id, :plan_id, :day_id, :title, :description, "
                            " :event_type, :address, :latitude, :longitude, :local_start_time, false, false, :sort_order)"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "plan_id": plan_id,
                            "day_id": day_id,
                            "title": str(title)[:255],
                            "description": event.get("description"),
                            "event_type": event.get("category") or event.get("type") or "activity",
                            "address": event.get("address"),
                            "latitude": float(lat) if isinstance(lat, (int, float)) else None,
                            "longitude": float(lng) if isinstance(lng, (int, float)) else None,
                            "local_start_time": event.get("time") or event.get("start_time"),
                            "sort_order": event_sort_order,
                        },
                    )
                    plan_events_count += 1

            connection.execute(
                sa.text(
                    "INSERT INTO plan_versions (id, plan_id, revision, summary) "
                    "VALUES (:id, :plan_id, 1, 'Gate #29 backfill from itinerary JSON')"
                ),
                {"id": uuid.uuid4(), "plan_id": plan_id},
            )
            savepoint.commit()
            migrated_days += plan_days_count
            migrated_events += plan_events_count
        except Exception as e:  # noqa: BLE001
            savepoint.rollback()
            skipped += 1
            print(f"  [backfill] plan {plan_id} skipped due to: {e}")

    print(
        f"[Gate #29 backfill] plans processed={len(plans)} skipped={skipped} "
        f"days_created={migrated_days} events_created={migrated_events}"
    )


def upgrade() -> None:
    """Upgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('idempotency_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('key', sa.String(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('endpoint', sa.String(), nullable=False),
    sa.Column('response_status', sa.Integer(), nullable=False),
    sa.Column('response_json', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key', 'user_id', 'endpoint', name='uq_idempotency_key_user_endpoint')
    )
    op.create_index(op.f('ix_idempotency_records_id'), 'idempotency_records', ['id'], unique=False)
    op.create_table('change_sets',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('actor_user_id', sa.UUID(), nullable=True),
    sa.Column('source', sa.String(), nullable=False),
    sa.Column('base_revision', sa.Integer(), nullable=False),
    sa.Column('resulting_revision', sa.Integer(), nullable=False),
    sa.Column('applied_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('undone_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['plan_id'], ['travel_plans.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_change_sets_id'), 'change_sets', ['id'], unique=False)
    op.create_table('plan_versions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('revision', sa.Integer(), nullable=False),
    sa.Column('summary', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['plan_id'], ['travel_plans.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('plan_id', 'revision', name='uq_plan_versions_plan_revision')
    )
    op.create_index(op.f('ix_plan_versions_id'), 'plan_versions', ['id'], unique=False)
    op.create_table('travel_days',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('timezone_id', sa.String(), nullable=False),
    sa.Column('title', sa.String(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['plan_id'], ['travel_plans.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('plan_id', 'local_date', name='uq_travel_days_plan_date')
    )
    op.create_index(op.f('ix_travel_days_id'), 'travel_days', ['id'], unique=False)
    op.create_table('change_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('change_set_id', sa.UUID(), nullable=False),
    sa.Column('entity_type', sa.String(), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=False),
    sa.Column('action', sa.String(), nullable=False),
    sa.Column('before_json', sa.JSON(), nullable=True),
    sa.Column('after_json', sa.JSON(), nullable=True),
    sa.ForeignKeyConstraint(['change_set_id'], ['change_sets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_change_items_id'), 'change_items', ['id'], unique=False)
    op.create_table('travel_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('day_id', sa.UUID(), nullable=False),
    sa.Column('spot_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('event_type', sa.String(), nullable=False),
    sa.Column('start_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('end_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('local_start_time', sa.String(), nullable=True),
    sa.Column('is_all_day', sa.Boolean(), nullable=False),
    sa.Column('address', sa.String(), nullable=True),
    sa.Column('latitude', sa.Float(), nullable=True),
    sa.Column('longitude', sa.Float(), nullable=True),
    sa.Column('locked', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['day_id'], ['travel_days.id'], ),
    sa.ForeignKeyConstraint(['plan_id'], ['travel_plans.id'], ),
    sa.ForeignKeyConstraint(['spot_id'], ['spots.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_travel_events_id'), 'travel_events', ['id'], unique=False)
    op.create_table('event_links',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('event_id', sa.UUID(), nullable=False),
    sa.Column('link_type', sa.String(), nullable=False),
    sa.Column('label', sa.String(), nullable=True),
    sa.Column('url', sa.String(), nullable=True),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['event_id'], ['travel_events.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_event_links_id'), 'event_links', ['id'], unique=False)
    op.add_column('travel_plans', sa.Column('revision', sa.Integer(), server_default='1', nullable=False))
    # ### end Alembic commands ###

    # [Gate #29] スキーマ作成後、既存プランのitinerary JSONを正規テーブルへbackfill
    connection = op.get_bind()
    _backfill(connection)


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column('travel_plans', 'revision')
    op.drop_index(op.f('ix_event_links_id'), table_name='event_links')
    op.drop_table('event_links')
    op.drop_index(op.f('ix_travel_events_id'), table_name='travel_events')
    op.drop_table('travel_events')
    op.drop_index(op.f('ix_change_items_id'), table_name='change_items')
    op.drop_table('change_items')
    op.drop_index(op.f('ix_travel_days_id'), table_name='travel_days')
    op.drop_table('travel_days')
    op.drop_index(op.f('ix_plan_versions_id'), table_name='plan_versions')
    op.drop_table('plan_versions')
    op.drop_index(op.f('ix_change_sets_id'), table_name='change_sets')
    op.drop_table('change_sets')
    op.drop_index(op.f('ix_idempotency_records_id'), table_name='idempotency_records')
    op.drop_table('idempotency_records')
    # ### end Alembic commands ###
