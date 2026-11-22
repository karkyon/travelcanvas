"""[FR-062] 今度行きたい・また行きたい: 行きたい場所(spots)に、種類・範囲・残した元・ひとこと・知らせの列を足す。

DD-2026-11-22-01 §2.1。
- wish_kind: next(今度行きたい)/ again(また行きたい)。null は今までの行きたい場所(画面では「今度行きたい」に数える)
- wish_scope: place / area。エリアの時は radius_m(100〜5000)
- source_kind・source_plan_id(旅行を消すと外れる SET NULL)・source_label(旅行の名前の写し)
- wish_note(200)・wish_when(next_trip / someday)・remind_nearby・again_count・last_visited_at
- client_id: 端末が作る ID。(created_by, client_id) の一意で、圏外で溜めた分の再送を 1 件にする
- 追加だけ。downgrade は列を消す(行きたい場所そのものは残る)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e9a1c3f5b7d2"
down_revision = "d7f3b5c9e1a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("spots", sa.Column("wish_kind", sa.String(8), nullable=True))
    op.add_column("spots", sa.Column("wish_scope", sa.String(8), nullable=False, server_default="place"))
    op.add_column("spots", sa.Column("radius_m", sa.Integer(), nullable=True))
    op.add_column("spots", sa.Column("source_kind", sa.String(16), nullable=True))
    op.add_column("spots", sa.Column(
        "source_plan_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("travel_plans.id", ondelete="SET NULL", name="fk_spots_source_plan"), nullable=True))
    op.add_column("spots", sa.Column("source_label", sa.String(120), nullable=True))
    op.add_column("spots", sa.Column("wish_note", sa.String(200), nullable=True))
    op.add_column("spots", sa.Column("wish_when", sa.String(12), nullable=True))
    op.add_column("spots", sa.Column("remind_nearby", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("spots", sa.Column("again_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("spots", sa.Column("client_id", sa.String(64), nullable=True))
    op.add_column("spots", sa.Column("last_visited_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("ck_spots_wish_kind", "spots", "wish_kind IS NULL OR wish_kind IN ('next', 'again')")
    op.create_check_constraint("ck_spots_wish_scope", "spots", "wish_scope IN ('place', 'area')")
    op.create_check_constraint("ck_spots_radius", "spots",
                               "radius_m IS NULL OR (radius_m >= 100 AND radius_m <= 5000)")
    op.create_check_constraint("ck_spots_wish_when", "spots",
                               "wish_when IS NULL OR wish_when IN ('next_trip', 'someday')")
    op.create_index("ix_spots_source_plan", "spots", ["source_plan_id"])
    op.create_index("uq_spots_owner_client_id", "spots", ["created_by", "client_id"], unique=True,
                    postgresql_where=sa.text("client_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("uq_spots_owner_client_id", table_name="spots")
    op.drop_index("ix_spots_source_plan", table_name="spots")
    for ck in ("ck_spots_wish_when", "ck_spots_radius", "ck_spots_wish_scope", "ck_spots_wish_kind"):
        op.drop_constraint(ck, "spots", type_="check")
    op.drop_constraint("fk_spots_source_plan", "spots", type_="foreignkey")
    for col in ("last_visited_at", "client_id", "again_count", "remind_nearby", "wish_when", "wish_note",
                "source_label", "source_plan_id", "source_kind", "radius_m", "wish_scope", "wish_kind"):
        op.drop_column("spots", col)
