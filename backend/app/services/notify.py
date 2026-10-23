"""[Gate G4] COL-03 通知の配信(利用者ごとの設定の適用)・メールのまとめ(digest)・送るメールの記録(outbox)と再送。

通知の設定(notification_preferences):
- 旅行ごとの設定 > 全体の設定 > 既定(all)
- all: すべて / mentions: 自分へのメンション・自分の投稿への返信・自分あての割り当てだけ / none: 作らない
- email_digest=daily: 読んでいない通知を1日1回メールにまとめる(本文は旅行名と件数・画面への案内だけ。コメントの本文・
  予約番号・位置は入れない)

メールの送信(email_outbox):
- 送る物は先に記録し、別の処理(``tcops.py jobs email-outbox``、5分ごと)が送る。失敗したら 5分・10分・20分…(上限6時間)と
  間を空けて送り直し、MAX_ATTEMPTS 回で dead(管理者が見て直す)
- 送信の設定(SMTP_HOST 等)が無い環境では、まとめを作らない(email_available=false を画面に出す)
"""
from __future__ import annotations

import smtplib
import ssl
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import EmailOutbox, Notification, NotificationPreference, TravelPlan, User

LEVELS = ("all", "mentions", "none")
DIGESTS = ("off", "daily")
MAX_ATTEMPTS = 6
DIGEST_INTERVAL = timedelta(hours=20)  # 1日1回(cron の時刻のずれを見込む)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def email_available() -> bool:
    return bool(settings.SMTP_HOST and settings.EMAIL_FROM)


def levels_for(db: Session, user_ids: Iterable[uuid.UUID], plan_id: Optional[uuid.UUID]) -> Dict[uuid.UUID, str]:
    ids = list(set(user_ids))
    out = {uid: "all" for uid in ids}
    if not ids:
        return out
    rows: List[Any] = db.query(NotificationPreference).filter(NotificationPreference.user_id.in_(ids)).all()
    glob: Dict[Any, str] = {r.user_id: r.level for r in rows if r.plan_id is None}
    per_plan: Dict[Any, str] = {r.user_id: r.level for r in rows if plan_id is not None and r.plan_id == plan_id}
    for uid in ids:
        out[uid] = per_plan.get(uid) or glob.get(uid) or "all"
    return out


def deliver(db: Session, plan: Optional[Any], user_ids: Iterable[uuid.UUID], ntype: str, title: str,
            message: str, *, target_type: Optional[str] = None, target_id: Optional[uuid.UUID] = None,
            direct_ids: Iterable[uuid.UUID] = ()) -> int:
    """設定に従って通知を作る(呼んだ側が commit する)。direct_ids は「自分あて」(メンション・返信)の人。作った件数を返す。"""
    direct: Set[uuid.UUID] = set(direct_ids)
    levels = levels_for(db, user_ids, plan.id if plan else None)
    n = 0
    for uid, level in levels.items():
        if level == "none" or (level == "mentions" and uid not in direct):
            continue
        db.add(Notification(id=uuid.uuid4(), user_id=uid, type=ntype, title=title[:200], message=message,
                            related_plan_id=plan.id if plan else None, target_type=target_type,
                            target_id=target_id))
        n += 1
    return n


# ---------------------------------------------------------------- 設定

def get_preferences(db: Session, user: User) -> Dict[str, object]:
    rows: List[Any] = db.query(NotificationPreference).filter(NotificationPreference.user_id == user.id).all()
    glob = next((r for r in rows if r.plan_id is None), None)
    plan_ids = [r.plan_id for r in rows if r.plan_id is not None]
    titles = {p.id: p.title for p in db.query(TravelPlan).filter(TravelPlan.id.in_(plan_ids)).all()} if plan_ids else {}
    return {
        "level": glob.level if glob else "all",
        "email_digest": glob.email_digest if glob else "off",
        "email_available": email_available(),
        "has_email": bool(getattr(user, "email", None)) and not getattr(user, "is_guest", False),
        "plans": sorted(({"plan_id": str(r.plan_id), "plan_title": titles.get(r.plan_id), "level": r.level}
                         for r in rows if r.plan_id is not None and r.plan_id in titles),
                        key=lambda x: (x["plan_title"] or "")),
    }


def set_preference(db: Session, user: User, plan_id: Optional[uuid.UUID], level: Optional[str],
                   email_digest: Optional[str]) -> None:
    row: Any = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == user.id,
        NotificationPreference.plan_id.is_(None) if plan_id is None else NotificationPreference.plan_id == plan_id,
    ).first()
    if row is None:
        row = NotificationPreference(user_id=user.id, plan_id=plan_id)
        db.add(row)
    if level is not None:
        row.level = level
    if email_digest is not None:
        row.email_digest = email_digest
    row.updated_at = _now()


