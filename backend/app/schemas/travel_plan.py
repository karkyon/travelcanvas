"""
TravelCanvas 旅行プラン(TravelPlan)スキーマ
実DBモデル(app.models.models.TravelPlan)のフィールドに準拠。
"""
import uuid
from datetime import date, datetime
from typing import Optional, Dict, Any

from pydantic import BaseModel, validator


class TravelPlanBase(BaseModel):
    """旅行プラン基本スキーマ"""
    title: str
    description: Optional[str] = None
    destination: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    budget: Optional[float] = None
    preferences: Optional[Dict[str, Any]] = None

    @validator('title')
    def title_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('プラン名は必須です')
        return v.strip()

    @validator('end_date')
    def end_after_start(cls, v, values):
        start = values.get('start_date')
        if start and v and v < start:
            raise ValueError('終了日は開始日以降である必要があります')
        return v


class TravelPlanCreate(TravelPlanBase):
    """旅行プラン作成スキーマ"""
    pass


class TravelPlanUpdate(BaseModel):
    """旅行プラン更新スキーマ(部分更新)"""
    title: Optional[str] = None
    description: Optional[str] = None
    destination: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    budget: Optional[float] = None
    status: Optional[str] = None
    preferences: Optional[Dict[str, Any]] = None
    itinerary: Optional[Dict[str, Any]] = None

    @validator('title')
    def title_not_empty_if_set(cls, v):
        if v is not None and not v.strip():
            raise ValueError('プラン名は空にできません')
        return v.strip() if v is not None else v

    @validator('status')
    def status_valid(cls, v):
        allowed = {"draft", "active", "completed", "archived", "shared"}
        if v is not None and v not in allowed:
            raise ValueError(f'statusは次のいずれかである必要があります: {allowed}')
        return v


class TravelPlanResponse(TravelPlanBase):
    """旅行プランレスポンススキーマ"""
    id: uuid.UUID
    user_id: uuid.UUID
    status: str
    itinerary: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TravelPlanListResponse(BaseModel):
    """旅行プラン一覧レスポンス"""
    plans: list[TravelPlanResponse]
    total: int
