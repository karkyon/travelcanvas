"""[Gate Remaining-3] FR-024 通知のメールの即時の配信・FR-011 予約メールの転送アドレス。

- notification_preferences: email_digest に 'instant' を足す(CHECK の作り直しだけ。列・データは変えない)
- inbound_mail_addresses(新しい表): 旅行ごとの転送用のアドレス。宛先の文字(token)は暗号化して持ち、照合は sha256 だけ
- downgrade: instant の人を daily に戻して CHECK を元に戻す。転送アドレスの表を消す
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c1e7a3b9d5f2"
down_revision = "a9d4e2c7f1b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_notification_preferences_digest", "notification_preferences", type_="check")
    op.create_check_constraint("ck_notification_preferences_digest", "notification_preferences",
                               "email_digest IN ('off', 'daily', 'instant')")
    op.create_table(
        "inbound_mail_addresses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("travel_plans.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("token_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("received_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_inbound_mail_addresses_token_hash"),
    )
    op.create_index("ix_inbound_mail_addresses_plan_user", "inbound_mail_addresses", ["plan_id", "user_id"])
    op.create_index("ix_inbound_mail_addresses_user", "inbound_mail_addresses", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_inbound_mail_addresses_user", table_name="inbound_mail_addresses")
    op.drop_index("ix_inbound_mail_addresses_plan_user", table_name="inbound_mail_addresses")
    op.drop_table("inbound_mail_addresses")
    op.execute("UPDATE notification_preferences SET email_digest = 'daily' WHERE email_digest = 'instant'")
    op.drop_constraint("ck_notification_preferences_digest", "notification_preferences", type_="check")
    op.create_check_constraint("ck_notification_preferences_digest", "notification_preferences",
                               "email_digest IN ('off', 'daily')")
