"""gate_p1_packing_and_preparation

Revision ID: a4d7e2c9b1f6
Revises: e5b9c2d8f341
Create Date: 2026-10-02 18:00:00.000000

[Gate P1] FR-025 持ち物 / FR-026 準備タスク(DOC-05 §8.5 packing_items / preparation_tasks)。

新規テーブル2つを追加するだけの完全にadditiveな変更で、既存テーブル・既存データには
一切触れない(backfill不要)。

- packing_items: scope='personal'(本人だけの持ち物)は名前・メモを平文列に持たず
  payload_ciphertext(Fernet)だけに保存する(FC-070 薬・健康用品は本人限定)。
  採用した候補(suggestion_key)は、有効な行の中でプラン(共有)/本人(個人)ごとに一意。
- preparation_tasks: 完了条件・担当者・期限・状態。readiness_key(レディネス項目から
  作ったタスク)は有効な行の中でプランごとに一意。関連対象(related_type/related_id)は
  外部キーにしない(予定・予約などの個別削除を妨げないため。表示時に存在を確認する)。
- どちらも plan_id は ON DELETE CASCADE(プランの完全削除を妨げない。Gate B-012の
  外部キー削除方針の試験が検査する)。users への参照は削除方針を持たない
  (users はプランから連鎖削除されない)。

downgrade はテーブルを削除する(持ち物・タスクのデータは失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a4d7e2c9b1f6'
down_revision: Union[str, Sequence[str], None] = 'e5b9c2d8f341'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'packing_items',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('owner_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scope', sa.String(length=8), nullable=False),
        sa.Column('assignee_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('name', sa.String(length=120), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('payload_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_required', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('source', sa.String(length=10), nullable=False),
        sa.Column('suggestion_key', sa.String(length=40), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("scope IN ('shared','personal')", name='ck_packing_items_scope'),
        sa.CheckConstraint(
            "(scope = 'personal' AND payload_ciphertext IS NOT NULL AND name IS NULL AND note IS NULL"
            " AND assignee_user_id IS NULL)"
            " OR (scope = 'shared' AND payload_ciphertext IS NULL AND name IS NOT NULL)",
            name='ck_packing_items_scope_payload',
        ),
        sa.CheckConstraint(
            "category IN ('clothing','toiletries','health','documents','electronics','money','gear','other')",
            name='ck_packing_items_category',
        ),
        sa.CheckConstraint('quantity BETWEEN 1 AND 999', name='ck_packing_items_quantity'),
        sa.CheckConstraint(
            "status IN ('to_prepare','to_buy','packed','after_use')", name='ck_packing_items_status',
        ),
        sa.CheckConstraint("source IN ('manual','suggested')", name='ck_packing_items_source'),
        sa.CheckConstraint(
            "(source = 'suggested') = (suggestion_key IS NOT NULL)", name='ck_packing_items_suggestion_key',
        ),
    )
    op.create_index('ix_packing_items_id', 'packing_items', ['id'])
    op.create_index('ix_packing_items_plan_deleted', 'packing_items', ['plan_id', 'deleted_at'])
    op.create_index(
        'uq_packing_items_shared_suggestion', 'packing_items', ['plan_id', 'suggestion_key'], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND scope = 'shared' AND suggestion_key IS NOT NULL"),
    )
    op.create_index(
        'uq_packing_items_personal_suggestion', 'packing_items', ['plan_id', 'owner_user_id', 'suggestion_key'],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND scope = 'personal' AND suggestion_key IS NOT NULL"),
    )

    op.create_table(
        'preparation_tasks',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('assignee_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.String(length=2000), nullable=True),
        sa.Column('completion_criteria', sa.String(length=500), nullable=True),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=4), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('related_type', sa.String(length=20), nullable=True),
        sa.Column('related_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('readiness_key', sa.String(length=80), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('open','done')", name='ck_preparation_tasks_status'),
        sa.CheckConstraint("(status = 'done') = (completed_at IS NOT NULL)", name='ck_preparation_tasks_completed'),
        sa.CheckConstraint(
            "related_type IS NULL OR related_type IN ('event','reservation','segment','document','packing_item')",
            name='ck_preparation_tasks_related_type',
        ),
        sa.CheckConstraint("(related_type IS NULL) = (related_id IS NULL)", name='ck_preparation_tasks_related_pair'),
    )
    op.create_index('ix_preparation_tasks_id', 'preparation_tasks', ['id'])
    op.create_index('ix_preparation_tasks_plan_deleted', 'preparation_tasks', ['plan_id', 'deleted_at'])
    op.create_index(
        'uq_preparation_tasks_readiness_key', 'preparation_tasks', ['plan_id', 'readiness_key'], unique=True,
        postgresql_where=sa.text('deleted_at IS NULL AND readiness_key IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_preparation_tasks_readiness_key', table_name='preparation_tasks')
    op.drop_index('ix_preparation_tasks_plan_deleted', table_name='preparation_tasks')
    op.drop_index('ix_preparation_tasks_id', table_name='preparation_tasks')
    op.drop_table('preparation_tasks')
    op.drop_index('uq_packing_items_personal_suggestion', table_name='packing_items')
    op.drop_index('uq_packing_items_shared_suggestion', table_name='packing_items')
    op.drop_index('ix_packing_items_plan_deleted', table_name='packing_items')
    op.drop_index('ix_packing_items_id', table_name='packing_items')
    op.drop_table('packing_items')
