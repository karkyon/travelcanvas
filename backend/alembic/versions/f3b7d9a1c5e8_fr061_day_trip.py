"""[FR-061] 日帰りモード: travel_plans.trip_style と、行き・帰りのルート(day_trip_routes)。

DD-2026-11-22-01 §2.2。
- trip_style: null(今までの旅行)/ day_trip
- day_trip_routes: 旅行ごとに out / back の 1 行(一意)。出発地は小数 2 桁に丸めた値と地名だけ。線は最大 200KB
- 目的地の行きたい場所(dest_spot_id)は、場所を消すと外れる(SET NULL)。旅行を消すと消える(CASCADE)
- 追加だけ。downgrade は表と列を消す
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f3b7d9a1c5e8"
down_revision = "e9a1c3f5b7d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("travel_plans", sa.Column("trip_style", sa.String(16), nullable=True))
    op.create_check_constraint("ck_travel_plans_trip_style", "travel_plans",
                               "trip_style IS NULL OR trip_style IN ('day_trip')")
    op.create_table(
        "day_trip_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("travel_plans.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("leg", sa.String(4), nullable=False),
        sa.Column("origin_label", sa.String(120), nullable=False),
        sa.Column("origin_lat", sa.Float(), nullable=False),
        sa.Column("origin_lng", sa.Float(), nullable=False),
        sa.Column("dest_label", sa.String(200), nullable=False),
        sa.Column("dest_lat", sa.Float(), nullable=False),
        sa.Column("dest_lng", sa.Float(), nullable=False),
        sa.Column("dest_spot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("spots.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("road", sa.String(12), nullable=False, server_default="auto"),
        sa.Column("depart_at", sa.String(5), nullable=False),
        sa.Column("home_by", sa.String(5), nullable=True),
        sa.Column("polyline", sa.Text(), nullable=False),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("toll_jpy", sa.Integer(), nullable=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("plan_id", "leg", name="uq_day_trip_routes_plan_leg"),
        sa.CheckConstraint("leg IN ('out', 'back')", name="ck_day_trip_routes_leg"),
        sa.CheckConstraint("road IN ('highway', 'local', 'avoid_tolls', 'auto')", name="ck_day_trip_routes_road"),
        sa.CheckConstraint("provider IN ('google', 'osrm', 'straight')", name="ck_day_trip_routes_provider"),
        sa.CheckConstraint("octet_length(polyline) <= 200000", name="ck_day_trip_routes_polyline_size"),
    )
    op.create_index("ix_day_trip_routes_plan", "day_trip_routes", ["plan_id"])
    op.create_index("ix_day_trip_routes_dest_spot", "day_trip_routes", ["dest_spot_id"])


def downgrade() -> None:
    op.drop_index("ix_day_trip_routes_dest_spot", table_name="day_trip_routes")
    op.drop_index("ix_day_trip_routes_plan", table_name="day_trip_routes")
    op.drop_table("day_trip_routes")
    op.drop_constraint("ck_travel_plans_trip_style", "travel_plans", type_="check")
    op.drop_column("travel_plans", "trip_style")
