"""[Gate C2] 場所(places)の権限。以前は場所の ID を知っていれば誰でも見られた(GET /search/places/{id})・
予定に付けられた(POST /plans/{id}/events の place_id)。

- 見られる: 場所を作った人、または場所を使っている旅行(予定・移動区間・候補が参照)に参加している人
- 編集できる: 場所を使っている全ての旅行を編集できる人(どこにも使われていなければ作った人)。
  共有の場所を、編集の権限が無い旅行の分まで書き換えさせないため
存在を区別させないよう、見られない場所は 404 にする。

[Gate G2] FR-045 所有者が「予定の住所・位置」を隠した参加者には、その旅行は見る・編集する理由にならない
(場所の住所・座標から、隠した予定の位置が分かってしまうため)。
"""
import uuid
from typing import Optional, Set

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.plan_access import resolve_plan_role
from app.models.models import Place, PlanCandidate, TravelEvent, TravelPlan, TravelSegment, User

_RANK = {"viewer": 1, "editor": 2, "owner": 3}


def referencing_plan_ids(db: Session, place_id) -> Set[uuid.UUID]:
    ids = {r[0] for r in db.query(TravelEvent.plan_id).filter(TravelEvent.place_id == place_id).all()}
    ids |= {r[0] for r in db.query(TravelSegment.plan_id).filter(
        (TravelSegment.from_place_id == place_id) | (TravelSegment.to_place_id == place_id)).all()}
    ids |= {r[0] for r in db.query(PlanCandidate.plan_id).filter(PlanCandidate.place_id == place_id).all()}
    return ids


def _plans(db: Session, ids: Set[uuid.UUID]):
    if not ids:
        return []
    return db.query(TravelPlan).filter(TravelPlan.id.in_(ids), TravelPlan.deleted_at.is_(None)).all()


def role_with_location(db: Session, plan: TravelPlan, user: User) -> Optional[str]:
    from app.services import member_policy  # 循環 import を避ける

    role = resolve_plan_role(db, plan, user)
    if role and "event_address" in member_policy.hidden_for(db, plan, role, user):
        return None
    return role


def can_view(db: Session, place: Place, user: User) -> bool:
    if place.created_by is not None and place.created_by == user.id:
        return True
    return any(role_with_location(db, p, user) for p in _plans(db, referencing_plan_ids(db, place.id)))


def can_edit(db: Session, place: Place, user: User) -> bool:
    plans = _plans(db, referencing_plan_ids(db, place.id))
    if not plans:
        return place.created_by is not None and place.created_by == user.id
    return all(_RANK.get(role_with_location(db, p, user) or "", 0) >= _RANK["editor"] for p in plans)


def get_viewable(db: Session, place_id, user: User) -> Place:
    try:
        pid = place_id if isinstance(place_id, uuid.UUID) else uuid.UUID(str(place_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="場所が見つかりません")
    place: Optional[Place] = db.query(Place).filter(Place.id == pid).first()
    if place is None or not can_view(db, place, user):
        raise HTTPException(status_code=404, detail="場所が見つかりません")
    return place
