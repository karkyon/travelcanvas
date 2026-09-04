"""
TravelCanvas Database Models - 最終完成版
統一されたBaseクラスを使用、重複定義なし
"""
import uuid
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date, Text, JSON,
    ForeignKey, UniqueConstraint,
)
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
    # [Gate #29] 楽観的並行制御用のリビジョン番号。/plans系の新エンドポイントの
    # 更新・削除・並べ替えはこの値をIf-Matchヘッダーで要求し、一致しない場合は
    # 409を返す。更新の度に加算される。既存の/travel-plansエンドポイント
    # (itinerary JSONベース)は当面この値を変更しない(後方互換維持のため)。
    revision = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # リレーションシップ
    user = relationship("User", back_populates="travel_plans")
    share_links = relationship("PlanShareLink", back_populates="plan", cascade="all, delete-orphan")
    collaborators = relationship("PlanCollaborator", back_populates="plan", cascade="all, delete-orphan")
    days = relationship("TravelDay", back_populates="plan", cascade="all, delete-orphan", order_by="TravelDay.sort_order")

class PlanShareLink(Base):
    """旅行プラン共有リンクモデル"""
    __tablename__ = "plan_share_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    token = Column(String, unique=True, index=True, nullable=False)
    permission = Column(String, default="view")  # view | edit
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # リレーションシップ
    plan = relationship("TravelPlan", back_populates="share_links")

class PlanCollaborator(Base):
    """旅行プランコラボレーターモデル"""
    __tablename__ = "plan_collaborators"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    email = Column(String, nullable=False)
    role = Column(String, default="viewer")  # viewer | editor | owner
    status = Column(String, default="pending")  # pending | accepted | declined
    invite_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # リレーションシップ
    plan = relationship("TravelPlan", back_populates="collaborators")
    user = relationship("User")

class Notification(Base):
    """通知モデル"""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=True)
    related_plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # リレーションシップ
    user = relationship("User")
    related_plan = relationship("TravelPlan")

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


# ==========================================
# [Gate #29] Plan/Day/Event 正規化
# ==========================================
# TravelPlan.itinerary (JSON blob)から段階的に移行する正規テーブル群。
# 既存の/travel-plansエンドポイントとitinerary JSONは後方互換のためこの
# Gateでは変更しない。新設の/plansエンドポイント(app/api/v1/plans.py)が
# これらのテーブルを読み書きの正本として使う。


class TravelDay(Base):
    """旅行プランの「日」。1プラン×1現地日で一意。"""
    __tablename__ = "travel_days"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    local_date = Column(Date, nullable=False)
    timezone_id = Column(String, nullable=False, default="UTC")
    title = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    plan = relationship("TravelPlan", back_populates="days")
    events = relationship(
        "TravelEvent", back_populates="day", cascade="all, delete-orphan",
        order_by="TravelEvent.sort_order",
    )

    __table_args__ = (
        UniqueConstraint("plan_id", "local_date", name="uq_travel_days_plan_date"),
    )


class TravelEvent(Base):
    """旅程イベント(観光・食事・移動等)。"""
    __tablename__ = "travel_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    day_id = Column(UUID(as_uuid=True), ForeignKey("travel_days.id"), nullable=False)
    spot_id = Column(UUID(as_uuid=True), ForeignKey("spots.id"), nullable=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    event_type = Column(String, nullable=False, default="activity")

    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    local_start_time = Column(String, nullable=True)  # "HH:MM" 表示用
    is_all_day = Column(Boolean, nullable=False, default=False)

    address = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    locked = Column(Boolean, nullable=False, default=False)  # 最適化対象から除外
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    day = relationship("TravelDay", back_populates="events")


class EventLink(Base):
    """イベントへの補助的な関連情報(メモ/URL等)。将来の文書・予約テーブルへの
    参照はsource_type/source_idの汎用形で拡張する想定。"""
    __tablename__ = "event_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("travel_events.id"), nullable=False)
    link_type = Column(String, nullable=False)  # note | url | other
    label = Column(String, nullable=True)
    url = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PlanVersion(Base):
    """プラン全体の論理版。変更が確定するたびに1行追加する。"""
    __tablename__ = "plan_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    revision = Column(Integer, nullable=False)
    summary = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("plan_id", "revision", name="uq_plan_versions_plan_revision"),
    )


class ChangeSet(Base):
    """1回の変更操作(作成/更新/削除/並べ替え/Undo)の単位。"""
    __tablename__ = "change_sets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    source = Column(String, nullable=False, default="manual")  # manual|optimization|replan|import|undo
    base_revision = Column(Integer, nullable=False)
    resulting_revision = Column(Integer, nullable=False)
    applied_at = Column(DateTime(timezone=True), server_default=func.now())
    undone_at = Column(DateTime(timezone=True), nullable=True)

    items = relationship("ChangeItem", back_populates="change_set", cascade="all, delete-orphan")


class ChangeItem(Base):
    """ChangeSet内の個別エンティティ差分。Undo時にafter->beforeへ戻す。"""
    __tablename__ = "change_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    change_set_id = Column(UUID(as_uuid=True), ForeignKey("change_sets.id"), nullable=False)
    entity_type = Column(String, nullable=False)  # travel_day | travel_event
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(String, nullable=False)  # create | update | delete | reorder
    before_json = Column(JSON, nullable=True)
    after_json = Column(JSON, nullable=True)

    change_set = relationship("ChangeSet", back_populates="items")


class IdempotencyRecord(Base):
    """[Gate #29] Idempotency-Keyによる重複実行防止。同一user×endpoint×keyの
    再送に対し、実際の処理を再実行せず前回のレスポンスをそのまま返す。"""
    __tablename__ = "idempotency_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    key = Column(String, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    endpoint = Column(String, nullable=False)
    response_status = Column(Integer, nullable=False)
    response_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("key", "user_id", "endpoint", name="uq_idempotency_key_user_endpoint"),
    )
