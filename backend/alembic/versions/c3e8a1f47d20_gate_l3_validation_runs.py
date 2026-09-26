"""gate_l3_validation_runs

Revision ID: c3e8a1f47d20
Revises: b7d41e9c2a53
Create Date: 2026-09-26 19:00:00.000000

[Gate L3] FR-017 実行可能性検証(DOC-05 §7.4 validation_runs / validation_issues)。

新規テーブル2つを追加するだけの完全にadditiveな変更で、既存テーブル・既存データには
触れない(backfill不要)。

- validation_runs: 検証1回分のスナップショット(入力revision・入力ハッシュ・件数・
  制約ごとの結果)。plan_id は ON DELETE CASCADE。
- validation_issues: 違反(violation)と検証不能(unverified)。run_id・constraint_id は
  ON DELETE CASCADE。秘匿制約の値は保存しない(アプリ側の規則。CHECKでは秘匿制約の
  問題に制約IDと作成者IDが必ずあることを強制する)。

downgrade は2テーブルを削除する(検証結果は再検証で再生成できる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c3e8a1f47d20'
down_revision: Union[str, Sequence[str], None] = 'b7d41e9c2a53'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'validation_runs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('input_revision', sa.Integer(), nullable=False),
        sa.Column('input_fingerprint', sa.String(length=64), nullable=False),
        sa.Column('algorithm_version', sa.String(length=30), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('error_count', sa.Integer(), nullable=False),
        sa.Column('warning_count', sa.Integer(), nullable=False),
        sa.Column('info_count', sa.Integer(), nullable=False),
        sa.Column('unverified_count', sa.Integer(), nullable=False),
        sa.Column('summary_json', sa.JSON(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.CheckConstraint("status IN ('completed','failed')", name='ck_validation_runs_status'),
    )
    op.create_index('ix_validation_runs_id', 'validation_runs', ['id'])
    op.create_index('ix_validation_runs_plan_created', 'validation_runs', ['plan_id', 'created_at'])

    op.create_table(
        'validation_issues',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            'run_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('validation_runs.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('severity', sa.String(length=7), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('entity_type', sa.String(length=20), nullable=True),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('entity_label', sa.String(length=300), nullable=True),
        sa.Column('day_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            'constraint_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('constraints.id', ondelete='CASCADE'), nullable=True,
        ),
        sa.Column('constraint_owner_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_private_constraint', sa.Boolean(), nullable=False),
        sa.Column('evidence_json', sa.JSON(), nullable=True),
        sa.Column('suggestion_json', sa.JSON(), nullable=True),
        sa.CheckConstraint("kind IN ('violation','unverified')", name='ck_validation_issues_kind'),
        sa.CheckConstraint("severity IN ('ERROR','WARNING','INFO')", name='ck_validation_issues_severity'),
        sa.CheckConstraint(
            'is_private_constraint = false OR (constraint_id IS NOT NULL AND constraint_owner_user_id IS NOT NULL)',
            name='ck_validation_issues_private_owner',
        ),
    )
    op.create_index('ix_validation_issues_id', 'validation_issues', ['id'])
    op.create_index('ix_validation_issues_run', 'validation_issues', ['run_id', 'sort_order'])


def downgrade() -> None:
    op.drop_index('ix_validation_issues_run', table_name='validation_issues')
    op.drop_index('ix_validation_issues_id', table_name='validation_issues')
    op.drop_table('validation_issues')
    op.drop_index('ix_validation_runs_plan_created', table_name='validation_runs')
    op.drop_index('ix_validation_runs_id', table_name='validation_runs')
    op.drop_table('validation_runs')
