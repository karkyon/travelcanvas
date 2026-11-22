"""[FR-062] 旅の記録の「また行きたい」(詳細設計 DD-2026-11-22-01 §6)。

- GET /plans/{plan_id}/again-candidates: 本人の記録から、行った場所・エリア・行けなかった場所を返す(viewer 以上)
- POST /plans/{plan_id}/again: 選んだものを本人の行きたい場所へ残す(viewer でも残せる。旅行は変えない)。1 回 50 件まで
"""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_active_user
from app.core.database import get_db
from app.core.plan_access import require_plan_access
from app.models.models import User
from app.services import again_candidates
from app.utils.rate_limiter import check_rate_limit

router = APIRouter(prefix="/plans", tags=["again"])


class AgainArea(BaseModel):
    key: str
    title: str
    lat: float
    lng: float
    radius_m: int
    walked_min: Optional[int] = None
    visited_count: int
    saved_spot_id: Optional[uuid.UUID] = None


class AgainPlace(BaseModel):
    key: str
    name: str
    genre: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    visited_at: Optional[datetime] = None
    photo_count: int = 0
    thumb_memory_id: Optional[str] = None
    saved_spot_id: Optional[uuid.UUID] = None
    saved_kind: Optional[str] = None
    sources: List[str] = []


class AgainMissed(BaseModel):
    key: str
    candidate_id: uuid.UUID
    title: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class AgainCandidates(BaseModel):
    areas: List[AgainArea]
    places: List[AgainPlace]
    missed: List[AgainMissed]


class AgainItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(..., min_length=8, max_length=200)
    kind: str = Field(..., pattern=r"^(place|area|missed)$")
    wish_kind: Optional[str] = Field(None, pattern=r"^(next|again)$")


class AgainSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: List[AgainItem] = Field(..., min_length=1, max_length=again_candidates.MAX_ITEMS)


class AgainSaved(BaseModel):
    key: str
    spot_id: uuid.UUID
    again_count: Optional[int] = None


class AgainResult(BaseModel):
    saved: List[AgainSaved]
    merged: List[AgainSaved]


@router.get("/{plan_id}/again-candidates", response_model=AgainCandidates)
def get_again_candidates(plan_id: str, db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_active_user)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return again_candidates.build(db, plan, current_user)


@router.post("/{plan_id}/again", response_model=AgainResult)
def save_again(plan_id: str, body: AgainSave, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_active_user)):
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    if not check_rate_limit(f"plan_again:{current_user.id}", 30, 60):
        raise HTTPException(status_code=429, detail={"code": "rate_limited",
                                                     "message": "続けて残しすぎました。1 分ほど待ってから残してください"})
    kinds = {"place": "places", "area": "areas", "missed": "missed"}
    try:
        return again_candidates.save(db, plan, current_user, [
            {"key": it.key, "kind": kinds[it.kind], "wish_kind": it.wish_kind} for it in body.items])
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "unknown_key",
                                                     "message": "選んだ場所が見つかりません。画面を開き直してください"})
