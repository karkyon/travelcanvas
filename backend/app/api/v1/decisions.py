"""[Gate G4] COL-02 投票の決定を旅程へ採用する(FR-022。採用の前の確認・変更セット・元に戻す)。

エンドポイント(すべて /plans/{plan_id}/polls/{poll_id} 配下。editor 以上):
- POST /adoption-preview : 採用すると何が変わるかを返す(何も変えない)。入力は adopt と同じ
- POST /adopt            : 採用する。If-Match は旅行の revision(違えば 409。プレビューの後に他の人が変えた)
- POST /adopt/undo       : 採用を元に戻す(採用の変更セットが旅行の一番新しい変更の時だけ。後の変更は巻き戻さない)

採用の中身(決定した選択肢による):
- 候補箱の候補: 指定した日(day_id・時刻)に予定として置く(候補は「予定に配置済み」になる。元に戻すと候補に戻る)
- 予定: その予定を残す。remove_others=true なら、ほかの選択肢の予定を外す(ロックされた予定・確定の予約が付いた予定は外さず 409)
- 名前だけの選択肢: 旅程は変えない(採用の記録だけ)
1回の採用は1つの変更セット(source=decision)にまとめる。監査に予定の名前を残さない。
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.v1 import candidates as candidates_api
from app.api.v1 import commands as commands_api
from app.api.v1 import discussion as discussion_api
from app.api.v1 import plans as plans_api
from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import (
    ChangeSet, Place, PlanCandidate, PollOption, TravelDay, TravelEvent, TravelPlan, User,
)
from app.services import plan_item_deletion
from app.services.constraint_evaluation import member_user_ids

router = APIRouter(prefix="/plans", tags=["decisions"])


def _bad(code: str, message: str, status_code: int = 409) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


class AdoptInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day_id: Optional[uuid.UUID] = None
    local_start_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    remove_others: bool = False


def _decided(db: Session, plan: TravelPlan, poll: Any) -> PollOption:
    opt = next((o for o in poll.options if o.id == poll.decided_option_id), None)
    if opt is None:
        raise _bad("poll_not_decided", "まだ決定していません(先に選択肢を決定してください)")
    return opt


def _plan_of(db: Session, plan: TravelPlan, poll: Any, body: AdoptInput) -> Dict[str, Any]:
    """採用で起きることの計画(読むだけ)。問題があれば problems に入れる。"""
    opt = _decided(db, plan, poll)
    effects: List[str] = []
    problems: List[Dict[str, str]] = []
    kind = "record_only"
    day = None
    if opt.candidate_id:
        kind = "schedule_candidate"
        cand = db.query(PlanCandidate).filter(PlanCandidate.id == opt.candidate_id,
                                              PlanCandidate.plan_id == plan.id).first()
        if cand is None:
            problems.append({"code": "candidate_missing", "message": "決定した候補が候補箱から消えています"})
        else:
            event_ids = {r[0] for r in db.query(TravelEvent.id).filter(TravelEvent.plan_id == plan.id).all()}
            if candidates_api._effective_status(cand, event_ids) == "scheduled":
                problems.append({"code": "already_scheduled", "message": "決定した候補は、もう予定に置かれています"})
        if body.day_id is None:
            problems.append({"code": "day_required", "message": "候補を置く日を選んでください"})
        else:
            day = db.query(TravelDay).filter(TravelDay.id == body.day_id, TravelDay.plan_id == plan.id).first()
            if day is None:
                problems.append({"code": "day_not_found", "message": "選んだ日がこの旅行にありません"})
        if cand is not None and day is not None:
            effects.append("候補「%s」を %s%s の予定にします" % (
                cand.title, day.local_date.strftime("%m/%d") if day.local_date else "その日",
                " %s" % body.local_start_time if body.local_start_time else ""))
    elif opt.event_id:
        kind = "keep_event"
        ev = db.query(TravelEvent).filter(TravelEvent.id == opt.event_id, TravelEvent.plan_id == plan.id).first()
        if ev is None:
            problems.append({"code": "event_missing", "message": "決定した予定が旅程から消えています"})
        else:
            effects.append("予定「%s」を残します" % ev.title)
    else:
        effects.append("選択肢「%s」を採用として記録します(旅程は変えません)" % opt.label)
    removals: List[TravelEvent] = []
    if body.remove_others:
        other_ids = [o.event_id for o in poll.options if o.event_id and o.id != opt.id]
        removals = db.query(TravelEvent).filter(TravelEvent.id.in_(other_ids), TravelEvent.plan_id == plan.id).all() \
            if other_ids else []
        for ev in removals:
            if ev.locked:
                problems.append({"code": "event_locked", "message": "予定「%s」はロックされているため外せません" % ev.title})
            effects.append("ほかの選択肢の予定「%s」を外します" % ev.title)
        if not removals:
            effects.append("外すほかの予定はありません")
    return {"option": opt, "kind": kind, "day": day, "removals": removals, "effects": effects, "problems": problems}


def _preview_out(plan: TravelPlan, poll: Any, planned: Dict[str, Any]) -> Dict[str, Any]:
    return {"poll_id": str(poll.id), "option_id": str(planned["option"].id), "option_label": planned["option"].label,
            "kind": planned["kind"], "effects": planned["effects"], "problems": planned["problems"],
            "can_adopt": not planned["problems"] and poll.adopted_at is None, "undoable": True,
            "plan_revision": plan.revision}


def _load(db: Session, plan_id: str, poll_id: str, user: User):
    plan, role = require_plan_access(db, plan_id, user, min_role="editor")
    poll = discussion_api._get_poll(db, plan, poll_id)
    return plan, role, poll


@router.post("/{plan_id}/polls/{poll_id}/adoption-preview")
def adoption_preview(plan_id: str, poll_id: str, body: AdoptInput, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, _role, poll = _load(db, plan_id, poll_id, current_user)
    if poll.adopted_at is not None:
        raise _bad("already_adopted", "この投票はもう採用しています")
    return _preview_out(plan, poll, _plan_of(db, plan, poll, body))


@router.post("/{plan_id}/polls/{poll_id}/adopt")
def adopt(plan_id: str, poll_id: str, body: AdoptInput, request: Request, db: Session = Depends(get_db),
          if_match: Optional[str] = Header(None, alias="If-Match"),
          current_user: User = Depends(get_current_user_or_guest)):
    plan, role, poll = _load(db, plan_id, poll_id, current_user)
    plans_api._require_if_match(plan, if_match)
    if poll.adopted_at is not None:
        raise _bad("already_adopted", "この投票はもう採用しています")
    planned = _plan_of(db, plan, poll, body)
    if planned["problems"]:
        p = planned["problems"][0]
        raise _bad(p["code"], p["message"])
    changes: List[tuple] = []
    if planned["kind"] == "schedule_candidate":
        cand: Any = db.query(PlanCandidate).filter(PlanCandidate.id == planned["option"].candidate_id).one()
        place = db.query(Place).filter(Place.id == cand.place_id).first() if cand.place_id else None
        if place is None:
            place = candidates_api._place_from_candidate(db, cand, current_user)
            cand.place_id = place.id
        day = planned["day"]
        ev = TravelEvent(plan_id=plan.id, day_id=day.id, place_id=place.id, title=cand.title, description=cand.note,
                         event_type="sightseeing", local_start_time=body.local_start_time, address=cand.address,
                         latitude=cand.latitude, longitude=cand.longitude,
                         sort_order=db.query(TravelEvent).filter(TravelEvent.day_id == day.id).count())
        db.add(ev)
        db.flush()
        changes.append(("travel_event", ev.id, "create", None, plans_api._event_to_dict(ev)))
        cand.status, cand.scheduled_event_id, cand.merged_into_id = "scheduled", ev.id, None
        cand.revision += 1
    if planned["removals"]:
        ids = [e.id for e in planned["removals"]]
        try:
            detachment = plan_item_deletion.detach_event_references(db, ids)
        except plan_item_deletion.LockedRelationError as exc:
            raise HTTPException(status_code=409, detail=plan_item_deletion.locked_detail(exc.blocking))
        for e in planned["removals"]:
            changes.append(("travel_event", e.id, "delete", plans_api._event_to_dict(e), None))
            db.delete(e)
        db.flush()
        changes.extend(detachment.changes)
    change_set_id = None
    if changes:
        plans_api._record_batch_change_and_bump_revision(db, plan, current_user, "decision", changes)
        latest = (db.query(ChangeSet.id).filter(ChangeSet.plan_id == plan.id)
                  .order_by(ChangeSet.resulting_revision.desc()).first())
        change_set_id = latest[0] if latest else None
    poll = discussion_api._get_poll(db, plan, poll_id)
    poll.adopted_at = datetime.now(dt_timezone.utc)
    poll.adopted_by_user_id = current_user.id
    poll.adopted_change_set_id = change_set_id
    poll.revision += 1
    members = member_user_ids(db, plan)
    me: Any = current_user.id
    discussion_api._notify(db, plan, members - {me}, "poll_adopted",
                           f"「{plan.title}」で投票の結果を旅程に反映しました",
                           f"{current_user.username or 'ゲスト'}さんが決定した選択肢を採用しました。旅行プランで確認してください。",
                           target_type="poll", target_id=poll.id)
    db.commit()
    db.refresh(plan)
    discussion_api._audit("poll_adopted", "poll", request, current_user, poll.id, plan.id,
                          {"kind": planned["kind"], "removed": len(planned["removals"]),
                           "change_set_id": str(change_set_id) if change_set_id else None})
    return {"poll": discussion_api._poll_response(db, plan, poll, current_user, role, members,
                                                  discussion_api._poll_names(db, [poll], members)),
            "plan_revision": plan.revision, "message": "旅程に反映しました"}


@router.post("/{plan_id}/polls/{poll_id}/adopt/undo")
async def undo_adopt(plan_id: str, poll_id: str, request: Request, db: Session = Depends(get_db),
                     if_match: Optional[str] = Header(None, alias="If-Match"),
                     current_user: User = Depends(get_current_user_or_guest)):
    plan, role, poll = _load(db, plan_id, poll_id, current_user)
    if poll.adopted_at is None:
        raise _bad("not_adopted", "この投票はまだ採用していません")
    if poll.adopted_change_set_id is not None:
        await commands_api.undo_change_set(db, plan, current_user, poll.adopted_change_set_id, if_match)
    else:
        plans_api._require_if_match(plan, if_match)
    poll = discussion_api._get_poll(db, plan, poll_id)
    poll.adopted_at = None
    poll.adopted_by_user_id = None
    poll.adopted_change_set_id = None
    poll.revision += 1
    db.commit()
    db.refresh(plan)
    discussion_api._audit("poll_adoption_undone", "poll", request, current_user, poll.id, plan.id)
    members = member_user_ids(db, plan)
    return {"poll": discussion_api._poll_response(db, plan, poll, current_user, role, members,
                                                  discussion_api._poll_names(db, [poll], members)),
            "plan_revision": plan.revision, "message": "採用を元に戻しました"}
