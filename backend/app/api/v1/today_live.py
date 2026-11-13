"""
[Gate TDay] 旅の当日「旅帖ライブ」(docs/ux/TDay_旅の当日_旅帖ライブ.md)。

- GET    /plans/{plan_id}/today/guide    : 出発の合図(出る時刻と出所)・予定ごとの営業の照合・すきま時間・
                                           旅帖の印(実績と記録の数)・旅の何日目か・旅の前の日数(viewer 以上)
- POST   /plans/{plan_id}/today/detours  : すきま時間の寄り道の候補(前後の予定を結ぶ道の近く。保存しない)
- GET    /plans/{plan_id}/today/eta      : 同行者の「到着予定」(位置は持たない・期限内だけ)
- PUT    /plans/{plan_id}/today/eta      : 自分の到着予定を期限つきで共有する
- DELETE /plans/{plan_id}/today/eta      : 自分の共有を止める

どれも予定を変えない。隠す項目(member_policy)は当日にも出さない。
"""
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.v1 import plans as P
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.models.models import EventActual, Memory, Place, TravelDay, TravelEvent, TravelSegment, User
from app.services import eta_share, feasibility, hours_check, today_guide, today_mode
from app.services import movement as mv
from app.services import weather_fit as wf

router = APIRouter(prefix="/plans", tags=["today-live"])


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()


def _bad(code: str, message: str, status_code: int = 422) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _hours(db: Session, plan, day: TravelDay, hidden) -> Dict[str, Dict[str, Any]]:
    """その日の予定ごとの営業の照合(hours-check と同じ計算)。場所の無い予定は含めない"""
    if "event_address" in hidden:
        return {}
    from app.api.v1.places import _sources

    snap = feasibility.load_snapshot(db, plan)
    rules = mv.load_rules(db, plan)
    place_ids = {e.place_id for e in snap.events if e.day.id == day.id and e.place_id}
    sources: Dict[Any, Optional[Dict[str, Any]]] = {}
    for place in db.query(Place).filter(Place.id.in_(place_ids)).all() if place_ids else []:
        sources[place.id] = _sources(db, place).get("opening_hours")
    out: Dict[str, Dict[str, Any]] = {}
    for row in hours_check.check_day(snap, day.id, rules, sources):
        if row.get("place_id"):
            out[row["event_id"]] = {k: row.get(k) for k in (
                "status", "reason", "window_label", "closes_at", "minutes_to_close", "last_entry", "last_order",
                "estimated", "stale")}
    return out


def _estimated_ends(db: Session, plan, event_ids: List[uuid.UUID]) -> Dict[uuid.UUID, datetime]:
    snap = feasibility.load_snapshot(db, plan)
    rules = mv.load_rules(db, plan)
    out: Dict[uuid.UUID, datetime] = {}
    wanted = set(event_ids)
    for e in snap.events:
        if e.id in wanted and e.end is None:
            end = feasibility._estimated_end(e, rules)  # noqa: SLF001 - 営業時間の照合と同じ見積もり
            if end is not None:
                out[e.id] = end
    return out


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _visible_memories(db: Session, plan, user):
    return (db.query(Memory).filter(Memory.plan_id == plan.id)
            .filter((Memory.author_user_id == user.id) | (Memory.visibility == "members")))


def _day_summary(db: Session, plan, day: TravelDay, user) -> Dict[str, Any]:
    """[Gate TDay-Mock] 前の日の旅帖(予定が無い日に出す): 印の数・写真の数"""
    ev_ids = [e.id for e in db.query(TravelEvent.id).filter(TravelEvent.day_id == day.id).all()]
    visited = db.query(EventActual).filter(EventActual.plan_id == plan.id, EventActual.event_id.in_(ev_ids),
                                           EventActual.status == "visited").count() if ev_ids else 0
    photos = _visible_memories(db, plan, user).filter(Memory.event_id.in_(ev_ids), Memory.kind == "photo").count() \
        if ev_ids else 0
    return {"date": day.local_date.isoformat(), "title": day.title, "visited": visited, "photos": photos}


