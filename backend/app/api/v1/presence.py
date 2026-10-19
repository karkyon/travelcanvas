"""
[Gate C1] FR-020 共同編集(準リアルタイム)。

- POST   /plans/{plan_id}/presence             : この端末で旅行を開いていることを知らせ、同じ旅行を開いている人・
                                                 編集中の予定・知っている版より後の変更(誰が何を)を受け取る
- DELETE /plans/{plan_id}/presence/{client_id} : 画面を閉じた(この端末の知らせを消す)

閲覧者以上(旅行を見られる人)だけが使える。他の人の名前は利用者名(メールアドレスは出さない。ゲストは「ゲスト」)。
変更は ChangeSet(予定・日の変更の記録)から作る。予定の題名は旅行の参加者が見られる情報のため、そのまま出す。
同じ予定を2人が編集した時は、先に保存した方が通り、後の保存は版の不一致(409)で止まる(黙って上書きしない)。
"""
import re
import time
import uuid
from datetime import datetime, timezone as dt_timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import ChangeSet, PlanCollaborator, TravelEvent, TravelPlan, User
from app.services import presence as pr

router = APIRouter(prefix="/plans", tags=["presence"])

CLIENT_ID_PATTERN = r"^[A-Za-z0-9_-]{8,64}$"
MAX_CHANGES = 20
POLL_WITH_OTHERS = 5
POLL_ALONE = 15


class EditingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["event"]
    id: uuid.UUID


class PresenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    known_revision: Optional[int] = Field(None, ge=0)
    editing: Optional[EditingIn] = None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=dt_timezone.utc).isoformat()


def _iso_dt(dt) -> Optional[str]:
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)).isoformat()


def _roles(db: Session, plan: TravelPlan) -> Dict[str, str]:
    """いま旅行に参加している人(所有者・承諾済みの共同編集者)と役割。外れた人の端末は数えない。"""
    roles = {str(plan.user_id): "owner"}
    for user_id, role in db.query(PlanCollaborator.user_id, PlanCollaborator.role).filter(
            PlanCollaborator.plan_id == plan.id, PlanCollaborator.status == "accepted",
            PlanCollaborator.user_id.isnot(None)).all():
        if role in ("viewer", "editor"):  # plan_access.resolve_plan_role と同じ(ほかの役割は旅行を見られない)
            roles.setdefault(str(user_id), str(role))
    return roles


def _labels(db: Session, user_ids, me: User) -> Dict[str, str]:
    ids = [uuid.UUID(u) for u in set(user_ids) if u]
    out: Dict[str, str] = {}
    if not ids:
        return out
    for u in db.query(User.id, User.username, User.user_type).filter(User.id.in_(ids)).all():
        guest = str(getattr(u.user_type, "value", u.user_type) or "") == "guest"
        out[str(u.id)] = "ゲスト" if guest or not u.username else str(u.username)
    out[str(me.id)] = "あなた"
    return out


def _item_label(item) -> Optional[str]:
    for data in (item.after_json, item.before_json):
        if isinstance(data, dict):
            if item.entity_type == "travel_event" and data.get("title"):
                return str(data["title"])[:200]
            if item.entity_type == "travel_day" and data.get("local_date"):
                return str(data["local_date"])
    return None


def _changes(db: Session, plan: TravelPlan, known: Optional[int], me: User) -> List[dict]:
    if known is None or known >= plan.revision:
        return []
    sets = (db.query(ChangeSet).filter(ChangeSet.plan_id == plan.id, ChangeSet.resulting_revision > known)
            .order_by(ChangeSet.resulting_revision.desc()).limit(MAX_CHANGES).all())
    labels = _labels(db, [str(s.actor_user_id) for s in sets if s.actor_user_id], me)
    out = []
    for s in reversed(sets):
        actor = str(s.actor_user_id) if s.actor_user_id else None
        items = list(s.items or [])
        out.append({
            "revision": s.resulting_revision,
            "actor_label": labels.get(actor or "", "だれか"),
            "is_self": actor == str(me.id),
            "source": s.source,
            "undone": s.undone_at is not None,
            "count": len(items),
            "items": [{"entity_type": i.entity_type, "action": i.action, "label": _item_label(i)} for i in items[:5]],
            "at": _iso_dt(s.applied_at),
        })
    return out


@router.post("/{plan_id}/presence")
def heartbeat(plan_id: str, payload: PresenceIn, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    editing = None
    if payload.editing is not None:
        # 旅行の外の予定・消された予定は「編集中」にしない(他の人の画面に出さない)
        ev = db.query(TravelEvent.id).filter(TravelEvent.id == payload.editing.id,
                                             TravelEvent.plan_id == plan.id).first()
        if ev is not None:
            editing = {"kind": "event", "id": str(payload.editing.id)}
    now = time.time()
    me = str(current_user.id)
    pr.touch(str(plan.id), f"{me}:{payload.client_id}", {"user_id": me, "editing": editing}, now)

    roles = _roles(db, plan)
    people: Dict[str, dict] = {}
    for e in pr.entries(str(plan.id), now):
        uid = str(e.get("user_id") or "")
        if uid not in roles:
            continue
        p = people.setdefault(uid, {"user_id": uid, "role": roles[uid], "is_self": uid == me, "devices": 0,
                                    "seen_at": 0.0, "editing": None, "_editing_at": 0.0})
        p["devices"] += 1
        at = float(e.get("at", 0))
        p["seen_at"] = max(p["seen_at"], at)
        if e.get("editing") and at >= p["_editing_at"]:
            p["editing"], p["_editing_at"] = e["editing"], at

    titles: Dict[str, str] = {}
    editing_ids = [uuid.UUID(p["editing"]["id"]) for p in people.values() if p["editing"]]
    if editing_ids:
        for ev_id, title in db.query(TravelEvent.id, TravelEvent.title).filter(
                TravelEvent.id.in_(editing_ids), TravelEvent.plan_id == plan.id).all():
            titles[str(ev_id)] = title or "予定"
    labels = _labels(db, list(people), current_user)
    viewers = []
    for uid, p in sorted(people.items(), key=lambda kv: (not kv[1]["is_self"], labels.get(kv[0], ""))):
        ed = p["editing"]
        if ed and ed["id"] not in titles:
            ed = None  # 編集中だった予定が消された
        viewers.append({
            "user_id": uid, "label": labels.get(uid, "だれか"), "role": p["role"], "is_self": p["is_self"],
            "devices": p["devices"], "seen_at": _iso(p["seen_at"]),
            "editing": ({"kind": "event", "id": ed["id"], "label": titles[ed["id"]]} if ed else None),
        })
    others = sum(1 for v in viewers if not v["is_self"])
    return {
        "plan_id": str(plan.id),
        "revision": plan.revision,
        "viewers": viewers,
        "changes": _changes(db, plan, payload.known_revision, current_user),
        "poll_seconds": POLL_WITH_OTHERS if others else POLL_ALONE,
        "ttl_seconds": pr.TTL_SECONDS,
    }


@router.delete("/{plan_id}/presence/{client_id}", status_code=204)
def leave(plan_id: str, client_id: str, db: Session = Depends(get_db),
          current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if re.match(CLIENT_ID_PATTERN, client_id):
        pr.leave(str(plan.id), f"{current_user.id}:{client_id}")
    return Response(status_code=204)
