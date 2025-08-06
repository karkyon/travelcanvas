#!/usr/bin/env python3
"""
TravelCanvas MVP スポット機能完全セットアップ (修正版)
app/main.py 対応
"""
import os
import shutil
import json
from datetime import datetime

class MVPSpotSetup:
    def __init__(self):
        self.setup_log = []
        self.base_dir = os.getcwd()
        self.log_file = "mvp_development.log"
    
    def log(self, message, level="INFO"):
        """開発ログを記録"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] {level}: {message}"
        self.setup_log.append(log_entry)
        print(f"📝 {log_entry}")
        
        # ファイルにも記録
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry + "\n")
    
    def analyze_project_structure(self):
        """プロジェクト構造の詳細分析"""
        self.log("プロジェクト構造分析開始")
        
        structure = {
            "backend_files": [],
            "frontend_files": [],
            "existing_models": [],
            "existing_apis": [],
            "missing_components": []
        }
        
        # バックエンド構造確認
        backend_paths = [
            "app/api/v1",
            "app/models", 
            "app/schemas",
            "app/core"
        ]
        
        for path in backend_paths:
            if os.path.exists(path):
                for file in os.listdir(path):
                    if file.endswith('.py') and file != '__init__.py':
                        structure["backend_files"].append(f"{path}/{file}")
            else:
                structure["missing_components"].append(path)
        
        # 既存モデル確認
        models_file = "app/models/models.py"
        if os.path.exists(models_file):
            with open(models_file, 'r') as f:
                content = f.read()
                if "class User(" in content:
                    structure["existing_models"].append("User")
                if "class Spot(" in content:
                    structure["existing_models"].append("Spot")
                if "class Travel(" in content:
                    structure["existing_models"].append("Travel")
        
        # 既存API確認
        api_dir = "app/api/v1"
        if os.path.exists(api_dir):
            for file in os.listdir(api_dir):
                if file.endswith('.py') and file != '__init__.py':
                    structure["existing_apis"].append(file.replace('.py', ''))
        
        self.log(f"既存モデル: {structure['existing_models']}")
        self.log(f"既存API: {structure['existing_apis']}")
        self.log(f"不足コンポーネント: {structure['missing_components']}")
        
        return structure
    
    def create_spot_models_extension(self):
        """スポット関連モデルを追加"""
        self.log("スポット関連モデル追加開始")
        
        models_file = "app/models/models.py"
        if not os.path.exists(models_file):
            self.log("models.py が見つかりません", "ERROR")
            return False
        
        # バックアップ作成
        backup_file = f"{models_file}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(models_file, backup_file)
        self.log(f"models.py を {backup_file} にバックアップ")
        
        with open(models_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 既にSpotモデルが存在するかチェック
        if "class Spot(Base):" in content:
            self.log("Spotモデルは既に存在します")
            return True
        
        # スポット関連モデルを追加
        spot_extension = '''

# ==========================================
# MVPスポット機能 - モデル追加
# ==========================================

class SpotCategory(str, Enum):
    """スポットカテゴリ - MVP版"""
    RESTAURANT = "restaurant"        # レストラン
    SIGHTSEEING = "sightseeing"     # 観光地  
    ACCOMMODATION = "accommodation"  # 宿泊
    SHOPPING = "shopping"           # ショッピング
    OTHER = "other"                 # その他

class Spot(Base):
    """MVPスポットモデル - シンプル版"""
    __tablename__ = "spots"
    
    # 基本情報
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False, default="other")
    
    # 位置情報（MVP版：手動入力）
    address = Column(String(500), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    
    # MVPメタデータ
    rating = Column(Float, nullable=True)  # 1-5評価
    price_range = Column(String(10), nullable=True)  # $, $$, $$$
    
    # 画像（MVP版：URL文字列）
    image_url = Column(String(500), nullable=True)
    
    # ユーザー関連
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_public = Column(Boolean, default=False)
    
    # 統計
    visit_count = Column(Integer, default=0)
    
    # タイムスタンプ
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # リレーションシップ
    creator = relationship("User", back_populates="created_spots")

class UserSpotFavorite(Base):
    """ユーザーお気に入りスポット - MVP版"""
    __tablename__ = "user_spot_favorites"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    spot_id = Column(Integer, ForeignKey("spots.id"), nullable=False)
    
    # 個人メモ
    personal_note = Column(Text, nullable=True)
    personal_rating = Column(Float, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # ユニーク制約
    __table_args__ = (
        {"extend_existing": True},
    )
'''
        
        # Userモデルにリレーションシップ追加
        if "sessions = relationship" in content and "created_spots" not in content:
            content = content.replace(
                'sessions = relationship("UserSession", back_populates="user")',
                'sessions = relationship("UserSession", back_populates="user")\n    created_spots = relationship("Spot", back_populates="creator")'
            )
        
        # ファイル末尾にスポットモデル追加
        updated_content = content + spot_extension
        
        with open(models_file, 'w', encoding='utf-8') as f:
            f.write(updated_content)
        
        self.log("スポット関連モデルを追加完了")
        return True
    
    def create_spot_schemas(self):
        """スポット用Pydanticスキーマ作成"""
        self.log("スポットスキーマ作成開始")
        
        schema_dir = "app/schemas"
        os.makedirs(schema_dir, exist_ok=True)
        
        schema_file = f"{schema_dir}/spots.py"
        
        schema_content = '''"""
