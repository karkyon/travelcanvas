"""gate_r3_15_participant_name_lookup_hash

Revision ID: 725cce80af7c
Revises: cc0e6eee0159
Create Date: 2026-09-09 15:30:00.000000

[Gate R3-15] DOC-11 §6.3: reservation_participants.nameに対する完全一致
HMAC blind indexの追加。confirmation_number用(Gate R3-13)とは別ドメイン
(app/core/crypto.py compute_participant_name_lookup_hash、
"PARTICIPANT_NAME:"タグ)。

additive only(DOC-11 §14 expand/contractパターンのexpand)。

backfill: 既存のname_ciphertextをENCRYPTION_KEYで復号し、
LOOKUP_INDEX_KEYでHMAC化してname_lookup_hash列へ格納する。
ENCRYPTION_KEYまたはLOOKUP_INDEX_KEYが未設定の環境ではbackfillを
スキップする(Gate R3-13/14と同じ方針)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '725cce80af7c'
down_revision: Union[str, Sequence[str], None] = 'cc0e6eee0159'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column(
        'reservation_participants',
        sa.Column('name_lookup_hash', sa.String(length=64), nullable=True),
    )
    op.create_index(
        'ix_reservation_participants_name_lookup_hash',
        'reservation_participants',
        ['name_lookup_hash'],
    )

    # --- backfill ---
    try:
        from app.core.crypto import (
            decrypt_payload,
            compute_participant_name_lookup_hash,
            EncryptionNotConfigured,
            LookupIndexNotConfigured,
        )
    except ImportError:
        print("[Gate R3-15] app.core.cryptoをimportできませんでした。backfillをスキップします。")
        return

    bind = op.get_bind()

    try:
        rows = bind.execute(
            sa.text(
                "SELECT id, name_ciphertext FROM reservation_participants "
                "WHERE name_ciphertext IS NOT NULL"
            )
        ).fetchall()

        processed = 0
        for row in rows:
            try:
                ciphertext = bytes(row.name_ciphertext)
                plaintext = decrypt_payload(ciphertext).decode("utf-8")
            except (EncryptionNotConfigured, ValueError):
                continue
            name_hash = compute_participant_name_lookup_hash(plaintext)
            bind.execute(
                sa.text(
                    "UPDATE reservation_participants SET name_lookup_hash = :h WHERE id = :id"
                ),
                {"h": name_hash, "id": row.id},
            )
            processed += 1

        print(f"[Gate R3-15 backfill] participants processed={processed}/{len(rows)}")
    except LookupIndexNotConfigured:
        print(
            "[Gate R3-15] LOOKUP_INDEX_KEYが未設定のため、backfillをスキップしました。"
            "既存参加者の氏名検索は、LOOKUP_INDEX_KEY設定後に別途バックフィルジョブを"
            "実行するまで機能しません(新規作成・更新分は以後正常に索引が設定されます)。"
        )


def downgrade() -> None:
    """Downgrade schema。"""

    op.drop_index('ix_reservation_participants_name_lookup_hash', table_name='reservation_participants')
    op.drop_column('reservation_participants', 'name_lookup_hash')
