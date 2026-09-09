"""gate_r3_6_documents

Revision ID: c9a1e73d8f42
Revises: b48d9f2c6e17
Create Date: 2026-09-09 06:00:00.000000

[Gate R3-6] FR-013文書ウォレット: documents/document_linksテーブル新規追加。

DOC-05 §6.5/§6.6の documents(id、plan_id、owner_user_id、classification、
document_type、original_filename_ciphertext、storage_key、mime_type、
size、sha256、encryption_key_ref、malware_status、ocr_status、
retention_until、created_at、deleted_at)、document_links(document_id、
entity_type/id、relation_type、display_order)を追加する。

Object Storage連携が未導入のため実ファイルは一切扱わない(スコープ限定の
理由はapp/models/models.pyのDocumentクラス直上コメント参照)。

追加のみ(additive only)。既存テーブル・既存データへの変更は一切含まない。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c9a1e73d8f42'
down_revision: Union[str, Sequence[str], None] = 'b48d9f2c6e17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.create_table(
        'documents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id'), nullable=False,
        ),
        sa.Column(
            'owner_user_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id'), nullable=True,
        ),
        sa.Column('classification', sa.String(), nullable=False, server_default='internal'),
        sa.Column('document_type', sa.String(), nullable=True),
        sa.Column('original_filename_ciphertext', sa.LargeBinary(), nullable=True),
        sa.Column('storage_key', sa.String(), nullable=False),
        sa.Column('mime_type', sa.String(), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('sha256', sa.String(length=64), nullable=True),
        sa.Column('encryption_key_ref', sa.String(), nullable=True),
        sa.Column('malware_status', sa.String(), nullable=False, server_default='not_scanned'),
        sa.Column('ocr_status', sa.String(), nullable=False, server_default='not_requested'),
        sa.Column('retention_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('size IS NULL OR size >= 0', name='ck_documents_size_non_negative'),
    )
    op.create_index('ix_documents_id', 'documents', ['id'])
    op.create_index('ix_documents_plan_id', 'documents', ['plan_id'])

    op.create_table(
        'document_links',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'document_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('documents.id'), nullable=False,
        ),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('relation_type', sa.String(), nullable=False, server_default='attachment'),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_document_links_id', 'document_links', ['id'])
    op.create_index('ix_document_links_document_id', 'document_links', ['document_id'])
    op.create_index('ix_document_links_entity_id', 'document_links', ['entity_id'])


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_index('ix_document_links_entity_id', table_name='document_links')
    op.drop_index('ix_document_links_document_id', table_name='document_links')
    op.drop_index('ix_document_links_id', table_name='document_links')
    op.drop_table('document_links')

    op.drop_index('ix_documents_plan_id', table_name='documents')
    op.drop_index('ix_documents_id', table_name='documents')
    op.drop_table('documents')