def _trip_summary(db: Session, plan, user) -> Dict[str, Any]:
    """[Gate TDay-Mock] 旅の最終日: 旅全体の旅帖(印・写真・ひとこと・日数)"""
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()
    order = {d.id: (d.local_date, d) for d in days}
    visited = {a.event_id for a in db.query(EventActual).filter(
        EventActual.plan_id == plan.id, EventActual.status == "visited").all()}
    evs = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id, TravelEvent.parent_event_id.is_(None)).all()

    def key(e):
        d = order.get(e.day_id)
        return (d[0] if d else datetime.max.date(), e.sort_order or 0)
    stamps = [{"event_id": str(e.id), "title": e.title, "event_type": e.event_type}
              for e in sorted(evs, key=key) if e.id in visited]
    missed = [{"event_id": str(e.id), "title": e.title} for e in sorted(evs, key=key)
              if e.id not in visited and e.event_type not in ("transport", "accommodation")]
    mem = _visible_memories(db, plan, user)
    return {"days": len({d.local_date for d in days}), "stamps": stamps[:40], "stamp_count": len(stamps),
            "photos": mem.filter(Memory.kind == "photo").count(),
            "notes": mem.filter(Memory.kind.in_(("note", "audio"))).count(), "missed": missed[:5]}


def _bookings(db: Session, plan, ids: List[uuid.UUID], hidden) -> Dict[str, Any]:
    """[Gate TDay-Mock] 今日の予定の予約(予約済み・要確認)。予約を隠すメンバーには出さない"""
    if not ids or "reservations" in hidden:
        return {}
    from app.services import booking_status as bs

    allb = bs.booking_status(db, plan)["events"]
    out = {}
    for i in ids:
        b = allb.get(str(i))
        if b and b["state"] in ("booked", "issue"):
            out[str(i)] = {"state": b["state"], "issues": b["issues"], "reservations": b["reservations"]}
    return out


def _lodging(db: Session, plan, today_events, events_out: Dict[str, Any], bookings: Dict[str, Any],
             hidden) -> Optional[Dict[str, Any]]:
    """[Gate TDay-Mock] 今日の宿(宿の到着ガイド・宿へ帰る)。宿の予定が無ければ None"""
    from app.models.models import Reservation

    acc = [t for t in today_events if t.event.event_type == "accommodation"]
    if not acc:
        return None
    t = acc[-1]
    e = t.event
    hide_place = "event_address" in hidden
    b = bookings.get(str(e.id))
    res = next((r for r in (b["reservations"] if b else []) if r["type"] == "accommodation"), None)
    notes = None
    nights = None
    if res is not None:
        row = db.query(Reservation).filter(Reservation.id == uuid.UUID(res["id"])).first()
        if row is not None:
            notes = (row.notes or None) if "reservations" not in hidden else None
            if row.start_at and row.end_at:
                nights = max(0, (row.end_at.date() - row.start_at.date()).days) or None
    g = events_out.get(str(e.id), {})
    return {
        "event_id": str(e.id), "title": e.title, "start_at": _iso(t.start),
        "address": None if hide_place else e.address, "phone": None if hide_place else e.phone,
        "latitude": None if hide_place or e.latitude is None else float(e.latitude),
        "longitude": None if hide_place or e.longitude is None else float(e.longitude),
        "check_in": res["start"][11:16] if res and res.get("start") else None,
        "booking": b["state"] if b else None, "guest_count": res.get("guest_count") if res else None,
        "nights": nights, "notes": notes, "memo": g.get("memo"), "entrance_note": g.get("entrance_note"),
    }


