"""
TravelCanvas 旅行プラン(TravelPlan) CRUD API
既存 spots.py の実装パターンに準拠。

[Gate #34] このrouterはプランmetadata(title/description/destination/
start_date/end_date/budget/status/preferences)のCRUDに限定する。
`itinerary`(旧JSON blob正本)はGate #29以降、正規化された
travel_days/travel_events(app/api/v1/plans.py)が唯一の書込み正本であり、
このrouter経由でのitinerary書換えはrevision/If-Match/Idempotency/
ChangeSet/Undoの全保証を迂回する(2026-09-05監査 P0-01/P0-02)。
そのため本Gateでitineraryフィールドの書込みを明示的に拒否する。
"""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from sqlalchemy import or_

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.core.plan_access import require_plan_access, accessible_plan_ids_subquery
from app.models.models import TravelPlan, User
from app.schemas.travel_plan import (
    TravelPlanCreate,
    TravelPlanUpdate,
    TravelPlanResponse,
    TravelPlanListResponse,
)

logger = logging.getLogger("travelcanvas")

router = APIRouter(prefix="/travel-plans", tags=["travel-plans"])

# [Gate #34] metadata CRUDでは書き込みを受け付けないフィールド。
# `itinerary`をrequestに含めてもサイレントに無視せず、422で明示的に
# 拒否する(壊れた/混乱した呼び出し元を早期に気づかせるため)。
_LEGACY_ITINERARY_FIELD = "itinerary"


def _reject_itinerary_write(update_data: dict) -> None:
    if _LEGACY_ITINERARY_FIELD in update_data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": (
                    "itineraryはこのAPIでは更新できません。日/イベントの"
                    "変更は /plans/{plan_id}/days および "
                    "/plans/{plan_id}/days/{day_id}/events を使用してください。"
                ),
                "error_code": "LEGACY_ITINERARY_WRITE_REJECTED",
            },
        )


@router.post("/", response_model=TravelPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_travel_plan(
    plan_data: TravelPlanCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """新しい旅行プランを作成(metadataのみ。itineraryはこのAPIでは受け付けない)"""
    try:
        new_plan = TravelPlan(
            user_id=current_user.id,
            title=plan_data.title,
            description=plan_data.description,
            destination=plan_data.destination,
            start_date=plan_data.start_date,
            end_date=plan_data.end_date,
            budget=plan_data.budget,
            preferences=plan_data.preferences,
            status="draft",
        )

        db.add(new_plan)
        db.commit()
        db.refresh(new_plan)

        return new_plan

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン作成中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの作成に失敗しました。しばらくしてから再試行してください。",
        )


@router.get("/", response_model=TravelPlanListResponse)
async def get_travel_plans(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    """自分が所有、または承諾済みコラボレーターとして参加している旅行プラン一覧取得

    [Gate #30] 以前はowner分のみを返しており、招待を承諾したプランは
    一覧に一切現れなかった(そもそもアクセス自体できなかったため気づかれ
    なかった不整合)。
    """
    collab_plan_ids = accessible_plan_ids_subquery(db, current_user)
    query = db.query(TravelPlan).filter(
        or_(TravelPlan.user_id == current_user.id, TravelPlan.id.in_(collab_plan_ids))
    )

    if status_filter:
        query = query.filter(TravelPlan.status == status_filter)

    total = query.count()
    plans = (
        query.order_by(TravelPlan.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    return {"plans": plans, "total": total}


# [Gate #27 / A-011] /test/ping は /{plan_id}(UUID型パスパラメータ)より前に
# 定義する必要がある。spots.py の固定ルートと同じ理由・同じ対応。
@router.get("/test/ping")
async def test_travel_plans_api():
    """旅行プランAPI動作テスト"""
    return {
        "message": "旅行プランAPI正常動作中",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/{plan_id}", response_model=TravelPlanResponse)
async def get_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """旅行プラン詳細取得(owner/editor/viewerいずれでも閲覧可能)"""
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="viewer")
    return plan


@router.put("/{plan_id}", response_model=TravelPlanResponse)
async def update_travel_plan(
    plan_id: uuid.UUID,
    plan_data: TravelPlanUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """旅行プラン更新(owner/editorが編集可能。viewerは403)

    [Gate #34] itineraryフィールドが含まれる場合は422で拒否する
    (day/eventの正本は/plans/*のみ)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="editor")

    update_data = plan_data.dict(exclude_unset=True)
    _reject_itinerary_write(update_data)

    for field, value in update_data.items():
        setattr(plan, field, value)

    try:
        db.commit()
        db.refresh(plan)
        return plan
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン更新中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの更新に失敗しました。しばらくしてから再試行してください。",
        )


@router.delete("/{plan_id}")
async def delete_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """旅行プラン削除

    [Gate #30 設計判断] プラン全体の削除は、editorではなくownerのみに限定
    する。日/イベント単位の編集はeditorに許可するが、プラン自体の破壊的
    操作(削除)はownerの専権とする(共有機能の一般的な権限モデルに合わせた
    意図的な判断)。
    """
    plan, _role = require_plan_access(db, plan_id, current_user, min_role="owner")

    try:
        db.delete(plan)
        db.commit()
        return {"message": "旅行プランを削除しました"}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("旅行プラン削除中に予期しないエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="旅行プランの削除に失敗しました。しばらくしてから再試行してください。",
        )
