"""gate_r3_16_contract_plaintext_columns

Revision ID: 29f832c03c75
Revises: 725cce80af7c
Create Date: 2026-09-11 09:00:00.000000

[Gate R3-16] DOC-11 §14 expand/contractパターンのcontractフェーズ。
Gate R3-8で追加したFernet field encryption列(*_ciphertext)は既に正本と
して以後の作成・更新すべてで使われている(app/api/v1/reservations.py)。
本migrationは、その時点までexpandのため残していた旧平文列を削除する:

- reservations.holder_name
- reservations.contact_phone
- reservation_participants.name
- reservation_participants.seat
- reservation_participants.special_request

【重要: 破壊的migration】このmigrationは非additiveであり、実行前に
必ず次を確認する:

1. 対象の平文列にNOT NULL値が入っているのに対応するciphertext列が
   NULLの行が1件でも存在する場合、そのciphertext化されていないデータは
   本migrationで失われる。これを防ぐため、upgrade()の冒頭で
   pre-flightチェックを行い、該当行が1件でもあればRuntimeErrorを送出して
   migration全体を中断する(alembicのtransactional DDLによりカラム削除も
   ロールバックされる)。
2. pre-flightチェックで検出された場合の対処:
   ENCRYPTION_KEYを設定した状態でGate R3-8のbackfillロジック相当を
   再実行し(本Gateでは自動実行しない。既存データへの再暗号化は
   人手による確認を要するため)、全行がciphertext化されたことを
   確認してから本migrationを再実行すること。
3. downgrade()はスキーマ形状(列の復元)のみを行い、削除されたデータの
   復元は行わない(そもそも復元不可能。downgradeは「列を元の形へ戻す」
   ことのみを保証し、「元のデータへ戻す」ことは保証しない)。

このmigrationは実データに対して破壊的であるため、omega-dev2の本番/開発
DBに対しては、パッチスクリプトによる自動`alembic upgrade head`の対象と
せず、pre-flightチェック通過の確認結果を見てから利用者自身が実行する
運用とする(docs/adr/ADR-reservation-minimal.md Gate R3-16改訂参照)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '29f832c03c75'
down_revision: Union[str, Sequence[str], None] = '725cce80af7c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


class UnbackfilledPlaintextDataError(RuntimeError):
    """ciphertext化されていない平文データが残っているため中断する。"""


def _preflight_check(bind) -> None:
    checks = [
        (
            "reservations.holder_name",
            "SELECT COUNT(*) FROM reservations "
            "WHERE holder_name IS NOT NULL AND holder_name_ciphertext IS NULL",
        ),
        (
            "reservations.contact_phone",
            "SELECT COUNT(*) FROM reservations "
            "WHERE contact_phone IS NOT NULL AND contact_phone_ciphertext IS NULL",
        ),
        (
            "reservation_participants.name",
            "SELECT COUNT(*) FROM reservation_participants "
            "WHERE name IS NOT NULL AND name_ciphertext IS NULL",
        ),
        (
            "reservation_participants.seat",
            "SELECT COUNT(*) FROM reservation_participants "
            "WHERE seat IS NOT NULL AND seat_ciphertext IS NULL",
        ),
        (
            "reservation_participants.special_request",
            "SELECT COUNT(*) FROM reservation_participants "
            "WHERE special_request IS NOT NULL AND special_request_ciphertext IS NULL",
        ),
    ]

    problems = []
    for label, query in checks:
        count = bind.execute(sa.text(query)).scalar()
        if count:
            problems.append(f"{label}: {count}行")

    if problems:
        raise UnbackfilledPlaintextDataError(
            "[Gate R3-16] ciphertext化されていない平文データが残っているため、"
            "旧平文列の削除を中断しました。該当箇所:\n  - "
            + "\n  - ".join(problems)
            + "\nENCRYPTION_KEYを設定した状態でbackfillを再実行し、"
            "全行がciphertext化されたことを確認してから再度本migrationを"
            "実行してください。"
        )


def upgrade() -> None:
    """Upgrade schema。"""

    bind = op.get_bind()
    _preflight_check(bind)

    op.drop_column('reservations', 'holder_name')
    op.drop_column('reservations', 'contact_phone')
    op.drop_column('reservation_participants', 'name')
    op.drop_column('reservation_participants', 'seat')
    op.drop_column('reservation_participants', 'special_request')

    print(
        "[Gate R3-16] 旧平文列を削除しました: reservations.holder_name/"
        "contact_phone、reservation_participants.name/seat/special_request"
    )


def downgrade() -> None:
    """Downgrade schema。列の形状のみを復元する(データは復元されない。
    上記docstring参照)。"""

    op.add_column('reservations', sa.Column('holder_name', sa.String(), nullable=True))
    op.add_column('reservations', sa.Column('contact_phone', sa.String(), nullable=True))
    op.add_column('reservation_participants', sa.Column('name', sa.String(), nullable=True))
    op.add_column('reservation_participants', sa.Column('seat', sa.String(), nullable=True))
    op.add_column(
        'reservation_participants', sa.Column('special_request', sa.Text(), nullable=True)
    )
