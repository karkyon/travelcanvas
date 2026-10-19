"""gate_c1_private_profile

Revision ID: a9d4e7c2f8b3
Revises: f2a6c8e4b1d7
Create Date: 2026-10-19 10:00:00.000000

[Gate C1] FR-023 秘匿プロフィール・制約(DOC-02)。

- user_private_profiles(新規): 利用者ごとの非公開の条件(朝の開始・夜の終わり・1日の移動の上限・食事の間隔・
  旅行の予算の上限・避けたいこと・避けたい移動手段)。内容は1つの暗号文(Fernet)だけで持ち、平文の列を持たない
  (運用管理者にも平文を見せない)。
- private_profile_links(新規): どの旅行にプロフィールを適用しているか(旅行・利用者)。plan_id は ON DELETE CASCADE(B-012)。
- constraints.profile_item_id(追加): プロフィールから作った秘匿制約の印(プロフィールの項目の ID)。

FR-020 の「同じ旅行を開いている人・編集中」は短い間だけの情報のため DB に持たない(Redis、届かなければプロセス内)。

downgrade: プロフィールから作った秘匿制約を消し(削除済みにする)、追加した列・表を消す。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a9d4e7c2f8b3'
down_revision: Union[str, Sequence[str], None] = 'f2a6c8e4b1d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'user_private_profiles',
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, nullable=False),
        sa.Column('items_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'private_profile_links',
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), primary_key=True,
                  nullable=False),
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_private_profile_links_user_id', 'private_profile_links', ['user_id'])
    op.add_column('constraints', sa.Column('profile_item_id', sa.String(length=36), nullable=True))
    op.create_index('ix_constraints_profile_item', 'constraints', ['plan_id', 'owner_user_id', 'profile_item_id'])


def downgrade() -> None:
    op.execute("UPDATE constraints SET deleted_at = now(), revision = revision + 1 "
               "WHERE profile_item_id IS NOT NULL AND deleted_at IS NULL")
    op.drop_index('ix_constraints_profile_item', table_name='constraints')
    op.drop_column('constraints', 'profile_item_id')
    op.drop_index('ix_private_profile_links_user_id', table_name='private_profile_links')
    op.drop_table('private_profile_links')
    op.drop_table('user_private_profiles')
