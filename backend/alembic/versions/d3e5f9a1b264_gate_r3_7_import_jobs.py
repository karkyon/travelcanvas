"""gate_r3_7_import_jobs

Revision ID: d3e5f9a1b264
Revises: c9a1e73d8f42
Create Date: 2026-09-09 07:00:00.000000

[Gate R3-7] FR-011予約取込: import_jobs/extraction_candidatesテーブル新規追加。

DOC-05 §6.7の import_jobs(ジョブ状態、provider、原本、モデル、同意、
開始終了、エラー)、extraction_candidates(field_path、
candidate_value_ciphertext、confidence、evidence_locator、review_status、
reviewed_by/at)を追加する。

AI/OCR provider未導入のためuploaded/scanning/extractingへの自動遷移は
実装しない(スコープ限定の理由はapp/models/models.pyのImportJobクラス
直上コメント参照)。

追加のみ(additive only)。既存テーブル・既存データへの変更は一切含まない。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd3e5f9a1b264'
down_revision: Union[str, Sequence[str], None] = 'c9a1e73d8f42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'import_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id'), nullable=False,
        ),
        sa.Column(
            'document_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('documents.id'), nullable=True,
        ),
        sa.Column(
            'created_by_user_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id'), nullable=True,
        ),
        sa.Column('provider', sa.String(), nullable=False, server_default='manual'),
        sa.Column('status', sa.String(), nullable=False, server_default='review_required'),
        sa.Column('consent_given', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column(
            'result_reservation_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('reservations.id'), nullable=True,
        ),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_import_jobs_id', 'import_jobs', ['id'])
    op.create_index('ix_import_jobs_plan_id', 'import_jobs', ['plan_id'])

    op.create_table(
        'extraction_candidates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'import_job_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('import_jobs.id'), nullable=False,
        ),
        sa.Column('field_path', sa.String(), nullable=False),
        sa.Column('candidate_value_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False, server_default='1.0'),
        sa.Column('evidence_locator', sa.String(), nullable=True),
        sa.Column('review_status', sa.String(), nullable=False, server_default='pending'),
        sa.Column(
            'reviewed_by_user_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id'), nullable=True,
        ),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            'confidence >= 0 AND confidence <= 1',
            name='ck_extraction_candidates_confidence_range',
        ),
    )
    op.create_index('ix_extraction_candidates_id', 'extraction_candidates', ['id'])
    op.create_index(
        'ix_extraction_candidates_import_job_id', 'extraction_candidates', ['import_job_id'],
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_extraction_candidates_import_job_id', table_name='extraction_candidates')
    op.drop_index('ix_extraction_candidates_id', table_name='extraction_candidates')
    op.drop_table('extraction_candidates')

    op.drop_index('ix_import_jobs_plan_id', table_name='import_jobs')
    op.drop_index('ix_import_jobs_id', table_name='import_jobs')
    op.drop_table('import_jobs')
