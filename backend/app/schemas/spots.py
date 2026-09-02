"""
TravelCanvas MVP スポットスキーマ
"""
import uuid
from pydantic import BaseModel, validator
from typing import Optional
from datetime import datetime

class SpotBase(BaseModel):
    """スポット基本スキーマ"""
    name: str
    description: Optional[str] = None
    category: str = "other"
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    price_range: Optional[str] = None
    image_url: Optional[str] = None
    
    @validator('name')
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('スポット名は必須です')
        return v.strip()

class SpotCreate(SpotBase):
    """スポット作成スキーマ"""
    pass

class SpotUpdate(BaseModel):
    """スポット更新スキーマ"""
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    price_range: Optional[str] = None
    image_url: Optional[str] = None
    is_public: Optional[bool] = None

class SpotResponse(SpotBase):
    """スポットレスポンススキーマ"""
    id: uuid.UUID
    created_by: uuid.UUID
    is_public: bool
    visit_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class FavoriteCreate(BaseModel):
    """お気に入り登録スキーマ"""
    personal_note: Optional[str] = None
    personal_rating: Optional[float] = None


class FavoriteResponse(BaseModel):
    """お気に入りレスポンススキーマ(スポット詳細を内包)"""
    id: uuid.UUID
    spot_id: uuid.UUID
    personal_note: Optional[str] = None
    personal_rating: Optional[float] = None
    created_at: datetime
    spot: SpotResponse

    class Config:
        from_attributes = True
