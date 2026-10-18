"""gate_s11_user_mfa

Revision ID: e8b4c2a6d1f9
Revises: d3f9b1c5e7a4
Create Date: 2026-10-19 05:00:00.000000

[Gate S11] SEC-06 多要素認証(TOTP: 認証アプリの6桁のワンタイムパスワード)。管理者は必須、会員は任意。

新規テーブル user_mfa を1つ追加するだけの完全に additive な変更で、既存テーブル・データには触れない。
- TOTP の秘密は ENCRYPTION_KEY で暗号化して保存する(*_ciphertext の bytea。tcops の復号確認の対象になる)。
- 回復コードは平文で保存しない(PBKDF2 のハッシュの一覧だけ)。
- last_used_step は同じワンタイムパスワードの使い回し(リプレイ)を防ぐため、最後に受け付けた時間区切りを持つ。
- users の行が消えた時は一緒に消える(ON DELETE CASCADE)。

downgrade はテーブルを削除する(全員の多要素認証の設定が失われ、管理者は設定し直しになる)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e8b4c2a6d1f9'
down_revision: Union[str, Sequence[str], None] = 'd3f9b1c5e7a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        'user_mfa',
        sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, nullable=False),
        sa.Column('method', sa.String(length=8), nullable=False, server_default='totp'),
        sa.Column('totp_secret_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_step', sa.BigInteger(), nullable=True),
        sa.Column('recovery_code_hashes', postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
        sa.Column('recovery_salt', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("method IN ('totp')", name='ck_user_mfa_method'),
    )


def downgrade() -> None:
    op.drop_table('user_mfa')
