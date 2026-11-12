"""[Gate PlanB-Next] もしもの案の表 itinerary_branches を消す(P8 で控えの案へ移した 1 版あと)と、
オフラインの日の案の切り替え(sync_operations の entity_type=variant・action=switch)を受け付ける。

- itinerary_branches: P8(f3a8c1d5e9b2)で下書きを控えの案へ移し、1 版残して確かめた。2026-11-12 利用者が削除を指示
- sync_operations: CHECK の作り直しだけ(列は変えない)
- downgrade: 表を空で作り直し(中身は戻らない)、オフラインの切り替えの記録を消して CHECK を元に戻す
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a9d4e2c7f1b6"
down_revision = "f3a8c1d5e9b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("itinerary_branches")
    op.drop_constraint("ck_sync_operations_entity_type", "sync_operations", type_="check")
    op.drop_constraint("ck_sync_operations_action", "sync_operations", type_="check")
    op.create_check_constraint("ck_sync_operations_entity_type", "sync_operations",
                               "entity_type IN ('event', 'day', 'order', 'reservation', 'variant')")
    op.create_check_constraint("ck_sync_operations_action", "sync_operations",
                               "action IN ('create', 'update', 'delete', 'reorder', 'switch')")


def downgrade() -> None:
    op.execute("DELETE FROM sync_operations WHERE entity_type = 'variant' OR action = 'switch'")
    op.drop_constraint("ck_sync_operations_entity_type", "sync_operations", type_="check")
    op.drop_constraint("ck_sync_operations_action", "sync_operations", type_="check")
    op.create_check_constraint("ck_sync_operations_entity_type", "sync_operations",
                               "entity_type IN ('event', 'day', 'order', 'reservation')")
    op.create_check_constraint("ck_sync_operations_action", "sync_operations",
                               "action IN ('create', 'update', 'delete', 'reorder')")
    op.create_table(
        "itinerary_branches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("travel_plans.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("scenario_type", sa.String(10), nullable=False),
        sa.Column("assumptions", sa.JSON(), nullable=False),
        sa.Column("base_revision", sa.Integer(), nullable=False),
        sa.Column("base_snapshot", sa.JSON(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(9), nullable=False),
        sa.Column("adopted_change_set_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("change_sets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("adopted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("adopted_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resources", sa.JSON(), nullable=True),
        sa.CheckConstraint("scenario_type IN ('rain','delay','absence','budget','fatigue','custom')",
                           name="ck_itinerary_branches_scenario"),
        sa.CheckConstraint("status IN ('draft','adopted','discarded')", name="ck_itinerary_branches_status"),
        sa.CheckConstraint("(status = 'adopted') = (adopted_at IS NOT NULL)", name="ck_itinerary_branches_adopted_at"),
        sa.CheckConstraint("char_length(title) BETWEEN 1 AND 200", name="ck_itinerary_branches_title"),
    )
    op.create_index("ix_itinerary_branches_id", "itinerary_branches", ["id"])
    op.create_index("ix_itinerary_branches_plan_deleted", "itinerary_branches", ["plan_id", "deleted_at"])
    op.create_index("ix_fk_itinerary_branches_adopted_by_user_id", "itinerary_branches", ["adopted_by_user_id"])
    op.create_index("ix_fk_itinerary_branches_adopted_change_set_id", "itinerary_branches", ["adopted_change_set_id"])
    op.create_index("ix_fk_itinerary_branches_created_by_user_id", "itinerary_branches", ["created_by_user_id"])
