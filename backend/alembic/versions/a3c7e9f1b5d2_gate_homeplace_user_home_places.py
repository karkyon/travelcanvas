"""[Gate HomePlace] 自宅の場所(本人だけ・使うかは本人が選ぶ)。

- user_home_places: 利用者ごとに 1 行。名前・住所・座標は利用者のデータ鍵で暗号化した 1 つの値(平文の列なし)
- show_on_map / use_for_routes / send_to_route_provider: 地図に出す・出発と帰着の経路に使う・経路の提供元へ送る
- downgrade は表を消す(登録した自宅の場所は失われる。旅程・予定には影響しない)
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a3c7e9f1b5d2"
down_revision = "e8a2c4f6b1d3"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "user_home_places",
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("place_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("show_on_map", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("use_for_routes", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("send_to_route_provider", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("user_home_places")
