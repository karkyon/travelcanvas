"""ops_provider_secrets_fk_indexes

Revision ID: f2a6d8c4b9e1
Revises: e8b4c2a7f1d3
Create Date: 2026-10-30 21:00:00.000000

[Gate OpsSecrets] provider_secrets の外部キー(created_by・disabled_by)に索引を足す(全ての外部キーに索引、Gate G3 の決まり)。
e8b4c2a7f1d3 を先に入れた環境(omega-dev2)でもそのまま上がるよう、別の版にした。データは変えない。
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f2a6d8c4b9e1'
down_revision: Union[str, Sequence[str], None] = 'e8b4c2a7f1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_provider_secrets_created_by", "provider_secrets", ["created_by"])
    op.create_index("ix_provider_secrets_disabled_by", "provider_secrets", ["disabled_by"])


def downgrade() -> None:
    op.drop_index("ix_provider_secrets_disabled_by", table_name="provider_secrets")
    op.drop_index("ix_provider_secrets_created_by", table_name="provider_secrets")
