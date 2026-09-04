"""gate31_search_normalization

Revision ID: c4a7f0e2b913
Revises: b12f9c30ad41
Create Date: 2026-09-04 00:00:00.000000

[Gate #31] Candidate/Place/Search正規化。

search_candidates / places / source_records / field_sources /
opening_hours の5テーブルを新規追加する(既存テーブルへのALTER/DROPは
一切行わない、追加のみの安全なマイグレーション)。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4a7f0e2b913'
down_revision: Union[str, Sequence[str], None] = 'b12f9c30ad41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'search_candidates',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('query', sa.String(), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('external_id', sa.String(), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('address', sa.String(), nullable=True),
        sa.Column('raw_payload', sa.JSON(), nullable=True),
        sa.Column('searched_by_user_id', sa.UUID(), nullable=True),
        sa.Column('retrieved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['searched_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_search_candidates_id'), 'search_candidates', ['id'], unique=False)

    op.create_table(
        'places',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('address', sa.String(), nullable=True),
        sa.Column('adopted_from_candidate_id', sa.UUID(), nullable=True),
        sa.Column('created_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['adopted_from_candidate_id'], ['search_candidates.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_places_id'), 'places', ['id'], unique=False)

    op.create_table(
        'source_records',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('candidate_id', sa.UUID(), nullable=True),
        sa.Column('place_id', sa.UUID(), nullable=True),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('source_url', sa.String(), nullable=True),
        sa.Column('retrieved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('freshness_state', sa.String(), nullable=False, server_default='fresh'),
        sa.Column('raw_response', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['candidate_id'], ['search_candidates.id']),
        sa.ForeignKeyConstraint(['place_id'], ['places.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_source_records_id'), 'source_records', ['id'], unique=False)

    op.create_table(
        'field_sources',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('place_id', sa.UUID(), nullable=False),
        sa.Column('field_name', sa.String(), nullable=False),
        sa.Column('value', sa.Text(), nullable=True),
        sa.Column('source_record_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['place_id'], ['places.id']),
        sa.ForeignKeyConstraint(['source_record_id'], ['source_records.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_field_sources_id'), 'field_sources', ['id'], unique=False)

    op.create_table(
        'opening_hours',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('place_id', sa.UUID(), nullable=False),
        sa.Column('day_of_week', sa.Integer(), nullable=False),
        sa.Column('open_time', sa.String(), nullable=True),
        sa.Column('close_time', sa.String(), nullable=True),
        sa.Column('source_record_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['place_id'], ['places.id']),
        sa.ForeignKeyConstraint(['source_record_id'], ['source_records.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_opening_hours_id'), 'opening_hours', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_opening_hours_id'), table_name='opening_hours')
    op.drop_table('opening_hours')

    op.drop_index(op.f('ix_field_sources_id'), table_name='field_sources')
    op.drop_table('field_sources')

    op.drop_index(op.f('ix_source_records_id'), table_name='source_records')
    op.drop_table('source_records')

    op.drop_index(op.f('ix_places_id'), table_name='places')
    op.drop_table('places')

    op.drop_index(op.f('ix_search_candidates_id'), table_name='search_candidates')
    op.drop_table('search_candidates')