def clear_plan_preference(db: Session, user: User, plan_id: uuid.UUID) -> None:
    db.query(NotificationPreference).filter(NotificationPreference.user_id == user.id,
                                            NotificationPreference.plan_id == plan_id).delete(synchronize_session=False)


# ---------------------------------------------------------------- まとめ(digest)

def build_digests(db: Session, now: Optional[datetime] = None) -> Dict[str, int]:
    """email_digest=daily の人に、前のまとめ(無ければ24時間前)からの読んでいない通知をまとめて outbox に入れる。"""
    now = now or _now()
    if not email_available():
        return {"queued": 0, "skipped": 0, "email_disabled": 1}
    queued = skipped = 0
    rows: List[Any] = db.query(NotificationPreference).filter(NotificationPreference.plan_id.is_(None),
                                                              NotificationPreference.email_digest == "daily").all()
    for pref in rows:
        since = pref.last_digest_at or (now - timedelta(hours=24))
        if pref.last_digest_at and now - pref.last_digest_at < DIGEST_INTERVAL:
            continue
        user: Any = db.query(User).filter(User.id == pref.user_id).first()
        if user is None or not user.email or getattr(user, "is_guest", False) or not getattr(user, "is_active", True):
            skipped += 1
            pref.last_digest_at = now
            continue
        counts = (db.query(Notification.related_plan_id, func.count(Notification.id))
                  .filter(Notification.user_id == user.id, Notification.is_read.is_(False),
                          Notification.created_at > since)
                  .group_by(Notification.related_plan_id).all())
        total = sum(c for _p, c in counts)
        pref.last_digest_at = now
        if total == 0:
            continue
        titles = {p.id: p.title for p in db.query(TravelPlan).filter(
            TravelPlan.id.in_([p for p, _c in counts if p is not None])).all()}
        lines = ["読んでいない通知が %d 件あります。" % total, ""]
        for pid, c in sorted(counts, key=lambda x: -x[1]):
            lines.append("・%s: %d 件" % (titles.get(pid, "旅行に関係しない通知") if pid else "旅行に関係しない通知", c))
        lines += ["", "TravelCanvas の「通知」の画面で確かめてください。",
                  "このまとめを止めるには、通知の設定で「メールでまとめる」を「送らない」にしてください。"]
        db.add(EmailOutbox(user_id=user.id, kind="digest", subject="TravelCanvas: 読んでいない通知 %d 件" % total,
                           body="\n".join(lines)))
        queued += 1
    db.commit()
    return {"queued": queued, "skipped": skipped}


# ---------------------------------------------------------------- 送信

def _smtp_send(to_email: str, subject: str, body: str) -> None:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr(("TravelCanvas", settings.EMAIL_FROM))
    msg["To"] = to_email
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
        if settings.SMTP_USE_TLS:
            server.starttls(context=ssl.create_default_context())
        if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, [to_email], msg.as_string())


def backoff(attempts: int) -> timedelta:
    return min(timedelta(minutes=5) * (2 ** max(0, attempts - 1)), timedelta(hours=6))


def deliver_outbox(db: Session, now: Optional[datetime] = None, send: Optional[Callable[[str, str, str], None]] = None,
                   limit: int = 100) -> Dict[str, int]:
    """時刻の来た送信待ち(pending・failed)を送る。失敗は間を空けて再送、上限で dead。宛先・本文はログに出さない。"""
    now = now or _now()
    send = send or _smtp_send
    result = {"attempted": 0, "sent": 0, "failed": 0, "dead": 0}
    if send is _smtp_send and not email_available():
        return {**result, "email_disabled": 1}
    rows: List[Any] = (db.query(EmailOutbox).filter(EmailOutbox.status.in_(("pending", "failed")),
                                                    EmailOutbox.next_attempt_at <= now)
                       .order_by(EmailOutbox.next_attempt_at).limit(limit).with_for_update(skip_locked=True).all())
    for row in rows:
        user: Any = db.query(User).filter(User.id == row.user_id).first()
        result["attempted"] += 1
        row.attempts += 1
        try:
            if user is None or not user.email:
                raise ValueError("no_recipient")
            send(user.email, row.subject, row.body)
        except Exception as e:  # noqa: BLE001 - 送信の失敗は記録して再送する
            row.last_error = type(e).__name__[:200]
            if row.attempts >= MAX_ATTEMPTS or str(e) == "no_recipient":
                row.status = "dead"
                result["dead"] += 1
            else:
                row.status = "failed"
                row.next_attempt_at = now + backoff(row.attempts)
                result["failed"] += 1
            continue
        row.status, row.sent_at, row.last_error = "sent", now, None
        result["sent"] += 1
    db.commit()
    return result


def outbox_summary(db: Session) -> Dict[str, int]:
    rows = db.query(EmailOutbox.status, func.count(EmailOutbox.id)).group_by(EmailOutbox.status).all()
    return {s: c for s, c in rows}
