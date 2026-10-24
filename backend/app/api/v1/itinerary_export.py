"""
[Gate P5] FR-036 カレンダー・地図の書き出し(FC-091 ICS / FC-092 KML・GPX)と表計算用CSV。DOC-04 SC-27。

エンドポイント(すべて /plans/{plan_id}/exports 配下、viewer以上。応答はファイル):
- GET calendar.ics   ?include_addresses=false              : 予定と移動のカレンダー(iCalendar)
- GET places.gpx     ?precision=approx&exclude_accommodation=true : 訪問地点と日ごとの順路(GPX 1.1)
- GET places.kml     ?precision=approx&exclude_accommodation=true : 同上(KML 2.2)
- GET itinerary.csv  ?include_addresses=false              : 予定の一覧(UTF-8 BOM付き、CSV injection対策)

予約番号・PIN・チケット・メモ・参加者名は、どの形式にも含めない。住所・正確な位置・宿泊場所は利用者が選んだ時だけ。
応答ヘッダー X-Export-Count(書き出した件数)・X-Export-Skipped(位置が無い等で書き出さなかった件数)・
X-Export-Excluded(利用者の選択で除外した件数)を返す。監査には形式・選択・件数だけを記録する。

外部からの取込(差分確認後の適用)は今回の範囲外(ADR-itinerary-export.md)。

[Gate G2] FR-045 所有者が「予定の住所・位置」を隠した参加者: ICS・CSV に住所を入れない(選んでも無視)、
GPX・KML は 403。「予約」を隠した参加者: 予約の種類を使わない。
"""
from datetime import datetime, timezone as dt_timezone
from typing import Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.services import member_policy
from app.models.models import (
    EventReservation, Place, Reservation, Spot, TravelDay, TravelEvent, TravelPlan, TravelSegment, User,
)
from app.services import itinerary_export as ix
from app.services.audit_service import record_audit_event
from app.services.today_mode import effective_start, zone_for

router = APIRouter(prefix="/plans", tags=["itinerary-export"])

MEDIA = {
    "ics": "text/calendar; charset=utf-8",
    "gpx": "application/gpx+xml; charset=utf-8",
    "kml": "application/vnd.google-earth.kml+xml; charset=utf-8",
    "csv": "text/csv; charset=utf-8",
}


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _collect(db: Session, plan: TravelPlan, hidden=member_policy.EMPTY):
    days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
            .order_by(TravelDay.local_date.asc(), TravelDay.sort_order.asc()).all())
    order = {d.id: i for i, d in enumerate(days)}
    day_by_id = {d.id: d for d in days}
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    events = [e for e in events if e.day_id in day_by_id]
    events.sort(key=lambda e: (order[e.day_id], e.sort_order))
    place_ids = {e.place_id for e in events if e.place_id}
    spot_ids = {e.spot_id for e in events if e.spot_id}
    places = {p.id: p for p in db.query(Place).filter(Place.id.in_(place_ids)).all()} if place_ids else {}
    spots = {s.id: s for s in db.query(Spot).filter(Spot.id.in_(spot_ids)).all()} if spot_ids else {}

    reservations = [] if "reservations" in hidden else (
        db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None)).all())
    res_by_id = {r.id: r for r in reservations}
    linked: Dict[object, List[Reservation]] = {}
    for r in reservations:
        if r.event_id:
            linked.setdefault(r.event_id, []).append(r)
    if events and reservations:
        for er in db.query(EventReservation).filter(EventReservation.event_id.in_([e.id for e in events])).all():
            r = res_by_id.get(er.reservation_id)
            if r is not None and r not in linked.setdefault(er.event_id, []):
                linked[er.event_id].append(r)

    out: List[ix.ExportEvent] = []
    hide_place = "event_address" in hidden
    for e in events:
        d = day_by_id[e.day_id]
        src = places.get(e.place_id) if e.place_id else None
        if src is None and e.spot_id:
            src = spots.get(e.spot_id)
        start, _ = effective_start(e, d)
        end = e.end_at
        if end is not None and end.tzinfo is None:
            end = end.replace(tzinfo=dt_timezone.utc)
        res_types = [r.type for r in linked.get(e.id, [])]
        out.append(ix.ExportEvent(
            id=str(e.id), title=e.title, event_type=e.event_type, local_date=d.local_date,
            timezone_id=d.timezone_id, start=start, end=end, is_all_day=e.is_all_day,
            local_start_time=e.local_start_time, place_name=getattr(src, "name", None),
            address=None if hide_place else (e.address or getattr(src, "address", None)),
            latitude=None if hide_place else (e.latitude if e.latitude is not None else getattr(src, "latitude", None)),
            longitude=None if hide_place else (
                e.longitude if e.longitude is not None else getattr(src, "longitude", None)),
            locked=e.locked,
            is_accommodation=e.event_type in ix.ACCOMMODATION_TYPES or "accommodation" in res_types,
            reservation_types=sorted(set(res_types)),
        ))

    ev_by_id = {e.id: e for e in events}
    segs = db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id).all()
    seg_places = {p.id: p for p in db.query(Place).filter(
        Place.id.in_({s.from_place_id for s in segs if s.from_place_id}
                     | {s.to_place_id for s in segs if s.to_place_id})).all()} if segs else {}

    def label(event_id, place_id) -> Optional[str]:
        if event_id and event_id in ev_by_id:
            return ev_by_id[event_id].title
        if place_id and place_id in seg_places:
            return seg_places[place_id].name
        return None

    seg_out = [ix.ExportSegment(
        id=str(s.id), mode=s.mode, from_label=label(s.from_event_id, s.from_place_id),
        to_label=label(s.to_event_id, s.to_place_id), departure=s.planned_departure_at,
        arrival=s.planned_arrival_at, transport_number=s.transport_number, status=s.status,
    ) for s in segs]
    seg_out.sort(key=lambda s: (s.departure is None, s.departure or _now()))
    return days, out, seg_out


