"""
[Gate G9] UX-4 文脈型ダッシュボードの集約(GET /dashboard)。

「次に何をすべきか」を5秒で判断できるよう、利用者が見られる旅行を旅行の前・中・後に分け、焦点の旅行を1つ選んで、
その段階に要る情報だけをまとめて返す。値の計算は既存の画面と同じ関数を使う(当日 = GET /plans/{id}/today、
準備 = GET /plans/{id}/readiness、遅延・休業 = GET /plans/{id}/alerts)。そのため参加者に見せない設定の項目
(member_policy)は、それぞれの画面と同じく隠れる。

段階(phase)は旅行の日程の日付(無ければ旅行の開始・終了の日)を、最初の日程のタイムゾーンの「今日」と比べて決める:
    ongoing(旅行中)/ upcoming(旅行前)/ past(旅行後)/ undated(日付が無い)
焦点の旅行: 旅行中(開始が早い順)→ 旅行前(開始が近い順)→ 30日以内に終わった旅行(終わりが新しい順)
→ 日付の無い旅行(作成が新しい順)。無ければ null(旅行を始める案内を出す)。

読み取りだけ。監査・回数制限の対象にしない(各画面の GET と同じ)。旅行名などの値はログに出さない。
"""
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import accessible_plan_ids_subquery
from app.models.models import PlanCollaborator, TravelDay, TravelPlan, User

router = APIRouter(tags=["dashboard"])

MAX_TRIPS = 50
RECENT_PAST_DAYS = 30
DEFAULT_TZ = "Asia/Tokyo"
PHASES = ("ongoing", "upcoming", "past", "undated")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def _as_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


def phase_of(start: Optional[date], end: Optional[date], today: date) -> str:
    """旅行の段階(日付だけで決める。純粋関数)。"""
    if start is None and end is None:
        return "undated"
    start = start or end
    end = end or start
    assert start is not None and end is not None
    if today < start:
        return "upcoming"
    if today > end:
        return "past"
    return "ongoing"


