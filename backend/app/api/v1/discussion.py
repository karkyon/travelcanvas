"""
[Gate P3] FR-022 合意形成(投票・懸念) / FR-024 コメント・メンション通知(DOC-05 §8.4 / FC-065〜067 / EX-011)。

エンドポイント(すべて /plans/{plan_id} 配下):
- GET/POST /polls, GET/PATCH/DELETE /polls/{id}
- PUT  /polls/{id}/votes                     : 自分の回答(選択肢ごとに Love/OK/懸念/不可/棄権)をまとめて保存
- POST /polls/{id}/votes/{vote_id}/resolution: 懸念・不可を解決済み/未解決にする(返信・代替の記録)
- GET/POST /comments, PATCH/DELETE /comments/{id}

権限:
- 投票の作成・変更・締切・削除: editor以上。回答・コメント: viewer以上(投票者・閲覧者も意見を出せる)
- 懸念の解決: 回答した本人、または editor以上
- コメントの編集: 本人。解決済みにする・削除: 本人または editor以上

匿名の投票は、回答者が3人未満の間は件数を出さず、誰がどう回答したかは本人以外に出さない(FC-067)。

[Gate G4] COL-02 決定の状態遷移(app/services/consensus.phase): 回答中 → 締切(手で・期限。期限は tcops jobs poll-deadlines が
締めて知らせる)→ 決定 → 採用(予定へ反映。app/api/v1/decisions.py)。定足数(quorum)に届かない投票は決定できない。同点の
最有力は tied_option_ids で示し、自動では決めない(編集者が選ぶ)。採用した後は、決定の変更・再開・回答の変更をしない
(先に採用を元に戻す)。選択肢は候補箱の候補(candidate_id)にもできる。
[Gate G4] COL-03 通知は利用者の設定(app/services/notify.py)に従う。メンション・返信は「自分あて」。対象(予約・費用)を
見られない人はメンションできない(通知から対象の存在を漏らさない)。通知には対象(target_type・target_id)を付ける。
コメントに予約番号・PIN・旅券番号らしき文字列があれば sensitive_warning で知らせる(EX-011。保存は止めない)。
メンションした相手と投票の作成時のメンバーには通知を作るが、通知本文にコメント本文は入れない(FR-024)。
"""
import re
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.services import member_policy
from app.models.models import (
    Comment,
    Expense,
    PlanCandidate,
    PlanCollaborator,
    Poll,
    PollOption,
    Reservation,
    TravelEvent,
    TravelPlan,
    User,
    Vote,
)
from app.services import consensus
from app.services import notify
from app.services.audit_service import record_audit_event
from app.services.constraint_evaluation import member_user_ids
from app.services.readiness import member_names

router = APIRouter(prefix="/plans", tags=["discussion"])

VETO_POLICIES = {"block", "block_with_alternative", "advisory"}
VOTE_VALUES = set(consensus.VALUES)
TARGET_TYPES = {"plan", "event", "reservation", "poll", "expense"}
MAX_OPTIONS = 10

_SENSITIVE_PATTERNS = [
    ("keyword", re.compile(r"(予約番号|確認番号|PIN|暗証番号|パスポート|旅券|ビザ番号|カード番号|confirmation)", re.IGNORECASE)),
    ("long_number", re.compile(r"\d{8,}")),
    ("code", re.compile(r"\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b")),
]


def _now() -> datetime:
    return datetime.now(dt_timezone.utc)


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)


