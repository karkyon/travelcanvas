"""
[Gate EventArea] エリアの中の予定(おかげ横丁の中の赤福・ダンデライオン など)。

- エリアは予定の種類 event_type='area'。中の予定は parent_event_id にエリアの ID を持つ
- 決まり: 同じ旅行・同じ日のエリアだけ。入れ子にしない(エリアはエリアに入らない・中の予定のエリアは無い)。自分自身には入らない
- 並び: 中の予定はいつもエリアのすぐ後ろに続ける(normalize_day)。旅程・全日程・移動の数え方はこの並びを前提にする
- エリアと中の予定、中の予定どうしの間は「エリアの中の移動」で、移動の区間として数えない(is_inner_pair)
"""
from __future__ import annotations

import uuid
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.models.models import TravelEvent

AREA = "area"


class AreaError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def parse_parent(value: Any) -> Optional[uuid.UUID]:
    """空・None は「外す」。それ以外は UUID(形が違えば AreaError)。"""
    if value in (None, ""):
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise AreaError("invalid_parent", "エリアの指定の形が正しくありません")


def check_parent(db: Session, *, plan_id: uuid.UUID, day_id: uuid.UUID, event_type: str,
                 event_id: Optional[uuid.UUID], parent_id: Optional[uuid.UUID]) -> Optional[TravelEvent]:
    """入れる先のエリアが決まりに合うか確かめる。合えばエリアを返す(外す時は None)。"""
    if parent_id is None:
        return None
    if event_id is not None and parent_id == event_id:
        raise AreaError("invalid_parent", "予定を自分自身の中には入れられません")
    if event_type == AREA:
        raise AreaError("nested_area", "エリアはほかのエリアの中に入れられません")
    parent = db.query(TravelEvent).filter(TravelEvent.id == parent_id, TravelEvent.plan_id == plan_id).first()
    if parent is None:
        raise AreaError("parent_not_found", "入れる先のエリアが見つかりません")
    if parent.event_type != AREA:
        raise AreaError("parent_not_area", "入れる先は種類が「エリア」の予定にしてください")
    if parent.day_id != day_id:
        raise AreaError("parent_other_day", "同じ日のエリアにだけ入れられます")
    return parent


def grouped_order(events: Sequence[TravelEvent]) -> Tuple[List[TravelEvent], List[TravelEvent]]:
    """並び(sort_order 順の events)を、各エリアのすぐ後ろに中の予定が続く並びに直す。

    戻り値: (直した並び, 決まりに合わず外す予定)。中の予定どうしの順・エリアの外の予定どうしの順は保つ。
    外す予定: エリアが同じ日に無い・エリアの種類でない・自分がエリア(入れ子)の予定。"""
    by_id = {e.id: e for e in events}
    drop: List[TravelEvent] = []
    members: Dict[uuid.UUID, List[TravelEvent]] = {}
    for e in events:
        pid = e.parent_event_id
        if pid is None:
            continue
        parent = by_id.get(pid)
        if parent is None or parent.event_type != AREA or parent.parent_event_id is not None or e.event_type == AREA \
                or parent.id == e.id:
            drop.append(e)
            continue
        members.setdefault(pid, []).append(e)
    dropped = {e.id for e in drop}
    out: List[TravelEvent] = []
    for e in events:
        if e.parent_event_id is not None and e.id not in dropped:
            continue  # エリアの後ろで出す
        out.append(e)
        if e.event_type == AREA:
            out.extend(members.get(e.id, []))
    return out, drop


def normalize_day(db: Session, day_id: uuid.UUID, snapshot: Callable[[TravelEvent], Dict[str, Any]]
                  ) -> List[Tuple[TravelEvent, Dict[str, Any]]]:
    """その日の並びを直し(エリアの後ろに中の予定)、決まりに合わない入れ方を外す。

    変えた予定と、変える前の写し(snapshot)の組を返す(元に戻すための記録に使う)。"""
    events = (db.query(TravelEvent).filter(TravelEvent.day_id == day_id)
              .order_by(TravelEvent.sort_order, TravelEvent.created_at, TravelEvent.id).all())
    if not any(e.parent_event_id is not None for e in events):
        return []  # エリアに入れた予定が無い日は並びを変えない
    before = {e.id: snapshot(e) for e in events}
    order, drop = grouped_order(events)
    for e in drop:
        e.parent_event_id = None
    for i, e in enumerate(order):
        if e.sort_order != i:
            e.sort_order = i
    changed = []
    for e in events:
        if snapshot(e) != before[e.id]:
            changed.append((e, before[e.id]))
    return changed


def detach_members(db: Session, area_id: uuid.UUID, snapshot: Callable[[TravelEvent], Dict[str, Any]]
                   ) -> List[Tuple[TravelEvent, Dict[str, Any]]]:
    """エリアの中の予定を全部外す(エリアの種類をやめた・別の日へ移した・消す時)。"""
    out = []
    for e in db.query(TravelEvent).filter(TravelEvent.parent_event_id == area_id).all():
        out.append((e, snapshot(e)))
        e.parent_event_id = None
    return out


def is_inner_pair(prev: TravelEvent, cur: TravelEvent) -> bool:
    """続く 2 つの予定が同じエリアの中(エリア → 中の予定、中の予定 → 中の予定)。移動の区間として数えない。"""
    pid = cur.parent_event_id
    return pid is not None and (prev.id == pid or prev.parent_event_id == pid)
