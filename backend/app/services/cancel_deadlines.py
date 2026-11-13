"""[Gate Remaining-3] FR-010 予約の取消期限の知らせ(定期実行: tcops.py jobs cancel-deadlines、15分ごと)。

- 取消期限(cancellation_deadline)の 48 時間前・6 時間前に 1 回ずつ、旅行の所有者と編集者(予約を隠されていない人)へ知らせる
- 同じ予約・同じ段階は 1 回だけ(通知の表に同じ種類・同じ予約・同じ段階の題名があれば送らない。DB の変更なし)
- 本文に予約番号・氏名・金額は入れない(予約の種類・事業者の名前・期限の時刻だけ)。急ぎの通知として、メールを
  「すぐ送る」の人にはメールも送る(notify.URGENT_TYPES)
- 期限を過ぎた・取消済み・使用済み・削除済みの予約は対象外。出力は件数だけ
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.models.models import Notification, PlanCollaborator, Reservation, TravelPlan, User
from app.services import member_policy, notify

NTYPE = "cancel_deadline"
STAGES = (("48h", timedelta(hours=48)), ("6h", timedelta(hours=6)))
ACTIVE = ("candidate", "confirmed", "modified")
TYPE_LABEL = {"accommodation": "宿", "flight": "飛行機", "train": "列車", "bus": "バス", "ferry": "船",
              "rental_car": "レンタカー", "restaurant": "お店", "activity": "体験", "admission": "入場券", "other": "予約"}


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _local(dt: datetime, tz: Optional[str]) -> str:
    try:
        z = ZoneInfo(tz or "Asia/Tokyo")
    except (ZoneInfoNotFoundError, ValueError):
        z = ZoneInfo("Asia/Tokyo")
    return _aware(dt).astimezone(z).strftime("%m/%d %H:%M")


def recipients(db: Session, plan: TravelPlan) -> Set[Any]:
    """所有者と、承諾済みの編集者のうち予約を隠されていない人"""
    out = {plan.user_id}
    rows: List[Any] = db.query(PlanCollaborator).filter(
        PlanCollaborator.plan_id == plan.id, PlanCollaborator.status == "accepted",
        PlanCollaborator.role == "editor", PlanCollaborator.user_id.isnot(None)).all()
    for c in rows:
        user = db.query(User).filter(User.id == c.user_id).first()
        if user is not None and "reservations" not in member_policy.hidden_for(db, plan, "editor", user):
            out.add(c.user_id)
    return out


def _stage_marker(stage: str) -> str:
    return "まで48時間" if stage == "48h" else "まで6時間"


def sweep(db: Session, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or datetime.now(timezone.utc)
    result = {"checked": 0, "notified": 0, "reservations": 0}
    rows: List[Any] = (db.query(Reservation).filter(
        Reservation.deleted_at.is_(None), Reservation.status.in_(ACTIVE),
        Reservation.cancellation_deadline.isnot(None), Reservation.cancellation_deadline > now,
        Reservation.cancellation_deadline <= now + STAGES[0][1])
        .order_by(Reservation.cancellation_deadline).limit(500).all())
    for r in rows:
        result["checked"] += 1
        left = _aware(r.cancellation_deadline) - now
        stage = "6h" if left <= STAGES[1][1] else "48h"
        marker = _stage_marker(stage)
        sent = db.query(Notification.id).filter(Notification.type == NTYPE, Notification.target_id == r.id,
                                                Notification.title.contains(marker)).first()
        if sent is not None:
            continue
        plan = db.query(TravelPlan).filter(TravelPlan.id == r.plan_id, TravelPlan.deleted_at.is_(None)).first()
        if plan is None:
            continue
        what = TYPE_LABEL.get(str(r.type), "予約")
        name = (r.provider_name or "").strip()[:60]
        label = f"{what}「{name}」" if name else what
        title = "%sの取消期限%s(%s)" % (label, marker, _local(r.cancellation_deadline, getattr(r, "timezone_id", None)))
        message = "「%s」の予約の取消期限が近づいています。取り消すか続けるかを、予約の画面で確かめてください。" % plan.title
        users = recipients(db, plan)
        n = notify.deliver(db, plan, users, NTYPE, title, message, target_type="reservation", target_id=r.id,
                           direct_ids=users)
        result["notified"] += n
        result["reservations"] += 1
    db.commit()
    return result
