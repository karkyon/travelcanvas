"""gate_g11_express_bus

Revision ID: c4e8a1f3b7d2
Revises: b8d4f6a0c3e5
Create Date: 2026-10-29 11:00:00.000000

[Gate G11] 移動手段の語彙に高速バス(express_bus)を足す(docs/ux/G11_UIUX全範囲_実装仕様.md §1.0・§4、UIX-M04)。
これまでの bus は「路線バス」として表示する(値は変えない)。段階2 の `b8d4f6a0c3e5` と同じ形で、移動区間(travel_segments)と
経路候補の区間(route_legs)の mode の CHECK を広げるだけ(列・既存の値は変えない)。

downgrade: express_bus は bus に直してから元の CHECK に戻す(路線バスと高速バスの区別は失われる)。
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c4e8a1f3b7d2'
down_revision: Union[str, Sequence[str], None] = 'b8d4f6a0c3e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = ("walking", "driving", "train", "bus", "ferry", "flight", "bicycle", "taxi", "mixed", "shinkansen", "helicopter")
_NEW = _OLD + ("express_bus",)
_TABLES = (("travel_segments", "ck_travel_segments_mode_vocab"), ("route_legs", "ck_route_legs_mode_vocab"))


def _check(modes) -> str:
    return "mode IN (" + ",".join(f"'{m}'" for m in modes) + ")"


def upgrade() -> None:
    for table, name in _TABLES:
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, _check(_NEW))


def downgrade() -> None:
    for table, name in _TABLES:
        op.execute(f"UPDATE {table} SET mode = 'bus' WHERE mode = 'express_bus'")
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, _check(_OLD))