def _incoming_segments(db: Session, plan, event_ids: List[uuid.UUID]) -> Dict[uuid.UUID, TravelSegment]:
    """予定へ向かう区間(取り消し・控えの案の区間は除く。経路を採用した区間を優先)"""
    if not event_ids:
        return {}
    out: Dict[uuid.UUID, TravelSegment] = {}
    for seg in db.query(TravelSegment).filter(
            TravelSegment.plan_id == plan.id, TravelSegment.to_event_id.in_(event_ids),
            TravelSegment.status != "cancelled", TravelSegment.variant_standby.is_(False)).all():
        to_id = seg.to_event_id
        if to_id is None:
            continue
        cur = out.get(to_id)
        if cur is None or (cur.route_option_id is None and seg.route_option_id is not None):
            out[to_id] = seg
    return out


@router.get("/{plan_id}/today/guide")
def today_guide_view(plan_id: str, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    from app.services import weather_fit as wf

    plan, hidden = P._plan_hidden(db, plan_id, current_user, "viewer")
    days = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()
    now = today_mode.utcnow()
    sel = today_mode.select_today(days, now)
    dates = sorted({d.local_date for d in days})
    day = sel.today_days[0] if sel.today_days else None

    upcoming = None
    if day is None and days:
        # 旅の前: いちばん近い先の日(その日のタイムゾーンの今日より後)
        future = sorted((d for d in days if d.local_date > now.astimezone(today_mode.zone_for(d.timezone_id)).date()),
                        key=lambda d: d.local_date)
        if future:
            f = future[0]
            local_today = now.astimezone(today_mode.zone_for(f.timezone_id)).date()
            timed_f = [e for e in sorted(f.events, key=lambda e: e.sort_order)
                       if today_mode.effective_start(e, f)[0] is not None]
            first = timed_f[0] if timed_f else None
            upcoming = {"date": f.local_date.isoformat(), "days_until": (f.local_date - local_today).days,
                        "event_count": len(timed_f),
                        "day_title": f.title, "is_trip_start": f.local_date == dates[0],
                        "first_event_title": first.title if first is not None else None,
                        "first_event_time": (first.local_start_time or None) if first is not None else None}

    base: Dict[str, Any] = {
        "plan_id": str(plan.id), "server_time": _iso(now),
        "day_id": str(day.id) if day is not None else None,
        "day_title": day.title if day is not None else None,
        "local_date": sel.today_date.isoformat() if sel.today_date else None,
        "timezone_id": sel.timezone_id,
        "day_index": (dates.index(sel.today_date) + 1) if sel.today_date in dates else None,
        "day_count": len(dates),
        "is_last_day": bool(sel.today_date and dates and sel.today_date == dates[-1]),
        "upcoming": upcoming, "next_day": None, "min_gap_minutes": today_guide.MIN_GAP_MINUTES,
        "events": {}, "gaps": [], "stamps": {}, "metrics": {"visited": 0, "total": 0, "photos": 0, "notes": 0},
        "bookings": {}, "lodging": None, "day_photos": [], "trip": None, "prev_day": None,
    }
    if day is None:
        return base
    earlier = sorted((d for d in days if d.local_date < day.local_date), key=lambda d: d.local_date)
    if earlier:
        base["prev_day"] = _day_summary(db, plan, earlier[-1], current_user)
    later = sorted((d for d in days if d.local_date > day.local_date), key=lambda d: d.local_date)
    if later:
        n = later[0]
        timed: List[tuple] = []
        for e in n.events:
            st = today_mode.effective_start(e, n)[0]
            if e.parent_event_id is None and st is not None:
                timed.append((st, e))
        timed.sort(key=lambda x: x[0])
        base["next_day"] = {"date": n.local_date.isoformat(), "day_title": n.title, "event_count": len(timed),
                            "first_event_title": timed[0][1].title if timed else None,
                            "first_event_time": timed[0][1].local_start_time if timed else None}

    today_events = [t for t in sel.events if t.is_today]
    responses = P._today_event_responses(db, today_events, hidden)
    hide_place = "event_address" in hidden
    ends = _estimated_ends(db, plan, [t.event.id for t in today_events])
    hours = _hours(db, plan, day, hidden)

    segs = _incoming_segments(db, plan, [t.event.id for t in today_events])
    # [Gate TDay-Mock] 次の場所の詳しい情報(入口・目印・場所のメモ・自分のメモ)
    place_ids = [t.event.place_id for t in today_events if t.event.place_id is not None]
    places = ({p.id: p for p in db.query(Place).filter(Place.id.in_(place_ids)).all()}
              if place_ids and not hide_place else {})
    hide_notes = "event_notes" in hidden

    events_out: Dict[str, Any] = {}
    slots: List[today_guide.Slot] = []
    prev: Optional[TravelEvent] = None
    for t in today_events:
        e = t.event
        r = responses.get(e.id)
        dep = None
        if r is not None and r.departure_at is not None:
            dep = r.departure_at if r.departure_at.tzinfo else r.departure_at.replace(tzinfo=timezone.utc)
        travel = None if hide_place else today_guide.estimate_travel(prev, e, r.transport_mode if r else None)
        seg = segs.get(e.id)
        # [Gate TDay-Transit] 区間に所要時間があればそれを使う(手で入れた=乗換を調べた時刻は manual、
        # 見積もりの区間は estimate のまま)
        source = "segment" if dep is not None else ("estimate" if travel else None)
        if seg is not None and seg.duration_minutes is not None and not hide_place:
            travel = {"minutes": max(1, int(round(float(seg.duration_minutes)))), "mode": seg.mode,
                      "distance_km": seg.distance_km if seg.distance_km is not None
                      else (travel["distance_km"] if travel else None)}
            if dep is None:
                source = "estimate" if seg.is_estimate else "manual"
        minutes = travel["minutes"] if travel else None
        leave = today_guide.leave_by(t.start, dep, minutes)
        end = t.end or ends.get(e.id)
        slots.append(today_guide.Slot(str(e.id), t.start, end, minutes, leave))
        events_out[str(e.id)] = {
            "event_id": str(e.id),
            "place_id": None if hide_place or e.place_id is None else str(e.place_id),
            "phone": None if hide_place else e.phone,
            "image_memory_id": str(e.image_memory_id) if e.image_memory_id else None,
            "end_at": _iso(end), "end_estimated": t.end is None and end is not None,
            "travel_minutes": minutes, "travel_mode": travel["mode"] if travel else (r.transport_mode if r else None),
            "distance_km": travel["distance_km"] if travel else None,
            "travel_source": source,
            "leave_by": _iso(leave),
            "start_at": _iso(t.start),
            "from_event_id": str(prev.id) if prev is not None and not hide_place else None,
            "segment_id": str(seg.id) if seg is not None else None,
            "segment_revision": seg.revision if seg is not None else None,
            "segment_departure_at": _iso(seg.planned_departure_at) if seg is not None else None,
            "fit": wf.fit(e.title, e.event_type, e.description)["fit"],
            "hours": hours.get(str(e.id)),
            "entrance_note": (places[e.place_id].entrance_note or None) if e.place_id in places else None,
            "place_note": (places[e.place_id].note or None) if e.place_id in places else None,
            "memo": None if hide_notes else (e.description or None),
            "photo_ids": [], "note_text": None, "audio_count": 0,
        }
        if e.latitude is not None and e.longitude is not None:
            prev = e

    ids = [t.event.id for t in today_events]
    actuals = {a.event_id: a for a in db.query(EventActual).filter(
        EventActual.plan_id == plan.id, EventActual.event_id.in_(ids)).all()} if ids else {}
    mems = (db.query(Memory.id, Memory.event_id, Memory.kind, Memory.body, Memory.occurred_at, Memory.created_at)
            .filter(Memory.plan_id == plan.id, Memory.event_id.in_(ids))
            .filter((Memory.author_user_id == current_user.id) | (Memory.visibility == "members")).all()) if ids else []
    counts: Dict[uuid.UUID, Dict[str, int]] = {}
    day_photos: List[Dict[str, Any]] = []
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    for m in sorted(mems, key=lambda m: _aware(m.occurred_at) or _aware(m.created_at) or epoch):
        c = counts.setdefault(m.event_id, {"memories": 0, "photos": 0})
        c["memories"] += 1
        out_e = events_out.get(str(m.event_id))
        if m.kind == "photo":
            c["photos"] += 1
            day_photos.append({"id": str(m.id), "event_id": str(m.event_id),
                               "at": _iso(_aware(m.occurred_at) or _aware(m.created_at))})
            if out_e is not None and len(out_e["photo_ids"]) < 6:
                out_e["photo_ids"].append(str(m.id))
        elif m.kind == "audio" and out_e is not None:
            out_e["audio_count"] += 1
        elif m.kind == "note" and out_e is not None and m.body:
            out_e["note_text"] = m.body[:120]
    stamps: Dict[str, Any] = {}
    for eid in ids:
        a = actuals.get(eid)
        c = counts.get(eid, {"memories": 0, "photos": 0})
        stamps[str(eid)] = {"status": a.status if a else None, "revision": a.revision if a else None,
                            "actual_start_at": _iso(a.actual_start_at) if a else None,
                            "actual_end_at": _iso(a.actual_end_at) if a else None,
                            "memory_count": c["memories"], "photo_count": c["photos"]}

    gaps = today_guide.gaps(slots, now)
    bookings = _bookings(db, plan, ids, hidden)
    return {**base, "events": events_out, "stamps": stamps, "bookings": bookings,
            "lodging": _lodging(db, plan, today_events, events_out, bookings, hidden),
            "day_photos": day_photos[-60:],
            "trip": _trip_summary(db, plan, current_user) if base["is_last_day"] else None,
            "gaps": [{**g, "start_at": _iso(g["start_at"]), "end_at": _iso(g["end_at"])} for g in gaps],
            "metrics": {"visited": sum(1 for a in actuals.values() if a.status == "visited"), "total": len(ids),
                        "photos": sum(c["photos"] for c in counts.values()),
                        "notes": sum(c["memories"] - c["photos"] for c in counts.values())}}


# ---- 寄り道の候補 ---------------------------------------------------------------------------------------------

DETOUR_QUERIES: Dict[str, tuple] = {
    "all": ("観光", "sightseeing"), "cafe": ("", "cafe"), "sweets": ("", "sweets"),
    "indoor": ("博物館", "all"), "surprise": ("穴場", "sightseeing"),
}
DETOUR_MAX_KM = 2.0
DETOUR_LIMIT = 8


class DetourIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    after_event_id: Optional[uuid.UUID] = None
    before_event_id: Optional[uuid.UUID] = None
    kind: Literal["all", "cafe", "sweets", "indoor", "surprise"] = "all"


def _wishlist_detours(db: Session, plan, points: List[tuple], already: set) -> List[Dict[str, Any]]:
    """[Gate TDay-Mock] 行きたい場所リスト(候補箱)のうち、前後の予定から近い物(位置のある・旅程に入れていない物)"""
    from app.models.models import PlanCandidate
    from app.services import route_estimator as re_

    out = []
    rows = db.query(PlanCandidate).filter(PlanCandidate.plan_id == plan.id, PlanCandidate.status == "open",
                                          PlanCandidate.latitude.isnot(None), PlanCandidate.longitude.isnot(None)).all()
    for c in rows:
        if c.title in already or c.latitude is None or c.longitude is None:
            continue
        lat, lng = float(c.latitude), float(c.longitude)
        d = min(re_.haversine_km(lat, lng, p[0], p[1]) for p in points)
        if d > DETOUR_MAX_KM:
            continue
        out.append({"name": c.title, "address": c.address,
                    "latitude": lat, "longitude": lng,
                    "distance_km": round(d, 2), "genre_label": "行きたい場所リストから", "category": c.category,
                    "provider": "wishlist", "url": None,
                    "fit": wf.fit(c.title, c.category, c.note)["fit"]})
    out.sort(key=lambda r: r["distance_km"])
    return out[:2]


@router.post("/{plan_id}/today/detours")
async def today_detours(plan_id: str, body: DetourIn, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    from app.api.v1.spot_intake import _limit, _recorder
    from app.services import place_finder as pf
    from app.services import weather_fit as wf
    from app.services import member_policy

    plan, hidden = P._plan_hidden(db, plan_id, current_user, "viewer")
    member_policy.require_visible(hidden, "event_address")
    _limit(current_user, "today-detours")
    wanted = [i for i in (body.after_event_id, body.before_event_id) if i is not None]
    evs = {e.id: e for e in db.query(TravelEvent).filter(
        TravelEvent.plan_id == plan.id, TravelEvent.id.in_(wanted)).all()} if wanted else {}
    if len(evs) != len(set(wanted)):
        raise HTTPException(status_code=404, detail="予定が見つかりません")
    points = [(float(e.latitude), float(e.longitude)) for i in wanted for e in [evs[i]]
              if e.latitude is not None and e.longitude is not None]
    if not points:
        return {"kind": body.kind, "candidates": [], "region": None, "sources": [], "failed_providers": [],
                "message": "前後の予定に場所が無いため、近くを探せません"}
    word, genre = DETOUR_QUERIES[body.kind]
    record = _recorder(db, current_user, "today.detours")
    res = await pf.find(db, plan, word, genre, "route" if len(points) >= 2 else "area", record, points=points)
    db.commit()
    already = {t for (t,) in db.query(TravelEvent.title).filter(TravelEvent.plan_id == plan.id).all()}
    rows = _wishlist_detours(db, plan, points, already) if body.kind in ("all", "surprise") else []
    for c in res.get("candidates", []):
        name = c.get("name") or ""
        d = c.get("distance_km")
        if not name or name in already or any(r["name"] == name for r in rows) or \
                (d is not None and d > DETOUR_MAX_KM):
            continue
        f = wf.fit(name, c.get("category"), None, c.get("genre"))["fit"]
        if body.kind == "indoor" and f == "outdoor":
            continue
        rows.append({"name": name, "address": c.get("address"), "latitude": c.get("latitude"),
                     "longitude": c.get("longitude"), "distance_km": d, "genre_label": c.get("genre_label"),
                     "category": c.get("category"), "provider": (c.get("providers") or [c.get("provider")])[0],
                     "url": c.get("url"), "fit": f})
        if len(rows) >= DETOUR_LIMIT:
            break
    return {"kind": body.kind, "candidates": rows, "region": res.get("region"), "sources": res.get("sources", []),
            "failed_providers": res.get("failed_providers", []), "message": None if rows else "近くに候補が見つかりませんでした"}


# ---- 到着予定の共有 -------------------------------------------------------------------------------------------

class EtaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    arrive_at: datetime
    until: datetime


@router.put("/{plan_id}/today/eta")
def put_eta(plan_id: str, body: EtaIn, background: BackgroundTasks, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    plan, _hidden = P._plan_hidden(db, plan_id, current_user, "viewer")
    for v in (body.arrive_at, body.until):
        if v.tzinfo is None:
            raise _bad("invalid_field", "時刻にはタイムゾーンを含めてください")
    now = today_mode.utcnow()
    if body.until <= now or body.until > now + timedelta(hours=eta_share.MAX_HOURS):
        raise _bad("invalid_field", f"共有の期限は今から{eta_share.MAX_HOURS}時間以内にしてください")
    if abs((body.arrive_at - now).total_seconds()) > eta_share.MAX_HOURS * 3600:
        raise _bad("invalid_field", "到着予定の時刻が今から離れすぎています")
    ev = db.query(TravelEvent).filter(TravelEvent.id == body.event_id, TravelEvent.plan_id == plan.id).first()
    if ev is None:
        raise HTTPException(status_code=404, detail="予定が見つかりません")
    eta_share.put(str(plan.id), str(current_user.id), {
        "event_id": str(body.event_id), "arrive_at": _iso(body.arrive_at), "until": body.until.timestamp()})
    out = get_eta(plan_id, db, current_user)
    # [Gate TDay-Push] 大きく遅れる時は、ほかの参加者の端末へ知らせる(応答の後に送る)
    from app.services import today_push

    me = next((s for s in out["shares"] if s["is_self"]), None)
    day = db.query(TravelDay).filter(TravelDay.id == ev.day_id).first()
    planned = today_mode.effective_start(ev, day)[0] if day is not None else None
    if me is not None and planned is not None:
        from app.api.v1.presence import _labels

        label = _labels(db, [str(current_user.id)], current_user).get(str(current_user.id), "だれか")
        if label == "あなた":
            name = getattr(current_user, "username", None)
            guest = str(getattr(getattr(current_user, "user_type", None), "value", current_user.user_type)) == "guest"
            label = "ゲスト" if guest or not name else str(name)
        targets = today_push.crew_targets(db, plan, current_user, ev, body.arrive_at.astimezone(timezone.utc),
                                          planned, day.timezone_id if day is not None else None, label)
        if targets:
            background.add_task(today_push.deliver_later, targets)
    return out


@router.delete("/{plan_id}/today/eta", status_code=204)
def delete_eta(plan_id: str, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)) -> Response:
    plan, _hidden = P._plan_hidden(db, plan_id, current_user, "viewer")
    eta_share.remove(str(plan.id), str(current_user.id))
    return Response(status_code=204)


@router.get("/{plan_id}/today/eta")
def get_eta(plan_id: str, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user_or_guest)) -> Dict[str, Any]:
    from app.api.v1.presence import _labels, _roles

    plan, _hidden = P._plan_hidden(db, plan_id, current_user, "viewer")
    roles = _roles(db, plan)  # 旅行から外れた人の共有は出さない
    rows = [r for r in eta_share.entries(str(plan.id), time.time()) if r.get("user_id") in roles]
    ev_ids = []
    for r in rows:
        try:
            ev_ids.append(uuid.UUID(str(r.get("event_id"))))
        except ValueError:
            continue
    events = {e.id: e for e in db.query(TravelEvent).filter(
        TravelEvent.plan_id == plan.id, TravelEvent.id.in_(ev_ids)).all()} if ev_ids else {}
    day_ids = {e.day_id for e in events.values()}
    days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.id.in_(day_ids)).all()} if day_ids else {}
    labels = _labels(db, [r["user_id"] for r in rows], current_user)
    out = []
    for r in rows:
        try:
            e = events.get(uuid.UUID(str(r.get("event_id"))))
        except ValueError:
            e = None
        if e is None:
            continue  # 消された予定の共有は出さない
        planned = today_mode.effective_start(e, days[e.day_id])[0] if e.day_id in days else None
        arrive = datetime.fromisoformat(str(r["arrive_at"]))
        out.append({
            "user_id": r["user_id"], "label": labels.get(r["user_id"], "だれか"),
            "is_self": r["user_id"] == str(current_user.id),
            "event_id": str(e.id), "event_title": e.title, "arrive_at": _iso(arrive),
            "planned_start_at": _iso(planned),
            "delay_minutes": int((arrive - planned).total_seconds() // 60) if planned is not None else None,
            "until": _iso(datetime.fromtimestamp(float(r["until"]), tz=timezone.utc)),
        })
    out.sort(key=lambda x: (not x["is_self"], x["label"]))
    return {"plan_id": str(plan.id), "shares": out, "max_hours": eta_share.MAX_HOURS,
            "notice": "到着予定だけを共有します(位置は送りません)。期限を過ぎると自動で消えます"}
