"""gate_m3_fr015_route_options

Revision ID: 60233f506045
Revises: 5bf5b47a715d
Create Date: 2026-09-13 09:00:00.000000

[Gate M3] FR-015 複数経路比較(DOC-05 §7.2 route_options / route_legs)。

新規テーブル2本(route_options, route_legs)の追加と、既存
travel_segmentsへのnullable FK列(route_option_id)追加のみを行う、
完全にadditiveなmigration(既存データへの影響なし)。

- route_options: from/to端点(Event/PlaceのXOR、travel_segmentsと同じ
  パターン)、比較指標(時間/費用/距離/徒歩/乗換/バリアフリー/景観/CO2)、
  provenance(provider/retrieved_at/expires_at/推定幅)を持つ。
- route_legs: route_option内の個別乗り継ぎ区間。(route_option_id,
  leg_order)の一意性を保証する。
- travel_segments.route_option_id: 採用されたRouteOptionへの参照
  (nullable)。Gate M1時点では参照先テーブルが存在しなかったため
  先送りしていた列(ADR-travel-segment.md参照)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '60233f506045'
down_revision: Union[str, Sequence[str], None] = '5bf5b47a715d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MODE_VOCAB = ('walking', 'driving', 'train', 'bus', 'ferry', 'flight', 'bicycle', 'taxi', 'mixed')
_STATUS_VOCAB = ('candidate', 'adopted', 'discarded')
_REALTIME_VOCAB = ('unknown', 'on_time', 'delayed', 'cancelled')


def upgrade() -> None:
    op.create_table(
        'route_options',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('plan_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_plans.id'), nullable=False),
        sa.Column('from_event_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_events.id'), nullable=True),
        sa.Column('from_place_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('places.id'), nullable=True),
        sa.Column('to_event_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('travel_events.id'), nullable=True),
        sa.Column('to_place_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('places.id'), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='candidate'),
        sa.Column('total_duration_minutes', sa.Float(), nullable=True),
        sa.Column('total_cost', sa.Numeric(14, 2), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=True),
        sa.Column('total_distance_km', sa.Float(), nullable=True),
        sa.Column('walking_minutes', sa.Float(), nullable=True),
        sa.Column('transfer_count', sa.Integer(), nullable=True),
        sa.Column('accessibility_score', sa.Float(), nullable=True),
        sa.Column('scenic_score', sa.Float(), nullable=True),
        sa.Column('co2_estimate_kg', sa.Float(), nullable=True),
        sa.Column('duration_estimate_low_minutes', sa.Float(), nullable=True),
        sa.Column('duration_estimate_high_minutes', sa.Float(), nullable=True),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('retrieved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_estimate', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('algorithm_version', sa.String(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_route_options_id', 'route_options', ['id'])
    op.create_index('ix_route_options_plan_id', 'route_options', ['plan_id'])

    mode_list = ",".join(f"'{m}'" for m in _MODE_VOCAB)
    status_list = ",".join(f"'{s}'" for s in _STATUS_VOCAB)
    op.create_check_constraint(
        'ck_route_options_status_vocab', 'route_options', f'status IN ({status_list})',
    )
    op.create_check_constraint(
        'ck_route_options_from_endpoint_xor', 'route_options',
        '(from_event_id IS NOT NULL) != (from_place_id IS NOT NULL)',
    )
    op.create_check_constraint(
        'ck_route_options_to_endpoint_xor', 'route_options',
        '(to_event_id IS NOT NULL) != (to_place_id IS NOT NULL)',
    )
    op.create_check_constraint(
        'ck_route_options_no_same_endpoint', 'route_options',
        '(from_event_id IS NULL OR to_event_id IS NULL OR from_event_id != to_event_id) '
        'AND (from_place_id IS NULL OR to_place_id IS NULL OR from_place_id != to_place_id)',
    )
    op.create_check_constraint(
        'ck_route_options_nonneg', 'route_options',
        '(total_duration_minutes IS NULL OR total_duration_minutes >= 0) '
        'AND (total_cost IS NULL OR total_cost >= 0) '
        'AND (total_distance_km IS NULL OR total_distance_km >= 0) '
        'AND (walking_minutes IS NULL OR walking_minutes >= 0) '
        'AND (transfer_count IS NULL OR transfer_count >= 0) '
        'AND (co2_estimate_kg IS NULL OR co2_estimate_kg >= 0)',
    )
    op.create_check_constraint(
        'ck_route_options_currency_format', 'route_options',
        "currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))",
    )
    op.create_check_constraint(
        'ck_route_options_scores_range', 'route_options',
        '(accessibility_score IS NULL OR (accessibility_score >= 0 AND accessibility_score <= 1)) '
        'AND (scenic_score IS NULL OR (scenic_score >= 0 AND scenic_score <= 1))',
    )

    op.create_table(
        'route_legs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('route_option_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('route_options.id'), nullable=False),
        sa.Column('leg_order', sa.Integer(), nullable=False),
        sa.Column('mode', sa.String(), nullable=False),
        sa.Column('line', sa.String(), nullable=True),
        sa.Column('operator', sa.String(), nullable=True),
        sa.Column('platform', sa.String(), nullable=True),
        sa.Column('from_label', sa.String(), nullable=True),
        sa.Column('to_label', sa.String(), nullable=True),
        sa.Column('departure_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('arrival_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('distance_km', sa.Float(), nullable=True),
        sa.Column('duration_minutes', sa.Float(), nullable=True),
        sa.Column('realtime_status', sa.String(), nullable=False, server_default='unknown'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('route_option_id', 'leg_order', name='uq_route_legs_option_order'),
    )
    op.create_index('ix_route_legs_id', 'route_legs', ['id'])
    op.create_index('ix_route_legs_route_option_id', 'route_legs', ['route_option_id'])

    op.create_check_constraint(
        'ck_route_legs_mode_vocab', 'route_legs', f'mode IN ({mode_list})',
    )
    realtime_list = ",".join(f"'{s}'" for s in _REALTIME_VOCAB)
    op.create_check_constraint(
        'ck_route_legs_realtime_vocab', 'route_legs', f'realtime_status IN ({realtime_list})',
    )
    op.create_check_constraint(
        'ck_route_legs_nonneg', 'route_legs',
        '(distance_km IS NULL OR distance_km >= 0) AND (duration_minutes IS NULL OR duration_minutes >= 0) '
        'AND leg_order >= 0',
    )

    # [Gate M3] travel_segments.route_option_id(additive、nullable)。
    op.add_column(
        'travel_segments',
        sa.Column('route_option_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_travel_segments_route_option_id_route_options',
        'travel_segments', 'route_options', ['route_option_id'], ['id'],
    )

    print("[Gate M3] route_options/route_legsを新設し、travel_segments.route_option_idを追加しました")


def downgrade() -> None:
    op.drop_constraint(
        'fk_travel_segments_route_option_id_route_options', 'travel_segments', type_='foreignkey'
    )
    op.drop_column('travel_segments', 'route_option_id')

    op.drop_table('route_legs')
    op.drop_table('route_options')
