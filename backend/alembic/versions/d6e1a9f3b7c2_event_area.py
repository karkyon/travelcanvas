"""[Gate EventArea] エリアの中の予定(travel_events.parent_event_id)

予定の種類「エリア」(event_type='area')の中に入れた予定は、エリアの予定の ID を持つ。
列の追加だけ(既存の行は変えない)。エリアを消すと中の予定は外れる(ON DELETE SET NULL)。
外部キーは取引の終わりに確かめる(DEFERRABLE INITIALLY DEFERRED。元に戻す時、中の予定とエリアの順を問わない)。

Revision ID: d6e1a9f3b7c2
Revises: c5d2f8a1e7b4
Create Date: 2026-11-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'd6e1a9f3b7c2'
down_revision: Union[str, Sequence[str], None] = 'c5d2f8a1e7b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_events', sa.Column('parent_event_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_travel_events_parent_event_id', 'travel_events', 'travel_events',
                          ['parent_event_id'], ['id'], ondelete='SET NULL', deferrable=True, initially='DEFERRED')
    op.create_index('ix_travel_events_parent_event_id', 'travel_events', ['parent_event_id'])


def downgrade() -> None:
    op.drop_index('ix_travel_events_parent_event_id', table_name='travel_events')
    op.drop_constraint('fk_travel_events_parent_event_id', 'travel_events', type_='foreignkey')
    op.drop_column('travel_events', 'parent_event_id')