def _file(content: str, ext: str, plan: TravelPlan, headers: Dict[str, str]) -> Response:
    ascii_name = f"travelcanvas-plan.{ext}"
    utf8_name = quote(f"{plan.title or 'travelcanvas'}.{ext}")
    return Response(content=content.encode("utf-8"), media_type=MEDIA[ext], headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}",
        "Cache-Control": "no-store",
        **headers,
    })


def _audit(request: Request, user: User, plan: TravelPlan, fmt: str, details: dict) -> None:
    record_audit_event(
        action="itinerary_exported", resource_type="travel_plan", user_id=user.id, resource_id=plan.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # 予定名・住所・位置は記録しない
        details={"plan_id": str(plan.id), "format": fmt, **details},
    )


def _counts(count: int, skipped: int = 0, excluded: int = 0) -> Dict[str, str]:
    return {"X-Export-Count": str(count), "X-Export-Skipped": str(skipped), "X-Export-Excluded": str(excluded)}


@router.get("/{plan_id}/exports/calendar.ics")
def export_ics(plan_id: str, request: Request, include_addresses: bool = Query(False),
               db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    include_addresses = include_addresses and "event_address" not in hidden
    days, events, segs = _collect(db, plan, hidden)
    timed_segs = [s for s in segs if s.departure is not None]
    body = ix.build_ics(plan.title, days[0].timezone_id if days else None, plan.revision, events, segs,
                        include_addresses, _now())
    count = len(events) + len(timed_segs)
    _audit(request, current_user, plan, "ics", {"include_addresses": include_addresses, "count": count})
    return _file(body, "ics", plan, _counts(count, skipped=len(segs) - len(timed_segs)))


def _geo(fmt: str, plan_id: str, request: Request, precision: str, exclude_accommodation: bool, db: Session,
         user: User) -> Response:
    plan, _, hidden = member_policy.require_access(db, plan_id, user, "viewer", "event_address")
    _, events, _ = _collect(db, plan, hidden)
    # [Gate G6] LOC-02 旅行の所有者と書き出す本人の守る範囲(自宅・職場など)の中の地点は書き出さない
    from app.services import location_privacy as lp

    zones = lp.zones_for(db, {plan.user_id, user.id})
    points, no_location, lodging = ix.waypoints(events, precision, exclude_accommodation, zones)
    body = ix.build_gpx(plan.title, points, precision, _now()) if fmt == "gpx" else \
        ix.build_kml(plan.title, points, precision)
    _audit(request, user, plan, fmt, {"precision": precision, "exclude_accommodation": exclude_accommodation,
                                      "count": len(points)})
    return _file(body, fmt, plan, _counts(len(points), skipped=no_location, excluded=lodging))


@router.get("/{plan_id}/exports/places.gpx")
def export_gpx(plan_id: str, request: Request, precision: str = Query("approx", pattern="^(approx|exact)$"),
               exclude_accommodation: bool = Query(True), db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    return _geo("gpx", plan_id, request, precision, exclude_accommodation, db, current_user)


@router.get("/{plan_id}/exports/places.kml")
def export_kml(plan_id: str, request: Request, precision: str = Query("approx", pattern="^(approx|exact)$"),
               exclude_accommodation: bool = Query(True), db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    return _geo("kml", plan_id, request, precision, exclude_accommodation, db, current_user)


@router.get("/{plan_id}/exports/itinerary.csv")
def export_csv(plan_id: str, request: Request, include_addresses: bool = Query(False),
               db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    include_addresses = include_addresses and "event_address" not in hidden
    _, events, _ = _collect(db, plan, hidden)

    def local_hm(dt: datetime, tz: str) -> str:
        return dt.astimezone(zone_for(tz)).strftime("%H:%M")

    body = ix.build_csv(events, include_addresses, local_hm)
    _audit(request, current_user, plan, "csv", {"include_addresses": include_addresses, "count": len(events)})
    return _file(body, "csv", plan, _counts(len(events)))
