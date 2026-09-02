"""
TravelCanvas MVP スポットAPI
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.core.database import get_db
from app.models.models import Spot, User, UserSpotFavorite, UserSpotVisit
from app.schemas.spots import (
    SpotCreate, SpotUpdate, SpotResponse,
    FavoriteCreate, FavoriteResponse,
    VisitCreate, VisitResponse,
)
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

# ===== お気に入り関連API =====
# [Gate #15] UserSpotFavoriteテーブルはDBに存在していたが、これを操作するAPIが
# 一切実装されていなかった(Gate #14で発見・記録済みのギャップ)。今回実装する。
# 注意: /favorites は /{spot_id}(UUID型パスパラメータ)より前に定義する必要がある。
# FastAPI/Starletteは構造的に一致するパスをUUID変換に失敗しても次のルートへ
# フォールバックしないため、順序を誤ると /spots/favorites への全リクエストが
# 422(UUID解析エラー)になる。

@router.get("/favorites", response_model=List[FavoriteResponse])
async def get_favorites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """自分のお気に入りスポット一覧を取得"""
    favorites = (
        db.query(UserSpotFavorite)
        .filter(UserSpotFavorite.user_id == current_user.id)
        .order_by(UserSpotFavorite.created_at.desc())
        .all()
    )

    results = []
    for fav in favorites:
        spot = db.query(Spot).filter(Spot.id == fav.spot_id).first()
        if spot is None:
            # スポット自体が削除済みの場合はスキップ(整合性維持)
            continue
        results.append({
            "id": fav.id,
            "spot_id": fav.spot_id,
            "personal_note": fav.personal_note,
            "personal_rating": fav.personal_rating,
            "created_at": fav.created_at,
            "spot": spot,
        })
    return results


@router.post("/{spot_id}/favorite", response_model=FavoriteResponse, status_code=status.HTTP_201_CREATED)
async def add_favorite(
    spot_id: uuid.UUID,
    favorite_data: FavoriteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """スポットをお気に入りに追加"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    if not spot.is_public and spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません"
        )

    existing = (
        db.query(UserSpotFavorite)
        .filter(
            UserSpotFavorite.user_id == current_user.id,
            UserSpotFavorite.spot_id == spot_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="既にお気に入りに登録されています"
        )

    try:
        new_favorite = UserSpotFavorite(
            user_id=current_user.id,
            spot_id=spot_id,
            personal_note=favorite_data.personal_note,
            personal_rating=favorite_data.personal_rating,
        )
        db.add(new_favorite)
        db.commit()
        db.refresh(new_favorite)
        return {
            "id": new_favorite.id,
            "spot_id": new_favorite.spot_id,
            "personal_note": new_favorite.personal_note,
            "personal_rating": new_favorite.personal_rating,
            "created_at": new_favorite.created_at,
            "spot": spot,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"お気に入り登録エラー: {str(e)}"
        )


@router.delete("/{spot_id}/favorite")
async def remove_favorite(
    spot_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """スポットをお気に入りから削除"""
    favorite = (
        db.query(UserSpotFavorite)
        .filter(
            UserSpotFavorite.user_id == current_user.id,
            UserSpotFavorite.spot_id == spot_id,
        )
        .first()
    )
    if not favorite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="お気に入りが見つかりません"
        )

    try:
        db.delete(favorite)
        db.commit()
        return {"message": "お気に入りを解除しました"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"お気に入り解除エラー: {str(e)}"
        )


# ===== 訪問記録関連API =====
# [Gate #19] ダッシュボードの「訪問済み」統計は常にハードコードの0だった。
# Spot.visit_countは全ユーザー合算の表示回数カウンタで「自分が訪れたか」を
# 表さないため、UserSpotVisit(新規テーブル、追加のみのマイグレーション)を
# 使って実装する。/visits は /{spot_id} より前に定義する必要がある(favoritesと同じ理由)。

@router.get("/visits", response_model=List[VisitResponse])
async def get_visits(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """自分の訪問済みスポット一覧を取得"""
    visits = (
        db.query(UserSpotVisit)
        .filter(UserSpotVisit.user_id == current_user.id)
        .order_by(UserSpotVisit.visited_at.desc())
        .all()
    )

    results = []
    for visit in visits:
        spot = db.query(Spot).filter(Spot.id == visit.spot_id).first()
        if spot is None:
            continue
        results.append({
            "id": visit.id,
            "spot_id": visit.spot_id,
            "visit_note": visit.visit_note,
            "visited_at": visit.visited_at,
            "spot": spot,
        })
    return results


@router.post("/{spot_id}/visit", response_model=VisitResponse, status_code=status.HTTP_201_CREATED)
async def add_visit(
    spot_id: uuid.UUID,
    visit_data: VisitCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """スポットを訪問済みとして記録"""
    spot = db.query(Spot).filter(Spot.id == spot_id).first()
    if not spot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="スポットが見つかりません"
        )
    if not spot.is_public and spot.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アクセス権限がありません"
        )

    existing = (
        db.query(UserSpotVisit)
        .filter(
            UserSpotVisit.user_id == current_user.id,
            UserSpotVisit.spot_id == spot_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="既に訪問済みとして記録されています"
        )

    try:
        new_visit = UserSpotVisit(
            user_id=current_user.id,
            spot_id=spot_id,
            visit_note=visit_data.visit_note,
        )
        db.add(new_visit)
        # 表示回数カウンタもあわせて加算(既存のSpot.visit_countの意味と整合させる)
        spot.visit_count = (spot.visit_count or 0) + 1
        db.commit()
        db.refresh(new_visit)
        return {
            "id": new_visit.id,
            "spot_id": new_visit.spot_id,
            "visit_note": new_visit.visit_note,
            "visited_at": new_visit.visited_at,
            "spot": spot,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"訪問記録エラー: {str(e)}"
        )


@router.delete("/{spot_id}/visit")
async def remove_visit(
    spot_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """訪問済み記録を取り消す"""
    visit = (
        db.query(UserSpotVisit)
        .filter(
            UserSpotVisit.user_id == current_user.id,
            UserSpotVisit.spot_id == spot_id,
        )
        .first()
    )
    if not visit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="訪問記録が見つかりません"
        )

    try:
        db.delete(visit)
        db.commit()
        return {"message": "訪問記録を取り消しました"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"訪問記録削除エラー: {str(e)}"
        )


@router.get("/{spot_id}", response_model=SpotResponse)
async def get_spot(
    spot_id: uuid.UUID,
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
    spot_id: uuid.UUID,
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
    spot_id: uuid.UUID,
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
