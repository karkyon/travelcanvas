"""[Gate G2] FR-045 同行者(参加者)向けの項目の規則の設定。app/services/member_policy.py が正本。

- GET /plans/{plan_id}/member-policy                         : 所有者には役割ごとの既定と参加者ごとの上書き。参加者には
                                                               自分に隠されている項目だけ(他の人の設定は見せない)
- PUT /plans/{plan_id}/member-policy                         : 役割ごとの既定を変える(所有者だけ)
- PUT /plans/{plan_id}/member-policy/members/{collaborator_id}: 参加者1人の上書き(hidden=null で役割の既定に戻す)

変更は監査に残す(項目の名前だけ。メールアドレスは残さない)。設定を変えると、その人の次の読み込みから適用される。
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import PlanCollaborator, User
from app.services import member_policy as mp
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["member-policy"])


def _audit(request: Request, user: User, action: str, plan_id, details: dict) -> None:
    record_audit_event(action=action, resource_type="travel_plan", user_id=user.id, resource_id=plan_id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255], details=details)


def _members(db: Session, plan) -> List[dict]:
    rows = (db.query(PlanCollaborator).filter(PlanCollaborator.plan_id == plan.id)
            .order_by(PlanCollaborator.created_at).all())
    defaults = mp.role_defaults(plan)
    out = []
    for c in rows:
        override = mp.member_override(c)
        out.append({"id": str(c.id), "email": c.email, "role": c.role, "status": c.status,
                    "hidden": override, "effective_hidden": override if override is not None
                    else defaults.get(c.role, [])})
    return out


def _owner_view(db: Session, plan) -> dict:
    return {"plan_id": str(plan.id), "role": "owner", "catalog": mp.catalog(), "roles": mp.role_defaults(plan),
            "configured": plan.member_field_policy is not None, "members": _members(db, plan), "my_hidden": []}


@router.get("/{plan_id}/member-policy")
def get_member_policy(plan_id: str, response: Response, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    response.headers["Cache-Control"] = "no-store"
    if role == "owner":
        return _owner_view(db, plan)
    hidden = mp.hidden_for(db, plan, role, current_user)
    return {"plan_id": str(plan.id), "role": role, "catalog": mp.catalog(), "my_hidden": mp.ordered(hidden)}


class PolicyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    roles: Optional[dict] = None
    preset_editor: Optional[str] = Field(None, max_length=40)
    preset_viewer: Optional[str] = Field(None, max_length=40)


@router.put("/{plan_id}/member-policy")
def put_member_policy(plan_id: str, payload: PolicyIn, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")
    try:
        policy = mp.clean_plan_policy(payload.model_dump(exclude_none=True))
    except mp.MemberPolicyError as e:
        raise HTTPException(status_code=422, detail=e.detail())
    plan.member_field_policy = policy
    db.commit()
    _audit(request, current_user, "member_policy_updated", plan.id, {"roles": policy["roles"]})
    return _owner_view(db, plan)


class MemberPolicyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hidden: Optional[List[str]] = None


@router.put("/{plan_id}/member-policy/members/{collaborator_id}")
def put_member_override(plan_id: str, collaborator_id: str, payload: MemberPolicyIn, request: Request,
                        db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")
    try:
        cid = uuid.UUID(collaborator_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="参加者が見つかりません")
    collab = db.query(PlanCollaborator).filter(PlanCollaborator.id == cid, PlanCollaborator.plan_id == plan.id).first()
    if collab is None:
        raise HTTPException(status_code=404, detail="参加者が見つかりません")
    try:
        hidden = None if payload.hidden is None else mp.clean_hidden(payload.hidden)
    except mp.MemberPolicyError as e:
        raise HTTPException(status_code=422, detail=e.detail())
    collab.field_policy = None if hidden is None else {"version": mp.POLICY_VERSION, "hidden": hidden}
    db.commit()
    _audit(request, current_user, "member_policy_member_updated", plan.id,
           {"collaborator_id": str(collab.id), "hidden": hidden})
    return _owner_view(db, plan)
