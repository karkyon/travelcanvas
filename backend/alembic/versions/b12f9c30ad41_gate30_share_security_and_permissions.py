"""gate30_share_security_and_permissions

Revision ID: b12f9c30ad41
Revises: 7a025eaa9ef0
Create Date: 2026-09-04 00:00:00.000000

[Gate #30] 共有・招待・権限を実際に成立させるための変更。

1. plan_share_links.token を平文でDBに保持していた実バグ(監査指摘: token
   はDBへ平文保存しない)を修正する。token_hash(SHA-256)のみを保存し、
   生トークンは作成時のレスポンスで一度だけ返す設計へ変更する。
   既存行があれば平文tokenからハッシュをbackfillしてからtoken列を削除する
   (このアプリはまだ本番投入前で実データは無い想定だが、安全のため
   backfillしてから削除する変更順序にする)。
2. 失効(revoked_at)・使用回数上限(max_uses/use_count)・パスコード
   (passcode_hash)列を追加し、公開閲覧解決endpointで検証できるように
   する。
3. plan_collaborators.decided_at を追加し、招待のaccept/decline日時を
   記録できるようにする(Gate #30で新設するaccept/declineエンドポイント
   が使用する)。
"""
import hashlib
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b12f9c30ad41'
down_revision: Union[str, Sequence[str], None] = '7a025eaa9ef0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ===== plan_share_links =====
    op.add_column('plan_share_links', sa.Column('token_hash', sa.String(), nullable=True))
    op.add_column('plan_share_links', sa.Column('token_prefix', sa.String(length=8), nullable=True))
    op.add_column('plan_share_links', sa.Column('passcode_hash', sa.String(), nullable=True))
    op.add_column('plan_share_links', sa.Column('max_uses', sa.Integer(), nullable=True))
    op.add_column(
        'plan_share_links',
        sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column('plan_share_links', sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True))

    # 既存の平文tokenからtoken_hash/token_prefixをbackfillする。
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, token FROM plan_share_links")).fetchall()
    for row in rows:
        raw_token = row.token
        if not raw_token:
            continue
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        token_prefix = raw_token[:8]
        bind.execute(
            sa.text("UPDATE plan_share_links SET token_hash = :h, token_prefix = :p WHERE id = :rid"),
            {"h": token_hash, "p": token_prefix, "rid": row.id},
        )

    op.drop_index(op.f('ix_plan_share_links_token'), table_name='plan_share_links')
    op.drop_column('plan_share_links', 'token')
    op.alter_column('plan_share_links', 'token_hash', nullable=False)
    op.alter_column('plan_share_links', 'token_prefix', nullable=False)
    op.create_index(
        op.f('ix_plan_share_links_token_hash'), 'plan_share_links', ['token_hash'], unique=True
    )

    # ===== plan_collaborators =====
    op.add_column('plan_collaborators', sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('plan_collaborators', 'decided_at')

    op.drop_index(op.f('ix_plan_share_links_token_hash'), table_name='plan_share_links')
    op.add_column('plan_share_links', sa.Column('token', sa.String(), nullable=True))

    # token_hashは不可逆なため生値は復元できない。ダウングレード時は
    # 一意なプレースホルダ値を入れる(既存の共有リンクは再発行が必要になる)。
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE plan_share_links SET token = 'revoked-' || id::text"))

    op.alter_column('plan_share_links', 'token', nullable=False)
    op.create_index(op.f('ix_plan_share_links_token'), 'plan_share_links', ['token'], unique=True)

    op.drop_column('plan_share_links', 'revoked_at')
    op.drop_column('plan_share_links', 'use_count')
    op.drop_column('plan_share_links', 'max_uses')
    op.drop_column('plan_share_links', 'passcode_hash')
    op.drop_column('plan_share_links', 'token_prefix')
    op.drop_column('plan_share_links', 'token_hash')
