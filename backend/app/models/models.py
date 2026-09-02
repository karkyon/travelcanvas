"""
TravelCanvas Database Models - 最終完成版
統一されたBaseクラスを使用、重複定義なし
"""
import uuid
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
from enum import Enum

# 統一されたBaseクラスをインポート
from app.core.database import Base

# ==========================================
# 列挙型定義
# ==========================================

class UserType(str, Enum):
    """ユーザータイプ"""
    GUEST = "guest"
    REGISTERED = "registered" 
    PREMIUM = "premium"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

class PlanStatus(str, Enum):  
    """プラン状態"""
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    SHARED = "shared"

class EventCategory(str, Enum):
    """イベントカテゴリ"""
    ACCOMMODATION = "accommodation"
    TRANSPORTATION = "transportation"
    ACTIVITY = "activity"
    DINING = "dining"
    SHOPPING = "shopping"
    SIGHTSEEING = "sightseeing"
    OTHER = "other"

class OptimizationType(str, Enum):
    """最適化タイプ"""
    ROUTE = "route"
    COST = "cost"
    TIME = "time"
    PREFERENCE = "preference"
    MIXED = "mixed"

class SharePermission(str, Enum):
    """共有権限"""
    VIEW = "view"
    EDIT = "edit"
    ADMIN = "admin"  
    OWNER = "owner"

# ==========================================
# データベースモデル（唯一の定義場所）
# ==========================================

class User(Base):
    """ユーザーモデル - 唯一の定義"""
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)      # ← 認証で必要
    is_superuser = Column(Boolean, default=False)     # ← 管理者権限
    role = Column(String, default="user")
    user_type = Column(String, default="registered")  # ← ユーザータイプ
    preferences = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # リレーションシップ
    travels = relationship("Travel", back_populates="owner")
    travel_plans = relationship("TravelPlan", back_populates="user")
    sessions = relationship("UserSession", back_populates="user")
    created_spots = relationship("Spot", back_populates="creator")

class UserSession(Base):
    """ユーザーセッションモデル"""
    __tablename__ = "user_sessions"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    session_token = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True)
    device_info = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # リレーションシップ
    user = relationship("User", back_populates="sessions")

class Travel(Base):
    """旅行モデル"""
    __tablename__ = "travels"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title = Column(String, index=True)
    description = Column(Text)
    location = Column(String)
    duration = Column(Integer)  # days
    estimated_cost = Column(Float)
    optimized_route = Column(Boolean, default=False)
    optimization_score = Column(Float, nullable=True)
    transport_modes = Column(JSON, nullable=True)
    waypoints = Column(JSON, nullable=True)
    preferences = Column(JSON, nullable=True)
    status = Column(String, default="draft")
    is_public = Column(Boolean, default=False)
    
    # 外部キー
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    
    # タイムスタンプ
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # リレーションシップ
    owner = relationship("User", back_populates="travels")
    optimization_results = relationship("OptimizationResult", back_populates="travel")

class TravelPlan(Base):
    """旅行プランモデル"""
    __tablename__ = "travel_plans"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    destination = Column(String)
    start_date = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    budget = Column(Float)
    status = Column(String, default="draft")
    preferences = Column(JSON, nullable=True)
    itinerary = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # リレーションシップ
    user = relationship("User", back_populates="travel_plans")

class OptimizationResult(Base):
    """最適化結果モデル"""
    __tablename__ = "optimization_results"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    travel_id = Column(UUID(as_uuid=True), ForeignKey("travels.id"))
    optimization_type = Column(String)
    original_data = Column(JSON)
    optimized_data = Column(JSON)
    improvement_metrics = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # リレーションシップ
    travel = relationship("Travel", back_populates="optimization_results")


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
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
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
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
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
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    spot_id = Column(UUID(as_uuid=True), ForeignKey("spots.id"), nullable=False)
    
    # 個人メモ
    personal_note = Column(Text, nullable=True)
    personal_rating = Column(Float, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # ユニーク制約
    __table_args__ = (
        {"extend_existing": True},
    )


class UserSpotVisit(Base):
    """ユーザー訪問済みスポット - MVP版

    [Gate #19] ダッシュボードの「訪問済み」統計は常にハードコードの0だった。
    Spot.visit_countは全ユーザー合算の表示回数カウンタであり、
    「自分が訪れたかどうか」を表す真偽値/記録ではないため転用できず、
    新規テーブルとして追加する(既存テーブルへのALTERではなく追加のみ、
    UserSpotFavoriteと対になる構造)。
    """
    __tablename__ = "user_spot_visits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    spot_id = Column(UUID(as_uuid=True), ForeignKey("spots.id"), nullable=False)

    # 訪問メモ
    visit_note = Column(Text, nullable=True)

    visited_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        {"extend_existing": True},
    )
