"""[Gate SpotMode] FR-060 スポットモード: 自由に歩くエリアと、その中の候補(利用者の決定 2026-11-18。DOC-02 v6.0 FR-060)。

- spot_areas: 旅行の中の「自由に歩くエリア」。日・時間枠(HH:MM)・集合の場所と時刻・範囲(半径 m)・近づいたら勧めるか
- spot_area_items: エリアの候補(候補箱 plan_candidates を指す)。ジャンル・優先(行きたい/気分で)・滞在の目安・並び・
  着いた(時刻と押した人)・今日はやめる・行きたい印を付けた人(利用者 ID の配列)
- 候補・旅行を消すとエリアの候補・エリアも消える(CASCADE)。日を消すとエリアは日なしになる(SET NULL)
- 追加だけ。downgrade は 2 つの表を消す(エリアの情報は失われる。候補箱の候補は残る)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4d8e2f6a9b1"
down_revision = "b7e3c9a1d5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spot_areas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("travel_plans.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("day_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("travel_days.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("start_time", sa.String(5), nullable=True),
        sa.Column("end_time", sa.String(5), nullable=True),
        sa.Column("meet_label", sa.String(100), nullable=True),
        sa.Column("meet_time", sa.String(5), nullable=True),
        sa.Column("meet_latitude", sa.Float(), nullable=True),
        sa.Column("meet_longitude", sa.Float(), nullable=True),
        sa.Column("radius_m", sa.Integer(), nullable=False, server_default="400"),
        sa.Column("suggest_on_approach", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("radius_m BETWEEN 100 AND 3000", name="ck_spot_areas_radius"),
    )
    op.create_index("ix_spot_areas_plan", "spot_areas", ["plan_id"])
    op.create_index("ix_spot_areas_day", "spot_areas", ["day_id"])
    op.create_index("ix_spot_areas_created_by", "spot_areas", ["created_by_user_id"])
    op.create_table(
        "spot_area_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("area_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spot_areas.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("plan_candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("genre", sa.String(8), nullable=False, server_default="other"),
        sa.Column("priority", sa.String(5), nullable=False, server_default="maybe"),
        sa.Column("stay_minutes", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("visited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("visited_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("skipped", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("wanted_by", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.CheckConstraint("genre IN ('food','cafe','gift','sight','rest','other')", name="ck_spot_area_items_genre"),
        sa.CheckConstraint("priority IN ('want','maybe')", name="ck_spot_area_items_priority"),
        sa.CheckConstraint("stay_minutes BETWEEN 5 AND 240", name="ck_spot_area_items_stay"),
        sa.UniqueConstraint("area_id", "candidate_id", name="uq_spot_area_items_candidate"),
    )
    op.create_index("ix_spot_area_items_area", "spot_area_items", ["area_id", "sort_order"])
    op.create_index("ix_spot_area_items_candidate", "spot_area_items", ["candidate_id"])
    op.create_index("ix_spot_area_items_visited_by", "spot_area_items", ["visited_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_spot_area_items_visited_by", table_name="spot_area_items")
    op.drop_index("ix_spot_area_items_candidate", table_name="spot_area_items")
    op.drop_index("ix_spot_area_items_area", table_name="spot_area_items")
    op.drop_table("spot_area_items")
    op.drop_index("ix_spot_areas_created_by", table_name="spot_areas")
    op.drop_index("ix_spot_areas_day", table_name="spot_areas")
    op.drop_index("ix_spot_areas_plan", table_name="spot_areas")
    op.drop_table("spot_areas")
