"""[Gate G4] COL-02 投票の締切の処理(定期実行: tcops.py jobs poll-deadlines、15分ごと)。

- 締切の REMIND_BEFORE 前: まだ回答していないメンバーに「締切が近い」と知らせる(1回だけ。reminder_sent_at)
- 締切を過ぎた回答中の投票: 締める(status=closed・closed_reason=deadline)。メンバーへ結果の状態(最有力・同点・
  定足数に届かない)を知らせる。決定は自動ではしない(同点・懸念の扱いは人が決める)
通知の本文に回答の内容・投票の題名以外の情報は入れない。出力は件数だけ。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.models import Poll, TravelPlan, Vote
from app.services import consensus, notify
from app.services.constraint_evaluation import member_user_ids

REMIND_BEFORE = timedelta(hours=24)


def _aware(dt: Any) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def sweep(db: Session, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or datetime.now(timezone.utc)
    result = {"reminded": 0, "closed": 0, "notified": 0}
    polls: List[Any] = (db.query(Poll).filter(Poll.status == "open", Poll.deleted_at.is_(None),
                                              Poll.deadline_at.isnot(None),
                                              Poll.deadline_at <= now + REMIND_BEFORE)
                        .order_by(Poll.deadline_at).limit(500).with_for_update(skip_locked=True).all())
    for p in polls:
        plan = db.query(TravelPlan).filter(TravelPlan.id == p.plan_id, TravelPlan.deleted_at.is_(None)).first()
        if plan is None:
            continue
        members = member_user_ids(db, plan)
        responders = {r[0] for r in db.query(Vote.user_id).filter(Vote.poll_id == p.id).all()}
        deadline = _aware(p.deadline_at)
        if deadline <= now:
            p.status, p.closed_at, p.closed_reason = "closed", now, "deadline"
            p.revision = (p.revision or 1) + 1
            result["closed"] += 1
            if not consensus.quorum_met(len(responders), p.quorum):
                msg = "回答者が定足数に届かないまま締め切りました。再開して回答を集めるか、投票を見直してください。"
            else:
                msg = "締め切りました。結果を確かめて、選択肢を決定してください。"
            result["notified"] += notify.deliver(db, plan, members, "poll_closed",
                                                 "「%s」の投票「%s」が締め切られました" % (plan.title, p.title), msg,
                                                 target_type="poll", target_id=p.id)
        elif p.reminder_sent_at is None:
            p.reminder_sent_at = now
            waiting = members - responders
            if waiting:
                result["reminded"] += notify.deliver(
                    db, plan, waiting, "poll_reminder", "「%s」の投票「%s」の締切が近づいています" % (plan.title, p.title),
                    "まだ回答していません。締切の前に回答してください。", target_type="poll", target_id=p.id,
                    direct_ids=waiting)
    db.commit()
    return result
