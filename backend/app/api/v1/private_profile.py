"""
[Gate C1] FR-023 秘匿プロフィール(本人だけ)。説明は app/services/private_profile.py。

- GET  /privacy/private-profile          : 自分の非公開の条件と、適用している旅行
- PUT  /privacy/private-profile          : 保存(If-Match: プロフィールの版。まだ無ければ 0)。適用中の旅行の秘匿制約も作り直す
- GET  /plans/{plan_id}/private-profile  : この旅行に自分のプロフィールを適用しているか
- PUT  /plans/{plan_id}/private-profile  : この旅行への適用を始める/やめる(閲覧者以上。秘匿制約は本人のものとして作る)

他人のプロフィールを読む口は無い(運用管理者の API にも無い)。監査には件数だけを残す(題名・値は残さない)。
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import PrivateProfileLink, TravelPlan, User
from app.services import private_profile as pp
from app.services.audit_service import record_audit_event

profile_router = APIRouter(prefix="/privacy", tags=["private-profile"])
plan_router = APIRouter(prefix="/plans", tags=["private-profile"])


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: List[Dict[str, Any]]


class LinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    applied: bool


def _if_match(value: Optional[str]) -> int:
    if value is None or not value.strip():
        raise HTTPException(status_code=428, detail={"code": "if_match_required",
                                                     "message": "If-Match(プロフィールの版。まだ無ければ 0)が必要です"})
    try:
        return int(value.strip().strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid_if_match", "message": "If-Match の形式が不正です"})


def _audit(request: Request, user: User, action: str, details: Dict[str, Any], resource_id=None) -> None:
    record_audit_event(action=action, resource_type="private_profile", user_id=user.id,
                       resource_id=resource_id or user.id,
                       ip_address=request.client.host if request.client else None,
                       user_agent=request.headers.get("user-agent", "")[:255], details=details)


def _profile_body(db: Session, user: User) -> Dict[str, Any]:
    row = pp.get_profile(db, user.id)
    items = pp.decrypt_items(row)
    plan_ids = pp.linked_plan_ids(db, user.id)
    plans = []
    if plan_ids:
        rows = db.query(TravelPlan.id, TravelPlan.title).filter(
            TravelPlan.id.in_(plan_ids), TravelPlan.deleted_at.is_(None)).all()
        plans = [{"plan_id": str(r[0]), "title": r[1]} for r in rows]
    return {
        "revision": row.revision if row else 0,
        "items": items if items is not None else [],
        "readable": items is not None,
        "kinds": [{"kind": k, "label": pp.KIND_LABEL[k], "value_type": v[3], "units": list(v[4])}
                  for k, v in pp.KINDS.items()],
        "max_items": pp.MAX_ITEMS,
        "applied_plans": sorted(plans, key=lambda p: p["title"] or ""),
    }


@profile_router.get("/private-profile")
def get_private_profile(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    return _profile_body(db, current_user)


@profile_router.put("/private-profile")
def put_private_profile(payload: ProfileIn, request: Request, if_match: Optional[str] = Header(None, alias="If-Match"),
                        db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    expected = _if_match(if_match)
    items = pp.clean_items(payload.items)
    row = pp.get_profile(db, current_user.id)
    if row is not None and pp.decrypt_items(row) is None:
        raise HTTPException(status_code=409, detail={"code": "profile_unreadable",
                                                     "message": "保存済みの内容を復号できないため変更できません"})
    pp.save_profile(db, current_user.id, items, expected)
    synced = 0
    for plan_id in pp.linked_plan_ids(db, current_user.id):
        pp.sync_plan(db, plan_id, current_user.id, items)
        synced += 1
    db.commit()
    _audit(request, current_user, "private_profile_updated", {"items": len(items), "plans": synced})
    return _profile_body(db, current_user)


def _link_body(db: Session, plan: TravelPlan, user: User) -> Dict[str, Any]:
    row = pp.get_profile(db, user.id)
    items = pp.decrypt_items(row) or []
    return {
        "plan_id": str(plan.id),
        "applied": pp.is_linked(db, plan.id, user.id),
        "profile_items": len(items),
        "applied_constraints": len(pp.derived_constraints(db, plan.id, user.id)),
        "profile_revision": row.revision if row else 0,
    }


@plan_router.get("/{plan_id}/private-profile")
def get_plan_link(plan_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _link_body(db, plan, current_user)


@plan_router.put("/{plan_id}/private-profile")
def put_plan_link(plan_id: str, payload: LinkIn, request: Request, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user_or_guest)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if payload.applied:
        row = pp.get_profile(db, current_user.id)
        items = pp.decrypt_items(row)
        if items is None:
            raise HTTPException(status_code=409, detail={"code": "profile_unreadable",
                                                         "message": "保存済みの内容を復号できないため適用できません"})
        if not items:
            raise HTTPException(status_code=409, detail={
                "code": "profile_empty", "message": "非公開の条件がまだありません。設定 → 非公開の条件 で登録してください"})
        if not pp.is_linked(db, plan.id, current_user.id):
            db.add(PrivateProfileLink(plan_id=plan.id, user_id=current_user.id))
        result = pp.sync_plan(db, plan.id, current_user.id, items)
        db.commit()
        _audit(request, current_user, "private_profile_applied", {"plan_id": str(plan.id), **result}, plan.id)
    else:
        removed = pp.unlink_plan(db, plan.id, current_user.id)
        db.commit()
        _audit(request, current_user, "private_profile_unapplied", {"plan_id": str(plan.id), "removed": removed},
               plan.id)
    return _link_body(db, plan, current_user)
