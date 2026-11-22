"""[Gate② FC-045] 文書の差し替え: 版を持ち、前の版を残す(抽出した値は読み取った版を指したまま)。

- documents.version: 版の番号(1 から)
- documents.replaces_document_id: この版が差し替えた前の版(前の版を消すと外れる。SET NULL)
- documents.superseded_at: 新しい版に差し替えられた時刻(一覧には出さず、版の履歴で見る)
- 追加だけ。downgrade は列を消す(版の履歴は失われるが、文書そのものは残る)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d7f3b5c9e1a4"
down_revision = "c5e1a7d3b9f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("documents", sa.Column(
        "replaces_document_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("documents.id", ondelete="SET NULL", name="fk_documents_replaces_document"), nullable=True))
    op.add_column("documents", sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_documents_replaces_document", "documents", ["replaces_document_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_replaces_document", table_name="documents")
    op.drop_column("documents", "superseded_at")
    op.drop_constraint("fk_documents_replaces_document", "documents", type_="foreignkey")
    op.drop_column("documents", "replaces_document_id")
    op.drop_column("documents", "version")
