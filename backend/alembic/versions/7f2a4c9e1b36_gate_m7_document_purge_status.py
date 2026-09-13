"""gate_m7_document_purge_status

Revision ID: 7f2a4c9e1b36
Revises: 60233f506045
Create Date: 2026-09-13 12:00:00.000000

[Gate M7] FR-013文書ウォレット安全化(P0-04是正)。

`DELETE /plans/{plan_id}/documents/{id}` はDB上のsoft delete
(`deleted_at`)のみを行い、storage backend上の実ファイルを一切削除
していなかった(2026-09-13監査 P0-04)。本migrationは、実ファイルの
purge試行結果を再試行可能に追跡するための`documents.purge_status`列
(pending/purged/failed)を追加する、完全にadditiveな変更である。

既存行(過去にsoft deleteされた行を含む)は既定値'pending'となり、
`app/services/document_purge_service.py` の再試行可能なpurgeジョブ
(`scripts/run_document_purge.py`)が後から一括処理できるようにする
(過去データを捏造して'purged'にはしない。実際にpurgeを試みるまでは
'pending'のままとするのが正直な状態)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7f2a4c9e1b36'
down_revision: Union[str, Sequence[str], None] = '60233f506045'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'documents',
        sa.Column('purge_status', sa.String(), nullable=False, server_default='pending'),
    )


def downgrade() -> None:
    op.drop_column('documents', 'purge_status')
