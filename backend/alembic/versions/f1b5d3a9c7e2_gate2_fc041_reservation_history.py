"""[Gate② FC-041] 予約の履歴: 変更・取消のメール(同じ予約番号の別の予約)を元の予約へまとめた記録。

- reservation_history: どの予約へ・どの予約を・変更か取消か・変えた項目の名前・誰が・いつ
  **値そのもの(予約番号・名義・金額など)は持たない**(項目の名前だけ)
- 自動ではまとめない。利用者が「同じ予約かもしれません」(FC-042)の組を見て選んだ時だけ行を足す
- 元の予約を消すと履歴も消える(CASCADE)。まとめた側の予約・操作した人を消しても履歴は残る(SET NULL)
- 追加だけ。downgrade は表を消す(履歴は失われるが、予約そのものは変わらない)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f1b5d3a9c7e2"
down_revision = "e6a4c2b8d0f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reservation_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("reservation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("source_reservation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("reservations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("kind IN ('change', 'cancel')", name="ck_reservation_history_kind"),
    )
    op.create_index("ix_reservation_history_reservation", "reservation_history", ["reservation_id", "created_at"])
    # 外部キーには必ず索引を付ける(test_gate_g3_perf の規則。旅行・予約・利用者を消す時の探索を速く)
    op.create_index("ix_reservation_history_plan", "reservation_history", ["plan_id"])
    op.create_index("ix_reservation_history_source", "reservation_history", ["source_reservation_id"])
    op.create_index("ix_reservation_history_actor", "reservation_history", ["actor_user_id"])


def downgrade() -> None:
    op.drop_index("ix_reservation_history_actor", table_name="reservation_history")
    op.drop_index("ix_reservation_history_source", table_name="reservation_history")
    op.drop_index("ix_reservation_history_plan", table_name="reservation_history")
    op.drop_index("ix_reservation_history_reservation", table_name="reservation_history")
    op.drop_table("reservation_history")
