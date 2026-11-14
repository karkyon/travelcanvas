"""[Gate Remaining-7] FR-003 passkey・FR-011 Gmail の連携・FR-016 制約の変更の取り消し。

- webauthn_credentials: 利用者の passkey(WebAuthn の公開鍵)。秘密鍵は端末から出ない。消すと使えなくなる
- gmail_connections: Gmail の読み取りの連携(1 人 1 つ)。refresh token は ENCRYPTION_KEY で暗号化。外すと消す
- constraint_undo_snapshots: 制約の作成・変更・削除の直前の状態(1 回の操作ごと)。秘匿の制約は暗号文のまま写す。
  取り消せるのは操作した本人が、その後に別の変更が無い時だけ
- downgrade は 3 つの表を消す(passkey・Gmail の連携・取り消しの記録は失われる。制約そのものは残る)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e8a2c4f6b1d3"
down_revision = "d4f8b2a6c1e9"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("credential_id", sa.String(512), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("transports", sa.JSON(), nullable=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("backed_up", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("credential_id", name="uq_webauthn_credentials_credential_id"),
    )
    op.create_index("ix_webauthn_credentials_user", "webauthn_credentials", ["user_id"])

    op.create_table(
        "gmail_connections",
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("google_email", sa.String(320), nullable=True),
        sa.Column("refresh_token_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("scope", sa.String(200), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(40), nullable=True),
        sa.Column("imported_count", sa.Integer(), nullable=False, server_default="0"),
        # 取り込んだメールの ID の sha256(同じメールを 2 回取り込まない。最大 500 件)
        sa.Column("seen_message_hashes", sa.JSON(), nullable=True),
    )

    op.create_table(
        "constraint_undo_snapshots",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("constraint_id", UUID, sa.ForeignKey("constraints.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", UUID, sa.ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(8), nullable=False),
        sa.Column("before_json", sa.JSON(), nullable=True),
        sa.Column("revision_after", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("action IN ('create', 'update', 'delete')", name="ck_constraint_undo_snapshots_action"),
    )
    op.create_index("ix_constraint_undo_snapshots_constraint", "constraint_undo_snapshots", ["constraint_id"])
    op.create_index("ix_constraint_undo_snapshots_plan", "constraint_undo_snapshots", ["plan_id", "created_at"])
    op.create_index("ix_constraint_undo_snapshots_actor", "constraint_undo_snapshots", ["actor_user_id"])


def downgrade() -> None:
    op.drop_index("ix_constraint_undo_snapshots_actor", table_name="constraint_undo_snapshots")
    op.drop_index("ix_constraint_undo_snapshots_plan", table_name="constraint_undo_snapshots")
    op.drop_index("ix_constraint_undo_snapshots_constraint", table_name="constraint_undo_snapshots")
    op.drop_table("constraint_undo_snapshots")
    op.drop_table("gmail_connections")
    op.drop_index("ix_webauthn_credentials_user", table_name="webauthn_credentials")
    op.drop_table("webauthn_credentials")
