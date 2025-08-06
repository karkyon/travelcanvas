"""
TravelCanvas MVP スポットAPI
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.models.models import Spot, User
from app.schemas.spots import SpotCreate, SpotUpdate, SpotResponse
from app.core.auth import get_current_user

router = APIRouter(prefix="/spots", tags=["spots"])

@router.post("/", response_model=SpotResponse, status_code=status.HTTP_201_CREATED)
async def create_spot(
    spot_data: SpotCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """新しいスポットを作成"""
    try:
        new_spot = Spot(
            name=spot_data.name,
            description=spot_data.description,
            category=spot_data.category,
            address=spot_data.address,
            latitude=spot_data.latitude,
            longitude=spot_data.longitude,
            price_range=spot_data.price_range,
            image_url=spot_data.image_url,
            created_by=current_user.id
        )
        
        db.add(new_spot)
        db.commit()
        db.refresh(new_spot)
        
        return new_spot
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"スポット作成エラー: {str(e)}"
        )

@router.get("/", response_model=List[SpotResponse])
async def get_spots(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    category: Optional[str] = None,
    limit: int = 20
):
    """スポット一覧取得"""
    try:
        query = db.query(Spot).filter(
            (Spot.created_by == current_user.id) | (Spot.is_public == True)
        )
        
        if category and category != "all":
            query = query.filter(Spot.category == category)
        
        spots = query.order_by(Spot.created_at.desc()).limit(limit).all()
        return spots
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"スポット取得エラー: {str(e)}"
        )

@router.get("/{spot_id}", response_model=SpotResponse)
async def get_spot(
    spot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """スポット詳細取得"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    
    # アクセス権限チェック
    if not spot.is_public and spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません"
        )
    
    return spot

@router.put("/{spot_id}", response_model=SpotResponse)  
async def update_spot(
    spot_id: int,
    spot_data: SpotUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """スポット更新"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    
    if spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="編集権限がありません"
        )
    
    # 更新処理
    update_data = spot_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(spot, field, value)
    
    try:
        db.commit()
        db.refresh(spot)
        return spot
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"スポット更新エラー: {str(e)}"
        )

@router.delete("/{spot_id}")
async def delete_spot(
    spot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """スポット削除"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    
    if spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="削除権限がありません"
        )
    
    try:
        db.delete(spot)
        db.commit()
        return {"message": "スポットを削除しました"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"スポット削除エラー: {str(e)}"
        )

@router.get("/categories/list")
async def get_categories():
    """利用可能なカテゴリ一覧"""
    return {
        "categories": [
            {"value": "restaurant", "label": "レストラン"},
            {"value": "sightseeing", "label": "観光地"},
            {"value": "accommodation", "label": "宿泊"},
            {"value": "shopping", "label": "ショッピング"},
            {"value": "other", "label": "その他"}
        ]
    }

@router.get("/test/ping")
async def test_spots_api():
    """スポットAPI動作テスト"""
    return {
        "message": "スポットAPI正常動作中",
        "version": "MVP-1.0.0",
        "timestamp": datetime.now().isoformat()
    }
