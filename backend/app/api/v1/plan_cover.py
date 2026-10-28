"""
[Gate G11] 旅行の表紙の写真(docs/ux/G11_UIUX全範囲_実装仕様.md §2.1)。

- GET    /plans/{plan_id}/cover        : 表紙(見える時だけ。見えない・無い時は null)と、変えられるか(viewer 以上)
- PUT    /plans/{plan_id}/cover        : 表紙に写真を設定する({memory_id, focus_x?, focus_y?, zoom?}、editor 以上)
- PATCH  /plans/{plan_id}/cover        : 位置・拡大だけ変える(editor 以上。表紙が無い・見えない時は 404)
- DELETE /plans/{plan_id}/cover        : 表紙の参照だけを外す(記録は消さない。editor 以上)
- GET    /plans/{plan_id}/cover/media  : 表紙の写真(見える人だけ。記録の配信と同じ守り: 撮影情報の除去・no-store)

表紙は旅程(日・予定)の変更ではないため、旅行の revision を進めない(旅程の編集の If-Match と競合させない)。
後から保存した方が残る。記録の公開範囲は変えない(非公開の写真は他の人には見えず、グラデーションの表紙になる)。
監査には記録の ID・公開範囲だけを残す(ファイル名・本文は残さない)。
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StrictInt
from sqlalchemy.orm import Session

from app.core.auth import get_current_user_or_guest
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import User
from app.services import plan_cover as pc
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/plans", tags=["plan-cover"])


class CoverSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    memory_id: str
    focus_x: Optional[StrictInt] = None
    focus_y: Optional[StrictInt] = None
    zoom: Optional[StrictInt] = None


class CoverPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    focus_x: Optional[StrictInt] = None
    focus_y: Optional[StrictInt] = None
    zoom: Optional[StrictInt] = None


def _err(e: pc.CoverInputError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": str(e)})


def _out(db: Session, plan, user: User, role: str) -> dict:
    return {"cover": pc.cover_of(db, plan, user), "can_edit": role in ("owner", "editor")}


def _audit(action: str, user: User, plan, details: dict) -> None:
    record_audit_event(action=action, resource_type="travel_plan", user_id=user.id, resource_id=plan.id,
                       details=details)


@router.get("/{plan_id}/cover")
def get_cover(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return _out(db, plan, current_user, role)


@router.put("/{plan_id}/cover")
def set_cover(plan_id: str, body: CoverSet, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    try:
        pc.check_position(body.focus_x, body.focus_y, body.zoom)
        m = pc.photo_for(db, plan, body.memory_id, current_user)
    except pc.CoverInputError as e:
        raise _err(e)
    plan.cover_memory_id = m.id
    plan.cover_focus_x = body.focus_x if body.focus_x is not None else 50
    plan.cover_focus_y = body.focus_y if body.focus_y is not None else 50
    plan.cover_zoom = body.zoom if body.zoom is not None else 100
    db.commit()
    db.refresh(plan)
    _audit("plan.cover_set", current_user, plan,
           {"memory_id": str(m.id), "visibility": m.visibility, "external": bool(m.source)})
    return _out(db, plan, current_user, role)


@router.patch("/{plan_id}/cover")
def move_cover(plan_id: str, body: CoverPosition, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    if pc.cover_memory(db, plan, current_user) is None:
        raise HTTPException(status_code=404, detail={"code": "cover_not_found", "message": "表紙の写真がありません"})
    sent = body.model_fields_set
    if not sent:
        raise HTTPException(status_code=422, detail={"code": "no_changes", "message": "変更する項目がありません"})
    try:
        pc.check_position(body.focus_x, body.focus_y, body.zoom)
    except pc.CoverInputError as e:
        raise _err(e)
    for k in ("focus_x", "focus_y", "zoom"):
        v = getattr(body, k)
        if k in sent and v is not None:
            setattr(plan, f"cover_{k}", v)
    db.commit()
    db.refresh(plan)
    _audit("plan.cover_move", current_user, plan, {"fields": sorted(sent)})
    return _out(db, plan, current_user, role)


@router.delete("/{plan_id}/cover")
def clear_cover(plan_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_or_guest)):
    plan, role = require_plan_access(db, plan_id, current_user, min_role="editor")
    had = plan.cover_memory_id is not None
    plan.cover_memory_id = None
    plan.cover_focus_x, plan.cover_focus_y, plan.cover_zoom = 50, 50, 100
    db.commit()
    db.refresh(plan)
    if had:
        _audit("plan.cover_clear", current_user, plan, {})
    return _out(db, plan, current_user, role)


@router.get("/{plan_id}/cover/media")
def get_cover_media(plan_id: str, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user_or_guest)) -> Response:
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    m = pc.cover_memory(db, plan, current_user)
    if m is None:
        raise HTTPException(status_code=404, detail="表紙の写真がありません")
    from app.api.v1.memories import media_response
    return media_response(m)
