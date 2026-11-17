"""[Gate ChatConsensus] 相談を話し合い(チャット)中心にする(利用者の決定 2026-11-17。DOC-02 v6.0 FR-022)。

- polls.mode: simple(かんたん投票: 1 つ選ぶ。既定)/ detailed(詳しい投票: 4 段階・定足数・不可で不成立)/
  decision(話し合いだけで決めた記録。投票なし。選択肢 1 つで作った時から決定)
  既存の投票は detailed(今までと同じ動き)
- polls.source_comment_id: 元の発言(チャットのコメント)。発言を消しても投票・決定は残す(SET NULL)
- 追加だけ。downgrade は 2 つの列を消す(かんたん投票・決定の記録は詳しい投票として残る。元の発言との結び付きは失われる)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b7e3c9a1d5f4"
down_revision = "a3c7e9f1b5d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("polls", sa.Column("mode", sa.String(length=8), nullable=False, server_default="detailed"))
    op.create_check_constraint("ck_polls_mode", "polls", "mode IN ('simple','detailed','decision')")
    op.add_column("polls", sa.Column("source_comment_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_polls_source_comment", "polls", "comments", ["source_comment_id"], ["id"],
                          ondelete="SET NULL")
    op.create_index("ix_polls_source_comment", "polls", ["source_comment_id"])


def downgrade() -> None:
    op.drop_index("ix_polls_source_comment", table_name="polls")
    op.drop_constraint("fk_polls_source_comment", "polls", type_="foreignkey")
    op.drop_column("polls", "source_comment_id")
    op.drop_constraint("ck_polls_mode", "polls", type_="check")
    op.drop_column("polls", "mode")
