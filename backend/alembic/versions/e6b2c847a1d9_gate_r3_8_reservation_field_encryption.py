"""gate_r3_8_reservation_field_encryption

Revision ID: e6b2c847a1d9
Revises: d3e5f9a1b264
Create Date: 2026-09-09 08:00:00.000000

[Gate R3-8] FR-010/§6.1/§6.3: reservations.holder_name/contact_phone、
reservation_participants.name/seat/special_requestの暗号化列追加。

DOC-11 §14「暗号化移行は二重読取・新規暗号化・再暗号化・旧列削除」の
expand/contractパターンに従う。本migrationはexpand(新列追加+backfill)
のみを行い、旧平文列は削除しない(additive only原則。将来の非additive
メンテナンスGateでのcontract(旧列削除)は本Gateのスコープ外とする)。

- reservations: holder_name_ciphertext, contact_phone_ciphertext を追加
- reservation_participants: name_ciphertext, seat_ciphertext,
  special_request_ciphertext を追加。既存name列はNOT NULL制約を緩和
  (nullable化。以後の新規行はciphertext列のみへ書き込むため)

backfill: 既存の平文値をENCRYPTION_KEY(app.core.crypto、Gate R2-2と同じ
Fernet)で暗号化し、対応するciphertext列へ格納する。ENCRYPTION_KEYが
未設定の環境ではbackfillをスキップし警告を出力する(migration自体は
失敗させない。API側は起動時にENCRYPTION_KEY必須とはしていないため)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6b2c847a1d9'
down_revision: Union[str, Sequence[str], None] = 'd3e5f9a1b264'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column('reservations', sa.Column('holder_name_ciphertext', sa.LargeBinary(), nullable=True))
    op.add_column('reservations', sa.Column('contact_phone_ciphertext', sa.LargeBinary(), nullable=True))

    op.add_column(
        'reservation_participants', sa.Column('name_ciphertext', sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        'reservation_participants', sa.Column('seat_ciphertext', sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        'reservation_participants',
        sa.Column('special_request_ciphertext', sa.LargeBinary(), nullable=True),
    )
    # 以後の新規行はciphertext列のみへ書き込むため、既存のNOT NULL制約を
    # 緩和する(データは失わない。列自体はadditive only原則により残す)。
    op.alter_column('reservation_participants', 'name', existing_type=sa.String(), nullable=True)

    # --- backfill: 既存平文値を暗号化してciphertext列へ格納する ---
    try:
        from app.core.crypto import encrypt_payload, EncryptionNotConfigured
    except ImportError:
        print("[Gate R3-8] app.core.cryptoをimportできませんでした。backfillをスキップします。")
        return

    bind = op.get_bind()

    try:
        reservations_rows = bind.execute(
            sa.text(
                "SELECT id, holder_name, contact_phone FROM reservations "
                "WHERE holder_name IS NOT NULL OR contact_phone IS NOT NULL"
            )
        ).fetchall()

        for row in reservations_rows:
            holder_ct = encrypt_payload(row.holder_name.encode("utf-8")) if row.holder_name else None
            phone_ct = encrypt_payload(row.contact_phone.encode("utf-8")) if row.contact_phone else None
            bind.execute(
                sa.text(
                    "UPDATE reservations SET holder_name_ciphertext = :h, "
                    "contact_phone_ciphertext = :p WHERE id = :id"
                ),
                {"h": holder_ct, "p": phone_ct, "id": row.id},
            )

        participant_rows = bind.execute(
            sa.text(
                "SELECT id, name, seat, special_request FROM reservation_participants "
                "WHERE name IS NOT NULL OR seat IS NOT NULL OR special_request IS NOT NULL"
            )
        ).fetchall()

        for row in participant_rows:
            name_ct = encrypt_payload(row.name.encode("utf-8")) if row.name else None
            seat_ct = encrypt_payload(row.seat.encode("utf-8")) if row.seat else None
            req_ct = encrypt_payload(row.special_request.encode("utf-8")) if row.special_request else None
            bind.execute(
                sa.text(
                    "UPDATE reservation_participants SET name_ciphertext = :n, "
                    "seat_ciphertext = :s, special_request_ciphertext = :r WHERE id = :id"
                ),
                {"n": name_ct, "s": seat_ct, "r": req_ct, "id": row.id},
            )

        print(
            f"[Gate R3-8 backfill] reservations processed={len(reservations_rows)}, "
            f"participants processed={len(participant_rows)}"
        )
    except EncryptionNotConfigured:
        print(
            "[Gate R3-8] ENCRYPTION_KEYが未設定のため、backfillをスキップしました。"
            "既存の平文列(holder_name/contact_phone/name/seat/special_request)は"
            "そのまま残っています。ENCRYPTION_KEY設定後にバックフィルジョブを"
            "別途実行してください。"
        )


def downgrade() -> None:
    """Downgrade schema。"""

    op.alter_column('reservation_participants', 'name', existing_type=sa.String(), nullable=False)
    op.drop_column('reservation_participants', 'special_request_ciphertext')
    op.drop_column('reservation_participants', 'seat_ciphertext')
    op.drop_column('reservation_participants', 'name_ciphertext')

    op.drop_column('reservations', 'contact_phone_ciphertext')
    op.drop_column('reservations', 'holder_name_ciphertext')
