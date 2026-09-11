"""gate_r3_14_suffix_lookup_hash

Revision ID: cc0e6eee0159
Revises: 5d57e3208d2a
Create Date: 2026-09-09 14:00:00.000000

[Gate R3-14] DOC-04 SC-10/SC-17 / DOC-08 §19 POC-03「blind indexで予約番号
末尾検索」対応。reservations.confirmation_numberの末尾4文字専用HMAC blind
indexを追加する。

Gate R3-13で追加した`confirmation_number_lookup_hash`(完全一致用)とは
別列・別ドメイン(app/core/crypto.py compute_suffix_lookup_hash参照。
入力に"SUFFIX4:"タグを付与してからHMAC計算するため、同じ鍵を使っても
完全一致索引の値と混同できない)。

additive only(DOC-11 §14 expand/contractパターンのexpand)。

backfill: 既存のconfirmation_number_ciphertextをENCRYPTION_KEYで復号し、
末尾4文字をLOOKUP_INDEX_KEYでHMAC化してsuffix_lookup_hash列へ格納する。
正規化後の文字列が4文字未満の場合は索引を作らない(Gate R3-13と同じ方針:
短い予約番号への末尾一致は事実上の完全一致に近づき、マスク表示が提供する
秘匿性を損なうため)。ENCRYPTION_KEYまたはLOOKUP_INDEX_KEYが未設定の環境
ではbackfillをスキップする(Gate R3-13と同じ方針)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'cc0e6eee0159'
down_revision: Union[str, Sequence[str], None] = '5d57e3208d2a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column(
        'reservations',
        sa.Column('confirmation_number_suffix_lookup_hash', sa.String(length=64), nullable=True),
    )
    op.create_index(
        'ix_reservations_confirmation_number_suffix_lookup_hash',
        'reservations',
        ['confirmation_number_suffix_lookup_hash'],
    )

    # --- backfill ---
    try:
        from app.core.crypto import (
            decrypt_payload,
            compute_suffix_lookup_hash,
            EncryptionNotConfigured,
            LookupIndexNotConfigured,
        )
    except ImportError:
        print("[Gate R3-14] app.core.cryptoをimportできませんでした。backfillをスキップします。")
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
                continue
            suffix_hash = compute_suffix_lookup_hash(plaintext)
            if suffix_hash is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE reservations SET confirmation_number_suffix_lookup_hash = :h "
                    "WHERE id = :id"
                ),
                {"h": suffix_hash, "id": row.id},
            )
            processed += 1

        print(f"[Gate R3-14 backfill] reservations processed={processed}/{len(rows)}")
    except LookupIndexNotConfigured:
        print(
            "[Gate R3-14] LOOKUP_INDEX_KEYが未設定のため、backfillをスキップしました。"
            "既存予約の末尾検索は、LOOKUP_INDEX_KEY設定後に別途バックフィルジョブを"
            "実行するまで機能しません(新規作成・更新分は以後正常に索引が設定されます)。"
        )


def downgrade() -> None:
    """Downgrade schema。"""

    op.drop_index(
        'ix_reservations_confirmation_number_suffix_lookup_hash', table_name='reservations'
    )
    op.drop_column('reservations', 'confirmation_number_suffix_lookup_hash')
