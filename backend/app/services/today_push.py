"""[Gate TDay-Push] 旅の当日の端末への通知(出発の合図・雨・今日の旅程・同行者の遅れ)。

- 定期の処理(``tcops.py jobs today-push``、2分ごと)が、端末を登録した人の「今日」の旅行ごとに
  当日の画面と同じ計算(GET /plans/{id}/today/guide)をして、次の時に送る:
  - depart_soon: 出る時刻の SOON_MINUTES 分前から(「そろそろ出発」)
  - depart_now : 出る時刻から NOW_LATE_MINUTES 分後まで(「いま出れば間に合います」)
  - rain       : 屋外・一部屋外の予定が RAIN_AHEAD_MINUTES 分以内に始まり、その時刻に雨の予報
  - morning    : その日の最初の出発(無ければ開始)の MORNING_LEAD_MINUTES 分前から、6時より後
- 同行者の遅れ(crew): 到着予定の共有(PUT /today/eta)が予定の開始より CREW_DELAY_MINUTES 分以上遅い時、
  ほかの参加者へ送る(位置は送らない)。
- 同じ知らせは二度送らない(Redis に送った印。届かない時はプロセス内)。印を押した予定・始まった予定には送らない。
- 旅行の通知の設定が「なし」の人、種類を切った人には送らない。
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.services import web_push as wp
from app.utils import rate_limiter as rl

logger = logging.getLogger("travelcanvas.push")

SOON_MINUTES = 15
NOW_LATE_MINUTES = 5
RAIN_AHEAD_MINUTES = 120
MORNING_LEAD_MINUTES = 60
MORNING_EARLIEST_HOUR = 6
CREW_DELAY_MINUTES = 10
SENT_TTL_SECONDS = 36 * 3600

_memory: Dict[str, float] = {}
_lock = threading.Lock()


def reset_for_testing() -> None:
    with _lock:
        _memory.clear()


def _once(key: str, ttl: int = SENT_TTL_SECONDS) -> bool:
    """初めての時だけ True(送った印を付ける)"""
    full = f"{rl.namespace()}:push-sent:{key}"
    if rl._redis_available():  # noqa: SLF001 - 回数制限と同じ判定
        try:
            return bool(rl._client().set(full, "1", nx=True, ex=ttl))  # noqa: SLF001
        except Exception as e:  # noqa: BLE001
            rl._mark_down(e)  # noqa: SLF001
    now = time.time()
    with _lock:
        for k in [k for k, exp in _memory.items() if exp <= now]:
            _memory.pop(k, None)
        if full in _memory:
            return False
        _memory[full] = now + ttl
        return True


def _parse(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _hm(dt: datetime, tz: Optional[str]) -> str:
    from app.services import today_mode

    return dt.astimezone(today_mode.zone_for(tz)).strftime("%H:%M")


def _url(plan_id: str, anchor: str = "") -> str:
    return f"/planner/{plan_id}/today{anchor}"


# ---- 当日の知らせを組み立てる(純粋な計算。送らない) ---------------------------------------------------------

def depart_messages(plan_id: str, guide: Dict[str, Any], titles: Dict[str, str], now: datetime
                    ) -> List[Tuple[str, Dict[str, Any], str]]:
    """[(印の鍵, 中身, urgency)]。出る時刻のある・まだ始まっていない・印の無い予定"""
    out: List[Tuple[str, Dict[str, Any], str]] = []
    tz = guide.get("timezone_id")
    stamps = guide.get("stamps") or {}
    for eid, ev in (guide.get("events") or {}).items():
        leave = _parse(ev.get("leave_by"))
        start = _parse(ev.get("start_at"))
        if leave is None or start is None or start <= now:
            continue
        if (stamps.get(eid) or {}).get("status") == "visited":
            continue
        minutes = (leave - now).total_seconds() / 60
        title = titles.get(eid, "次の予定")
        travel = ev.get("travel_minutes")
        how = ""
        if travel:
            how = f"移動 約{travel}分" + ("(概算)" if ev.get("travel_source") == "estimate" else "")
        if 0 < minutes <= SOON_MINUTES:
            body = f"{_hm(leave, tz)} に出れば {_hm(start, tz)} の{title}にちょうど" + (f"。{how}" if how else "")
            out.append((f"{plan_id}:{eid}:soon:{leave.isoformat()}",
                        wp.message(f"そろそろ出発 ・ あと{int(minutes + 0.999)}分", body, _url(plan_id),
                                   f"go-{eid}", "depart"), "high"))
        elif -NOW_LATE_MINUTES <= minutes <= 0:
            body = f"{title}({_hm(start, tz)} から)へ。" + (how or "外の地図で道順を確かめてください")
            out.append((f"{plan_id}:{eid}:now:{leave.isoformat()}",
                        wp.message("いま出れば間に合います", body, _url(plan_id), f"go-{eid}", "depart"), "high"))
    return out


def morning_message(plan_id: str, guide: Dict[str, Any], titles: Dict[str, str], now: datetime
                    ) -> Optional[Tuple[str, Dict[str, Any], str]]:
    from app.services import today_mode

    tz = guide.get("timezone_id")
    timed = []
    for eid, ev in (guide.get("events") or {}).items():
        start = _parse(ev.get("start_at"))
        if start is not None:
            timed.append((start, _parse(ev.get("leave_by")), eid))
    if not timed or not guide.get("local_date"):
        return None
    timed.sort(key=lambda x: x[0])
    first_start, first_leave, first_id = timed[0]
    begin = (first_leave or first_start) - timedelta(minutes=MORNING_LEAD_MINUTES)
    if now < begin or now >= first_start:
        return None
    if now.astimezone(today_mode.zone_for(tz)).hour < MORNING_EARLIEST_HOUR:
        return None
    nth = guide.get("day_index")
    head = f"旅の{nth}日目" if nth else "今日の旅程"
    body = f"今日は{len(timed)}件。最初は {_hm(first_start, tz)} {titles.get(first_id, '')}".rstrip()
    if first_leave is not None:
        body += f"({_hm(first_leave, tz)} に出発)"
    return (f"{plan_id}:{guide['local_date']}:morning",
            wp.message(f"{head}{(' ・ ' + guide['day_title']) if guide.get('day_title') else ''}", body,
                       _url(plan_id), f"morning-{guide['local_date']}", "morning"), "normal")


def rain_messages(db: Session, plan_id: str, guide: Dict[str, Any], titles: Dict[str, str], now: datetime
                  ) -> List[Tuple[str, Dict[str, Any], str]]:
    """屋外の予定が雨の時刻にかかる(予報は Open-Meteo。使えない環境では何もしない)"""
    from app.models.models import TravelDay, TravelEvent
    from app.services import weather_fit as wf
    from app.services import weather_forecast as wfc

    if not wfc.enabled() or not guide.get("day_id"):
        return []
    soon = []
    for eid, ev in (guide.get("events") or {}).items():
        start = _parse(ev.get("start_at"))
        if start is None or not (now < start <= now + timedelta(minutes=RAIN_AHEAD_MINUTES)):
            continue
        if ev.get("fit") in ("outdoor", "partly"):
            soon.append(eid)
    if not soon:
        return []
    day = db.query(TravelDay).filter(TravelDay.id == uuid.UUID(str(guide["day_id"]))).first()
    if day is None:
        return []
    from app.api.v1.day_variants import _forecast_for

    try:
        forecast = _forecast_for(db, day)
    except Exception as err:  # noqa: BLE001 - 予報が取れなくても他の知らせは送る
        logger.warning("today_push: 予報を取れませんでした(%s)", type(err).__name__)
        return []
    if not forecast:
        return []
    out: List[Tuple[str, Dict[str, Any], str]] = []
    events = {str(row.id): row for row in db.query(TravelEvent).filter(
        TravelEvent.id.in_([uuid.UUID(x) for x in soon])).all()}
    for eid in soon:
        e = events.get(eid)
        if e is None or e.parent_event_id is not None:
            continue
        hit = wfc.rain_at(forecast, e.local_start_time)
        if not hit or wf.fit(e.title, e.event_type, e.description)["fit"] not in ("outdoor", "partly"):
            continue
        body = f"{(e.local_start_time or '')[:5]} {titles.get(eid, e.title)} の時間に雨(降水確率{hit['probability']}%)。"
        body += "プランBに切り替えられます"
        out.append((f"{plan_id}:{eid}:rain:{guide.get('local_date')}",
                    wp.message("雨の兆し ・ 屋外の予定", body, _url(plan_id, "#today-planb"), f"rain-{eid}", "rain"),
                    "normal"))
    return out


# ---- 定期の処理 ---------------------------------------------------------------------------------------------

def _push_users(db: Session) -> List[Any]:
    from app.models.models import User

    return (db.query(User).filter(User.is_active.isnot(False))
            .filter(cast(User.preferences, JSONB).has_key(wp.PREF_KEY)).all())


def _plans_today(db: Session, user, now: datetime) -> List[Any]:
    from app.models.models import PlanCollaborator, TravelDay, TravelPlan

    owned = [p.id for p in db.query(TravelPlan.id).filter(
        TravelPlan.user_id == user.id, TravelPlan.deleted_at.is_(None)).all()]
    shared = [c.plan_id for c in db.query(PlanCollaborator.plan_id).filter(
        PlanCollaborator.user_id == user.id, PlanCollaborator.status == "accepted",
        PlanCollaborator.role.in_(("viewer", "editor"))).all()]
    ids = list(set(owned) | set(shared))
    if not ids:
        return []
    today = now.date()
    near = {d.plan_id for d in db.query(TravelDay.plan_id).filter(
        TravelDay.plan_id.in_(ids), TravelDay.local_date >= today - timedelta(days=1),
        TravelDay.local_date <= today + timedelta(days=1)).all()}
    return (db.query(TravelPlan).filter(TravelPlan.id.in_(list(near)), TravelPlan.deleted_at.is_(None)).all()
            if near else [])


def _titles(db: Session, ids: Iterable[str]) -> Dict[str, str]:
    from app.models.models import TravelEvent

    uids = []
    for x in ids:
        try:
            uids.append(uuid.UUID(str(x)))
        except ValueError:
            continue
    if not uids:
        return {}
    return {str(e.id): e.title for e in db.query(TravelEvent.id, TravelEvent.title).filter(
        TravelEvent.id.in_(uids)).all()}


def sweep(db: Session, now: Optional[datetime] = None, send: Optional[wp.Sender] = None) -> Dict[str, int]:
    from fastapi import HTTPException

    from app.api.v1.today_live import today_guide_view
    from app.services import notify, today_mode

    counts = {"users": 0, "plans": 0, "sent": 0, "removed": 0, "failed": 0}
    if not wp.enabled():
        return counts
    now = now or today_mode.utcnow()
    for user in _push_users(db):
        if not wp.subscriptions(user):
            continue
        counts["users"] += 1
        kinds = wp.kinds_of(user)
        for plan in _plans_today(db, user, now):
            if notify.levels_for(db, [user.id], plan.id).get(user.id) == "none":
                continue
            try:
                guide = today_guide_view(str(plan.id), db, user)
            except HTTPException:
                continue
            if not guide.get("day_id"):
                continue
            counts["plans"] += 1
            pid = str(plan.id)
            titles = _titles(db, (guide.get("events") or {}).keys())
            items: List[Tuple[str, Dict[str, Any], str]] = []
            if kinds["morning"]:
                m = morning_message(pid, guide, titles, now)
                if m:
                    items.append(m)
            if kinds["depart"]:
                items.extend(depart_messages(pid, guide, titles, now))
            if kinds["rain"]:
                items.extend(rain_messages(db, pid, guide, titles, now))
            for key, msg, urgency in items:
                if not _once(f"{user.id}:{key}"):
                    continue
                r = wp.send_to_user(user, msg, urgency=urgency, ttl=1800, send=send)
                for k in ("sent", "removed", "failed"):
                    counts[k] += r[k]
        db.commit()
    return counts


# ---- 同行者の遅れ ------------------------------------------------------------------------------------------

def crew_targets(db: Session, plan, actor, event, arrive: datetime, planned: Optional[datetime],
                 tz: Optional[str], label: str) -> List[Tuple[str, Dict[str, Any]]]:
    """[(送る人の ID, 中身)]。遅れが CREW_DELAY_MINUTES 分未満・送り済みなら空"""
    from app.api.v1.presence import _roles
    from app.models.models import User
    from app.services import notify

    if planned is None or not wp.enabled():
        return []
    delay = int((arrive - planned).total_seconds() // 60)
    if delay < CREW_DELAY_MINUTES:
        return []
    others = [uid for uid in _roles(db, plan) if uid != str(actor.id)]
    if not others:
        return []
    users = {str(u.id): u for u in db.query(User).filter(User.id.in_([uuid.UUID(x) for x in others])).all()}
    levels = notify.levels_for(db, [u.id for u in users.values()], plan.id)
    out = []
    for uid, u in users.items():
        if levels.get(u.id) == "none" or not wp.kinds_of(u)["crew"] or not wp.subscriptions(u):
            continue
        if not _once(f"{uid}:{plan.id}:{event.id}:crew:{actor.id}:{delay // 10}", ttl=6 * 3600):
            continue
        body = f"{event.title}に約{delay}分遅れて {_hm(arrive, tz)} ごろ着く見込みです(位置は共有していません)"
        out.append((uid, wp.message(f"{label}さんが遅れます", body, _url(str(plan.id)), f"crew-{actor.id}", "crew")))
    return out


SessionFactory = Callable[[], Session]


def _default_session() -> Session:
    from app.core.database import SessionLocal

    return SessionLocal()


session_factory: SessionFactory = _default_session


def deliver_later(targets: List[Tuple[str, Dict[str, Any]]], send: Optional[wp.Sender] = None) -> Dict[str, int]:
    """応答の後に送る(BackgroundTasks)。窓口の遅れで画面の操作を待たせない"""
    from app.models.models import User

    counts = {"sent": 0, "removed": 0, "failed": 0}
    if not targets:
        return counts
    db = session_factory()
    try:
        for uid, msg in targets:
            user = db.query(User).filter(User.id == uuid.UUID(uid)).first()
            if user is None:
                continue
            r = wp.send_to_user(user, msg, urgency="high", ttl=1800, send=send)
            for k in counts:
                counts[k] += r[k]
        db.commit()
    except Exception as e:  # noqa: BLE001 - 送れなくても共有そのものは済んでいる
        logger.warning("today_push: 同行者への通知を送れませんでした(%s)", type(e).__name__)
        db.rollback()
    finally:
        if session_factory is _default_session:
            db.close()
    return counts
