"""予定の一括の変更に共通の処理(本案の写し・紐付けのある予定・時刻の変更・差分の適用)。

[Gate PlanB-P8] もとは「もしもの案」(app/api/v1/branches.py)にあった関数。もしもの案をやめて日ごとの案(プランB)に
置き換えたため、再計画・カレンダーの取り込み・最適化・思い出からの再計画・同期が使う部分だけをここへ移した。
"""
import uuid
from datetime import datetime, time as time_cls, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.models import DocumentLink, TravelDay, TravelEvent, TravelPlan
from app.services import branches as br
from app.services.today_mode import zone_for


def _event_to_dict(ev: TravelEvent) -> Dict[str, Any]:
    from app.api.v1 import plans as plans_api

    return plans_api._event_to_dict(ev)


def snapshot(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
            .order_by(TravelDay.local_date, TravelDay.sort_order).all())
    events = (db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id)
              .order_by(TravelEvent.sort_order).all())
    return {
        "days": [{"id": str(d.id), "local_date": d.local_date.isoformat(), "timezone_id": d.timezone_id,
                  "title": d.title} for d in days],
        "events": [br.event_item(e) for e in events],
    }


def related_event_ids(db: Session, event_ids: List[uuid.UUID], exclude_segments: Optional[Set[str]] = None,
                      exclude_reservations: Optional[Set[str]] = None) -> Set[str]:
    """予約・移動区間・経路候補・リンク・文書などと紐付いている予定(外すと紐付けが失われるもの)。
    [Gate G8] 同じ採用で外す区間・付け替える(取り消す予定の)予約の紐付けは数えない(採用の中で先に解くため)。"""
    if not event_ids:
        return set()
    ex_seg = [uuid.UUID(x) for x in (exclude_segments or set())]
    ex_res = [uuid.UUID(x) for x in (exclude_reservations or set())]
    related: Set[str] = set()
    for table in Base.metadata.sorted_tables:
        if table.name == "travel_events":
            continue
        for col in table.columns:
            if any(fk.column.table.name == "travel_events" for fk in col.foreign_keys):
                q = select(col).where(col.in_(event_ids))
                if table.name == "travel_segments" and ex_seg:
                    q = q.where(table.c.id.notin_(ex_seg))
                if table.name == "reservations" and ex_res:
                    q = q.where(table.c.id.notin_(ex_res))
                if table.name == "event_reservations" and ex_res:
                    q = q.where(table.c.reservation_id.notin_(ex_res))
                rows = db.execute(q.distinct()).all()
                related.update(str(r[0]) for r in rows if r[0] is not None)
    links = db.query(DocumentLink.entity_id).filter(
        DocumentLink.entity_type == "event", DocumentLink.entity_id.in_(event_ids)).all()
    for (eid,) in links:
        related.add(str(eid))
    return related


def apply_time(event: TravelEvent, day: Any, new_time: Optional[str], old_time: Any = None,
               old_date: Any = None) -> None:
    """時刻を変えた予定は、開始日時(start_at)を持っていれば同じ日の新しい時刻へ合わせ、終了も同じだけずらす。
    [Gate G7] FR-005 start_at の無い予定(画面で作った予定)も、終了(end_at)を開始と同じだけずらす(old_time・old_date が
    分かる時。日をまたぐ予定の所要時間を保つ)。"""
    if event.start_at is None:
        from app.services import event_times as et

        if old_date is not None and old_date != day.local_date and event.end_at is not None:
            event.end_at = et._aware(event.end_at) + (day.local_date - old_date)
        if new_time is None:
            event.end_at = None  # 開始の無い予定に終了だけを残さない
            return
        et.shift_end_with_start(event, day.local_date, day.timezone_id, old_time, new_time)
        return
    if new_time is None:
        event.start_at = None
        event.end_at = None
        return
    h, m = (int(x) for x in new_time.split(":"))
    new_start = datetime.combine(day.local_date, time_cls(h, m), tzinfo=zone_for(day.timezone_id))
    old_start = event.start_at if event.start_at.tzinfo else event.start_at.replace(tzinfo=dt_timezone.utc)
    if event.end_at is not None:
        old_end = event.end_at if event.end_at.tzinfo else event.end_at.replace(tzinfo=dt_timezone.utc)
        event.end_at = new_start + (old_end - old_start)
    event.start_at = new_start


def apply_ops(db: Session, plan: TravelPlan, ops: List[Dict[str, Any]],
              keyed: Optional[Dict[str, uuid.UUID]] = None) -> List[tuple]:
    """差分(ops)を本案の予定へ当て、変更セット用の (entity_type, id, action, before, after) を返す。
    [Gate P10] 再計画の承認(app/api/v1/replans.py)でも同じ処理を使うため関数に切り出した。
    [Gate G8] keyed を渡すと、足した予定の key → 新しい予定の ID を入れる(区間・予約の付け替えで使う)。"""
    days = {str(d.id): d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}
    changes: List[tuple] = []
    for o in ops:
        if o["op"] == "add":
            f = o["fields"]
            ev = TravelEvent(id=uuid.uuid4(), plan_id=plan.id, day_id=uuid.UUID(f["day_id"]), title=f["title"],
                             event_type=f["event_type"], local_start_time=f["local_start_time"],
                             is_all_day=f["is_all_day"], sort_order=f["sort_order"])
            db.add(ev)
            db.flush()
            if keyed is not None and o.get("key"):
                keyed[o["key"]] = ev.id
            changes.append(("travel_event", ev.id, "create", None, _event_to_dict(ev)))
        elif o["op"] == "remove":
            gone = db.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(o["event_id"])).first()
            if gone is None:
                continue
            ev = gone
            changes.append(("travel_event", ev.id, "delete", _event_to_dict(ev), None))
            db.delete(ev)
        else:
            target = db.query(TravelEvent).filter(TravelEvent.id == uuid.UUID(o["event_id"])).first()
            if target is None:
                continue
            ev = target
            before = _event_to_dict(ev)
            f = o["fields"]
            old_time, old_date = ev.local_start_time, days[str(ev.day_id)].local_date
            if "day_id" in f:
                ev.day_id = uuid.UUID(f["day_id"])
            for k in ("title", "event_type", "is_all_day", "sort_order"):
                if k in f:
                    setattr(ev, k, f[k])
            if "local_start_time" in f or "day_id" in f:
                new_time = f.get("local_start_time", ev.local_start_time)
                ev.local_start_time = new_time
                apply_time(ev, days[str(ev.day_id)], new_time, old_time, old_date)
            db.flush()
            changes.append(("travel_event", ev.id, "update", before, _event_to_dict(ev)))
    return changes
