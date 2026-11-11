"""
[Gate BookingBadge] 旅程の予定ごとの「予約済み・予約の食い違い・まだ」の判定。

- 予約(reservations)と予定は、予約の event_id か、event_reservations(予約の取り込み・「予定につなぐ」)で結び付く
- 予約できる予定(宿・食事・体験)と、予約が結び付いている予定だけを出す
- 結び付いた予約は、日付・時刻(宿はチェックインの時刻)・施設の名前・人数(旅行の基本情報の人数)・取り消しを確かめる
- 結び付いていない時は、まだ予定につないでいない予約のうち、名前か日付が合う物を「この予約では?」として出す
外へは何も送らない(この旅行の予約と予定だけを比べる)。予約番号などの秘密の値は返さない。
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.models import EventReservation, Reservation, TravelDay, TravelEvent, TravelPlan

BOOKABLE = {"accommodation", "dining", "activity"}
# 予約の種類 → 合う予定の種類
TYPE_MATCH = {
    "accommodation": {"accommodation"},
    "restaurant": {"dining"},
    "activity": {"activity", "sightseeing"},
    "admission": {"activity", "sightseeing"},
}
TYPE_LABEL = {"accommodation": "宿", "restaurant": "食事", "activity": "体験", "admission": "入場", "flight": "飛行機",
              "train": "鉄道", "bus": "バス", "ferry": "船", "rental_car": "レンタカー", "other": "その他"}
LIVE = {"candidate", "confirmed", "modified"}
_NOISE = re.compile(r"[\s\-‐ー・･、。,.()()「」『』【】\[\]/／'\"&＆]+")


def norm_name(s: Optional[str]) -> str:
    return _NOISE.sub("", unicodedata.normalize("NFKC", s or "").lower())


def name_match(a: Optional[str], b: Optional[str]) -> bool:
    """施設の名前が同じ物を指すか(片方が片方を含む・2 文字ずつの重なりが半分以上)"""
    x, y = norm_name(a), norm_name(b)
    if len(x) < 2 or len(y) < 2:
        return False
    if x in y or y in x:
        return True
    bx = {x[i:i + 2] for i in range(len(x) - 1)}
    by = {y[i:i + 2] for i in range(len(y) - 1)}
    return len(bx & by) / max(1, min(len(bx), len(by))) >= 0.5


def _local(dt: Optional[datetime], tz: Optional[str]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    try:
        return dt.astimezone(ZoneInfo(tz or "Asia/Tokyo"))
    except Exception:  # noqa: BLE001 - 時刻帯の名前が不正なら UTC のまま
        return dt


def _md(d: date) -> str:
    return f"{d.month}/{d.day}"


def check(res: Reservation, ev: TravelEvent, day: Optional[TravelDay], party: Optional[int]) -> List[str]:
    """結び付いた予約と予定の食い違い(文)。合っていれば空"""
    issues: List[str] = []
    if res.status == "cancelled":
        issues.append("この予約は取り消し済みです")
    if res.status == "no_show":
        issues.append("この予約は不泊・不来店の扱いです")
    tz = res.timezone_id or (day.timezone_id if day else None)
    start = _local(res.start_at, tz)
    end = _local(res.end_at, tz)
    day_date = day.local_date if day is not None else None
    if start is not None and day_date is not None:
        sd = start.date()
        if res.type == "accommodation" and end is not None and end.date() > sd:
            if not (sd <= day_date < end.date()):
                issues.append(f"予約の宿泊日({_md(sd)}〜{_md(end.date())})と予定の日({_md(day_date)})が合いません")
        elif sd != day_date:
            issues.append(f"予約の日({_md(sd)})と予定の日({_md(day_date)})が合いません")
    if start is not None and ev.local_start_time and (day_date is None or start.date() == day_date):
        hhmm = start.strftime("%H:%M")
        if res.type == "accommodation":
            if ev.local_start_time < hhmm:
                issues.append(f"チェックインは {hhmm} からです(予定は {ev.local_start_time})")
        elif hhmm != ev.local_start_time[:5]:
            issues.append(f"予約の時刻 {hhmm} と予定の時刻 {ev.local_start_time[:5]} が違います")
    if res.provider_name and not (name_match(res.provider_name, ev.title) or name_match(res.provider_name, ev.address)):
        issues.append(f"予約の施設「{res.provider_name}」と予定の名前が違います")
    if res.guest_count and party and res.guest_count != party:
        issues.append(f"予約の人数 {res.guest_count}名と旅行の人数 {party}名が違います")
    return issues


def _res_out(r: Reservation, tz: Optional[str]) -> Dict[str, Any]:
    s = _local(r.start_at, r.timezone_id or tz)
    e = _local(r.end_at, r.timezone_id or tz)
    return {"id": str(r.id), "type": r.type, "type_label": TYPE_LABEL.get(r.type, r.type), "status": r.status,
            "provider_name": r.provider_name, "guest_count": r.guest_count,
            "start": s.strftime("%Y-%m-%d %H:%M") if s else None, "end": e.strftime("%Y-%m-%d %H:%M") if e else None}


def party_size(plan: TravelPlan) -> Optional[int]:
    prefs = plan.preferences if isinstance(plan.preferences, dict) else {}
    v = prefs.get("party_size")
    return int(v) if isinstance(v, (int, float)) and v > 0 else None


def booking_status(db: Session, plan: TravelPlan) -> Dict[str, Any]:
    events = db.query(TravelEvent).filter(TravelEvent.plan_id == plan.id).all()
    days = {d.id: d for d in db.query(TravelDay).filter(TravelDay.plan_id == plan.id).all()}
    reservations = (db.query(Reservation).filter(Reservation.plan_id == plan.id, Reservation.deleted_at.is_(None))
                    .order_by(Reservation.start_at.asc().nullslast(), Reservation.created_at.asc()).all())
    by_id = {r.id: r for r in reservations}
    links: Dict[Any, List[Reservation]] = {}
    linked_res: set = set()

    def link(eid: Any, r: Optional[Reservation]) -> None:
        if r is None:
            return
        cur = links.setdefault(eid, [])
        if r not in cur:
            cur.append(r)
        linked_res.add(r.id)

    for r in reservations:
        if r.event_id is not None:
            link(r.event_id, r)
    for er in db.query(EventReservation).join(Reservation, Reservation.id == EventReservation.reservation_id).filter(
            Reservation.plan_id == plan.id).all():
        link(er.event_id, by_id.get(er.reservation_id))

    party = party_size(plan)
    out: Dict[str, Any] = {}
    for ev in events:
        day = days.get(ev.day_id)
        tz = day.timezone_id if day else None
        mine = links.get(ev.id, [])
        if not mine and ev.event_type not in BOOKABLE:
            continue
        if mine:
            live = [r for r in mine if r.status in LIVE] or mine
            issues: List[str] = []
            for r in live:
                issues += check(r, ev, day, party)
            out[str(ev.id)] = {"state": "issue" if issues else "booked", "issues": issues,
                               "reservations": [_res_out(r, tz) for r in live], "suggestions": []}
            continue
        sugg: List[Tuple[int, Reservation]] = []
        for r in reservations:
            if r.id in linked_res or r.status not in LIVE:
                continue
            if r.type in TYPE_MATCH and ev.event_type not in TYPE_MATCH[r.type]:
                continue
            score = 0
            if r.provider_name and (name_match(r.provider_name, ev.title) or name_match(r.provider_name, ev.address)):
                score += 2
            s = _local(r.start_at, r.timezone_id or tz)
            same_day = s is not None and day is not None and s.date() == day.local_date
            if same_day:
                score += 1
            # 名前が合わない時は、同じ日で時刻が 1 時間以内(宿は同じ日)の予約だけ
            near = False
            if same_day and s is not None:
                if r.type == "accommodation":
                    near = True
                elif ev.local_start_time and re.match(r"^\d{1,2}:\d{2}", ev.local_start_time):
                    h, m = ev.local_start_time[:5].split(":")
                    near = abs((s.hour * 60 + s.minute) - (int(h) * 60 + int(m))) <= 60
            if score >= 2 or (near and r.type in TYPE_MATCH):
                sugg.append((score, r))
        sugg.sort(key=lambda x: -x[0])
        out[str(ev.id)] = {"state": "suggest" if sugg else "none", "issues": [], "reservations": [],
                           "suggestions": [_res_out(r, tz) for _s, r in sugg[:3]]}
    return {"party_size": party, "events": out}