def _strip_or_none(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


def sensitive_reasons(text: str) -> List[str]:
    return [name for name, pattern in _SENSITIVE_PATTERNS if pattern.search(text or "")]


# ===== スキーマ =====

class OptionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Optional[str] = Field(None, max_length=200)
    event_id: Optional[str] = None
    candidate_id: Optional[str] = None  # [Gate G4] COL-02 候補箱の候補


class PollCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    deadline_at: Optional[datetime] = None
    veto_policy: str = "block"
    is_anonymous: bool = False
    quorum: Optional[int] = Field(None, ge=1, le=100)  # [Gate G4] COL-02 決定に要る回答者の数
    options: List[OptionIn]

    @field_validator("title")
    @classmethod
    def _v_title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("titleを入力してください")
        return v

    @field_validator("veto_policy")
    @classmethod
    def _v_policy(cls, v):
        if v not in VETO_POLICIES:
            raise ValueError(f"veto_policy must be one of {sorted(VETO_POLICIES)}")
        return v

    @field_validator("deadline_at")
    @classmethod
    def _v_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


class PollUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    deadline_at: Optional[datetime] = None
    status: Optional[str] = None
    decided_option_id: Optional[str] = None
    quorum: Optional[int] = Field(None, ge=1, le=100)

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v is not None and v not in ("open", "closed"):
            raise ValueError("status must be open or closed")
        return v

    @field_validator("deadline_at")
    @classmethod
    def _v_tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("datetime must include a timezone offset")
        return v


class VoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    option_id: str
    value: Optional[str] = None  # None は回答の取り消し
    reason: Optional[str] = Field(None, max_length=500)
    alternative: Optional[str] = Field(None, max_length=200)

    @field_validator("value")
    @classmethod
    def _v_value(cls, v):
        if v is not None and v not in VOTE_VALUES:
            raise ValueError(f"value must be one of {list(consensus.VALUES)}")
        return v


class VotesPut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    votes: List[VoteIn]


class ResolutionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolved: bool = True
    note: Optional[str] = Field(None, max_length=500)


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_type: str = "plan"
    target_id: Optional[str] = None
    parent_id: Optional[str] = None
    body: str = Field(..., min_length=1, max_length=2000)
    mentions: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("body")
    @classmethod
    def _v_body(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("bodyを入力してください")
        return v

    @field_validator("target_type")
    @classmethod
    def _v_target(cls, v):
        if v not in TARGET_TYPES:
            raise ValueError(f"target_type must be one of {sorted(TARGET_TYPES)}")
        return v


class CommentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: Optional[str] = Field(None, min_length=1, max_length=2000)
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _v_status(cls, v):
        if v is not None and v not in ("open", "resolved"):
            raise ValueError("status must be open or resolved")
        return v


# ===== 共通 =====

def _parse_uuid(raw, label: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{label}の形式が不正です")


def _require_if_match(revision: int, if_match: Optional[str], label: str) -> None:
    if if_match is None or if_match.strip() == "":
        raise HTTPException(status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                            detail="If-Matchヘッダーが必要です(現在のリビジョンをGETで取得してから指定してください)")
    try:
        expected = int(if_match.strip().strip('"'))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="If-Matchの形式が不正です")
    if expected != revision:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"{label}が他の変更で更新されています(現在のリビジョン: {revision})")


def _audit(action: str, resource_type: str, request: Request, user: User, resource_id, plan_id,
           details: Optional[Dict[str, Any]] = None) -> None:
    record_audit_event(
        action=action, resource_type=resource_type, user_id=user.id, resource_id=resource_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
        # 題名・本文・理由は記録しない
        details={"plan_id": str(plan_id), **(details or {})},
    )


def _notify(db: Session, plan: TravelPlan, user_ids, ntype: str, title: str, message: str,
            target_type: Optional[str] = None, target_id=None, direct_ids=()) -> None:
    """[Gate G4] COL-03 利用者の通知の設定に従って作る(app/services/notify.py)。"""
    notify.deliver(db, plan, user_ids, ntype, title, message, target_type=target_type, target_id=target_id,
                   direct_ids=direct_ids)


def _can_see_target(db: Session, plan: TravelPlan, user_id: Any, target_type: str) -> bool:
    """[Gate G4] COL-03 その人がコメントの対象(予約・費用)を見られるか(FR-045 の項目の規則)。"""
    if target_type not in member_policy.COMMENT_TARGET_CATEGORY:
        return True
    if user_id == plan.user_id:
        return True
    collab: Any = db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id,
                                                    PlanCollaborator.user_id == user_id,
                                                    PlanCollaborator.status == "accepted").first()
    if collab is None:
        return False
    user = db.query(User).filter(User.id == user_id).first()
    hidden = member_policy.hidden_for(db, plan, collab.role, user)
    return not member_policy.comment_target_hidden(hidden, target_type)


# ===== 投票 =====

def _polls_query(db: Session, plan: TravelPlan):
    return db.query(Poll).filter(Poll.plan_id == plan.id, Poll.deleted_at.is_(None))


