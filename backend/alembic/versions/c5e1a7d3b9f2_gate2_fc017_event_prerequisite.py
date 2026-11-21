"""[Gate② FC-017] 予定の先行条件: 「この予定の後に」(チェックインの後・集合の後 など)を予定に持たせる。

- travel_events.after_event_id: 先に終えておく予定(同じ旅行の別の予定)。先の予定を消すと外れる(SET NULL)
- 検証(feasibility)は、先行の予定より前に始まる予定を「順序の注意」として出す
- 追加だけ。downgrade は列を消す(先行条件は失われるが、予定そのものは変わらない)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c5e1a7d3b9f2"
down_revision = "b8d2f4a6c1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("travel_events", sa.Column(
        "after_event_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("travel_events.id", ondelete="SET NULL", name="fk_travel_events_after_event"), nullable=True))
    op.create_index("ix_travel_events_after_event", "travel_events", ["after_event_id"])


def downgrade() -> None:
    op.drop_index("ix_travel_events_after_event", table_name="travel_events")
    op.drop_constraint("fk_travel_events_after_event", "travel_events", type_="foreignkey")
    op.drop_column("travel_events", "after_event_id")
