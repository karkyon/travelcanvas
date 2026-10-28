"""[Gate P4] しおり投影(booklet-v1)。FR-034 しおり生成 / FR-035 安全な印刷・公開 / FR-046 画像・PDF出力。

旅程の正本(travel_days / travel_events / travel_segments / reservations / packing_items / 費用)から、
選ばれた章(sections)と、含める機密項目(includes)だけを明示的なホワイトリストで組み立てる。
Web表示・印刷・PDF保存は、すべてこの1つの構造化データから描画する(同じデータから複数の出力)。

機密項目の扱い(DOC-11 / FR-035):
- 予約番号: 既定は伏字(masked)。includes.confirmation_numbers のときだけ復号した値を入れる
- 住所・座標: includes.addresses のときだけ入れる(既定は施設名だけ)
- 電話: includes.phones のときだけ予約の連絡先電話を入れる
- 参加者名: includes.participants のときだけメンバーの表示名を入れる(既定は人数だけ)
- QR・チケットの中身・PIN・名義・個人の持ち物・個人予算は、どの設定でも入れない
"""
from dataclasses import dataclass
from datetime import date, datetime, timezone as dt_timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, overload
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_payload
from app.models.models import (
    Budget,
    EventReservation,
    Expense,
    PackingItem,
    PlanFinanceSettings,
    Place,
    PreparationTask,
    Reservation,
    Spot,
    Ticket,
    TravelDay,
    TravelEvent,
    TravelPlan,
    TravelSegment,
)
from app.services import finance
from app.services.constraint_evaluation import member_user_ids
from app.services.readiness import member_names

POLICY_VERSION = "booklet-v1"
THEMES = ("cute", "simple", "family", "school", "business", "accessible", "mono")
DENSITIES = ("normal", "compact")
FORMATS = ("web", "print")
# 表示順(利用者がどの順で選んでも、この順に並べる)
SECTIONS = ("cover", "toc", "schedule", "map", "reservations", "packing", "contacts", "costs", "notes")
INCLUDE_KEYS = ("confirmation_numbers", "addresses", "phones", "participants")
ACTIVE_RESERVATION = {"candidate", "confirmed", "modified", "used"}


@dataclass(frozen=True)
class Options:
    theme: str
    density: str
    format: str
    sections: Sequence[str]
    includes: Dict[str, bool]

    @property
    def contains_sensitive(self) -> bool:
        return any(self.includes.get(k) for k in INCLUDE_KEYS)


def normalize_sections(sections: Sequence[str]) -> List[str]:
    chosen = set(sections)
    return [s for s in SECTIONS if s in chosen]


@overload
def _aware(dt: datetime) -> datetime: ...


@overload
def _aware(dt: None) -> None: ...


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)