def _get_poll(db: Session, plan: TravelPlan, poll_id: str) -> Any:
    try:
        pid = uuid.UUID(str(poll_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="投票が見つかりません")
    p = _polls_query(db, plan).filter(Poll.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="投票が見つかりません")
    return p


def _is_closed(p: Poll) -> bool:
    deadline = _aware(p.deadline_at)
    return p.status == "closed" or (deadline is not None and deadline <= _now())


def _poll_response(db: Session, plan: TravelPlan, p: Any, viewer: User, role: str, members: Set[uuid.UUID],
                   names: Dict[uuid.UUID, str]) -> dict:
    votes = db.query(Vote).filter(Vote.poll_id == p.id).all()
    by_option: Dict[uuid.UUID, List[Vote]] = {}
    for v in votes:
        by_option.setdefault(v.option_id, []).append(v)
    closed = _is_closed(p)
    states = {}
    for o in p.options:
        ov = by_option.get(o.id, [])
        states[o.id] = consensus.option_state(
            [consensus.VoteView(v.user_id, v.value, v.resolved_at is not None) for v in ov],
            members, p.veto_policy, closed,
        )
    leading = consensus.leading_option(states, [o.id for o in p.options])
    tied = consensus.tied_leaders(states, [o.id for o in p.options])
    decided = p.decided_option_id if any(o.id == p.decided_option_id for o in p.options) else None
    all_responders = {v.user_id for v in votes}
    show_counts = not p.is_anonymous or len(all_responders) >= consensus.ANONYMITY_THRESHOLD
    can_manage = role in ("owner", "editor")

    options = []
    for o in p.options:
        st = states[o.id]
        ev_label, ev_missing = None, False
        if o.event_id:
            ev = db.query(TravelEvent).filter(TravelEvent.id == o.event_id, TravelEvent.plan_id == plan.id).first()
            ev_label, ev_missing = (ev.title, False) if ev else (None, True)
        cand_label, cand_missing = None, False
        if o.candidate_id:
            cand = db.query(PlanCandidate).filter(PlanCandidate.id == o.candidate_id,
                                                  PlanCandidate.plan_id == plan.id).first()
            cand_label, cand_missing = (cand.title, False) if cand else (None, True)
        vote_rows = []
        for v in sorted(by_option.get(o.id, []), key=lambda x: (x.created_at or _now(), str(x.id))):
            mine = v.user_id == viewer.id
            if p.is_anonymous and not mine and v.value not in ("concern", "veto"):
                continue  # 匿名では他人のLove/OK/棄権は個別に出さない(件数だけ)
            vote_rows.append({
                "id": str(v.id),
                "is_mine": mine,
                "user_id": None if (p.is_anonymous and not mine) else str(v.user_id),
                "name": None if (p.is_anonymous and not mine) else names.get(v.user_id, "メンバー外"),
                "value": v.value,
                "reason": v.reason,
                "alternative": v.alternative,
                "is_resolved": v.resolved_at is not None,
                "resolution_note": v.resolution_note,
                "resolved_by_name": names.get(v.resolved_by_user_id) if v.resolved_by_user_id else None,
                "can_resolve": v.value in ("concern", "veto") and (mine or can_manage),
            })
        options.append({
            "id": str(o.id),
            "label": o.label,
            "event_id": str(o.event_id) if o.event_id else None,
            "event_label": ev_label,
            "event_missing": ev_missing,
            "candidate_id": str(o.candidate_id) if o.candidate_id else None,
            "candidate_label": cand_label,
            "candidate_missing": cand_missing,
            "is_tied": o.id in tied,
            "state": st["state"],
            "score": st["score"] if show_counts else None,
            "counts": st["counts"] if show_counts else None,
            "responders": len(st["responders"]),
            "unresolved_concerns": st["unresolved_concerns"],
            "unresolved_vetoes": st["unresolved_vetoes"],
            "is_leading": leading == o.id,
            "is_decided": decided == o.id,
            "my_vote": next((v.value for v in by_option.get(o.id, []) if v.user_id == viewer.id), None),
            "votes": vote_rows,
        })
    unanswered = sorted(
        {uid for s in states.values() for uid in s["unanswered"]},
        key=lambda uid: names.get(uid, ""),
    )
    return {
        "id": str(p.id),
        "plan_id": str(p.plan_id),
        "algorithm_version": consensus.ALGORITHM_VERSION,
        "title": p.title,
        "description": p.description,
        "deadline_at": _iso(p.deadline_at),
        "status": p.status,
        "is_closed": closed,
        "veto_policy": p.veto_policy,
        "is_anonymous": p.is_anonymous,
        "counts_hidden": not show_counts,
        "state": consensus.poll_state(states, closed, decided),
        "phase": consensus.phase(closed, decided, p.adopted_at is not None, len(all_responders), p.quorum),
        "quorum": p.quorum,
        "responders": len(all_responders),
        "quorum_met": consensus.quorum_met(len(all_responders), p.quorum),
        "tied_option_ids": [str(t) for t in tied],
        "closed_reason": p.closed_reason,
        "adopted_at": _iso(p.adopted_at),
        "adopted_by_name": names.get(p.adopted_by_user_id) if p.adopted_by_user_id else None,
        "can_adopt": can_manage and decided is not None and p.adopted_at is None,
        "decided_option_id": str(decided) if decided else None,
        "created_by_name": names.get(p.created_by_user_id),
        "can_manage": can_manage,
        "unanswered": [{"user_id": str(uid), "name": names.get(uid, "メンバー外")} for uid in unanswered],
        "options": options,
        "revision": p.revision,
        "created_at": _iso(p.created_at),
    }


def _poll_names(db: Session, polls: List[Any], members: Set[uuid.UUID]) -> Dict[uuid.UUID, str]:
    ids = set(members)
    poll_ids = [p.id for p in polls]
    if poll_ids:
        for uid, rid in db.query(Vote.user_id, Vote.resolved_by_user_id).filter(Vote.poll_id.in_(poll_ids)).all():
            ids.add(uid)
            if rid:
                ids.add(rid)
    ids.update(p.created_by_user_id for p in polls)
    ids.update(p.adopted_by_user_id for p in polls if p.adopted_by_user_id)
    return member_names(db, ids)


@router.get("/{plan_id}/polls", response_model=List[dict])
def list_polls(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    members = member_user_ids(db, plan)
    polls = _polls_query(db, plan).all()
    polls.sort(key=lambda p: (_is_closed(p), -(p.created_at.timestamp() if p.created_at else 0), str(p.id)))
    names = _poll_names(db, polls, members)
    return [_poll_response(db, plan, p, current_user, role, members, names) for p in polls]


@router.get("/{plan_id}/polls/{poll_id}", response_model=dict)
def get_poll(plan_id: str, poll_id: str, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    p = _get_poll(db, plan, poll_id)
    members = member_user_ids(db, plan)
    return _poll_response(db, plan, p, current_user, role, members, _poll_names(db, [p], members))


@router.post("/{plan_id}/polls", status_code=201, response_model=dict)
def create_poll(
    plan_id: str, payload: PollCreate, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if not 1 <= len(payload.options) <= MAX_OPTIONS:
        raise HTTPException(status_code=422, detail=f"選択肢は1〜{MAX_OPTIONS}個にしてください")
    p = Poll(id=uuid.uuid4(), plan_id=plan.id, created_by_user_id=current_user.id, title=payload.title,
             description=_strip_or_none(payload.description), deadline_at=payload.deadline_at, status="open",
             veto_policy=payload.veto_policy, is_anonymous=payload.is_anonymous, quorum=payload.quorum)
    labels = set()
    candidates_seen: Set[Any] = set()
    for i, o in enumerate(payload.options):
        event_id = None
        candidate_id = None
        label = _strip_or_none(o.label)
        if o.event_id and o.candidate_id:
            raise HTTPException(status_code=422, detail="選択肢は予定か候補のどちらか1つにしてください")
        if o.candidate_id:
            candidate_id = _parse_uuid(o.candidate_id, "candidate_id")
            cand = db.query(PlanCandidate).filter(PlanCandidate.id == candidate_id,
                                                  PlanCandidate.plan_id == plan.id).first()
            if not cand:
                raise HTTPException(status_code=422, detail="選択肢の候補がこのプランの候補箱に見つかりません")
            if cand.status == "dismissed" or cand.merged_into_id is not None:
                raise HTTPException(status_code=422, detail="見送った・まとめた候補は選択肢にできません")
            if candidate_id in candidates_seen:
                raise HTTPException(status_code=422, detail="同じ候補が2回あります")
            candidates_seen.add(candidate_id)
            label = label or cand.title
        if o.event_id:
            event_id = _parse_uuid(o.event_id, "event_id")
            ev = db.query(TravelEvent).filter(TravelEvent.id == event_id, TravelEvent.plan_id == plan.id).first()
            if not ev:
                raise HTTPException(status_code=422, detail="選択肢の予定がこのプラン内に見つかりません")
            label = label or ev.title
        if not label:
            raise HTTPException(status_code=422, detail="選択肢の名前を入力してください")
        if label in labels:
            raise HTTPException(status_code=422, detail="同じ名前の選択肢があります")
        labels.add(label)
        p.options.append(PollOption(id=uuid.uuid4(), label=label, event_id=event_id, candidate_id=candidate_id,
                                    sort_order=i))
    db.add(p)
    db.flush()
    members = member_user_ids(db, plan)
    _notify(db, plan, members - {current_user.id}, "poll_created", f"「{plan.title}」で投票が始まりました",
            f"{current_user.username or 'ゲスト'}さんが投票を作成しました。回答してください。",
            target_type="poll", target_id=p.id)
    db.commit()
    db.refresh(p)
    _audit("poll_created", "poll", request, current_user, p.id, plan.id,
           {"options": len(p.options), "veto_policy": p.veto_policy, "is_anonymous": p.is_anonymous})
    return _poll_response(db, plan, p, current_user, role, members, _poll_names(db, [p], members))


@router.patch("/{plan_id}/polls/{poll_id}", response_model=dict)
def update_poll(
    plan_id: str, poll_id: str, payload: PollUpdate, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    p = _get_poll(db, plan, poll_id)
    _require_if_match(p.revision, if_match, "投票")
    data = payload.model_dump(exclude_unset=True)
    if p.adopted_at is not None and any(k in data for k in ("status", "decided_option_id", "deadline_at", "quorum")):
        raise HTTPException(status_code=409, detail={"code": "poll_adopted",
                                                     "message": "予定に採用した投票は変えられません(先に採用を元に戻してください)"})
    if "quorum" in data:
        p.quorum = data["quorum"]
    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="titleを入力してください")
        p.title = title
    if "description" in data:
        p.description = _strip_or_none(data["description"])
    if "deadline_at" in data:
        p.deadline_at = data["deadline_at"]
    if "status" in data and data["status"] is not None and data["status"] != p.status:
        p.status = data["status"]
        p.closed_at = _now() if p.status == "closed" else None
        p.closed_reason = "manual" if p.status == "closed" else None
        if p.status == "open":
            # 再開: 期限が過ぎたままでは回答できないので、先の期限か期限なしにする。決定は外す
            deadline = _aware(p.deadline_at)
            if deadline is not None and deadline <= _now():
                raise HTTPException(status_code=422, detail="再開する時は、締切を先の日時にするか外してください")
            p.decided_option_id = None
            p.reminder_sent_at = None
    if "decided_option_id" in data:
        if data["decided_option_id"] is None:
            p.decided_option_id = None
        else:
            oid = _parse_uuid(data["decided_option_id"], "decided_option_id")
            if not any(o.id == oid for o in p.options):
                raise HTTPException(status_code=422, detail="決定する選択肢がこの投票にありません")
            members = member_user_ids(db, plan)
            responders = {r[0] for r in db.query(Vote.user_id).filter(Vote.poll_id == p.id).all()}
            if not consensus.quorum_met(len(responders), p.quorum):
                raise HTTPException(status_code=409, detail={
                    "code": "quorum_not_met",
                    "message": "回答者が定足数(%d人)に届いていないため、決定できません(今 %d人)" % (p.quorum, len(responders))})
            votes = db.query(Vote).filter(Vote.option_id == oid).all()
            st = consensus.option_state([consensus.VoteView(v.user_id, v.value, v.resolved_at is not None)
                                         for v in votes], members, p.veto_policy, True)
            if st["state"] == "blocked":
                raise HTTPException(status_code=409, detail="未解決の「不可」がある選択肢には決定できません(先に懸念を解決してください)")
            p.decided_option_id = oid
            if p.status != "closed":
                p.status = "closed"
                p.closed_at = _now()
                p.closed_reason = "decided"
    p.revision += 1
    db.commit()
    db.refresh(p)
    _audit("poll_updated", "poll", request, current_user, p.id, plan.id, {"fields": sorted(data)})
    members = member_user_ids(db, plan)
    return _poll_response(db, plan, p, current_user, role, members, _poll_names(db, [p], members))


@router.delete("/{plan_id}/polls/{poll_id}", response_model=dict)
def delete_poll(
    plan_id: str, poll_id: str, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, _ = require_plan_access(db, plan_id, current_user, min_role="editor")
    p = _get_poll(db, plan, poll_id)
    _require_if_match(p.revision, if_match, "投票")
    if p.adopted_at is not None:
        raise HTTPException(status_code=409, detail={"code": "poll_adopted",
                                                     "message": "予定に採用した投票は消せません(先に採用を元に戻してください)"})
    p.deleted_at = _now()
    p.revision += 1
    db.commit()
    _audit("poll_deleted", "poll", request, current_user, p.id, plan.id)
    return {"message": "投票を削除しました", "revision": p.revision}


@router.put("/{plan_id}/polls/{poll_id}/votes", response_model=dict)
def put_votes(
    plan_id: str, poll_id: str, payload: VotesPut, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    p = _get_poll(db, plan, poll_id)
    if _is_closed(p) or p.decided_option_id is not None:
        raise HTTPException(status_code=409, detail="この投票は締め切られています")
    option_ids = {o.id for o in p.options}
    seen = set()
    checked = []
    # 全ての回答を先に検証してから保存する(途中で422になった時に一部だけ保存しない)
    for item in payload.votes:
        oid = _parse_uuid(item.option_id, "option_id")
        if oid not in option_ids:
            raise HTTPException(status_code=422, detail="選択肢がこの投票にありません")
        if oid in seen:
            raise HTTPException(status_code=422, detail="同じ選択肢への回答が重複しています")
        seen.add(oid)
        reason = _strip_or_none(item.reason)
        alternative = _strip_or_none(item.alternative)
        if item.value in ("concern", "veto") and not reason:
            raise HTTPException(status_code=422, detail="懸念・不可には理由を入力してください")
        if item.value == "veto" and p.veto_policy == "block_with_alternative" and not alternative:
            raise HTTPException(status_code=422, detail="この投票では「不可」に代替案が必要です")
        checked.append((oid, item.value, reason, alternative))
    for oid, value, reason, alternative in checked:
        existing = db.query(Vote).filter(Vote.option_id == oid, Vote.user_id == current_user.id).first()
        if value is None:
            if existing:
                db.delete(existing)
            continue
        if existing is None:
            existing = Vote(id=uuid.uuid4(), poll_id=p.id, option_id=oid, user_id=current_user.id, value=value)
            db.add(existing)
        elif existing.value != value or existing.reason != reason:
            # 回答を変えたら解決の記録は外す(新しい懸念として扱う)
            existing.resolved_at = None
            existing.resolved_by_user_id = None
            existing.resolution_note = None
        existing.value = value
        existing.reason = reason
        existing.alternative = alternative
    db.commit()
    _audit("poll_voted", "poll", request, current_user, p.id, plan.id, {"answers": len(payload.votes)})
    members = member_user_ids(db, plan)
    return _poll_response(db, plan, p, current_user, role, members, _poll_names(db, [p], members))


@router.post("/{plan_id}/polls/{poll_id}/votes/{vote_id}/resolution", response_model=dict)
def resolve_vote(
    plan_id: str, poll_id: str, vote_id: str, payload: ResolutionIn, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    p = _get_poll(db, plan, poll_id)
    vid = _parse_uuid(vote_id, "vote_id")
    v = db.query(Vote).filter(Vote.id == vid, Vote.poll_id == p.id).first()
    if not v:
        raise HTTPException(status_code=404, detail="回答が見つかりません")
    if v.value not in ("concern", "veto"):
        raise HTTPException(status_code=422, detail="解決を記録できるのは懸念・不可だけです")
    if v.user_id != current_user.id and role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="懸念を解決済みにできるのは回答した本人か編集者です")
    if payload.resolved:
        v.resolved_at = _now()
        v.resolved_by_user_id = current_user.id
        v.resolution_note = _strip_or_none(payload.note)
    else:
        v.resolved_at = None
        v.resolved_by_user_id = None
        v.resolution_note = None
    db.commit()
    _audit("poll_concern_resolved" if payload.resolved else "poll_concern_reopened", "poll", request,
           current_user, p.id, plan.id)
    members = member_user_ids(db, plan)
    return _poll_response(db, plan, p, current_user, role, members, _poll_names(db, [p], members))


# ===== コメント =====

def _target_exists(db: Session, plan: TravelPlan, target_type: str, target_id: uuid.UUID) -> bool:
    if target_type == "event":
        q = db.query(TravelEvent.id).filter(TravelEvent.id == target_id, TravelEvent.plan_id == plan.id)
    elif target_type == "reservation":
        q = db.query(Reservation.id).filter(Reservation.id == target_id, Reservation.plan_id == plan.id,
                                            Reservation.deleted_at.is_(None))
    elif target_type == "poll":
        q = db.query(Poll.id).filter(Poll.id == target_id, Poll.plan_id == plan.id, Poll.deleted_at.is_(None))
    else:
        q = db.query(Expense.id).filter(Expense.id == target_id, Expense.plan_id == plan.id,
                                        Expense.deleted_at.is_(None))
    return q.first() is not None


def _comment_response(c: Comment, viewer: User, role: str, names: Dict[uuid.UUID, str]) -> dict:
    deleted = c.deleted_at is not None
    mine = c.author_user_id == viewer.id
    reasons = [] if deleted else sensitive_reasons(c.body)
    return {
        "id": str(c.id),
        "plan_id": str(c.plan_id),
        "target_type": c.target_type,
        "target_id": str(c.target_id) if c.target_id else None,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "author_user_id": str(c.author_user_id),
        "author_name": names.get(c.author_user_id, "メンバー外"),
        "is_mine": mine,
        "is_deleted": deleted,
        "body": None if deleted else c.body,
        "mentions": [] if deleted else [
            {"user_id": uid, "name": names.get(uuid.UUID(uid), "メンバー外")} for uid in (c.mentions or [])
        ],
        "status": c.status,
        "sensitive_warning": bool(reasons),
        "sensitive_reasons": reasons,
        "can_edit": mine and not deleted,
        "can_moderate": (mine or role in ("owner", "editor")) and not deleted,
        "edited_at": _iso(c.edited_at),
        "revision": c.revision,
        "created_at": _iso(c.created_at),
    }


def _comment_names(db: Session, comments: List[Comment]) -> Dict[uuid.UUID, str]:
    ids = set()
    for c in comments:
        ids.add(c.author_user_id)
        for uid in c.mentions or []:
            ids.add(uuid.UUID(uid))
    return member_names(db, ids)


@router.get("/{plan_id}/comments", response_model=List[dict])
def list_comments(
    plan_id: str,
    target_type: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    if member_policy.comment_target_hidden(hidden, target_type):
        raise member_policy.hidden_error(member_policy.COMMENT_TARGET_CATEGORY[target_type])
    q = db.query(Comment).filter(Comment.plan_id == plan.id)
    if target_type is not None:
        if target_type not in TARGET_TYPES:
            raise HTTPException(status_code=422, detail="target_typeが不正です")
        q = q.filter(Comment.target_type == target_type)
        if target_type == "plan":
            q = q.filter(Comment.target_id.is_(None))
        elif target_id is not None:
            q = q.filter(Comment.target_id == _parse_uuid(target_id, "target_id"))
    # [Gate G2] FR-045 隠された予約・費用へのコメントは出さない
    rows = [c for c in q.all() if not member_policy.comment_target_hidden(hidden, c.target_type)]
    # 削除済みでも返信のある親はスレッドの形を保つために残す
    parents_with_replies = {c.parent_id for c in rows if c.parent_id and c.deleted_at is None}
    rows = [c for c in rows if c.deleted_at is None or c.id in parents_with_replies]
    rows.sort(key=lambda c: (c.created_at or _now(), str(c.id)))
    names = _comment_names(db, rows)
    return [_comment_response(c, current_user, role, names) for c in rows]


@router.post("/{plan_id}/comments", status_code=201, response_model=dict)
def create_comment(
    plan_id: str, payload: CommentCreate, request: Request,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    if member_policy.comment_target_hidden(hidden, payload.target_type):
        raise member_policy.hidden_error(member_policy.COMMENT_TARGET_CATEGORY[payload.target_type])
    target_id = None
    if payload.target_type == "plan":
        if payload.target_id is not None:
            raise HTTPException(status_code=422, detail="プランへのコメントにはtarget_idを指定できません")
    else:
        if payload.target_id is None:
            raise HTTPException(status_code=422, detail="コメントの対象(target_id)を指定してください")
        target_id = _parse_uuid(payload.target_id, "target_id")
        if not _target_exists(db, plan, payload.target_type, target_id):
            raise HTTPException(status_code=422, detail="コメントの対象がこのプラン内に見つかりません")
    parent_id = None
    if payload.parent_id is not None:
        parent_id = _parse_uuid(payload.parent_id, "parent_id")
        parent: Any = db.query(Comment).filter(Comment.id == parent_id, Comment.plan_id == plan.id).first()
        if not parent or parent.deleted_at is not None:
            raise HTTPException(status_code=422, detail="返信先のコメントが見つかりません")
        if parent.target_type != payload.target_type or parent.target_id != target_id:
            raise HTTPException(status_code=422, detail="返信は同じ対象のコメントにしてください")
    members = member_user_ids(db, plan)
    mentions: List[str] = []
    for raw in payload.mentions:
        uid = _parse_uuid(raw, "mentions")
        if uid not in members:
            raise HTTPException(status_code=422, detail="メンションできるのはこのプランのメンバーだけです")
        if not _can_see_target(db, plan, uid, payload.target_type):
            raise HTTPException(status_code=422, detail={"code": "mention_target_hidden",
                                                         "message": "その人はこの対象を見られないため、メンションできません"})
        if str(uid) not in mentions:
            mentions.append(str(uid))
    c = Comment(id=uuid.uuid4(), plan_id=plan.id, author_user_id=current_user.id, target_type=payload.target_type,
                target_id=target_id, parent_id=parent_id, body=payload.body, mentions=mentions or None, status="open")
    db.add(c)
    notify_ids = {uuid.UUID(u) for u in mentions} - {current_user.id}
    target_for_notice = ("plan", None) if payload.target_type == "plan" else (payload.target_type, target_id)
    _notify(db, plan, notify_ids, "comment_mention", f"「{plan.title}」のコメントでメンションされました",
            f"{current_user.username or 'ゲスト'}さんがあなたをメンションしました。旅行プランで確認してください。",
            target_type=target_for_notice[0], target_id=target_for_notice[1], direct_ids=notify_ids)
    # [Gate G4] COL-03 返信は、返信先を書いた人へ(自分あて)。メンションと二重にしない
    if parent_id is not None:
        author = parent.author_user_id
        if author != current_user.id and author not in notify_ids and author in members and \
                _can_see_target(db, plan, author, payload.target_type):
            _notify(db, plan, {author}, "comment_reply", f"「{plan.title}」であなたのコメントに返信がありました",
                    f"{current_user.username or 'ゲスト'}さんが返信しました。旅行プランで確認してください。",
                    target_type=target_for_notice[0], target_id=target_for_notice[1], direct_ids={author})
    db.commit()
    db.refresh(c)
    _audit("comment_created", "comment", request, current_user, c.id, plan.id,
           {"target_type": c.target_type, "mentions": len(mentions), "is_reply": parent_id is not None})
    return _comment_response(c, current_user, role, _comment_names(db, [c]))


@router.patch("/{plan_id}/comments/{comment_id}", response_model=dict)
def update_comment(
    plan_id: str, comment_id: str, payload: CommentUpdate, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    cid = _parse_uuid(comment_id, "comment_id")
    c = db.query(Comment).filter(Comment.id == cid, Comment.plan_id == plan.id, Comment.deleted_at.is_(None)).first()
    if c is not None and member_policy.comment_target_hidden(hidden, c.target_type):
        c = None  # [Gate G2] FR-045 隠された対象へのコメントは無いものとして扱う
    if not c:
        raise HTTPException(status_code=404, detail="コメントが見つかりません")
    data = payload.model_dump(exclude_unset=True)
    mine = c.author_user_id == current_user.id
    if "body" in data and not mine:
        raise HTTPException(status_code=403, detail="コメントを編集できるのは書いた本人だけです")
    if "status" in data and not (mine or role in ("owner", "editor")):
        raise HTTPException(status_code=403, detail="コメントを解決済みにできるのは本人か編集者です")
    _require_if_match(c.revision, if_match, "コメント")
    if "body" in data:
        body = (data["body"] or "").strip()
        if not body:
            raise HTTPException(status_code=422, detail="bodyを入力してください")
        c.body = body
        c.edited_at = _now()
    if "status" in data and data["status"] is not None:
        c.status = data["status"]
    c.revision += 1
    db.commit()
    db.refresh(c)
    _audit("comment_updated", "comment", request, current_user, c.id, plan.id, {"fields": sorted(data)})
    return _comment_response(c, current_user, role, _comment_names(db, [c]))


@router.delete("/{plan_id}/comments/{comment_id}", response_model=dict)
def delete_comment(
    plan_id: str, comment_id: str, request: Request,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest),
):
    plan, role, hidden = member_policy.require_access(db, plan_id, current_user, "viewer")
    cid = _parse_uuid(comment_id, "comment_id")
    c = db.query(Comment).filter(Comment.id == cid, Comment.plan_id == plan.id, Comment.deleted_at.is_(None)).first()
    if c is not None and member_policy.comment_target_hidden(hidden, c.target_type):
        c = None  # [Gate G2] FR-045 隠された対象へのコメントは無いものとして扱う
    if not c:
        raise HTTPException(status_code=404, detail="コメントが見つかりません")
    if c.author_user_id != current_user.id and role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="コメントを削除できるのは本人か編集者です")
    _require_if_match(c.revision, if_match, "コメント")
    c.deleted_at = _now()
    c.revision += 1
    db.commit()
    _audit("comment_deleted", "comment", request, current_user, c.id, plan.id)
    return {"message": "コメントを削除しました", "revision": c.revision}
