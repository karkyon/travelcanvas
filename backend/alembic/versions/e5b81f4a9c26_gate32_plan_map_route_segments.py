"""gate32_plan_map_route_segments

Revision ID: e5b81f4a9c26
Revises: d8e21a5c7f04
Create Date: 2026-09-05 00:00:00.000000

[Gate #32] PLAN MAP基礎。

1. travel_events.place_id を追加(Gate #31のPlaceからcandidate採用で
   作成されたイベントの出典を追跡できるようにする。既存行はNULLのまま)。
2. route_segments テーブルを新規追加(1日の中で連続する2イベント間の
   移動区間推定を保存する。プロバイダは当面haversine距離ベースの概算
   のみで、外部ルーティングAPIキーは不要)。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5b81f4a9c26'
down_revision: Union[str, Sequence[str], None] = 'd8e21a5c7f04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('travel_events', sa.Column('place_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_travel_events_place_id_places', 'travel_events', 'places', ['place_id'], ['id']
    )

    op.create_table(
        'route_segments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('plan_id', sa.UUID(), nullable=False),
        sa.Column('from_event_id', sa.UUID(), nullable=True),
        sa.Column('to_event_id', sa.UUID(), nullable=True),
        sa.Column('mode', sa.String(), nullable=False),
        sa.Column('distance_km', sa.Float(), nullable=True),
        sa.Column('duration_minutes', sa.Float(), nullable=True),
        sa.Column('is_estimate', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('algorithm_version', sa.String(), nullable=False),
        sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['plan_id'], ['travel_plans.id']),
        sa.ForeignKeyConstraint(['from_event_id'], ['travel_events.id']),
        sa.ForeignKeyConstraint(['to_event_id'], ['travel_events.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_route_segments_id'), 'route_segments', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_route_segments_id'), table_name='route_segments')
    op.drop_table('route_segments')

    op.drop_constraint('fk_travel_events_place_id_places', 'travel_events', type_='foreignkey')
    op.drop_column('travel_events', 'place_id')
