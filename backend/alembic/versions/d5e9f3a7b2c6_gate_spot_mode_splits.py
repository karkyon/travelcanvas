"""[Gate SpotMode-2] FR-060 スポットモード: 別行動の集合の共有(利用者の決定 2026-11-18)。

- spot_area_splits: エリアの中で別行動にしたメンバーと、その人の集合の場所・時刻・ひとこと(1人1行)
  今いる場所は持たない(集合の約束だけを共有する)。「合流した」で行を消す
- エリア・利用者を消すと行も消える(CASCADE)
- 追加だけ。downgrade は表を消す(別行動の約束は失われる)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d5e9f3a7b2c6"
down_revision = "c4d8e2f6a9b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spot_area_splits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("area_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spot_areas.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("meet_label", sa.String(100), nullable=True),
        sa.Column("meet_time", sa.String(5), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("area_id", "user_id", name="uq_spot_area_splits_member"),
    )
    op.create_index("ix_spot_area_splits_area", "spot_area_splits", ["area_id"])
    op.create_index("ix_spot_area_splits_user", "spot_area_splits", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_spot_area_splits_user", table_name="spot_area_splits")
    op.drop_index("ix_spot_area_splits_area", table_name="spot_area_splits")
    op.drop_table("spot_area_splits")