def _zone(tz: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_text(dt: Optional[datetime], tz: Optional[str]) -> Optional[str]:
    """現地時刻の表示文字列(YYYY-MM-DD HH:MM)。印刷物は端末の時刻帯に依存させない。"""
    dt = _aware(dt)
    if dt is None:
        return None
    return dt.astimezone(_zone(tz)).strftime("%Y-%m-%d %H:%M")


def _date_text(d) -> Optional[str]:
    if d is None:
        return None
    if isinstance(d, datetime):
        return _aware(d).date().isoformat()
    if isinstance(d, date):
        return d.isoformat()
    return None


def _decrypt(ciphertext: Optional[bytes]) -> Optional[str]:
    if not ciphertext:
        return None
    try:
        return decrypt_payload(ciphertext).decode("utf-8")
    except Exception:  # noqa: BLE001 - 復号できない値は「無い」として扱い、例外で出力全体を止めない
        return None


def _plain(d: Optional[Decimal]) -> Optional[str]:
    if d is None:
        return None
    return format(d.normalize(), "f") if d == d.to_integral() else format(d, "f")


def _places(db: Session, events: Sequence[TravelEvent]):
    place_ids = {e.place_id for e in events if e.place_id}
    spot_ids = {e.spot_id for e in events if e.spot_id}
    places = {p.id: p for p in db.query(Place).filter(Place.id.in_(place_ids)).all()} if place_ids else {}
    spots = {s.id: s for s in db.query(Spot).filter(Spot.id.in_(spot_ids)).all()} if spot_ids else {}
    return places, spots


def _event_place(e: TravelEvent, places, spots):
    """(施設名, 住所, 緯度, 経度)。イベント自身の値を優先し、無ければ場所・スポットから補う。"""
    src = places.get(e.place_id) if e.place_id else None
    if src is None and e.spot_id:
        src = spots.get(e.spot_id)
    name = getattr(src, "name", None)
    address = e.address or getattr(src, "address", None)
    lat = e.latitude if e.latitude is not None else getattr(src, "latitude", None)
    lon = e.longitude if e.longitude is not None else getattr(src, "longitude", None)
    return name, address, lat, lon


def _reservation_summary(r: Reservation, inc: Dict[str, bool]) -> Dict[str, Any]:
    confirmation = r.confirmation_number_masked
    full = False
    if inc.get("confirmation_numbers"):
        value = _decrypt(r.confirmation_number_ciphertext)
        if value:
            confirmation, full = value, True
    return {
        "type": r.type,
        "provider_name": r.provider_name,
        "status": r.status,
        "start": local_text(r.start_at, r.timezone_id),
        "end": local_text(r.end_at, r.timezone_id),
        "timezone_id": r.timezone_id,
        "guest_count": r.guest_count,
        "confirmation": confirmation,
        "confirmation_is_full": full,
        "contact_phone": _decrypt(r.contact_phone_ciphertext) if inc.get("phones") else None,
        "cancellation_deadline": local_text(r.cancellation_deadline, r.timezone_id),
        "payment_status": r.payment_status,
    }


def build(db: Session, plan: TravelPlan, viewer, opts: Options, input_revision: Optional[int] = None,
          now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(dt_timezone.utc)
    inc = {k: bool(opts.includes.get(k)) for k in INCLUDE_KEYS}
    sections = normalize_sections(opts.sections)
    warnings: List[str] = []
    notes: List[str] = []

    days = (db.query(TravelDay).filter(TravelDay.plan_id == plan.id)
            .order_by(TravelDay.local_date.asc(), TravelDay.sort_order.asc()).all())
    day_by_id = {d.id: d for d in days}
    events = (db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id)
              .order_by(TravelEvent.sort_order.asc()).all())
    places, spots = _places(db, events)
    reservations = (db.query(Reservation)
                    .filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
                    .order_by(Reservation.start_at.asc().nulls_last()).all())
    res_by_id = {r.id: r for r in reservations}
    default_tz = days[0].timezone_id if days else "UTC"

    # 予定に紐付く予約(event_reservations と reservations.event_id の両方)
    links: Dict[Any, List[Reservation]] = {}
    for r in reservations:
        if r.event_id:
            links.setdefault(r.event_id, []).append(r)
    if events:
        for er in db.query(EventReservation).filter(EventReservation.event_id.in_([e.id for e in events])).all():
            linked = res_by_id.get(er.reservation_id)
            if linked is not None and linked not in links.setdefault(er.event_id, []):
                links[er.event_id].append(r)

    members = member_user_ids(db, plan)
    out: Dict[str, Any] = {
        "policy_version": POLICY_VERSION,
        "plan_id": str(plan.id),
        "theme": opts.theme,
        "density": opts.density,
        "format": opts.format,
        "sections": sections,
        "includes": inc,
        "contains_sensitive": opts.contains_sensitive,
        "generated_at": now.isoformat(),
        "input_revision": input_revision if input_revision is not None else plan.revision,
        "current_revision": plan.revision,
        "is_stale": input_revision is not None and input_revision != plan.revision,
        "data_as_of": (_aware(plan.updated_at) or _aware(plan.created_at) or now).isoformat(),
        "cover": None, "schedule": None, "map": None, "reservations": None, "packing": None,
        "contacts": None, "costs": None, "notes": None,
    }
    if out["is_stale"]:
        warnings.append("stale_revision")
    if opts.contains_sensitive:
        warnings.append("contains_sensitive")

    if "cover" in sections:
        out["cover"] = {
            "title": plan.title,
            "destination": plan.destination,
            "start_date": _date_text(plan.start_date) or (days[0].local_date.isoformat() if days else None),
            "end_date": _date_text(plan.end_date) or (days[-1].local_date.isoformat() if days else None),
            "day_count": len(days),
            "member_count": len(members),
        }

    if "schedule" in sections:
        events_by_day: Dict[Any, List[TravelEvent]] = {}
        for e in events:
            events_by_day.setdefault(e.day_id, []).append(e)
        segs = (db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id)
                .order_by(TravelSegment.planned_departure_at.asc().nulls_last()).all())
        ev_by_id = {e.id: e for e in events}
        seg_places = {p.id: p for p in db.query(Place).filter(
            Place.id.in_({s.from_place_id for s in segs if s.from_place_id}
                         | {s.to_place_id for s in segs if s.to_place_id})).all()} if segs else {}

        def endpoint(event_id, place_id) -> Optional[str]:
            if event_id and event_id in ev_by_id:
                return ev_by_id[event_id].title
            if place_id and place_id in seg_places:
                return seg_places[place_id].name
            return None

        def seg_tz(s: TravelSegment) -> str:
            ev = ev_by_id.get(s.from_event_id) if s.from_event_id else None
            day = day_by_id.get(ev.day_id) if ev else None
            return day.timezone_id if day else default_tz

        sched_days = []
        for d in days:
            day_events = []
            for e in events_by_day.get(d.id, []):
                name, address, _, _ = _event_place(e, places, spots)
                day_events.append({
                    "title": e.title,
                    "event_type": e.event_type,
                    "local_start_time": e.local_start_time,
                    "is_all_day": e.is_all_day,
                    "end": local_text(e.end_at, d.timezone_id),
                    "place_name": name,
                    "address": address if inc["addresses"] else None,
                    "locked": e.locked,
                    "reservations": [{"type": r.type, "provider_name": r.provider_name, "status": r.status}
                                     for r in links.get(e.id, [])],
                })
            sched_days.append({"date": d.local_date.isoformat(), "title": d.title, "timezone_id": d.timezone_id,
                               "events": day_events})
        out["schedule"] = {
            "days": sched_days,
            "transport": [{
                "mode": s.mode,
                "from_label": endpoint(s.from_event_id, s.from_place_id),
                "to_label": endpoint(s.to_event_id, s.to_place_id),
                "departure": local_text(s.planned_departure_at, seg_tz(s)),
                "arrival": local_text(s.planned_arrival_at, seg_tz(s)),
                "duration_minutes": int(round(s.duration_minutes)) if s.duration_minutes is not None else None,
                "transport_number": s.transport_number,
                "platform": s.platform,
                "status": s.status,
                "is_estimate": s.is_estimate,
            } for s in segs],
        }

    if "map" in sections:
        seen = set()
        rows = []
        for e in events:
            name, address, lat, lon = _event_place(e, places, spots)
            label = name or e.title
            key = (label, address if inc["addresses"] else None)
            if key in seen:
                continue
            seen.add(key)
            day = day_by_id.get(e.day_id)
            rows.append({
                "label": label,
                "date": day.local_date.isoformat() if day else None,
                "address": address if inc["addresses"] else None,
                "latitude": round(lat, 5) if inc["addresses"] and lat is not None else None,
                "longitude": round(lon, 5) if inc["addresses"] and lon is not None else None,
            })
        out["map"] = {"places": rows}

    tickets = 0
    if reservations:
        tickets = (db.query(Ticket).filter(Ticket.reservation_id.in_([r.id for r in reservations]),
                                           Ticket.deleted_at.is_(None)).count())
    if "reservations" in sections:
        out["reservations"] = [_reservation_summary(r, inc) for r in reservations]
        if tickets:
            warnings.append("qr_not_included")

    if "packing" in sections:
        items = (db.query(PackingItem)
                 .filter(PackingItem.plan_id == plan.id, PackingItem.deleted_at.is_(None),
                         PackingItem.scope == "shared")
                 .order_by(PackingItem.category.asc(), PackingItem.created_at.asc()).all())
        out["packing"] = [{"name": i.name, "category": i.category, "quantity": i.quantity,
                           "is_required": i.is_required, "status": i.status} for i in items]

    if "contacts" in sections:
        names = member_names(db, members) if inc["participants"] else {}
        out["contacts"] = {
            "member_count": len(members),
            "members": sorted(names.values()) if inc["participants"] else None,
            "reservation_contacts": [
                {"provider_name": r.provider_name, "type": r.type, "phone": _decrypt(r.contact_phone_ciphertext),
                 "url": r.contact_url}
                for r in reservations if r.contact_phone_ciphertext
            ] if inc["phones"] else None,
            "hidden": [k for k in ("participants", "phones") if not inc[k]],
        }

    if "costs" in sections:
        out["costs"] = _costs(db, plan)
        if out["costs"]["unconverted_expenses"]:
            warnings.append("unconverted_expenses")

    if "notes" in sections:
        for r in reservations:
            dl = _aware(r.cancellation_deadline)
            if dl is not None and dl > now and r.status in ACTIVE_RESERVATION:
                notes.append(f"{r.provider_name or '予約'}の無料取消期限: {local_text(dl, r.timezone_id)}")
        open_tasks = (db.query(PreparationTask)
                      .filter(PreparationTask.plan_id == plan.id, PreparationTask.deleted_at.is_(None),
                              PreparationTask.status == "open").count())
        if open_tasks:
            notes.append(f"未完了の準備タスクが{open_tasks}件あります(作成時点)。")
        if tickets:
            notes.append("チケット・QRコードは印刷物に含めていません。当日はアプリのチケット画面で表示してください。")
        if opts.contains_sensitive:
            notes.append("この版には機密情報が含まれます。紛失・置き忘れに注意し、有効期限後は破棄してください。")
        notes.append("この版は作成時点の情報です。最新の予定はアプリで確認してください。")
        out["notes"] = notes

    out["warnings"] = warnings
    return out