TravelCanvas MVP スポットスキーマ
"""
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
    id: int
    created_by: int
    is_public: bool
    visit_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True
'''
        
        with open(schema_file, 'w', encoding='utf-8') as f:
            f.write(schema_content)
        
        self.log(f"スキーマファイル作成: {schema_file}")
        return True
    
    def create_spot_api(self):
        """スポットAPI作成"""
        self.log("スポットAPI作成開始")
        
        api_file = "app/api/v1/spots.py"
        
        api_content = '''"""
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
'''
        
        with open(api_file, 'w', encoding='utf-8') as f:
            f.write(api_content)
        
        self.log(f"スポットAPI作成: {api_file}")
        return True
    
    def update_main_app(self):
        """メインアプリにスポットルート追加"""
        self.log("メインアプリケーション更新開始")
        
        # 修正: app/main.py を指定
        main_file = "app/main.py"
        if not os.path.exists(main_file):
            self.log("app/main.py が見つかりません", "ERROR")
            return False
        
        with open(main_file, 'r') as f:
            content = f.read()
        
        # 既にスポットルートがあるかチェック
        if "from app.api.v1 import spots" in content:
            self.log("スポットルートは既に追加済み")
            return True
        
        # インポート追加
        if "from app.api.v1 import auth" in content:
            content = content.replace(
                "from app.api.v1 import auth",
                "from app.api.v1 import auth, spots"
            )
        
        # ルーター追加
        if 'app.include_router(auth.router, prefix="/api/v1")' in content:
            content = content.replace(
                'app.include_router(auth.router, prefix="/api/v1")',
                'app.include_router(auth.router, prefix="/api/v1")\napp.include_router(spots.router, prefix="/api/v1")'
            )
        
        with open(main_file, 'w') as f:
            f.write(content)
        
        self.log("メインアプリケーション更新完了")
        return True
    
    def create_development_status(self):
        """開発状況をJSONで記録"""
        status = {
            "project": "TravelCanvas MVP",
            "last_update": datetime.now().isoformat(),
            "completed_features": [
                "ユーザー認証（登録・ログイン・ログアウト）",
                "ダッシュボード基本画面",
                "スポット基本データモデル",
                "スポット基本API（CRUD）"
            ],
            "next_tasks": [
                "データベーステーブル作成",
                "API動作確認",
                "フロントエンドスポット登録画面",
                "フロントエンドスポット一覧画面"
            ],
            "current_phase": "Phase 1: バックエンドAPI基盤",
            "setup_log": self.setup_log
        }
        
        with open("mvp_status.json", 'w', encoding='utf-8') as f:
            json.dump(status, f, ensure_ascii=False, indent=2)
        
        self.log("開発状況をmvp_status.jsonに記録")
    
    def run_setup(self):
        """セットアップ実行"""
        self.log("=== TravelCanvas MVP スポット機能セットアップ開始 ===")
        
        # 1. 構造分析
        structure = self.analyze_project_structure()
        
        # 2. スポットモデル追加
        if not self.create_spot_models_extension():
            self.log("モデル追加に失敗", "ERROR")
            return False
        
        # 3. スキーマ作成
        if not self.create_spot_schemas():
            self.log("スキーマ作成に失敗", "ERROR")
            return False
        
        # 4. API作成
        if not self.create_spot_api():
            self.log("API作成に失敗", "ERROR")  
            return False
        
        # 5. メインアプリ更新
        if not self.update_main_app():
            self.log("メインアプリ更新に失敗", "ERROR")
            return False
        
        # 6. 開発状況記録
        self.create_development_status()
        
        self.log("=== MVPスポット機能セットアップ完了 ===")
        return True

def main():
    """メイン実行"""
    setup = MVPSpotSetup()
    
    print("🚀 TravelCanvas MVP スポット機能セットアップ (修正版)")
    print("=" * 60)
    
    success = setup.run_setup()
    
    if success:
        print("\n🎉 セットアップ完了！")
        print("\n📋 作成されたファイル:")
        print("  ✅ app/models/models.py - スポットモデル追加")
        print("  ✅ app/schemas/spots.py - スポットスキーマ")
        print("  ✅ app/api/v1/spots.py - スポットAPI")
        print("  ✅ app/main.py - ルート追加")
        print("  ✅ mvp_development.log - 開発ログ")
        print("  ✅ mvp_status.json - 進捗状況")
        
        print("\n🚀 次の実行コマンド:")
        print("  1. python3 create_tables.py")
        print("  2. tc-backend")
        print("  3. http://192.168.1.248:8000/docs でAPI確認")
        
        print("\n📊 期待される結果:")
        print("  - スポット関連エンドポイントがSwagger UIに表示")
        print("  - POST /api/v1/spots/ でスポット作成可能")
        print("  - GET /api/v1/spots/ でスポット一覧取得可能")
        
        return True
    else:
        print("\n❌ セットアップに失敗しました")
        print("ログファイル mvp_development.log を確認してください")
        return False

if __name__ == "__main__":
    import sys
    if not main():
        sys.exit(1)
