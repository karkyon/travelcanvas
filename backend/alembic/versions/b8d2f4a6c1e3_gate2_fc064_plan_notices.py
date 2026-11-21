"""[Gate② FC-064] 既読の確認: 重大な変更・集合の変更のお知らせと、メンバーごとの「確認しました」。

- plan_notices: 旅行・種類(major_change / meeting_change)・題名・本文・出した人・いつ
- plan_notice_acks: お知らせ・メンバー・確認した時刻(1 人 1 行)
- 旅行・お知らせを消すと確認も消える(CASCADE)。出した人を消してもお知らせは残る(SET NULL)。確認したメンバーを消すと
  その人の確認は消える(CASCADE)
- 追加だけ。downgrade は表を消す
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b8d2f4a6c1e3"
down_revision = "a3c7e9b1d5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_notices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.String(1000), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("kind IN ('major_change', 'meeting_change')", name="ck_plan_notices_kind"),
    )
    op.create_index("ix_plan_notices_plan", "plan_notices", ["plan_id", "created_at"])
    op.create_index("ix_plan_notices_creator", "plan_notices", ["created_by_user_id"])
    op.create_table(
        "plan_notice_acks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notice_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("plan_notices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("notice_id", "user_id", name="uq_plan_notice_acks_member"),
    )
    op.create_index("ix_plan_notice_acks_user", "plan_notice_acks", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_plan_notice_acks_user", table_name="plan_notice_acks")
    op.drop_table("plan_notice_acks")
    op.drop_index("ix_plan_notices_creator", table_name="plan_notices")
    op.drop_index("ix_plan_notices_plan", table_name="plan_notices")
    op.drop_table("plan_notices")
