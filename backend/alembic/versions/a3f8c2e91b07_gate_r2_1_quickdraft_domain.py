"""gate_r2_1_quickdraft_domain

Revision ID: a3f8c2e91b07
Revises: f1a3c9d7b2e4
Create Date: 2026-09-07 00:00:00.000000

[Gate R2-1] QuickDraft正式契約(docs/adr/ADR-quick-draft.md)のDomain/Migration
Foundation。

追加:
- devices: anonymous device token identity(token本体は保存せずSHA-256 digest
  のみ)。
- quick_drafts: `POST /v1/quick-drafts`の永続モデル。payload暗号化の実装自体
  はGate R2-2で行う(本Gateはbyteaカラムのみ用意)。

変更(idempotency_records, Gate #29既存テーブル):
- user_id を NOT NULL -> NULL許容へ変更(device actorにも対応するため)。
- device_id / payload_hash / status / error_json / expires_at を追加。
  既存行(historical rows)は以下の後方互換値で埋める:
    payload_hash  = 32байtのゼロ埋め(sentinel、実ハッシュと衝突しない)
    status        = 'COMPLETED'(既存行は全て処理完了済みのため)
    expires_at    = 実行時刻 + 7日
  response_status は元々NOT NULLだったが、IN_PROGRESS状態では未確定のため
  NULL許容へ変更する。
- 旧UniqueConstraint(key, user_id, endpoint)を、user_id/device_idどちらの
  actorにも対応する部分unique index 2本へ置き換える(UUID列への
  COALESCE(...,'')はPostgreSQLで型エラーになるため使わない)。
- CHECK (user_id IS NOT NULL OR device_id IS NOT NULL) を追加。

downgrade:
- (1)の追加テーブル・追加列・追加indexは削除するだけで既存データへ影響しない。
- (2)のuser_id NOT NULL復元は、device_id経由で作成された行(device_id IS NOT
  NULL AND user_id IS NULL)が存在する場合はデータ損失を防ぐため中断する。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'a3f8c2e91b07'
down_revision: Union[str, Sequence[str], None] = 'f1a3c9d7b2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ---- 1. devices ----
    op.create_table(
        'devices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('token_digest', sa.LargeBinary(32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_devices_id', 'devices', ['id'])
    op.create_index(
        'ix_devices_token_digest', 'devices', ['token_digest'], unique=True,
    )

    # ---- 2. quick_drafts ----
    op.create_table(
        'quick_drafts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'device_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('devices.id'), nullable=False,
        ),
        sa.Column('payload_ciphertext', sa.LargeBinary(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('status', sa.String(), nullable=False, server_default='ACTIVE'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            'promoted_plan_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('travel_plans.id'), nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_quick_drafts_id', 'quick_drafts', ['id'])
    op.create_index('ix_quick_drafts_device_id', 'quick_drafts', ['device_id'])
    op.create_index(
        'ix_quick_drafts_status_expires', 'quick_drafts', ['status', 'expires_at'],
    )

    # ---- 3. idempotency_records 拡張 ----
    op.add_column(
        'idempotency_records',
        sa.Column(
            'device_id', postgresql.UUID(as_uuid=True),
            sa.ForeignKey('devices.id'), nullable=True,
        ),
    )
    op.add_column(
        'idempotency_records',
        sa.Column(
            'payload_hash', sa.LargeBinary(32), nullable=False,
            server_default=sa.text("decode(repeat('00', 32), 'hex')"),
        ),
    )
    op.add_column(
        'idempotency_records',
        sa.Column(
            'status', sa.String(), nullable=False, server_default='COMPLETED',
        ),
    )
    op.add_column(
        'idempotency_records',
        sa.Column('error_json', sa.JSON(), nullable=True),
    )
    op.add_column(
        'idempotency_records',
        sa.Column(
            'expires_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now() + interval '7 days'"),
        ),
    )
    # response_status: IN_PROGRESS状態では未確定のためNULL許容化
    op.alter_column(
        'idempotency_records', 'response_status',
        existing_type=sa.Integer(), nullable=True,
    )
    # user_id: device actorにも対応するためNULL許容化
    op.alter_column(
        'idempotency_records', 'user_id',
        existing_type=postgresql.UUID(as_uuid=True), nullable=True,
    )

    op.create_check_constraint(
        'ck_idempotency_actor_present',
        'idempotency_records',
        'user_id IS NOT NULL OR device_id IS NOT NULL',
    )

    op.drop_constraint(
        'uq_idempotency_key_user_endpoint', 'idempotency_records', type_='unique',
    )
    op.create_index(
        'uq_idempotency_user', 'idempotency_records', ['key', 'user_id', 'endpoint'],
        unique=True, postgresql_where=sa.text('user_id IS NOT NULL'),
    )
    op.create_index(
        'uq_idempotency_device', 'idempotency_records', ['key', 'device_id', 'endpoint'],
        unique=True, postgresql_where=sa.text('device_id IS NOT NULL'),
    )


def downgrade() -> None:
    """Downgrade schema."""

    # データ損失防止: device経由で作成されたidempotency recordが存在する状態で
    # user_idをNOT NULLへ戻すと、その行は復元不能な形で矛盾する。存在する場合は
    # downgradeを中断する。
    conn = op.get_bind()
    orphan_count = conn.execute(
        sa.text(
            "SELECT count(*) FROM idempotency_records "
            "WHERE device_id IS NOT NULL AND user_id IS NULL"
        )
    ).scalar()
    if orphan_count and orphan_count > 0:
        raise RuntimeError(
            f"downgrade中断: device経由のidempotency_records({orphan_count}件)が"
            "存在するため、user_idをNOT NULLへ戻すとデータ不整合が発生します。"
            "先にGate R2-2以降のdevice機能を無効化するか、該当行を別途退避して"
            "ください。"
        )

    op.drop_index('uq_idempotency_device', table_name='idempotency_records')
    op.drop_index('uq_idempotency_user', table_name='idempotency_records')
    op.create_unique_constraint(
        'uq_idempotency_key_user_endpoint',
        'idempotency_records', ['key', 'user_id', 'endpoint'],
    )
    op.drop_constraint(
        'ck_idempotency_actor_present', 'idempotency_records', type_='check',
    )
    op.alter_column(
        'idempotency_records', 'user_id',
        existing_type=postgresql.UUID(as_uuid=True), nullable=False,
    )
    op.alter_column(
        'idempotency_records', 'response_status',
        existing_type=sa.Integer(), nullable=False,
    )
    op.drop_column('idempotency_records', 'expires_at')
    op.drop_column('idempotency_records', 'error_json')
    op.drop_column('idempotency_records', 'status')
    op.drop_column('idempotency_records', 'payload_hash')
    op.drop_column('idempotency_records', 'device_id')

    op.drop_index('ix_quick_drafts_status_expires', table_name='quick_drafts')
    op.drop_index('ix_quick_drafts_device_id', table_name='quick_drafts')
    op.drop_index('ix_quick_drafts_id', table_name='quick_drafts')
    op.drop_table('quick_drafts')

    op.drop_index('ix_devices_token_digest', table_name='devices')
    op.drop_index('ix_devices_id', table_name='devices')
    op.drop_table('devices')
