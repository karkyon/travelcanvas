"""gate_m1_fr014_travel_segments

Revision ID: 5bf5b47a715d
Revises: 29f832c03c75
Create Date: 2026-09-12 10:00:00.000000

[Gate M1] FR-014 移動区間(DOC-05 §7.1 travel_segments)。

Gate #32で追加した`route_segments`(1日の中で連続する2イベント間の
haversine概算のみを持つテーブル)を、DOC-05 §7.1の正式仕様に合わせて
`travel_segments`へrenameし、以下を追加する:

- from/to端点としてPlaceも指定できるようにする(from_place_id/to_place_id)
- 計画出発・到着(planned_departure_at/planned_arrival_at)
- 費用(cost, Numeric(14,2))・通貨(currency)
- 準備・前後バッファ時間(preparation_minutes/buffer_before/after_minutes)
- 便名・platform・乗換数・荷物条件(transport_number/platform/
  transfer_count/luggage_note)
- 予約紐付け(reservation_id)
- 状態(status)・楽観ロック用revision・updated_at

【重要: データ保持を最優先する】
API消費者がゼロであることは、既存DBの行数がゼロであることを証明しない。
本migrationは`route_segments`をdrop/recreateせず、既存PK・全行・既存値を
保持する「rename + expand」migrationとする。既存の`id`/`plan_id`/
`from_event_id`/`to_event_id`/`mode`/`distance_km`/`duration_minutes`/
`is_estimate`/`provider`/`algorithm_version`/`computed_at`/`created_at`
列とその値は一切変更しない(名称変更するのはtable名・index名・
制約名のみ)。

【新CHECK制約を追加する前の安全性検証(pre-flight)】
新たに追加するfrom/to endpoint XOR制約は、既存行のfrom_place_id/
to_place_idが必ずNULL(このmigrationで新規追加する列のため)である
ことを前提にすると、既存のfrom_event_id/to_event_idがNULLの行がもし
存在すれば、CHECK制約追加時にPostgresが即座に失敗する。「失敗して
migrationが止まる」のは安全だが、原因を利用者が調査しやすいよう、
CHECK制約を追加する前に明示的なpre-flightクエリで該当行を数え、
1件でもあれば分かりやすいメッセージと共にmigration全体を中断する
(transactional DDLにより、それまでの列追加もロールバックされる)。

【mode語彙の正規化】
Gate #32時点の`RouteSegment`はmode列に`walking`/`driving`/`transit`の
3値しか使っていなかった。FR-014の正式mode語彙は`walking`/`driving`/
`train`/`bus`/`ferry`/`flight`/`bicycle`/`taxi`/`mixed`の9値であり、
`transit`は含まれない。既存行に`mode='transit'`があった場合、新しい
mode CHECK制約を追加する前に`mixed`(具体的な交通手段を1つに確定
できない複合交通)へ正規化する。これは唯一のdestructiveなデータ変更
だが、`transit`自体が「鉄道かバスか不明な概算」だったため、`mixed`
への正規化は情報の追加喪失を伴わない(元々sub-modeを区別していない)。

開発/本番DBへの本migrationの自動実行は行わない(パッチスクリプトは
専用test DBでのみ検証する)。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '5bf5b47a715d'
down_revision: Union[str, Sequence[str], None] = '29f832c03c75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_MODE_VOCAB = ('walking', 'driving', 'train', 'bus', 'ferry', 'flight', 'bicycle', 'taxi', 'mixed')
_STATUS_VOCAB = ('planned', 'confirmed', 'cancelled')


class UnsafeExistingSegmentDataError(RuntimeError):
    """新CHECK制約と両立しない既存データが見つかったため中断する。"""


def upgrade() -> None:
    bind = op.get_bind()

    # ---- 1. table/index/制約名のrename(既存行のPK・値はそのまま) ----
    op.rename_table('route_segments', 'travel_segments')
    op.execute("ALTER INDEX ix_route_segments_id RENAME TO ix_travel_segments_id")
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT route_segments_pkey "
        "TO travel_segments_pkey"
    )
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT route_segments_plan_id_fkey "
        "TO travel_segments_plan_id_fkey"
    )
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT route_segments_from_event_id_fkey "
        "TO travel_segments_from_event_id_fkey"
    )
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT route_segments_to_event_id_fkey "
        "TO travel_segments_to_event_id_fkey"
    )

    # ---- 2. 新規列(nullableまたは安全なserver_default)を追加(expand) ----
    op.add_column('travel_segments', sa.Column('from_place_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('travel_segments', sa.Column('to_place_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        'travel_segments',
        sa.Column('status', sa.String(), nullable=False, server_default='planned'),
    )
    op.add_column('travel_segments', sa.Column('planned_departure_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('travel_segments', sa.Column('planned_arrival_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('travel_segments', sa.Column('cost', sa.Numeric(14, 2), nullable=True))
    op.add_column('travel_segments', sa.Column('currency', sa.String(length=3), nullable=True))
    op.add_column(
        'travel_segments',
        sa.Column('preparation_minutes', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'travel_segments',
        sa.Column('buffer_before_minutes', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'travel_segments',
        sa.Column('buffer_after_minutes', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column('travel_segments', sa.Column('transport_number', sa.String(), nullable=True))
    op.add_column('travel_segments', sa.Column('platform', sa.String(), nullable=True))
    op.add_column('travel_segments', sa.Column('transfer_count', sa.Integer(), nullable=True))
    op.add_column('travel_segments', sa.Column('luggage_note', sa.Text(), nullable=True))
    op.add_column('travel_segments', sa.Column('reservation_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        'travel_segments',
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
    )
    op.add_column('travel_segments', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        'fk_travel_segments_from_place_id_places', 'travel_segments', 'places',
        ['from_place_id'], ['id'],
    )
    op.create_foreign_key(
        'fk_travel_segments_to_place_id_places', 'travel_segments', 'places',
        ['to_place_id'], ['id'],
    )
    op.create_foreign_key(
        'fk_travel_segments_reservation_id_reservations', 'travel_segments', 'reservations',
        ['reservation_id'], ['id'],
    )
    op.create_index('ix_travel_segments_plan_id', 'travel_segments', ['plan_id'])

    # ---- 3. legacy mode='transit'の正規化(唯一のdestructiveなデータ変更) ----
    transit_count = bind.execute(
        sa.text("SELECT count(*) FROM travel_segments WHERE mode = 'transit'")
    ).scalar()
    if transit_count:
        bind.execute(sa.text("UPDATE travel_segments SET mode = 'mixed' WHERE mode = 'transit'"))
        print(f"[Gate M1] 既存の mode='transit' 行を mode='mixed' へ正規化しました: {transit_count}件")

    # ---- 4. pre-flight: 新CHECK制約と両立しない既存データを検査 ----
    problems = []

    from_null = bind.execute(sa.text(
        "SELECT count(*) FROM travel_segments WHERE from_event_id IS NULL AND from_place_id IS NULL"
    )).scalar()
    if from_null:
        problems.append(f"from_event_id/from_place_idが両方NULLの行: {from_null}行")

    to_null = bind.execute(sa.text(
        "SELECT count(*) FROM travel_segments WHERE to_event_id IS NULL AND to_place_id IS NULL"
    )).scalar()
    if to_null:
        problems.append(f"to_event_id/to_place_idが両方NULLの行: {to_null}行")

    same_event = bind.execute(sa.text(
        "SELECT count(*) FROM travel_segments "
        "WHERE from_event_id IS NOT NULL AND from_event_id = to_event_id"
    )).scalar()
    if same_event:
        problems.append(f"from_event_id = to_event_idの行: {same_event}行")

    placeholders = ",".join(f"'{m}'" for m in _MODE_VOCAB)
    unknown_mode = bind.execute(sa.text(
        f"SELECT count(*) FROM travel_segments WHERE mode NOT IN ({placeholders})"
    )).scalar()
    if unknown_mode:
        problems.append(f"未知のmode値を持つ行(transit正規化後も残存): {unknown_mode}行")

    if problems:
        raise UnsafeExistingSegmentDataError(
            "[Gate M1] 既存route_segments(rename後: travel_segments)行に、"
            "新CHECK制約と両立しないデータが見つかったため中断しました:\n  - "
            + "\n  - ".join(problems)
            + "\nこれらの行を手動で確認・修正してから本migrationを再実行してください。"
            "(from_event_id/to_event_idがNULLの行は、Gate #32時点のRouteSegmentが"
            "両カラムともnullable=Trueだったために発生し得ます。)"
        )

    # ---- 5. CHECK制約を追加 ----
    op.create_check_constraint(
        'ck_travel_segments_from_endpoint_xor', 'travel_segments',
        '(from_event_id IS NOT NULL) != (from_place_id IS NOT NULL)',
    )
    op.create_check_constraint(
        'ck_travel_segments_to_endpoint_xor', 'travel_segments',
        '(to_event_id IS NOT NULL) != (to_place_id IS NOT NULL)',
    )
    op.create_check_constraint(
        'ck_travel_segments_no_same_endpoint', 'travel_segments',
        '(from_event_id IS NULL OR to_event_id IS NULL OR from_event_id != to_event_id) '
        'AND (from_place_id IS NULL OR to_place_id IS NULL OR from_place_id != to_place_id)',
    )
    mode_list = ",".join(f"'{m}'" for m in _MODE_VOCAB)
    op.create_check_constraint(
        'ck_travel_segments_mode_vocab', 'travel_segments', f'mode IN ({mode_list})',
    )
    status_list = ",".join(f"'{s}'" for s in _STATUS_VOCAB)
    op.create_check_constraint(
        'ck_travel_segments_status_vocab', 'travel_segments', f'status IN ({status_list})',
    )
    op.create_check_constraint(
        'ck_travel_segments_nonneg', 'travel_segments',
        '(distance_km IS NULL OR distance_km >= 0) '
        'AND (duration_minutes IS NULL OR duration_minutes >= 0) '
        'AND (cost IS NULL OR cost >= 0) '
        'AND preparation_minutes >= 0 AND buffer_before_minutes >= 0 AND buffer_after_minutes >= 0 '
        'AND (transfer_count IS NULL OR transfer_count >= 0)',
    )
    op.create_check_constraint(
        'ck_travel_segments_currency_format', 'travel_segments',
        "currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))",
    )

    print("[Gate M1] travel_segments migration完了(既存行を保持したままexpand)")


def downgrade() -> None:
    """Downgrade schema。table名・列形状をGate #32時点へ戻す(既存の10列と
    その値は一切失われない)。本Gateで追加した列・制約のみを削除する。"""

    op.drop_constraint('ck_travel_segments_currency_format', 'travel_segments', type_='check')
    op.drop_constraint('ck_travel_segments_nonneg', 'travel_segments', type_='check')
    op.drop_constraint('ck_travel_segments_status_vocab', 'travel_segments', type_='check')
    op.drop_constraint('ck_travel_segments_mode_vocab', 'travel_segments', type_='check')
    op.drop_constraint('ck_travel_segments_no_same_endpoint', 'travel_segments', type_='check')
    op.drop_constraint('ck_travel_segments_to_endpoint_xor', 'travel_segments', type_='check')
    op.drop_constraint('ck_travel_segments_from_endpoint_xor', 'travel_segments', type_='check')

    op.drop_index('ix_travel_segments_plan_id', table_name='travel_segments')
    op.drop_constraint('fk_travel_segments_reservation_id_reservations', 'travel_segments', type_='foreignkey')
    op.drop_constraint('fk_travel_segments_to_place_id_places', 'travel_segments', type_='foreignkey')
    op.drop_constraint('fk_travel_segments_from_place_id_places', 'travel_segments', type_='foreignkey')

    op.drop_column('travel_segments', 'updated_at')
    op.drop_column('travel_segments', 'revision')
    op.drop_column('travel_segments', 'reservation_id')
    op.drop_column('travel_segments', 'luggage_note')
    op.drop_column('travel_segments', 'transfer_count')
    op.drop_column('travel_segments', 'platform')
    op.drop_column('travel_segments', 'transport_number')
    op.drop_column('travel_segments', 'buffer_after_minutes')
    op.drop_column('travel_segments', 'buffer_before_minutes')
    op.drop_column('travel_segments', 'preparation_minutes')
    op.drop_column('travel_segments', 'currency')
    op.drop_column('travel_segments', 'cost')
    op.drop_column('travel_segments', 'planned_arrival_at')
    op.drop_column('travel_segments', 'planned_departure_at')
    op.drop_column('travel_segments', 'status')
    op.drop_column('travel_segments', 'to_place_id')
    op.drop_column('travel_segments', 'from_place_id')

    # 注意: mode='transit'->'mixed'の正規化はdowngradeで復元しない
    # (元がtransitだったかmixedだったか区別する情報自体が失われているため。
    # docstring参照)。

    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT travel_segments_to_event_id_fkey "
        "TO route_segments_to_event_id_fkey"
    )
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT travel_segments_from_event_id_fkey "
        "TO route_segments_from_event_id_fkey"
    )
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT travel_segments_plan_id_fkey "
        "TO route_segments_plan_id_fkey"
    )
    op.execute(
        "ALTER TABLE travel_segments RENAME CONSTRAINT travel_segments_pkey "
        "TO route_segments_pkey"
    )
    op.execute("ALTER INDEX ix_travel_segments_id RENAME TO ix_route_segments_id")
    op.rename_table('travel_segments', 'route_segments')