def choose_focus(trips: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """焦点の旅行(旅行中 → 旅行前 → 30日以内に終わった → 日付が無い)。"""
    ongoing = [t for t in trips if t["phase"] == "ongoing"]
    if ongoing:
        return min(ongoing, key=lambda t: (t["start_date"] or "", t["title"]))
    upcoming = [t for t in trips if t["phase"] == "upcoming"]
    if upcoming:
        return min(upcoming, key=lambda t: (t["start_date"] or "", t["title"]))
    recent = [t for t in trips if t["phase"] == "past" and (t["days_since_end"] or 0) <= RECENT_PAST_DAYS]
    if recent:
        return max(recent, key=lambda t: (t["end_date"] or "", t["title"]))
    undated = [t for t in trips if t["phase"] == "undated"]
    if undated:
        return max(undated, key=lambda t: t["created_at"] or "")
    return None


def _day_ranges(db: Session, plan_ids: List[uuid.UUID]) -> Dict[Any, Tuple[date, date, int, Optional[str]]]:
    """旅行ごとの日程の最初の日・最後の日・日数・最初の日程のタイムゾーン(1回の問い合わせ)。"""
    out: Dict[Any, Tuple[date, date, int, Optional[str]]] = {}
    if not plan_ids:
        return out
    rows = (db.query(TravelDay.plan_id, TravelDay.local_date, TravelDay.timezone_id)
            .filter(TravelDay.plan_id.in_(plan_ids))
            .order_by(TravelDay.plan_id, TravelDay.local_date).all())
    grouped: Dict[Any, List[Tuple[date, Optional[str]]]] = defaultdict(list)
    for plan_id, local_date, tz in rows:
        if local_date is not None:
            grouped[plan_id].append((local_date, tz))
    for plan_id, days in grouped.items():
        out[plan_id] = (days[0][0], days[-1][0], len(days), days[0][1])
    return out


def _trip(plan: TravelPlan, role: str, ranges: Dict[Any, Tuple[date, date, int, Optional[str]]],
          members: Dict[Any, int], now: datetime) -> Dict[str, Any]:
    rng = ranges.get(plan.id)
    start: Optional[date]
    end: Optional[date]
    tz: Optional[str]
    if rng is not None:
        start, end, day_count, tz = rng
    else:
        start, end, day_count, tz = _as_date(plan.start_date), _as_date(plan.end_date), 0, None
        if start and end and end < start:
            end = start
    zone = _zone(tz)
    today = now.astimezone(zone).date()
    phase = phase_of(start, end, today)
    total_days = (end - start).days + 1 if start and end else None
    return {
        "id": str(plan.id),
        "title": plan.title,
        "destination": plan.destination,
        "role": role,
        "can_edit": role in ("owner", "editor"),
        "start_date": start.isoformat() if start else None,
        "end_date": end.isoformat() if end else None,
        "timezone_id": tz or DEFAULT_TZ,
        "local_today": today.isoformat(),
        "day_count": day_count,
        "total_days": total_days,
        "phase": phase,
        "days_until_start": (start - today).days if phase == "upcoming" and start else None,
        "day_number": (today - start).days + 1 if phase == "ongoing" and start else None,
        "days_since_end": (today - end).days if phase == "past" and end else None,
        "member_count": members.get(plan.id, 0) + 1,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
    }


def _readiness_summary(db: Session, plan_id: str, user: User) -> Optional[Dict[str, Any]]:
    from app.api.v1.preparation import get_readiness  # 循環 import を避ける
    try:
        r = get_readiness(plan_id, db=db, current_user=user)
    except Exception:  # noqa: BLE001 - 準備の計算の失敗でダッシュボード全体を止めない(項目を null にする)
        db.rollback()
        return None
    counts = r.get("counts") or {}
    items = r.get("items") or []
    return {
        "is_ready": bool(r.get("is_ready")),
        "total": int(counts.get("total") or len(items)),
        "high": int((counts.get("by_severity") or {}).get("high") or 0),
        "top": [{"title": i.get("title"), "severity": i.get("severity"), "link": i.get("link"),
                 "due_at": i.get("due_at")} for i in items[:3]],
    }


def _alerts_summary(db: Session, plan_id: str, user: User) -> Optional[Dict[str, Any]]:
    from app.api.v1.replans import list_alerts
    try:
        r = list_alerts(plan_id, db=db, current_user=user)
    except Exception:  # noqa: BLE001
        db.rollback()
        return None
    active = [a for a in r.get("alerts") or [] if a.get("status") == "active"]
    detected = r.get("detected") or []
    return {
        "active": len(active),
        "detected": len(detected),
        "top": [{"kind_label": a.get("kind_label"), "event_title": a.get("event_title"),
                 "delay_minutes": a.get("delay_minutes"), "is_stale": a.get("is_stale")} for a in active[:2]],
    }


async def _today_summary(db: Session, plan_id: str, user: User) -> Optional[Dict[str, Any]]:
    from app.api.v1.plans import get_today
    try:
        r = await get_today(plan_id, current_user=user, db=db)
    except Exception:  # noqa: BLE001
        db.rollback()
        return None
    data = r.model_dump(mode="json")
    keep = ("id", "title", "event_type", "start_at", "end_at", "local_start_time", "has_ticket", "reservation_id",
            "departure_at", "transport_mode", "transport_status")

    def pick(ev: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return {k: ev.get(k) for k in keep} if ev else None

    return {
        "today_date": data.get("today_date"), "timezone_id": data.get("timezone_id"),
        "now_event": pick(data.get("now_event")), "next_event": pick(data.get("next_event")),
        "minutes_until_next": data.get("minutes_until_next"), "event_count": len(data.get("events") or []),
    }


@router.get("/dashboard", response_model=dict)
async def get_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    now = _now()
    collab_ids = accessible_plan_ids_subquery(db, current_user)
    plans = (db.query(TravelPlan)
             .filter(or_(TravelPlan.user_id == current_user.id, TravelPlan.id.in_(collab_ids)),
                     TravelPlan.deleted_at.is_(None))
             .order_by(TravelPlan.created_at.desc()).limit(MAX_TRIPS).all())
    plan_ids = [cast(uuid.UUID, p.id) for p in plans]
    roles: Dict[Any, str] = {}
    if plan_ids:
        for pid, role in db.query(PlanCollaborator.plan_id, PlanCollaborator.role).filter(
                PlanCollaborator.user_id == current_user.id, PlanCollaborator.status == "accepted",
                PlanCollaborator.plan_id.in_(plan_ids)).all():
            roles[pid] = role
    members: Dict[Any, int] = defaultdict(int)
    if plan_ids:
        for (pid,) in db.query(PlanCollaborator.plan_id).filter(
                PlanCollaborator.plan_id.in_(plan_ids), PlanCollaborator.status == "accepted").all():
            members[pid] += 1
    ranges = _day_ranges(db, plan_ids)
    trips = [_trip(p, "owner" if p.user_id == current_user.id else roles.get(p.id, "viewer"), ranges, members, now)
             for p in plans]
    # 旅行中・旅行前は開始の早い順、旅行後は終わりの新しい順、日付の無い旅行は作成の新しい順
    head = sorted((t for t in trips if t["phase"] in ("ongoing", "upcoming")),
                  key=lambda t: (0 if t["phase"] == "ongoing" else 1, t["start_date"] or ""))
    tail_past = sorted((t for t in trips if t["phase"] == "past"), key=lambda t: t["end_date"] or "", reverse=True)
    tail_undated = sorted((t for t in trips if t["phase"] == "undated"), key=lambda t: t["created_at"] or "",
                          reverse=True)
    trips = head + tail_past + tail_undated

    focus_trip = choose_focus(trips)
    focus: Optional[Dict[str, Any]] = None
    if focus_trip is not None:
        pid = focus_trip["id"]
        phase = focus_trip["phase"]
        focus = {"plan_id": pid, "phase": phase, "today": None, "readiness": None, "alerts": None}
        if phase == "ongoing":
            focus["today"] = await _today_summary(db, pid, current_user)
        if phase in ("ongoing", "upcoming", "undated"):
            focus["readiness"] = _readiness_summary(db, pid, current_user)
        if phase in ("ongoing", "upcoming"):
            focus["alerts"] = _alerts_summary(db, pid, current_user)
    counts = {ph: sum(1 for t in trips if t["phase"] == ph) for ph in PHASES}
    return {
        "server_time": now.isoformat(),
        "is_guest": getattr(current_user, "user_type", None) == "guest",
        "trips": trips,
        "counts": counts,
        "focus": focus,
        "limit": MAX_TRIPS,
        "algorithm_version": "dashboard-v1",
    }
