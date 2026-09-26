"""gate_l2_constraints

Revision ID: b7d41e9c2a53
Revises: 7f2a4c9e1b36
Create Date: 2026-09-26 17:00:00.000000

[Gate L2] FR-016 制約管理(DOC-05 §7.3 constraints)。

新規テーブル`constraints`を追加するだけの完全にadditiveな変更で、既存テーブル・
既存データには一切触れない(backfill不要)。

- privacy_level='private' の制約は題名・値を平文列に持たず value_ciphertext
  (Fernet、app/core/crypto.py)だけに保存する。reasonは常に暗号化する
  (DOC-05 §19: constraints.reason = R、本人のみ)。
- DOC-05 §17 の CHECK(hardならweight不要)に加え、soft の重み範囲、scopeの
  整合、private時に平文列が空であること、有効期間の前後関係をDBで強制する。
- plan_id は ON DELETE CASCADE(プラン削除を制約が妨げない)。scope_id は
  day/event の削除に追従させるため外部キーにしない(アプリ側で検証)。

downgrade はテーブルを削除する(制約データは失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b7d41e9c2a53'
down_revision: Union[str, Sequence[str], None] = '7f2a4c9e1b36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'constraints',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('owner_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scope_type', sa.String(length=10), nullable=False),
        sa.Column('scope_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('constraint_type', sa.String(length=30), nullable=False),
        sa.Column('hardness', sa.String(length=4), nullable=False),
        sa.Column('operator', sa.String(length=12), nullable=False),
        sa.Column('weight', sa.Integer(), nullable=True),
        sa.Column('privacy_level', sa.String(length=7), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('value_json', sa.JSON(), nullable=True),
        sa.Column('value_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('reason_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('active_from', sa.DateTime(timezone=True), nullable=True),
        sa.Column('active_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("scope_type IN ('plan','day','event','member')", name='ck_constraints_scope_type'),
        sa.CheckConstraint("(scope_type = 'plan') = (scope_id IS NULL)", name='ck_constraints_scope_id'),
        sa.CheckConstraint("hardness IN ('hard','soft')", name='ck_constraints_hardness'),
        sa.CheckConstraint(
            "(hardness = 'hard' AND weight IS NULL) OR "
            "(hardness = 'soft' AND weight IS NOT NULL AND weight BETWEEN 1 AND 100)",
            name='ck_constraints_weight',
        ),
        sa.CheckConstraint("privacy_level IN ('shared','private')", name='ck_constraints_privacy_level'),
        sa.CheckConstraint(
            "(privacy_level = 'private' AND value_ciphertext IS NOT NULL AND title IS NULL AND value_json IS NULL)"
            " OR (privacy_level = 'shared' AND value_ciphertext IS NULL AND title IS NOT NULL)",
            name='ck_constraints_privacy_payload',
        ),
        sa.CheckConstraint(
            'active_from IS NULL OR active_to IS NULL OR active_from < active_to',
            name='ck_constraints_active_window',
        ),
    )
    op.create_index('ix_constraints_id', 'constraints', ['id'])
    op.create_index('ix_constraints_plan_deleted', 'constraints', ['plan_id', 'deleted_at'])


def downgrade() -> None:
    op.drop_index('ix_constraints_plan_deleted', table_name='constraints')
    op.drop_index('ix_constraints_id', table_name='constraints')
    op.drop_table('constraints')
