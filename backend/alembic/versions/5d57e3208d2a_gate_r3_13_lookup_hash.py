"""gate_r3_13_lookup_hash

Revision ID: 5d57e3208d2a
Revises: e6b2c847a1d9
Create Date: 2026-09-09 12:00:00.000000

[Gate R3-13] DOC-11 §6.3 / DOC-08 §19: reservations.confirmation_numberに
対するHMAC blind index(盲検索index)の追加。

confirmation_numberはGate R3-0からFernet field encryptionで暗号化されて
おり、平文でのWHERE検索ができない(ハンドオフ資料§5参照)。本migrationは
決定的なHMAC-SHA256ハッシュ列`confirmation_number_lookup_hash`を追加し、
完全一致検索(app/api/v1/reservations.py の
GET /plans/{plan_id}/reservations/search)を可能にする。

additive only(DOC-11 §14 expand/contractパターンのexpand)。既存の
confirmation_number_ciphertext/masked列には一切触れない。

backfill: 既存のconfirmation_number_ciphertextをENCRYPTION_KEYで復号し、
LOOKUP_INDEX_KEYでHMACを計算してlookup_hash列へ格納する。ENCRYPTION_KEY
またはLOOKUP_INDEX_KEYのいずれかが未設定の環境ではbackfillをスキップし
警告を出力する(migration自体は失敗させない。Gate R3-8と同じ方針)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5d57e3208d2a'
down_revision: Union[str, Sequence[str], None] = 'e6b2c847a1d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column(
        'reservations',
        sa.Column('confirmation_number_lookup_hash', sa.String(length=64), nullable=True),
    )
    op.create_index(
        'ix_reservations_confirmation_number_lookup_hash',
        'reservations',
        ['confirmation_number_lookup_hash'],
    )

    # --- backfill: 既存ciphertextを復号し、HMAC blind indexを計算する ---
    try:
        from app.core.crypto import (
            decrypt_payload,
            compute_lookup_hash,
            EncryptionNotConfigured,
            LookupIndexNotConfigured,
        )
    except ImportError:
        print("[Gate R3-13] app.core.cryptoをimportできませんでした。backfillをスキップします。")
        return

    bind = op.get_bind()

    try:
        rows = bind.execute(
            sa.text(
                "SELECT id, confirmation_number_ciphertext FROM reservations "
                "WHERE confirmation_number_ciphertext IS NOT NULL"
            )
        ).fetchall()

        processed = 0
        for row in rows:
            try:
                ciphertext = bytes(row.confirmation_number_ciphertext)
                plaintext = decrypt_payload(ciphertext).decode("utf-8")
            except (EncryptionNotConfigured, ValueError):
                # ENCRYPTION_KEY未設定、または復号失敗。この行のbackfillのみ
                # スキップし、他の行の処理は続行する。
                continue
            lookup_hash = compute_lookup_hash(plaintext)
            bind.execute(
                sa.text(
                    "UPDATE reservations SET confirmation_number_lookup_hash = :h WHERE id = :id"
                ),
                {"h": lookup_hash, "id": row.id},
            )
            processed += 1

        print(f"[Gate R3-13 backfill] reservations processed={processed}/{len(rows)}")
    except LookupIndexNotConfigured:
        print(
            "[Gate R3-13] LOOKUP_INDEX_KEYが未設定のため、backfillをスキップしました。"
            "既存予約のconfirmation_number検索は、LOOKUP_INDEX_KEY設定後に別途"
            "バックフィルジョブを実行するまで機能しません(新規作成・更新分は"
            "以後正常にlookup_hashが設定されます)。"
        )


def downgrade() -> None:
    """Downgrade schema。"""

    op.drop_index('ix_reservations_confirmation_number_lookup_hash', table_name='reservations')
    op.drop_column('reservations', 'confirmation_number_lookup_hash')
