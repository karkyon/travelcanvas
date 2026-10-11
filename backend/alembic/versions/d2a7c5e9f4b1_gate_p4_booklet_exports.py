"""gate_p4_booklet_exports

Revision ID: d2a7c5e9f4b1
Revises: c9f4a2b7d1e3
Create Date: 2026-10-11 18:00:00.000000

[Gate P4] FR-034 しおり生成 / FR-035 安全な印刷・公開 / FR-046 画像・PDF出力
(DOC-05 export_jobs の成果物なし版)。

新規テーブル booklet_exports を1つ追加するだけの完全にadditiveな変更で、既存テーブル・データには触れない。
PDFや印刷物そのものは保存しない(ブラウザが構造化データから描画する)。版番号・設定・生成元revision、
作成時点の投影(Fernetで暗号化、失効時に消去)、機密情報を含む版の透かし文言・有効期限・失効を記録する。

- 機密情報(予約番号・住所・電話・参加者)を含む版は、透かしと有効期限が必須(CHECK)。
- 版番号はプランごとに1から(UNIQUE)。plan_id は ON DELETE CASCADE(B-012の外部キー方針の試験が検査する)。

downgrade はテーブルを削除する(版の履歴は失われる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd2a7c5e9f4b1'
down_revision: Union[str, Sequence[str], None] = 'c9f4a2b7d1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'booklet_exports',
        sa.Column('id', UUID, primary_key=True, nullable=False),
        sa.Column('plan_id', UUID, sa.ForeignKey('travel_plans.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', UUID, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('format', sa.String(length=5), nullable=False),
        sa.Column('theme', sa.String(length=12), nullable=False),
        sa.Column('density', sa.String(length=7), nullable=False),
        sa.Column('sections', sa.JSON(), nullable=False),
        sa.Column('includes', sa.JSON(), nullable=False),
        sa.Column('contains_sensitive', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('watermark_text', sa.String(length=200), nullable=True),
        sa.Column('valid_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('input_revision', sa.Integer(), nullable=False),
        sa.Column('policy_version', sa.String(length=20), nullable=False),
        sa.Column('snapshot_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('status', sa.String(length=7), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.UniqueConstraint('plan_id', 'version_no', name='uq_booklet_exports_plan_version'),
        sa.CheckConstraint("format IN ('web','print')", name='ck_booklet_exports_format'),
        sa.CheckConstraint(
            "theme IN ('cute','simple','family','school','business','accessible','mono')",
            name='ck_booklet_exports_theme',
        ),
        sa.CheckConstraint("density IN ('normal','compact')", name='ck_booklet_exports_density'),
        sa.CheckConstraint("status IN ('active','revoked')", name='ck_booklet_exports_status'),
        sa.CheckConstraint("(status = 'revoked') = (revoked_at IS NOT NULL)", name='ck_booklet_exports_revoked_at'),
        sa.CheckConstraint(
            "(status = 'active') = (snapshot_ciphertext IS NOT NULL)", name='ck_booklet_exports_snapshot',
        ),
        sa.CheckConstraint(
            "NOT contains_sensitive OR (watermark_text IS NOT NULL AND valid_until IS NOT NULL)",
            name='ck_booklet_exports_sensitive_guard',
        ),
        sa.CheckConstraint('version_no >= 1', name='ck_booklet_exports_version_no'),
    )
    op.create_index('ix_booklet_exports_id', 'booklet_exports', ['id'])


def downgrade() -> None:
    op.drop_index('ix_booklet_exports_id', table_name='booklet_exports')
    op.drop_table('booklet_exports')
