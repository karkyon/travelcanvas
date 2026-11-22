"""[Gate② FC-026] 不適切な候補の報告: 閉業・住所の誤り・危険・重複を、旅行のメンバーが候補箱の候補へ報告する。

- candidate_reports: どの旅行の・どの候補へ・理由(closed / wrong_address / dangerous / duplicate)・ひとこと・誰が・いつ
- 報告は出典の状態へ反映する(候補が場所に紐付いていれば、その場所の出典を「要確認」(stale)にする。アプリの処理)
- 候補・旅行を消すと報告も消える(CASCADE)。報告した人を消しても報告は残る(SET NULL)
- 追加だけ。downgrade は表を消す
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a3c7e9b1d5f4"
down_revision = "f1b5d3a9c7e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "candidate_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("plan_candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("reporter_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("reason IN ('closed', 'wrong_address', 'dangerous', 'duplicate')",
                           name="ck_candidate_reports_reason"),
    )
    op.create_index("ix_candidate_reports_candidate", "candidate_reports", ["candidate_id", "created_at"])
    op.create_index("ix_candidate_reports_plan", "candidate_reports", ["plan_id"])
    op.create_index("ix_candidate_reports_reporter", "candidate_reports", ["reporter_user_id"])


def downgrade() -> None:
    op.drop_index("ix_candidate_reports_reporter", table_name="candidate_reports")
    op.drop_index("ix_candidate_reports_plan", table_name="candidate_reports")
    op.drop_index("ix_candidate_reports_candidate", table_name="candidate_reports")
    op.drop_table("candidate_reports")
