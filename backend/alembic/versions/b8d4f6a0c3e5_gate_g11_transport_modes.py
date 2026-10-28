"""gate_g11_transport_modes

Revision ID: b8d4f6a0c3e5
Revises: a7c3e5f9b2d4
Create Date: 2026-10-28 19:40:00.000000

[Gate G11] 移動手段の語彙に新幹線(shinkansen)・ヘリ(helicopter)を足す(docs/ux/G11_UIUX全範囲_実装仕様.md §4、UIX-M04)。
移動区間(travel_segments)と経路候補の区間(route_legs)の mode の CHECK を広げるだけ(列・既存の値は変えない)。

downgrade: shinkansen は train、helicopter は mixed に直してから元の CHECK に戻す(新幹線・ヘリの区別は失われる)。
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b8d4f6a0c3e5'
down_revision: Union[str, Sequence[str], None] = 'a7c3e5f9b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = ("walking", "driving", "train", "bus", "ferry", "flight", "bicycle", "taxi", "mixed")
_NEW = _OLD + ("shinkansen", "helicopter")
_TABLES = (("travel_segments", "ck_travel_segments_mode_vocab"), ("route_legs", "ck_route_legs_mode_vocab"))


def _check(modes) -> str:
    return "mode IN (" + ",".join(f"'{m}'" for m in modes) + ")"


def upgrade() -> None:
    for table, name in _TABLES:
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, _check(_NEW))


def downgrade() -> None:
    for table, name in _TABLES:
        op.execute(f"UPDATE {table} SET mode = 'train' WHERE mode = 'shinkansen'")
        op.execute(f"UPDATE {table} SET mode = 'mixed' WHERE mode = 'helicopter'")
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, _check(_OLD))
