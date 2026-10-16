"""gate_p12_memories

Revision ID: b9d5f3a7c1e4
Revises: a8c4e2f6d9b3
Create Date: 2026-10-15 20:00:00.000000

[Gate P12] FR-037 写真・メモ・旅行記(DOC-04 SC-28)。

新規テーブル memories を1つ追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
- plan_id は ON DELETE CASCADE(B-012の外部キー方針)。写真・音声のファイルはプランの完全削除時に消す(plan_deletion)。
- 予定・日(event_id/day_id)には外部キーを張らない(B-013の個別削除を妨げないため)。

downgrade はテーブルを削除する(記録の行は失われる。保存済みのファイルは残るため、downgrade前に必要なら書き出すこと)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b9d5f3a7c1e4'
down_revision: Union[str, Sequence[str], None] = 'a8c4e2f6d9b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'memories',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('author_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('event_id', UUID, nullable=True),
        sa.Column('day_id', UUID, nullable=True),
        sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('place_name', sa.String(length=200), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('video_url', sa.String(length=2000), nullable=True),
        sa.Column('storage_key', sa.String(), nullable=True),
        sa.Column('mime_type', sa.String(length=100), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('sha256', sa.String(length=64), nullable=True),
        sa.Column('visibility', sa.String(length=8), nullable=False),
        sa.Column('include_in_journal', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('note','photo','audio','video')", name='ck_memories_kind'),
        sa.CheckConstraint("visibility IN ('private','members')", name='ck_memories_visibility'),
        sa.CheckConstraint("(kind IN ('photo','audio')) = (storage_key IS NOT NULL)", name='ck_memories_media'),
        sa.CheckConstraint("(kind = 'video') = (video_url IS NOT NULL)", name='ck_memories_video'),
        sa.CheckConstraint("kind <> 'note' OR body IS NOT NULL", name='ck_memories_note_body'),
        sa.CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name='ck_memories_location_pair'),
        sa.CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name='ck_memories_latitude'),
        sa.CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name='ck_memories_longitude'),
    )
    op.create_index('ix_memories_id', 'memories', ['id'])
    op.create_index('ix_memories_plan_occurred', 'memories', ['plan_id', 'occurred_at'])


def downgrade() -> None:
    op.drop_index('ix_memories_plan_occurred', table_name='memories')
    op.drop_index('ix_memories_id', table_name='memories')
    op.drop_table('memories')
