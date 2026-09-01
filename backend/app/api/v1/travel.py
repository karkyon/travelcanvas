"""
TravelCanvas 旅行プラン(TravelPlan) CRUD API
既存 spots.py の実装パターンに準拠。
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.auth import get_current_active_user
from app.models.models import TravelPlan, User
from app.schemas.travel_plan import (
    TravelPlanCreate,
    TravelPlanUpdate,
    TravelPlanResponse,
    TravelPlanListResponse,
)

router = APIRouter(prefix="/travel-plans", tags=["travel-plans"])


@router.post("/", response_model=TravelPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_travel_plan(
    plan_data: TravelPlanCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """新しい旅行プランを作成"""
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

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"旅行プラン作成エラー: {str(e)}",
        )


@router.get("/", response_model=TravelPlanListResponse)
async def get_travel_plans(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    """自分の旅行プラン一覧取得"""
    query = db.query(TravelPlan).filter(TravelPlan.user_id == current_user.id)

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


@router.get("/{plan_id}", response_model=TravelPlanResponse)
async def get_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """旅行プラン詳細取得"""
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()

    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="旅行プランが見つかりません",
        )

    if plan.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません",
        )

    return plan


@router.put("/{plan_id}", response_model=TravelPlanResponse)
async def update_travel_plan(
    plan_id: uuid.UUID,
    plan_data: TravelPlanUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """旅行プラン更新"""
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()

    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="旅行プランが見つかりません",
        )

    if plan.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="編集権限がありません",
        )

    update_data = plan_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(plan, field, value)

    try:
        db.commit()
        db.refresh(plan)
        return plan
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"旅行プラン更新エラー: {str(e)}",
        )


@router.delete("/{plan_id}")
async def delete_travel_plan(
    plan_id: uuid.UUID,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """旅行プラン削除"""
    plan = db.query(TravelPlan).filter(TravelPlan.id == plan_id).first()

    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="旅行プランが見つかりません",
        )

    if plan.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="削除権限がありません",
        )

    try:
        db.delete(plan)
        db.commit()
        return {"message": "旅行プランを削除しました"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"旅行プラン削除エラー: {str(e)}",
        )


@router.get("/test/ping")
async def test_travel_plans_api():
    """旅行プランAPI動作テスト"""
    return {
        "message": "旅行プランAPI正常動作中",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat(),
    }