def _costs(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    """費用の章: 旅行全体とカテゴリ別の予算・実績(基準通貨)。個人の予算・個人別の負担は入れない。"""
    settings_row = db.query(PlanFinanceSettings).filter(PlanFinanceSettings.plan_id == plan.id).first()
    base = settings_row.base_currency if settings_row else "JPY"
    expenses = db.query(Expense).filter(Expense.plan_id == plan.id, Expense.deleted_at.is_(None)).all()
    unconverted = 0
    total = 0
    by_cat: Dict[str, int] = {}
    for e in expenses:
        if e.base_amount is None:
            unconverted += 1
            continue
        v = finance.to_minor(e.base_amount, base) * (-1 if e.kind == "refund" else 1)
        total += v
        by_cat[e.category] = by_cat.get(e.category, 0) + v
    budgets = db.query(Budget).filter(Budget.plan_id == plan.id, Budget.deleted_at.is_(None)).all()
    total_budget = next((b.amount for b in budgets if b.kind == "total"), None)
    cat_budgets = {b.category: b.amount for b in budgets if b.kind == "category" and b.category is not None}

    def money(minor: int) -> str:
        return str(finance.from_minor(minor, base))

    rows = []
    for cat in sorted(set(by_cat) | set(cat_budgets)):
        b = cat_budgets.get(cat)
        actual = by_cat.get(cat, 0)
        rows.append({"category": cat, "budget": _plain(b), "actual": money(actual),
                     "over": b is not None and actual > finance.to_minor(b, base)})
    return {
        "base_currency": base,
        "budget_total": _plain(total_budget),
        "actual_total": money(total),
        "over": total_budget is not None and total > finance.to_minor(total_budget, base),
        "by_category": rows,
        "unconverted_expenses": unconverted,
    }
