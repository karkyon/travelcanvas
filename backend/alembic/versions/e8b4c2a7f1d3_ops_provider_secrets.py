"""ops_provider_secrets

Revision ID: e8b4c2a7f1d3
Revises: d5f9b2c8e1a3
Create Date: 2026-10-30 20:30:00.000000

[Gate OpsSecrets] 運用コンソールから外部 API の鍵を登録する(利用者の承認 2026-10-30)。

- provider_secrets: slot(openai_api_key など)ごとの版。鍵は ENCRYPTION_KEY で暗号化した secret_ciphertext だけを持つ
  (列の名前が *_ciphertext なので、鍵の点検・掛け直し(tcops.py keys)の対象になる)。有効な版は slot ごとに1つ。

既存の表・列は変えない。downgrade は表を消す(登録した鍵も消える。.env の値に戻る)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e8b4c2a7f1d3'
down_revision: Union[str, Sequence[str], None] = 'd5f9b2c8e1a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "provider_secrets",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("slot", sa.String(40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("secret_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("last4", sa.String(4), nullable=False),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("disabled_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("slot", "version", name="uq_provider_secrets_slot_version"),
        sa.CheckConstraint("status IN ('active', 'superseded', 'disabled')", name="ck_provider_secrets_status"),
    )
    op.create_index("uq_provider_secrets_one_active", "provider_secrets", ["slot"], unique=True,
                    postgresql_where=sa.text("status = 'active'"))


def downgrade() -> None:
    op.drop_index("uq_provider_secrets_one_active", table_name="provider_secrets")
    op.drop_table("provider_secrets")
