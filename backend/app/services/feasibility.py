"""
[Gate L3] FR-017 実行可能性検証の判定エンジン(algorithm_version = feasibility-v1)。

DOC-02 FR-017: 時間重複、移動不足、営業時間外、予約不一致、滞在不足、予算超過、
休憩不足、最終交通逸失、未確認情報を検出し、ERROR/WARNING/INFOに分類して根拠・
影響・修正候補を示す。**検証不能を「問題なし」にしない。**

構成:
- load_snapshot(db, plan): DBから判定に必要な値だけを読み出す(ここだけがDBに触れる)
- evaluate(snapshot, constraints): 純粋関数。問題(Finding)と制約ごとの結果を返す

判定の方針(推定で「問題なし」にしない):
- 画面で作った予定は開始時刻(local_start_time)しか持たないことが多い。終了が
  分からない予定は、終了を必要とする判定では「検証不能」とする。開始時刻だけで
  確実に違反と言える場合(例: 開始の時点で既に上限時刻を過ぎている)は違反とする。
- 営業時間は登録がある場所だけ判定し、未登録の件数は unchecked に数える。
- 秘匿制約の違反は、制約の値を message / evidence / suggestion に含めない。

制約の判定(DOC-02 FR-016の種類):
- 時刻(before/after/between): 適用範囲の予定の開始・終了を、その日の現地時刻で比べる
- 予算(budget_limit、通貨単位の上限/下限): 予約の金額と区間の費用の合計(同じ通貨のみ)
- 移動量(fatigue、分/時間/km): 1日ごとの区間の所要時間・距離の合計
- 食事の間隔(meal_interval、分/時間): 1日の食事(event_type=dining)の開始の間隔
- 避けたい移動手段(avoid_transport): 値を移動手段に対応付け、該当する区間を違反とする
- 文字の不可条件等(avoid/not_equals): 予定の名称・説明・住所に含まれれば「違反の可能性」
- 機械的に判定できないもの(prefer/equals等)は「検証不能」
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy.orm import Session

from app.models.models import (
    EventReservation, OpeningHours, PlanConstraint, Reservation, TravelDay, TravelEvent, TravelPlan, TravelSegment,
)
from app.services.constraint_evaluation import ConstraintSet, EffectiveConstraint
from app.services.today_mode import effective_start, parse_local_time, zone_for

ALGORITHM_VERSION = "feasibility-v1"
RESERVATION_TIME_TOLERANCE = timedelta(minutes=15)

CURRENCY_UNITS = {"JPY", "USD", "EUR"}
MINUTE_UNITS = {"minutes": 1, "hours": 60}

# 避けたい移動手段の値(自由入力)を区間のmodeへ対応付ける。長い語を先に照合する。
TRANSPORT_KEYWORDS: Sequence[Tuple[str, str]] = (
    ("夜行バス", "bus"), ("高速バス", "bus"), ("新幹線", "train"), ("タクシー", "taxi"), ("フェリー", "ferry"),
    ("飛行機", "flight"), ("航空", "flight"), ("自転車", "bicycle"), ("レンタカー", "driving"),
    ("バス", "bus"), ("電車", "train"), ("鉄道", "train"), ("列車", "train"), ("船", "ferry"),
    ("徒歩", "walking"), ("歩き", "walking"), ("車", "driving"),
    ("walking", "walking"), ("driving", "driving"), ("train", "train"), ("bus", "bus"), ("ferry", "ferry"),
    ("flight", "flight"), ("bicycle", "bicycle"), ("taxi", "taxi"), ("mixed", "mixed"),
)

MODE_LABEL = {
    "walking": "徒歩", "driving": "車", "train": "鉄道", "bus": "バス", "ferry": "船", "flight": "飛行機",
    "bicycle": "自転車", "taxi": "タクシー", "mixed": "複合",
}

PRIVATE_MESSAGE = "秘匿制約を満たしていません(内容は作成者本人にだけ表示されます)"
PRIVATE_POSSIBLE_MESSAGE = "秘匿制約を満たしていない可能性があります(内容は作成者本人にだけ表示されます)"
PRIVATE_UNVERIFIED_MESSAGE = "秘匿制約を検証できません(内容は作成者本人にだけ表示されます)"


# ============================================================ 入力(スナップショット)

@dataclass(frozen=True)
class DayInfo:
    id: uuid.UUID
    local_date: date
    timezone_id: str


@dataclass(frozen=True)
class EventInfo:
    id: uuid.UUID
    day: DayInfo
    title: str
    description: str
    address: str
    event_type: str
    place_id: Optional[uuid.UUID]
    is_all_day: bool
    start: Optional[datetime]  # UTC
    end: Optional[datetime]  # UTC(end_atが明示された場合のみ)
    sort_order: int


@dataclass(frozen=True)
class SegmentInfo:
    id: uuid.UUID
    from_event_id: Optional[uuid.UUID]
    to_event_id: Optional[uuid.UUID]
    mode: str
    status: str
    duration_minutes: Optional[float]
    distance_km: Optional[float]
    preparation_minutes: int
    buffer_before_minutes: int
    planned_departure_at: Optional[datetime]
    planned_arrival_at: Optional[datetime]
    cost: Optional[Decimal]
    currency: Optional[str]


@dataclass(frozen=True)
class ReservationInfo:
    id: uuid.UUID
    label: str
    status: str
    start_at: Optional[datetime]
    total_amount: Optional[float]
    currency: Optional[str]


@dataclass(frozen=True)
class LinkInfo:
    event_id: uuid.UUID
    reservation_id: uuid.UUID
    relation_type: str


@dataclass(frozen=True)
class HoursInfo:
    day_of_week: int  # 0=月 ... 6=日
    open_time: Optional[str]
    close_time: Optional[str]


@dataclass
class Snapshot:
    days: List[DayInfo]
    events: List[EventInfo]
    segments: List[SegmentInfo]
    reservations: Dict[uuid.UUID, ReservationInfo]
    links: List[LinkInfo]
    opening_hours: Dict[uuid.UUID, List[HoursInfo]]  # place_id -> 曜日ごと


# ============================================================ 出力

@dataclass
class Finding:
    code: str
    kind: str  # violation | unverified
    severity: str  # ERROR | WARNING | INFO
    message: str
    entity_type: Optional[str] = None
    entity_id: Optional[uuid.UUID] = None
    entity_label: Optional[str] = None
    day_id: Optional[uuid.UUID] = None
    constraint: Optional[EffectiveConstraint] = None
    evidence: Optional[Dict[str, Any]] = None
    suggestion: Optional[Dict[str, Any]] = None


@dataclass
class EvaluationResult:
    findings: List[Finding] = field(default_factory=list)
    constraint_results: List[Dict[str, str]] = field(default_factory=list)
    unchecked: Dict[str, int] = field(default_factory=dict)

    def count(self, key: str, n: int = 1) -> None:
        self.unchecked[key] = self.unchecked.get(key, 0) + n


# ============================================================ 読み出し

def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def load_snapshot(db: Session, plan: TravelPlan) -> Snapshot:
    day_rows = db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()
    days = {d.id: DayInfo(d.id, d.local_date, d.timezone_id or "UTC") for d in day_rows}
    day_models = {d.id: d for d in day_rows}

    events: List[EventInfo] = []
    for ev in db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all():
        day = days.get(ev.day_id)
        if day is None:
            continue
        start, _source = effective_start(ev, day_models[ev.day_id])
        events.append(EventInfo(
            id=ev.id, day=day, title=ev.title or "", description=ev.description or "", address=ev.address or "",
            event_type=ev.event_type or "", place_id=ev.place_id, is_all_day=bool(ev.is_all_day),
            start=start, end=_aware(ev.end_at), sort_order=ev.sort_order or 0,
        ))

    segments = [
        SegmentInfo(
            id=s.id, from_event_id=s.from_event_id, to_event_id=s.to_event_id, mode=s.mode, status=s.status,
            duration_minutes=s.duration_minutes, distance_km=s.distance_km,
            preparation_minutes=s.preparation_minutes or 0, buffer_before_minutes=s.buffer_before_minutes or 0,
            planned_departure_at=_aware(s.planned_departure_at), planned_arrival_at=_aware(s.planned_arrival_at),
            cost=s.cost, currency=s.currency,
        )
        for s in db.query(TravelSegment).filter(TravelSegment.plan_id == plan.id).all()
    ]

    reservations = {
        r.id: ReservationInfo(
            id=r.id, label=r.provider_name or r.type or "予約", status=r.status, start_at=_aware(r.start_at),
            total_amount=r.total_amount, currency=r.currency,
        )
        for r in db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None)).all()
    }
    links = [
        LinkInfo(link.event_id, link.reservation_id, link.relation_type)
        for link in db.query(EventReservation).filter(EventReservation.reservation_id.in_(list(reservations))).all()
    ] if reservations else []

    place_ids = {e.place_id for e in events if e.place_id}
    hours: Dict[uuid.UUID, List[HoursInfo]] = {}
    if place_ids:
        for h in db.query(OpeningHours).filter(OpeningHours.place_id.in_(list(place_ids))).all():
            hours.setdefault(h.place_id, []).append(HoursInfo(h.day_of_week, h.open_time, h.close_time))

    return Snapshot(
        days=sorted(days.values(), key=lambda d: d.local_date), events=events, segments=segments,
        reservations=reservations, links=links, opening_hours=hours,
    )


def compute_fingerprint(db: Session, plan: TravelPlan) -> str:
    """検証の入力(旅程・制約・予約・紐付け・区間)の版の組み合わせ。変われば結果は古い。"""
    parts: List[str] = [f"plan:{plan.revision}"]
    for c in db.query(PlanConstraint.id, PlanConstraint.revision).filter(PlanConstraint.plan_id == plan.id):
        parts.append(f"c:{c[0]}:{c[1]}")
    for r in db.query(Reservation.id, Reservation.revision).filter(Reservation.plan_id == plan.id):
        parts.append(f"r:{r[0]}:{r[1]}")
    reservation_ids = [r[0] for r in db.query(Reservation.id).filter(Reservation.plan_id == plan.id)]
    if reservation_ids:
        for link in db.query(EventReservation).filter(EventReservation.reservation_id.in_(reservation_ids)):
            parts.append(f"l:{link.id}:{link.relation_type}:{link.updated_at or link.created_at}")
    for s in db.query(TravelSegment.id, TravelSegment.revision).filter(TravelSegment.plan_id == plan.id):
        parts.append(f"s:{s[0]}:{s[1]}")
    return hashlib.sha256("\n".join(sorted(parts)).encode("utf-8")).hexdigest()


# ============================================================ 表示用の整形

def _local(dt: datetime, day: DayInfo) -> datetime:
    return dt.astimezone(zone_for(day.timezone_id))


def _fmt(dt: Optional[datetime], day: DayInfo) -> Optional[str]:
    if dt is None:
        return None
    local = _local(dt, day)
    prefix = "" if local.date() == day.local_date else f"{local.month}/{local.day} "
    return f"{prefix}{local:%H:%M}"


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _event_label(e: EventInfo) -> str:
    return f"{e.day.local_date.isoformat()} {e.title}"[:300]


def _minutes(td: timedelta) -> int:
    return int(round(td.total_seconds() / 60))


# ============================================================ 旅程そのものの判定

def _check_event_times(snap: Snapshot, res: EvaluationResult) -> List[EventInfo]:
    timed: List[EventInfo] = []
    for e in snap.events:
        if e.is_all_day:
            continue
        if e.start is None:
            res.count("event_time_unknown")
            res.findings.append(Finding(
                code="EVENT_TIME_UNKNOWN", kind="unverified", severity="INFO",
                message=f"「{e.title}」は開始時刻が未定のため、時刻に関する検証ができません",
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                suggestion={"action": "set_start_time"},
            ))
            continue
        if e.end is not None and e.end <= e.start:
            res.findings.append(Finding(
                code="INVALID_TIME_RANGE", kind="violation", severity="ERROR",
                message=f"「{e.title}」の終了時刻が開始時刻以前になっています",
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                evidence={"start": _iso(e.start), "end": _iso(e.end)},
                suggestion={"action": "fix_end_time"},
            ))
            continue
        timed.append(e)
    return timed


def _check_overlaps(timed: List[EventInfo], res: EvaluationResult) -> None:
    ordered = sorted(timed, key=lambda e: (e.start, e.sort_order))
    for i, a in enumerate(ordered):
        for b in ordered[i + 1:]:
            if a.end is not None and b.start >= a.end:
                continue
            if a.end is not None and a.start <= b.start < a.end:
                res.findings.append(Finding(
                    code="TIME_OVERLAP", kind="violation", severity="ERROR",
                    message=f"「{b.title}」が「{a.title}」({_fmt(a.start, a.day)}〜{_fmt(a.end, a.day)})の途中に始まります",
                    entity_type="event", entity_id=b.id, entity_label=_event_label(b), day_id=b.day.id,
                    evidence={"other_event_id": str(a.id), "other_start": _iso(a.start), "other_end": _iso(a.end),
                              "start": _iso(b.start)},
                    suggestion={"action": "move_event", "earliest_start": _iso(a.end)},
                ))
            elif a.start == b.start:
                res.findings.append(Finding(
                    code="SAME_START_TIME", kind="violation", severity="WARNING",
                    message=f"「{a.title}」と「{b.title}」が同じ時刻({_fmt(a.start, a.day)})に始まります",
                    entity_type="event", entity_id=b.id, entity_label=_event_label(b), day_id=b.day.id,
                    evidence={"other_event_id": str(a.id), "start": _iso(b.start)},
                    suggestion={"action": "move_event"},
                ))


def _check_segments(snap: Snapshot, res: EvaluationResult) -> None:
    by_id = {e.id: e for e in snap.events}
    for s in snap.segments:
        if s.status == "cancelled" or s.from_event_id is None or s.to_event_id is None:
            continue
        src, dst = by_id.get(s.from_event_id), by_id.get(s.to_event_id)
        if src is None or dst is None or src.start is None or dst.start is None:
            continue  # 開始時刻未定は EVENT_TIME_UNKNOWN として既に計上
        label = f"{src.title} → {dst.title}"[:300]
        if s.planned_arrival_at is not None and s.planned_arrival_at > dst.start:
            res.findings.append(Finding(
                code="ARRIVES_AFTER_START", kind="violation", severity="ERROR",
                message=f"移動({label})の到着予定が「{dst.title}」の開始({_fmt(dst.start, dst.day)})より後です",
                entity_type="segment", entity_id=s.id, entity_label=label, day_id=dst.day.id,
                evidence={"planned_arrival_at": _iso(s.planned_arrival_at), "next_start": _iso(dst.start)},
                suggestion={"action": "depart_earlier_or_move_event"},
            ))
            continue
        if s.duration_minutes is None:
            res.count("segment_duration_unknown")
            res.findings.append(Finding(
                code="SEGMENT_DURATION_UNKNOWN", kind="unverified", severity="INFO",
                message=f"移動({label})の所要時間が不明なため、移動時間が足りるか検証できません",
                entity_type="segment", entity_id=s.id, entity_label=label, day_id=dst.day.id,
                suggestion={"action": "set_duration"},
            ))
            continue
        required = timedelta(minutes=float(s.duration_minutes) + s.preparation_minutes + s.buffer_before_minutes)
        if src.end is not None:
            gap = dst.start - src.end
            if gap < required:
                if gap < timedelta(0):
                    detail = (f"「{src.title}」の終了({_fmt(src.end, src.day)})より前に"
                              f"「{dst.title}」が始まるため、移動の{_minutes(required)}分を確保できません")
                else:
                    detail = (f"移動({label})に{_minutes(required)}分必要ですが、"
                              f"「{src.title}」の終了から「{dst.title}」の開始まで{_minutes(gap)}分しかありません")
                res.findings.append(Finding(
                    code="TRAVEL_TIME_SHORTFALL", kind="violation", severity="ERROR",
                    message=detail,
                    entity_type="segment", entity_id=s.id, entity_label=label, day_id=dst.day.id,
                    evidence={"available_minutes": _minutes(gap), "required_minutes": _minutes(required),
                              "shortage_minutes": _minutes(required - gap)},
                    suggestion={"action": "move_event", "earliest_start": _iso(src.end + required)},
                ))
            continue
        # 前の予定の終了が不明: 開始直後に出発しても間に合わない場合だけ確実に違反
        if dst.start - src.start < required:
            res.findings.append(Finding(
                code="TRAVEL_TIME_SHORTFALL", kind="violation", severity="ERROR",
                message=(f"移動({label})に{_minutes(required)}分必要ですが、"
                         f"「{src.title}」の開始から「{dst.title}」の開始まで{_minutes(dst.start - src.start)}分しかありません"),
                entity_type="segment", entity_id=s.id, entity_label=label, day_id=dst.day.id,
                evidence={"available_minutes": _minutes(dst.start - src.start), "required_minutes": _minutes(required),
                          "from_end_unknown": True},
                suggestion={"action": "move_event", "earliest_start": _iso(src.start + required)},
            ))
        else:
            res.count("stay_length_unknown")
            res.findings.append(Finding(
                code="STAY_LENGTH_UNKNOWN", kind="unverified", severity="INFO",
                message=f"「{src.title}」の終了時刻が未定のため、移動({label})に間に合うか検証できません",
                entity_type="event", entity_id=src.id, entity_label=_event_label(src), day_id=src.day.id,
                evidence={"required_minutes": _minutes(required)},
                suggestion={"action": "set_end_time", "latest_end": _iso(dst.start - required)},
            ))


def _check_reservations(snap: Snapshot, res: EvaluationResult) -> None:
    by_id = {e.id: e for e in snap.events}
    for link in snap.links:
        e, r = by_id.get(link.event_id), snap.reservations.get(link.reservation_id)
        if e is None or r is None:
            continue
        if r.status == "cancelled":
            res.findings.append(Finding(
                code="RESERVATION_CANCELLED", kind="violation", severity="ERROR",
                message=f"「{e.title}」に紐付いた予約「{r.label}」は取消済みです",
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                evidence={"reservation_id": str(r.id), "reservation_status": r.status},
                suggestion={"action": "rebook_or_unlink"},
            ))
            continue
        if link.relation_type != "primary" or r.start_at is None or e.start is None:
            continue
        diff = e.start - r.start_at
        if abs(diff) > RESERVATION_TIME_TOLERANCE:
            res.findings.append(Finding(
                code="RESERVATION_TIME_MISMATCH", kind="violation", severity="WARNING",
                message=(f"「{e.title}」の開始({_fmt(e.start, e.day)})が予約「{r.label}」の時刻"
                         f"({_fmt(r.start_at, e.day)})と{abs(_minutes(diff))}分ずれています"),
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                evidence={"reservation_id": str(r.id), "reservation_start": _iso(r.start_at),
                          "event_start": _iso(e.start), "difference_minutes": _minutes(diff)},
                suggestion={"action": "align_to_reservation", "start": _iso(r.start_at)},
            ))


def _in_hours(t: time, open_t: time, close_t: time) -> bool:
    if close_t <= open_t:  # 深夜営業(日を跨ぐ)
        return t >= open_t or t < close_t
    return open_t <= t < close_t


def _check_opening_hours(timed: List[EventInfo], snap: Snapshot, res: EvaluationResult) -> None:
    for e in timed:
        if e.place_id is None:
            continue
        rows = snap.opening_hours.get(e.place_id)
        if not rows:
            res.count("opening_hours_unknown")
            continue
        local_start = _local(e.start, e.day)
        weekday = local_start.weekday()
        today = [h for h in rows if h.day_of_week == weekday]
        if not today:
            res.findings.append(Finding(
                code="CLOSED_ON_DAY", kind="violation", severity="ERROR",
                message=f"「{e.title}」の場所は{local_start:%m/%d}の曜日が休業日として登録されています",
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                evidence={"weekday": weekday}, suggestion={"action": "move_to_other_day"},
            ))
            continue
        h = today[0]
        open_t, close_t = parse_local_time(h.open_time), parse_local_time(h.close_time)
        if open_t is None or close_t is None:
            res.count("opening_hours_unknown")
            continue
        start_ok = _in_hours(local_start.time(), open_t, close_t)
        end_ok = True
        if e.end is not None:
            local_end = _local(e.end, e.day)
            if close_t > open_t:
                end_ok = local_end.date() == local_start.date() and local_end.time() <= close_t
        if not (start_ok and end_ok):
            res.findings.append(Finding(
                code="OUTSIDE_OPENING_HOURS", kind="violation", severity="ERROR",
                message=f"「{e.title}」は営業時間({h.open_time}〜{h.close_time})外です",
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                evidence={"open": h.open_time, "close": h.close_time, "start": _iso(e.start), "end": _iso(e.end)},
                suggestion={"action": "move_event_into_hours"},
            ))


# ============================================================ 制約の判定

@dataclass
class _Tally:
    violations: int = 0
    unverified: int = 0
    checked: int = 0


def _severity(c: EffectiveConstraint) -> str:
    return "ERROR" if c.hardness == "hard" else "WARNING"


def _constraint_text(c: EffectiveConstraint, title: Optional[str]) -> str:
    return f"制約「{title}」" if title else "制約"


def _violation(c: EffectiveConstraint, title: Optional[str], code: str, detail: str, possible: bool = False,
               **kw: Any) -> Finding:
    """制約違反のFinding。秘匿制約は文面・根拠・修正候補から値を除く。"""
    if c.is_private:
        evidence = {k: v for k, v in (kw.pop("evidence", None) or {}).items() if k in _PRIVATE_SAFE_EVIDENCE}
        kw.pop("suggestion", None)
        message = PRIVATE_POSSIBLE_MESSAGE if possible else PRIVATE_MESSAGE
        return Finding(code=code, kind="violation", severity=_severity(c), message=message,
                       constraint=c, evidence=evidence or None, **kw)
    evidence = dict(kw.pop("evidence", None) or {})
    if c.hardness == "soft":
        evidence["weight"] = c.weight
    return Finding(code=code, kind="violation", severity=_severity(c),
                   message=f"{_constraint_text(c, title)}に違反: {detail}", constraint=c, evidence=evidence, **kw)


def _unverified(c: EffectiveConstraint, title: Optional[str], code: str, detail: str, **kw: Any) -> Finding:
    message = PRIVATE_UNVERIFIED_MESSAGE if c.is_private else f"{_constraint_text(c, title)}を検証できません: {detail}"
    if c.is_private:
        kw.pop("evidence", None)
    return Finding(code=code, kind="unverified", severity="INFO", message=message, constraint=c, **kw)


# 秘匿制約の違反でも残してよい根拠(予定側の事実だけ。制約の値は含めない)
_PRIVATE_SAFE_EVIDENCE = {"start", "end", "segment_mode"}


def _events_in_scope(c: EffectiveConstraint, snap: Snapshot) -> Optional[List[EventInfo]]:
    """適用範囲の予定。対象が存在しなければNone。"""
    if c.scope_type in ("plan", "member"):
        return list(snap.events)
    if c.scope_type == "day":
        if not any(d.id == c.scope_id for d in snap.days):
            return None
        return [e for e in snap.events if e.day.id == c.scope_id]
    found = [e for e in snap.events if e.id == c.scope_id]
    return found or None


def _days_in_scope(c: EffectiveConstraint, snap: Snapshot) -> Optional[List[DayInfo]]:
    if c.scope_type in ("plan", "member"):
        return list(snap.days)
    if c.scope_type == "day":
        return [d for d in snap.days if d.id == c.scope_id] or None
    return None


def _threshold(value: Any, day: DayInfo) -> Optional[datetime]:
    """"HH:MM"はその日の現地時刻、ISO日時はそのまま(UTC)。"""
    if not isinstance(value, str):
        return None
    t = parse_local_time(value)
    if t is not None and len(value.strip()) <= 5:
        return datetime.combine(day.local_date, t, tzinfo=zone_for(day.timezone_id)).astimezone(timezone.utc)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _eval_time(c: EffectiveConstraint, title: Optional[str], snap: Snapshot, res: EvaluationResult, t: _Tally) -> None:
    events = _events_in_scope(c, snap)
    if events is None:
        t.unverified += 1
        res.findings.append(_unverified(c, title, "CONSTRAINT_SCOPE_MISSING", "適用対象が削除されています"))
        return
    value, value_to = c.value.get("value"), c.value.get("value_to")
    for e in events:
        if e.is_all_day:
            continue
        if e.start is None:
            t.unverified += 1
            continue
        base = dict(entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id)
        times = {"start": _iso(e.start), "end": _iso(e.end)}
        if c.operator == "after":
            limit = _threshold(value, e.day)
            if limit is None:
                t.unverified += 1
                continue
            t.checked += 1
            if e.start < limit:
                t.violations += 1
                res.findings.append(_violation(
                    c, title, "CONSTRAINT_TIME_VIOLATION",
                    f"「{e.title}」の開始({_fmt(e.start, e.day)})が{_fmt(limit, e.day)}より前です",
                    evidence={**times, "limit": _iso(limit)},
                    suggestion={"action": "move_event", "earliest_start": _iso(limit)}, **base))
        elif c.operator == "before":
            limit = _threshold(value, e.day)
            if limit is None:
                t.unverified += 1
                continue
            last = e.end if e.end is not None else e.start
            if last > limit:
                t.checked += 1
                t.violations += 1
                what = "終了" if e.end is not None else "開始"
                res.findings.append(_violation(
                    c, title, "CONSTRAINT_TIME_VIOLATION",
                    f"「{e.title}」の{what}({_fmt(last, e.day)})が{_fmt(limit, e.day)}を過ぎています",
                    evidence={**times, "limit": _iso(limit)},
                    suggestion={"action": "move_event", "latest_end": _iso(limit)}, **base))
            elif e.end is None:
                t.unverified += 1  # 開始は間に合うが終了が分からない
            else:
                t.checked += 1
        else:  # between
            start_l, end_l = _threshold(value, e.day), _threshold(value_to, e.day)
            if start_l is None or end_l is None:
                t.unverified += 1
                continue
            if end_l <= start_l:  # HH:MMで日を跨ぐ時間帯
                end_l += timedelta(days=1)
            outside = e.start < start_l or e.start >= end_l
            if not outside and e.end is not None and e.end > end_l:
                outside = True
            if outside:
                t.checked += 1
                t.violations += 1
                res.findings.append(_violation(
                    c, title, "CONSTRAINT_TIME_VIOLATION",
                    f"「{e.title}」({_fmt(e.start, e.day)}〜{_fmt(e.end, e.day) or '終了未定'})が"
                    f"{_fmt(start_l, e.day)}〜{_fmt(end_l, e.day)}の範囲外です",
                    evidence={**times, "window_start": _iso(start_l), "window_end": _iso(end_l)},
                    suggestion={"action": "move_event", "earliest_start": _iso(start_l), "latest_end": _iso(end_l)},
                    **base))
            elif e.end is None:
                t.unverified += 1
            else:
                t.checked += 1


def _local_date_of(dt: Optional[datetime], snap: Snapshot) -> Optional[date]:
    if dt is None:
        return None
    tz = snap.days[0].timezone_id if snap.days else "UTC"
    return dt.astimezone(zone_for(tz)).date()


def _compare(total: float, operator: str, limit: float) -> bool:
    """違反ならTrue。"""
    return total > limit if operator == "max" else total < limit


def _eval_budget(c: EffectiveConstraint, title: Optional[str], snap: Snapshot, res: EvaluationResult,
                 t: _Tally) -> None:
    unit, limit = c.value.get("unit"), c.value.get("value")
    if c.scope_type in ("member", "event") or unit not in CURRENCY_UNITS or not isinstance(limit, (int, float)):
        t.unverified += 1
        reason = ("1人あたり・予定単位の費用の内訳がまだ無いため" if c.scope_type in ("member", "event")
                  else "通貨単位で指定されていないため")
        res.findings.append(_unverified(c, title, "BUDGET_NOT_CHECKABLE", reason))
        return
    day_ids = None
    if c.scope_type == "day":
        days = _days_in_scope(c, snap)
        if not days:
            t.unverified += 1
            res.findings.append(_unverified(c, title, "CONSTRAINT_SCOPE_MISSING", "適用対象が削除されています"))
            return
        day_dates = {d.local_date for d in days}
        day_ids = day_dates
    total = 0.0
    other_currency = 0
    unknown_date = 0
    items: List[Tuple[Optional[datetime], Optional[float], Optional[str]]] = []
    for r in snap.reservations.values():
        if r.status != "cancelled" and r.total_amount is not None:
            items.append((r.start_at, r.total_amount, r.currency))
    for s in snap.segments:
        if s.status != "cancelled" and s.cost is not None:
            items.append((s.planned_departure_at, float(s.cost), s.currency))
    for when, amount, currency in items:
        if day_ids is not None:
            d = _local_date_of(when, snap)
            if d is None:
                unknown_date += 1
                continue
            if d not in day_ids:
                continue
        if currency != unit:
            other_currency += 1
            continue
        total += float(amount)
    t.checked += 1
    if _compare(total, c.operator, float(limit)):
        t.violations += 1
        word = "上回って" if c.operator == "max" else "下回って"
        res.findings.append(_violation(
            c, title, "BUDGET_EXCEEDED" if c.operator == "max" else "BUDGET_BELOW_MIN",
            f"予約・移動の費用の合計{total:,.0f} {unit}が{limit:,.0f} {unit}を{word}います",
            evidence={"total": total, "limit": limit, "unit": unit},
            suggestion={"action": "review_costs"}))
    if other_currency or unknown_date:
        t.unverified += 1
        res.findings.append(_unverified(
            c, title, "BUDGET_PARTIALLY_UNCHECKED",
            f"別通貨の費用{other_currency}件・日付不明の費用{unknown_date}件は合計に含めていません",
            evidence={"other_currency_items": other_currency, "unknown_date_items": unknown_date}))


def _segment_day(s: SegmentInfo, by_id: Dict[uuid.UUID, EventInfo]) -> Optional[DayInfo]:
    for eid in (s.to_event_id, s.from_event_id):
        if eid and eid in by_id:
            return by_id[eid].day
    return None


def _eval_fatigue(c: EffectiveConstraint, title: Optional[str], snap: Snapshot, res: EvaluationResult,
                  t: _Tally) -> None:
    unit, limit = c.value.get("unit"), c.value.get("value")
    days = _days_in_scope(c, snap)
    if days is None or not isinstance(limit, (int, float)) or (unit not in MINUTE_UNITS and unit != "km"):
        t.unverified += 1
        res.findings.append(_unverified(c, title, "CONSTRAINT_NOT_MACHINE_CHECKABLE",
                                        "1日の移動時間(分・時間)または距離(km)として判定できません"))
        return
    by_id = {e.id: e for e in snap.events}
    for day in days:
        total = 0.0
        unknown = 0
        for s in snap.segments:
            if s.status == "cancelled":
                continue
            seg_day = _segment_day(s, by_id)
            if seg_day is None or seg_day.id != day.id:
                continue
            amount = s.distance_km if unit == "km" else s.duration_minutes
            if amount is None:
                unknown += 1
                continue
            total += float(amount)
        limit_value = float(limit) * (MINUTE_UNITS.get(unit, 1) if unit != "km" else 1)
        t.checked += 1
        if _compare(total, c.operator, limit_value):
            t.violations += 1
            shown = f"{total:.1f} km" if unit == "km" else f"{int(round(total))}分"
            res.findings.append(_violation(
                c, title, "DAILY_TRAVEL_LIMIT",
                f"{day.local_date.isoformat()}の移動の合計({shown})が上限を超えています"
                if c.operator == "max" else f"{day.local_date.isoformat()}の移動の合計({shown})が下限に届きません",
                day_id=day.id,
                evidence={"total": total, "limit": limit_value, "unit": "km" if unit == "km" else "minutes"},
                suggestion={"action": "reduce_travel"}))
        if unknown:
            t.unverified += 1


def _eval_meal_interval(c: EffectiveConstraint, title: Optional[str], snap: Snapshot, res: EvaluationResult,
                        t: _Tally) -> None:
    unit, limit = c.value.get("unit"), c.value.get("value")
    days = _days_in_scope(c, snap)
    if days is None or unit not in MINUTE_UNITS or not isinstance(limit, (int, float)):
        t.unverified += 1
        res.findings.append(_unverified(c, title, "CONSTRAINT_NOT_MACHINE_CHECKABLE",
                                        "食事の間隔(分・時間)として判定できません"))
        return
    limit_minutes = float(limit) * MINUTE_UNITS[unit]
    for day in days:
        meals = sorted((e for e in snap.events if e.day.id == day.id and e.event_type == "dining"),
                       key=lambda e: (e.start is None, e.start))
        if any(m.start is None for m in meals):
            t.unverified += 1
        meals = [m for m in meals if m.start is not None]
        for prev, nxt in zip(meals, meals[1:]):
            gap = _minutes(nxt.start - prev.start)
            t.checked += 1
            if _compare(gap, c.operator, limit_minutes):
                t.violations += 1
                res.findings.append(_violation(
                    c, title, "MEAL_INTERVAL",
                    f"「{prev.title}」から「{nxt.title}」まで{gap}分空いています"
                    if c.operator == "max" else f"「{prev.title}」から「{nxt.title}」まで{gap}分しか空いていません",
                    entity_type="event", entity_id=nxt.id, entity_label=_event_label(nxt), day_id=day.id,
                    evidence={"interval_minutes": gap, "limit_minutes": limit_minutes},
                    suggestion={"action": "adjust_meal_time"}))


def _modes_for(text: str) -> List[str]:
    lowered = text.strip().lower()
    for keyword, mode in TRANSPORT_KEYWORDS:
        if keyword.lower() in lowered:
            return [mode]
    return []


def _eval_text(c: EffectiveConstraint, title: Optional[str], snap: Snapshot, res: EvaluationResult,
               t: _Tally) -> None:
    value = c.value.get("value")
    if c.operator not in ("avoid", "not_equals") or not isinstance(value, str) or not value.strip():
        t.unverified += 1
        res.findings.append(_unverified(c, title, "CONSTRAINT_NOT_MACHINE_CHECKABLE",
                                        "希望・一致条件は自動では判定できません(確認して手動で判断してください)"))
        return
    events = _events_in_scope(c, snap)
    if events is None:
        t.unverified += 1
        res.findings.append(_unverified(c, title, "CONSTRAINT_SCOPE_MISSING", "適用対象が削除されています"))
        return
    event_ids = {e.id for e in events}
    modes = _modes_for(value) if c.constraint_type == "avoid_transport" else []
    if modes:
        by_id = {e.id: e for e in snap.events}
        for s in snap.segments:
            if s.status == "cancelled":
                continue
            related = {s.from_event_id, s.to_event_id} & event_ids
            if c.scope_type not in ("plan", "member") and not related:
                continue
            t.checked += 1
            if s.mode in modes:
                t.violations += 1
                day = _segment_day(s, by_id)
                res.findings.append(_violation(
                    c, title, "AVOIDED_TRANSPORT_USED", f"区間の移動手段が{MODE_LABEL.get(s.mode, s.mode)}です",
                    entity_type="segment", entity_id=s.id, entity_label=MODE_LABEL.get(s.mode, s.mode),
                    day_id=day.id if day else None, evidence={"segment_mode": s.mode},
                    suggestion={"action": "choose_other_route"}))
        return
    needle = value.strip().casefold()
    matched = False
    for e in events:
        haystack = f"{e.title}\n{e.description}\n{e.address}".casefold()
        if needle in haystack:
            matched = True
            t.violations += 1
            res.findings.append(_violation(
                c, title, "POSSIBLE_CONSTRAINT_VIOLATION", f"「{e.title}」に「{value}」が含まれています(違反の可能性)",
                possible=True,
                entity_type="event", entity_id=e.id, entity_label=_event_label(e), day_id=e.day.id,
                evidence={"matched_text": value}, suggestion={"action": "review_event"}))
    if not matched:
        t.unverified += 1
        res.findings.append(_unverified(c, title, "TEXT_CONSTRAINT_NOT_CHECKABLE",
                                        "予定の名称・説明に該当する語はありませんが、内容までは判定できません"))


def _evaluate_constraint(c: EffectiveConstraint, title: Optional[str], snap: Snapshot,
                         res: EvaluationResult) -> str:
    t = _Tally()
    if c.operator in ("before", "after", "between"):
        _eval_time(c, title, snap, res, t)
    elif c.operator in ("max", "min"):
        if c.constraint_type == "budget_limit":
            _eval_budget(c, title, snap, res, t)
        elif c.constraint_type == "fatigue":
            _eval_fatigue(c, title, snap, res, t)
        elif c.constraint_type == "meal_interval":
            _eval_meal_interval(c, title, snap, res, t)
        else:
            t.unverified += 1
            res.findings.append(_unverified(c, title, "CONSTRAINT_NOT_MACHINE_CHECKABLE",
                                            "この種類の数値条件は自動では判定できません"))
    else:
        _eval_text(c, title, snap, res, t)

    if t.violations:
        return "violated"
    if t.unverified:
        return "unverified"
    if t.checked:
        return "satisfied"
    return "not_applicable"


# ============================================================ 全体

_SEVERITY_ORDER = {"ERROR": 0, "WARNING": 1, "INFO": 2}


def evaluate(snap: Snapshot, constraints: ConstraintSet, titles: Optional[Dict[uuid.UUID, str]] = None,
             unavailable_owners: Optional[Dict[uuid.UUID, uuid.UUID]] = None) -> EvaluationResult:
    """旅程と制約を検証する(DBに触れない純粋関数)。

    titles: 共有制約の題名(文面用)。秘匿制約の題名は渡さない。
    unavailable_owners: 復号できなかった秘匿制約のID→作成者ID。
    """
    titles = titles or {}
    res = EvaluationResult()
    timed = _check_event_times(snap, res)
    _check_overlaps(timed, res)
    _check_segments(snap, res)
    _check_reservations(snap, res)
    _check_opening_hours(timed, snap, res)

    for c in constraints.constraints:
        status = _evaluate_constraint(c, None if c.is_private else titles.get(c.id), snap, res)
        res.constraint_results.append({"constraint_id": str(c.id), "status": status})
    for cid in constraints.unavailable:
        owner = (unavailable_owners or {}).get(cid)
        placeholder = EffectiveConstraint(
            id=cid, owner_user_id=owner or uuid.UUID(int=0), is_private=True, scope_type="plan", scope_id=None,
            constraint_type="", hardness="hard", operator="", value={}, weight=None,
        )
        res.findings.append(Finding(code="CONSTRAINT_UNAVAILABLE", kind="unverified", severity="INFO",
                                    message=PRIVATE_UNVERIFIED_MESSAGE, constraint=placeholder))
        res.constraint_results.append({"constraint_id": str(cid), "status": "unverified"})

    res.findings.sort(key=lambda f: (f.kind != "violation", _SEVERITY_ORDER[f.severity]))
    return res


def counts(findings: Iterable[Finding]) -> Dict[str, int]:
    out = {"error": 0, "warning": 0, "info": 0, "unverified": 0}
    for f in findings:
        if f.kind == "unverified":
            out["unverified"] += 1
        else:
            out[f.severity.lower()] += 1
    return out
