"""[Gate PhotoMap・PhotoQR・MyMaps] 写真の位置の根拠・QR の投稿・マイマップのリンク

Revision ID: c4e8a2f6d1b3
Revises: b7d2f4a6c8e1
Create Date: 2026-11-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'c4e8a2f6d1b3'
down_revision: Union[str, Sequence[str], None] = 'b7d2f4a6c8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column('memories', sa.Column('location_source', sa.String(length=8), nullable=True))
    op.add_column('memories', sa.Column('location_status', sa.String(length=9), nullable=True))
    op.add_column('memories', sa.Column('location_confidence', sa.Float(), nullable=True))
    op.add_column('memories', sa.Column('location_visibility', sa.String(length=8), nullable=False,
                                        server_default='private'))
    op.add_column('memories', sa.Column('client_upload_id', sa.String(length=64), nullable=True))
    op.create_check_constraint('ck_memories_location_source', 'memories',
                               "location_source IS NULL OR location_source IN ('exif','track','event','manual')")
    op.create_check_constraint('ck_memories_location_status', 'memories',
                               "location_status IS NULL OR location_status IN ('proposed','confirmed')")
    op.create_check_constraint('ck_memories_location_visibility', 'memories',
                               "location_visibility IN ('private','members')")
    op.create_index('uq_memories_client_upload', 'memories', ['plan_id', 'author_user_id', 'client_upload_id'],
                    unique=True, postgresql_where=sa.text('client_upload_id IS NOT NULL'))
    op.create_table(
        'photo_upload_links',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False, unique=True),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', TS, nullable=False),
        sa.Column('revoked_at', TS, nullable=True),
        sa.Column('revoked_reason', sa.String(length=16), nullable=True),
        sa.Column('failed_attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('upload_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_used_at', TS, nullable=True),
        sa.Column('created_at', TS, server_default=sa.func.now(), nullable=True),
    )
    op.create_index('ix_photo_upload_links_plan_id', 'photo_upload_links', ['plan_id'])
    op.create_index('ix_photo_upload_links_created_by_user_id', 'photo_upload_links', ['created_by_user_id'])
    op.create_table(
        'photo_upload_sessions',
        sa.Column('id', UUID, primary_key=True),
        sa.Column('link_id', UUID, sa.ForeignKey('photo_upload_links.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False, unique=True),
        sa.Column('expires_at', TS, nullable=False),
        sa.Column('created_at', TS, server_default=sa.func.now(), nullable=True),
    )
    op.create_index('ix_photo_upload_sessions_link_id', 'photo_upload_sessions', ['link_id'])
    op.create_table(
        'plan_external_maps',
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('url', sa.String(length=500), nullable=False),
        sa.Column('visibility', sa.String(length=8), nullable=False, server_default='private'),
        sa.Column('created_at', TS, server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', TS, nullable=True),
        sa.CheckConstraint("visibility IN ('private','members')", name='ck_plan_external_maps_visibility'),
    )
    op.create_index('ix_plan_external_maps_user_id', 'plan_external_maps', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_plan_external_maps_user_id', table_name='plan_external_maps')
    op.drop_table('plan_external_maps')
    op.drop_index('ix_photo_upload_sessions_link_id', table_name='photo_upload_sessions')
    op.drop_table('photo_upload_sessions')
    op.drop_index('ix_photo_upload_links_created_by_user_id', table_name='photo_upload_links')
    op.drop_index('ix_photo_upload_links_plan_id', table_name='photo_upload_links')
    op.drop_table('photo_upload_links')
    op.drop_index('uq_memories_client_upload', table_name='memories')
    op.drop_constraint('ck_memories_location_visibility', 'memories', type_='check')
    op.drop_constraint('ck_memories_location_status', 'memories', type_='check')
    op.drop_constraint('ck_memories_location_source', 'memories', type_='check')
    op.drop_column('memories', 'client_upload_id')
    op.drop_column('memories', 'location_visibility')
    op.drop_column('memories', 'location_confidence')
    op.drop_column('memories', 'location_status')
    op.drop_column('memories', 'location_source')
