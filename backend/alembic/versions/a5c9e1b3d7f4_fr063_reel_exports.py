"""[FR-063] SNS の下書きとリール: 書き出したリールの記録(reel_exports)。

DD-2026-11-22-01 §2.3。動画は端末で作り端末だけに置く。記録には写真の ID・位置・文を入れない(型・長さ・枚数・結果だけ)。
storage_key・bytes はサーバーで作る段階 3b(作っていない)のための列。追加だけ。downgrade は表を消す。
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a5c9e1b3d7f4"
down_revision = "f3b7d9a1c5e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reel_exports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("travel_plans.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("scope", sa.String(8), nullable=False),
        sa.Column("scope_ref", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("style", sa.String(12), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=False),
        sa.Column("frame_count", sa.Integer(), nullable=False),
        sa.Column("renderer", sa.String(8), nullable=False, server_default="device"),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=True),
        sa.Column("bytes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("scope IN ('trip', 'day', 'area')", name="ck_reel_exports_scope"),
        sa.CheckConstraint("style IN ('tiktok', 'ig_reels', 'shorts', 'instagram', 'x', 'line')",
                           name="ck_reel_exports_style"),
        sa.CheckConstraint("renderer IN ('device', 'server')", name="ck_reel_exports_renderer"),
        sa.CheckConstraint("status IN ('ready', 'failed', 'queued', 'rendering')", name="ck_reel_exports_status"),
    )
    op.create_index("ix_reel_exports_plan", "reel_exports", ["plan_id"])
    op.create_index("ix_reel_exports_user", "reel_exports", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_reel_exports_user", table_name="reel_exports")
    op.drop_index("ix_reel_exports_plan", table_name="reel_exports")
    op.drop_table("reel_exports")
