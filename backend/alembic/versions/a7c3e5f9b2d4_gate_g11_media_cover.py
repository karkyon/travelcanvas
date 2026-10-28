"""gate_g11_media_cover

Revision ID: a7c3e5f9b2d4
Revises: f4d8a2c6e9b1
Create Date: 2026-10-28 18:30:00.000000

[Gate G11] 旅行の表紙の写真・予定の写真・外部の写真の出典・SNS の候補(docs/ux/G11_UIUX全範囲_実装仕様.md §1。
2026-10-28 に利用者が案A を承認)。

- travel_plans.cover_memory_id: 表紙に使う写真(memories.id、記録が消えたら NULL)
- travel_plans.cover_focus_x / cover_focus_y(0〜100 %)・cover_zoom(100〜300 %): 表紙の写真の見せる位置と拡大
- travel_events.image_memory_id: 予定のカードの写真(記録が消えたら NULL)
- memories.source: 外部から取り込んだ写真の出典(provider・作者・ライセンス・取得日時)。手で上げた写真は NULL
- plan_candidates.source_kind に 'social'(SNS の投稿 URL から作った候補)を足す

downgrade: 足した列を消す(表紙・予定の写真の設定と出典の記録は失われる。写真そのもの(memories)は残る)。
source_kind='social' の候補は 'manual' に直してから制約を戻す。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a7c3e5f9b2d4'
down_revision: Union[str, Sequence[str], None] = 'f4d8a2c6e9b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column('travel_plans', sa.Column('cover_memory_id', UUID, nullable=True))
    op.create_foreign_key('fk_travel_plans_cover_memory', 'travel_plans', 'memories', ['cover_memory_id'], ['id'],
                          ondelete='SET NULL')
    op.add_column('travel_plans', sa.Column('cover_focus_x', sa.SmallInteger(), nullable=False, server_default='50'))
    op.add_column('travel_plans', sa.Column('cover_focus_y', sa.SmallInteger(), nullable=False, server_default='50'))
    op.add_column('travel_plans', sa.Column('cover_zoom', sa.SmallInteger(), nullable=False, server_default='100'))
    op.create_check_constraint('ck_travel_plans_cover_focus', 'travel_plans',
                               'cover_focus_x BETWEEN 0 AND 100 AND cover_focus_y BETWEEN 0 AND 100')
    op.create_check_constraint('ck_travel_plans_cover_zoom', 'travel_plans', 'cover_zoom BETWEEN 100 AND 300')
    op.create_index('ix_travel_plans_cover_memory', 'travel_plans', ['cover_memory_id'],
                    postgresql_where=sa.text('cover_memory_id IS NOT NULL'))

    op.add_column('travel_events', sa.Column('image_memory_id', UUID, nullable=True))
    op.create_foreign_key('fk_travel_events_image_memory', 'travel_events', 'memories', ['image_memory_id'], ['id'],
                          ondelete='SET NULL')
    op.create_index('ix_travel_events_image_memory', 'travel_events', ['image_memory_id'],
                    postgresql_where=sa.text('image_memory_id IS NOT NULL'))

    op.add_column('memories', sa.Column('source', postgresql.JSONB(), nullable=True))

    op.drop_constraint('ck_plan_candidates_source_kind', 'plan_candidates', type_='check')
    op.create_check_constraint('ck_plan_candidates_source_kind', 'plan_candidates',
                               "source_kind IN ('url','text','manual','search','social')")


def downgrade() -> None:
    op.execute("UPDATE plan_candidates SET source_kind = 'manual' WHERE source_kind = 'social'")
    op.drop_constraint('ck_plan_candidates_source_kind', 'plan_candidates', type_='check')
    op.create_check_constraint('ck_plan_candidates_source_kind', 'plan_candidates',
                               "source_kind IN ('url','text','manual','search')")

    op.drop_column('memories', 'source')

    op.drop_index('ix_travel_events_image_memory', table_name='travel_events')
    op.drop_constraint('fk_travel_events_image_memory', 'travel_events', type_='foreignkey')
    op.drop_column('travel_events', 'image_memory_id')

    op.drop_index('ix_travel_plans_cover_memory', table_name='travel_plans')
    op.drop_constraint('ck_travel_plans_cover_zoom', 'travel_plans', type_='check')
    op.drop_constraint('ck_travel_plans_cover_focus', 'travel_plans', type_='check')
    op.drop_column('travel_plans', 'cover_zoom')
    op.drop_column('travel_plans', 'cover_focus_y')
    op.drop_column('travel_plans', 'cover_focus_x')
    op.drop_constraint('fk_travel_plans_cover_memory', 'travel_plans', type_='foreignkey')
    op.drop_column('travel_plans', 'cover_memory_id')
