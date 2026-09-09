"""
TravelCanvas Database Models - 最終完成版
統一されたBaseクラスを使用、重複定義なし
"""
import uuid
import hashlib
from datetime import datetime, timedelta
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Date, Text, JSON,
    ForeignKey, UniqueConstraint, LargeBinary, Index, CheckConstraint, text,
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
    """旅行プラン共有リンクモデル

    [Gate #30] トークンの生値はDBに平文保存しない(監査指摘)。生成時に
    一度だけ生値を発行し、DBにはSHA-256ハッシュ(token_hash)のみを保存
    する。token_prefixは一覧画面でリンクを識別するための非秘匿な表示用
    先頭数文字(単体では推測に使えない長さ)。
    """
    __tablename__ = "plan_share_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    token_prefix = Column(String(8), nullable=False)
    permission = Column(String, default="view")  # view | edit
    passcode_hash = Column(String, nullable=True)
    max_uses = Column(Integer, nullable=True)
    use_count = Column(Integer, nullable=False, default=0, server_default="0")
    expires_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
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
    # [Gate #30] 招待された側がaccept/declineした日時。pending中はNULL。
    decided_at = Column(DateTime(timezone=True), nullable=True)

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

    # [Gate #37] Visited Area Layer: GPS自動判定による訪問記録に対応する。
    # 既存の手動記録行はsource='manual'のまま(server_defaultにより後方互換)。
    # confidence/detected_accuracy_metersは手動記録では常にNULL。
    source = Column(String, nullable=False, server_default="manual")
    confidence = Column(Float, nullable=True)
    detected_accuracy_meters = Column(Float, nullable=True)

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
    # [Gate #32] このイベントがcandidate/place(Gate #31正規化検索結果)から
    # 採用されたものであれば、そのPlaceを参照する(出典追跡・地図上の
    # candidate<->event紐付けのため)。手動作成されたイベントはNULL。
    place_id = Column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)

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
    """[Gate #29 / Gate R2-1改訂] Idempotency-Keyによる重複実行防止。
    R2-1でanonymous device(匿名端末)actorにも対応し、payload hash比較・
    処理中(IN_PROGRESS)状態・TTLを追加した。既存user経由の呼び出し(plans.py等)
    はpayload_hash/status/expires_atを明示せずINSERTしているため、Python側
    default(下記_LEGACY_PAYLOAD_HASH_SENTINEL/_default_idempotency_expiry)で
    後方互換を保つ。詳細はdocs/adr/ADR-quick-draft.md参照。"""
    __tablename__ = "idempotency_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    key = Column(String, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=True)
    endpoint = Column(String, nullable=False)
    payload_hash = Column(
        LargeBinary(32), nullable=False, default=lambda: _LEGACY_PAYLOAD_HASH_SENTINEL,
    )
    status = Column(String, nullable=False, default="COMPLETED")  # IN_PROGRESS/COMPLETED/FAILED
    response_status = Column(Integer, nullable=True)
    response_json = Column(JSON, nullable=True)
    error_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: _default_idempotency_expiry(),
    )

    __table_args__ = (
        CheckConstraint(
            "user_id IS NOT NULL OR device_id IS NOT NULL",
            name="ck_idempotency_actor_present",
        ),
        Index(
            "uq_idempotency_user", "key", "user_id", "endpoint",
            unique=True, postgresql_where=text("user_id IS NOT NULL"),
        ),
        Index(
            "uq_idempotency_device", "key", "device_id", "endpoint",
            unique=True, postgresql_where=text("device_id IS NOT NULL"),
        ),
    )


# ==========================================
# [Gate R2-1] QuickDraft Domain Foundation
# 正式契約(DOC-06 `POST /v1/quick-drafts`)のためのモデル。設計判断の詳細は
# docs/adr/ADR-quick-draft.mdを参照。payload暗号化の実装はGate R2-2で導入し、
# 本Gateはスキーマ(devices/quick_drafts)のみを追加する。
# ==========================================

_LEGACY_PAYLOAD_HASH_SENTINEL = b"\x00" * 32


def _default_idempotency_expiry():
    return datetime.utcnow() + timedelta(days=7)


def _default_device_expiry():
    return datetime.utcnow() + timedelta(days=30)


def _default_quick_draft_expiry():
    return datetime.utcnow() + timedelta(days=30)


class QuickDraftStatus(str, Enum):
    """[Gate R2-1] ADR-quick-draft.md §4のQuickDraft状態機械。"""
    ACTIVE = "ACTIVE"
    PROMOTED = "PROMOTED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class Device(Base):
    """[Gate R2-1] QuickDraft専用のanonymous device identity。
    既存guest(users.user_type='guest'のステートレスJWT)とは別モデルとして
    併存させる(ADR-quick-draft.md §決定事項2/3)。token本体はDBへ保存せず、
    SHA-256 digestのみ保存する。"""
    __tablename__ = "devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    token_digest = Column(LargeBinary(32), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, default=_default_device_expiry)

    quick_drafts = relationship("QuickDraft", back_populates="device")


class QuickDraft(Base):
    """[Gate R2-1] DOC-06 `POST /v1/quick-drafts` の正式永続モデル。
    作成・promote APIの実装はGate R2-2/R2-3で行う(本Gateはスキーマのみ)。"""
    __tablename__ = "quick_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=False, index=True)
    payload_ciphertext = Column(LargeBinary, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default=QuickDraftStatus.ACTIVE.value)
    expires_at = Column(
        DateTime(timezone=True), nullable=False, default=_default_quick_draft_expiry,
    )
    promoted_plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    device = relationship("Device", back_populates="quick_drafts")

    __table_args__ = (
        Index("ix_quick_drafts_status_expires", "status", "expires_at"),
    )


# ==========================================
# [Gate #31] Candidate/Place/Search正規化
# ==========================================
# 監査指摘: frontendがWikipedia/Nominatim/Overpass APIを直接叩き、結果が
# 0件やエラー時には Math.random() で生成した架空の評価・座標・住所を
# 実データであるかのようにユーザーへ提示していた(webSearchService.ts
# generateMockResults)。本Gateでbackend adapterへ検索を集約し、
# source(provider/URL/取得日時)を保持する正規モデルを新設する。
# mock/random fallbackは本Gateの新規実装には一切含めない
# (プロバイダ失敗時は0件を返すのみで、絶対にデータを捏造しない)。

class SearchCandidate(Base):
    """検索で得られた未確定の候補。同一query・providerへの再検索でも
    重複削除せず毎回新規行として保持する(比較提示のため)。"""
    __tablename__ = "search_candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    query = Column(String, nullable=False)
    provider = Column(String, nullable=False)  # wikipedia | nominatim | overpass
    external_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    address = Column(String, nullable=True)
    raw_payload = Column(JSON, nullable=True)
    searched_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    retrieved_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    source_records = relationship(
        "SourceRecord", back_populates="candidate", cascade="all, delete-orphan"
    )


class Place(Base):
    """候補(Candidate)をユーザーが採用(adopt)して確定した正規の場所。"""
    __tablename__ = "places"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    address = Column(String, nullable=True)
    adopted_from_candidate_id = Column(
        UUID(as_uuid=True), ForeignKey("search_candidates.id"), nullable=True
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    field_sources = relationship(
        "FieldSource", back_populates="place", cascade="all, delete-orphan"
    )
    opening_hours = relationship(
        "OpeningHours", back_populates="place", cascade="all, delete-orphan"
    )


class SourceRecord(Base):
    """1回の外部取得(provider呼び出し)の記録。candidateまたはplaceの
    どちらかに紐づく。freshness_stateはこのレコードが今も鮮度を保って
    いるかを表す(呼び出し側が取得後の経過時間から判定して更新する)。"""
    __tablename__ = "source_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("search_candidates.id"), nullable=True)
    place_id = Column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)
    provider = Column(String, nullable=False)
    source_url = Column(String, nullable=True)
    retrieved_at = Column(DateTime(timezone=True), nullable=False)
    freshness_state = Column(String, nullable=False, default="fresh")  # fresh | stale | expired
    raw_response = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    candidate = relationship("SearchCandidate", back_populates="source_records")
    place = relationship("Place")


class FieldSource(Base):
    """Placeの個々のフィールドがどのSourceRecordに由来するかを記録する。
    1つのPlaceの複数フィールドが異なるproviderに由来するケースを表現できる。"""
    __tablename__ = "field_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    place_id = Column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    field_name = Column(String, nullable=False)
    value = Column(Text, nullable=True)
    source_record_id = Column(UUID(as_uuid=True), ForeignKey("source_records.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    place = relationship("Place", back_populates="field_sources")
    source_record = relationship("SourceRecord")


class OpeningHours(Base):
    """[Gate #31 スコープ] モデルのみ新設。providerからの自動取得・
    populateは次Gate以降(Overpassのopening_hoursタグ解析等)。"""
    __tablename__ = "opening_hours"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    place_id = Column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0=月 ... 6=日
    open_time = Column(String, nullable=True)  # "09:00"
    close_time = Column(String, nullable=True)  # "18:00"
    source_record_id = Column(UUID(as_uuid=True), ForeignKey("source_records.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    place = relationship("Place", back_populates="opening_hours")


# ==========================================
# [Gate #31.5B] 共有リンクアクセス監査ログ
# ==========================================
# 公開共有リンク解決(未認証)への全アクセス試行を記録する。誰が(IPアドレス)
# ・いつ・どの結果(成功/失効/期限切れ/上限到達/パスコード誤り/レート制限)
# でアクセスしたかを追跡できるようにし、不正利用の調査を可能にする。
# tokenの生値は記録しない(token_hashのみ)。

class ShareAccessLog(Base):
    """公開共有リンクへのアクセス試行監査ログ"""
    __tablename__ = "share_access_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    share_id = Column(UUID(as_uuid=True), ForeignKey("plan_share_links.id"), nullable=True)
    token_hash = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    # result: success | invalid | passcode_failed | rate_limited
    result = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ==========================================
# [Gate #32] PLAN MAP基礎 — route segment
# ==========================================

class RouteSegment(Base):
    """1日の中で連続する2イベント間の移動区間推定。

    [Gate #32 スコープ] 外部ルーティングAPI(Google Directions等)は
    APIキー未提供のため利用しない。距離はhaversine(大円距離)による
    概算のみを保持し、is_estimate=Trueで確定値ではないことを明示する
    (v5.1仕様「計算失敗時は直線距離を確定値にせず概算と明示する」に対応)。
    """
    __tablename__ = "route_segments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False)
    from_event_id = Column(UUID(as_uuid=True), ForeignKey("travel_events.id"), nullable=True)
    to_event_id = Column(UUID(as_uuid=True), ForeignKey("travel_events.id"), nullable=True)
    mode = Column(String, nullable=False)  # walking | driving | transit
    distance_km = Column(Float, nullable=True)
    duration_minutes = Column(Float, nullable=True)
    is_estimate = Column(Boolean, nullable=False, default=True)
    provider = Column(String, nullable=False)  # 例: "haversine_estimate"
    algorithm_version = Column(String, nullable=False)
    computed_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ==========================================
# [Gate R2-7] 監査ログ永続化基盤(audit/metric基盤)
# ==========================================
# docs/trace/gate-r2-trace.md のR2-5行が「未達」としていたaudit/metric基盤。
# backend/app/schemas/schemas.py の AuditLog/AuditLogResponse は既に定義済み
# だったが、対応するDBテーブル・書き込み経路・参照APIが一つも存在しない
# ゴーストスキーマだった(このGateで実体化する)。
#
# 記録方針: ログイン成功/失敗、QuickDraft promote、管理者によるユーザー
# アカウント操作(suspend/unsuspend/verify/unverify)の4系統から書き込む
# (app/services/audit_service.py の record_audit_event() 経由)。
# 書き込み失敗(DB例外等)で本来のリクエスト処理自体を失敗させないよう、
# 呼び出し側は例外を握りつぶして warning ログのみ残す設計とする
# (詳細は audit_service.py 参照)。

class AuditLog(Base):
    """監査ログモデル(schemas.AuditLogに対応する永続化実体)"""
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String, nullable=False, index=True)
    resource_type = Column(String, nullable=False, index=True)
    resource_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


# ==========================================
# [Gate R3-0] 予約管理(FR-010)最小実装
# ==========================================
# DOC-10 FR-010は静的評価「SCAFFOLDED 5%」(itinerary中の任意JSON=booking_url
# 断片のみ)であり、独立clone(HEAD 793c8eb)でのgrep確認でもReservation実体は
# 存在しない「ゴースト」ではなく単純に未着手であることを確認した。
#
# DOC-05 §6.1が定義するreservationsのフル仕様(KMS envelope暗号化・
# blind index、reservation_participants、tickets、import_jobs等)は
# 中〜大規模スコープであり、本Gateでは意図的に以下へ限定する
# (docs/adr/ADR-reservation-minimal.md §4に根拠を記載):
#
# 1. 暗号化はDOC-11本来のKMS envelope encryptionではなく、Gate R2-2の
#    QuickDraft同様 app/core/crypto.py のFernet field encryptionを再利用する
#    (confirmation_number/pinのみ暗号化対象。lookup_hashによる盲検索索引は
#    次Gateスコープ)。
# 2. event_reservations多対多中間表は設けず、reservations.event_idの
#    単一FKに限定する(1予約=最大1イベント紐付け)。複数イベントに跨る
#    予約(例: 連泊で複数日イベントに紐付け)は次Gateスコープ。
# 3. reservation_participants/tickets/import_jobsは対象外(次Gate以降)。
# 4. holder_name/contact_phoneは平文カラムとする(DOC-05は暗号化列を
#    要求するが、氏名・電話は既にevent_reservations経由の共同編集者へ
#    通常表示される情報であり、confirmation_number/pinほどの機微性を
#    持たないと判断。ただし将来の暗号化列追加はadditiveなmigrationで
#    可能な設計としている)。
#
# 権限: SC-11マトリクス(DOC-04)通り、作成・編集・削除はowner/editor、
# 閲覧はviewer以上(ただしviewerへはconfirmation_number/pinをmaskして
# 返す)。maskされた値の完全開示は専用reveal endpointを介し、
# record_audit_event()で監査ログに残す(DOC-05 §18.1 reveal監査要件に対応)。

class ReservationType(str, Enum):
    """DOC-02 FR-010: 宿泊/航空/鉄道/バス/船/レンタカー/飲食/体験/入場/その他。"""
    ACCOMMODATION = "accommodation"
    FLIGHT = "flight"
    TRAIN = "train"
    BUS = "bus"
    FERRY = "ferry"
    RENTAL_CAR = "rental_car"
    RESTAURANT = "restaurant"
    ACTIVITY = "activity"
    ADMISSION = "admission"
    OTHER = "other"


class ReservationStatus(str, Enum):
    """DOC-05 §18.1状態遷移: candidate->confirmed->used、confirmed<->modified、
    confirmed/modified->cancelled、confirmed->no_show。"""
    CANDIDATE = "candidate"
    CONFIRMED = "confirmed"
    MODIFIED = "modified"
    CANCELLED = "cancelled"
    USED = "used"
    NO_SHOW = "no_show"


class Reservation(Base):
    """[Gate R3-0] FR-010予約管理の最小永続モデル。"""
    __tablename__ = "reservations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False, index=True)
    # [Gate R3-0スコープ限定] 単一イベントのみへの紐付け(§上部コメント2参照)。
    event_id = Column(UUID(as_uuid=True), ForeignKey("travel_events.id"), nullable=True, index=True)
    place_id = Column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)

    type = Column(String, nullable=False)  # ReservationType
    status = Column(String, nullable=False, default=ReservationStatus.CONFIRMED.value)
    provider_name = Column(String, nullable=True)

    # 秘密値(Fernet field encryption。app/core/crypto.py参照)。
    confirmation_number_ciphertext = Column(LargeBinary, nullable=True)
    # 一覧・masked表示用の非機微プレフィックス("****1234"形式)。単体では
    # 予約特定に使えない末尾4文字相当のみを平文保持する(DOC-11 §6.3の
    # 盲検索indexとは異なる、表示専用の簡易マスク)。
    confirmation_number_masked = Column(String, nullable=True)
    pin_ciphertext = Column(LargeBinary, nullable=True)

    holder_name = Column(String, nullable=True)
    guest_count = Column(Integer, nullable=True)

    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    timezone_id = Column(String, nullable=True)

    total_amount = Column(Float, nullable=True)
    currency = Column(String(3), nullable=True)
    payment_status = Column(String, nullable=True)

    cancellation_deadline = Column(DateTime(timezone=True), nullable=True)
    contact_phone = Column(String, nullable=True)
    contact_url = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    revision = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    plan = relationship("TravelPlan")
    event = relationship("TravelEvent")

    __table_args__ = (
        Index("ix_reservations_plan_start", "plan_id", "start_at"),
    )


# ==========================================================================
# [Gate R3-3] イベント複数紐付け(event_reservations中間表)
# ==========================================================================
# DOC-05 §6.2: event_id、reservation_id、relation_type(primary/required/
# related)、is_locked。多対多を許容(連泊等で1予約が複数イベントに紐付く
# ケースに対応)。
#
# [スコープ限定/後方互換] Gate R3-0で導入した`Reservation.event_id`
# (単一FK)は本Gateでも削除・非推奨化しない(additive only原則)。
# 既存frontend(ReservationsPage.tsx)やGate R3-0/R3-1のAPIレスポンス
# 形状との互換性を保つため、create/update時にevent_idが設定された
# 場合は自動的にrelation_type="primary"のevent_reservationsリンクを
# 同期作成する(app/api/v1/reservations.pyの_sync_primary_event_link
# 参照)。複数イベントへの追加リンクはevent_reservations専用エンドポイント
# (relation_type="required"/"related")経由でのみ作成する。

class ReservationEventRelationType(str, Enum):
    """DOC-05 §6.2。"""
    PRIMARY = "primary"
    REQUIRED = "required"
    RELATED = "related"


class EventReservation(Base):
    """[Gate R3-3] 予約とイベントの多対多紐付け。"""
    __tablename__ = "event_reservations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("travel_events.id"), nullable=False, index=True)
    reservation_id = Column(UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False, index=True)
    relation_type = Column(String, nullable=False, default=ReservationEventRelationType.PRIMARY.value)
    is_locked = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    event = relationship("TravelEvent")
    reservation = relationship("Reservation")

    __table_args__ = (
        UniqueConstraint("event_id", "reservation_id", name="uq_event_reservations_event_reservation"),
    )


# ==========================================================================
# [Gate R3-1] 予約参加者(reservation_participants)
# ==========================================================================
# DOC-05 §6.3: reservation_id、plan_member_id、name_ciphertext、
# seat_ciphertext、special_request_ciphertext。
#
# [スコープ限定] Gate R3-0のholder_name/contact_phoneと同じ理由により、
# name/seat/special_requestは平文カラムとする(予約閲覧権限を持つ
# 共同編集者へは通常表示される情報であり、confirmation_number/pinほどの
# 機微性を持たないと判断。将来の暗号化列追加はadditive migrationで
# 対応可能な設計としている)。
#
# [スコープ限定] plan_member_idはPlanCollaborator.idへのFK(nullable)と
# する。DOC-05は「plan_member_id」という汎用名だが、本コードベースには
# 独立した`plan_members`テーブルが無く、ownerはTravelPlan.user_id、
# 招待済みメンバーはPlanCollaboratorで表現される(Gate #30)。参加者は
# 必ずしもplanのメンバーとは限らない(例: 同行する未登録の子供・同僚)ため
# nullable(名前のみの参加者も許容)とする。
#
# 権限: DOC-05 §6.3「アクセスは予約権限＋本人条件を評価」とあるが、
# 本人(plan_member)自身によるセルフサービス編集は次Gateスコープとし、
# 本Gateでは予約と同じowner/editor(書き込み)・viewer以上(閲覧)に単純化する。

class ReservationParticipant(Base):
    """[Gate R3-1] 予約参加者(DOC-05 §6.3)。"""
    __tablename__ = "reservation_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    reservation_id = Column(
        UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False, index=True,
    )
    plan_member_id = Column(UUID(as_uuid=True), ForeignKey("plan_collaborators.id"), nullable=True)

    name = Column(String, nullable=False)
    seat = Column(String, nullable=True)
    special_request = Column(Text, nullable=True)

    revision = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    reservation = relationship("Reservation")
    plan_member = relationship("PlanCollaborator")


# ==========================================================================
# [Gate R3-5] チケット(tickets、FR-012 QR・チケット)
# ==========================================================================
# DOC-05 §6.4: id、reservation_id、ticket_type、holder_member_id、
# payload_ciphertext、barcode_format、display_document_id、valid_from/to、
# status、offline_allowed、share_policy、key_version。
#
# [スコープ限定] display_document_id(DOC-05 §6.5 documentsテーブルへの
# 参照。チケット画像そのものを文書として保存するケース)は、documents
# テーブル自体が本コードベースに未実装(FR-013文書ウォレット、次Gate候補)
# のため、本Gateでは外部キー制約無しのnullable UUID列として先行定義する
# のみとする(additive migrationで後日FK制約を追加可能な設計)。DOC-05の
# 制約「payloadまたはdocumentの少なくとも一方」はdisplay_document_idが
# 実質使えない本Gateでは検証しない(payload必須として扱う)。
#
# payload_ciphertext(QR/バーコードの生データ)はGate R2-2/R3-0と同じ
# Fernet field encryptionを再利用する(app/core/crypto.py)。DOC-11本来の
# KMS envelope encryptionへの移行は将来のfollow-upとする(ADR-reservation
# -minimal.md §2と同じ位置づけ)。

class TicketStatus(str, Enum):
    """本Gateで定義する状態(DOC-05に明示のenum値は無いため、DOC-02の
    利用シナリオから妥当な値を採用)。"""
    ACTIVE = "active"
    USED = "used"
    EXPIRED = "expired"
    REVOKED = "revoked"


class TicketSharePolicy(str, Enum):
    """share_policy: チケットpayloadの閲覧可否をどの権限レベルまで
    許容するか。DOC-05は値を明示しないため、既存のowner/editor/viewer
    3区分に合わせて定義する。"""
    OWNER_EDITOR = "owner_editor"  # 既定。owner/editorのみreveal可
    ALL_COLLABORATORS = "all_collaborators"  # viewerも含め全員reveal可


class Ticket(Base):
    """[Gate R3-5] FR-012 QR・チケットの最小永続モデル。"""
    __tablename__ = "tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    reservation_id = Column(UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False, index=True)
    ticket_type = Column(String, nullable=False)  # 例: boarding_pass/entry_ticket/other
    holder_member_id = Column(UUID(as_uuid=True), ForeignKey("plan_collaborators.id"), nullable=True)

    # 秘密値(Fernet field encryption)。QR/バーコードの生データ本体。
    payload_ciphertext = Column(LargeBinary, nullable=True)
    barcode_format = Column(String, nullable=True)  # 例: QR_CODE/CODE128/PDF417
    # [スコープ限定] documentsテーブル未実装のためFK制約は付与しない(上部コメント参照)。
    display_document_id = Column(UUID(as_uuid=True), nullable=True)

    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_to = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default=TicketStatus.ACTIVE.value)
    offline_allowed = Column(Boolean, nullable=False, default=True)
    share_policy = Column(String, nullable=False, default=TicketSharePolicy.OWNER_EDITOR.value)
    key_version = Column(Integer, nullable=False, default=1, server_default="1")

    revision = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    reservation = relationship("Reservation")
    holder_member = relationship("PlanCollaborator")


# ==========================================================================
# [Gate R3-6] 文書ウォレット(documents / document_links、FR-013)
# ==========================================================================
# DOC-05 §6.5/§6.6: documents(id、plan_id、owner_user_id、classification、
# document_type、original_filename_ciphertext、storage_key、mime_type、
# size、sha256、encryption_key_ref、malware_status、ocr_status、
# retention_until、created_at、deleted_at)、document_links(document_id、
# entity_type/id、relation_type(original/receipt/ticket/map/attachment)、
# display_order)。
#
# [スコープ限定] 本コードベースにはObject Storage連携(DOC-08 §4.3)が
# 一切存在しない(S3等のクライアント・署名URL発行・malwareスキャン
# provider・OCR providerのいずれも未導入)。そのため本Gateでは:
# - 実ファイルバイト列は一切扱わない(DOC-05 §20「大容量原本はDBへ
#   格納せずObject keyとhashだけ保持」の方針通り、storage_keyは呼び出し側
#   が別途アップロード済みのオブジェクトキーをそのまま渡す前提とする。
#   DOC-06 §9の`POST /plans/{id}/documents/uploads`(署名URL発行)は
#   Object Storage未導入のため実装しない。将来的にObject Storageを
#   導入する際にこのGateのAPIを置き換える)。
# - malware_status/ocr_statusはクライアント入力を受け付けず、常に
#   "not_scanned"/"not_requested"で作成する(スキャナ・OCR未導入のため。
#   将来のバッチジョブがこれらの状態を更新する想定)。
# - encryption_key_ref(DOC-11 §6.3 envelope encryptionのKMS参照)は
#   KMS未導入のためnullable、常にNULLとする(Gate R2-2/R3-0と同じ
#   Fernet対称鍵暗号化をoriginal_filenameへ適用するのみ)。

class DocumentClassification(str, Enum):
    """DOC-11 §2 データ分類。"""
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"


class DocumentMalwareStatus(str, Enum):
    NOT_SCANNED = "not_scanned"  # [スコープ限定] 本Gateでは常にこの値
    CLEAN = "clean"
    INFECTED = "infected"
    QUARANTINED = "quarantined"


class DocumentOcrStatus(str, Enum):
    NOT_REQUESTED = "not_requested"  # [スコープ限定] 本Gateでは常にこの値
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class DocumentLinkRelationType(str, Enum):
    """DOC-05 §6.6。"""
    ORIGINAL = "original"
    RECEIPT = "receipt"
    TICKET = "ticket"
    MAP = "map"
    ATTACHMENT = "attachment"


class Document(Base):
    """[Gate R3-6] FR-013文書ウォレットの最小永続モデル(メタデータのみ)。"""
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False, index=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    classification = Column(String, nullable=False, default=DocumentClassification.INTERNAL.value)
    document_type = Column(String, nullable=True)  # 例: receipt/ticket/passport/map/other(自由記述)

    # 秘密値(Fernet field encryption)。ファイル名自体が機微な情報を
    # 含みうるため暗号化する(DOC-05 §6.5)。
    original_filename_ciphertext = Column(LargeBinary, nullable=True)

    storage_key = Column(String, nullable=False)  # [スコープ限定] 呼び出し側が別途アップロード済みの参照
    mime_type = Column(String, nullable=True)
    size = Column(Integer, nullable=True)  # バイト数
    sha256 = Column(String(64), nullable=True)
    encryption_key_ref = Column(String, nullable=True)  # [スコープ限定] KMS未導入のため常にNULL

    malware_status = Column(String, nullable=False, default=DocumentMalwareStatus.NOT_SCANNED.value)
    ocr_status = Column(String, nullable=False, default=DocumentOcrStatus.NOT_REQUESTED.value)
    retention_until = Column(DateTime(timezone=True), nullable=True)

    revision = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    plan = relationship("TravelPlan")
    owner = relationship("User")


class DocumentLink(Base):
    """[Gate R3-6] 文書と他エンティティ(予約・チケット・イベント等)の
    紐付け(DOC-05 §6.6)。entity_id はポリモーフィックのためFK制約を
    持たない(entity_typeごとにAPI側で存在検証する)。"""
    __tablename__ = "document_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, index=True)
    entity_type = Column(String, nullable=False)  # 例: reservation/ticket/event/attachment
    entity_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    relation_type = Column(String, nullable=False, default=DocumentLinkRelationType.ATTACHMENT.value)
    display_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("Document")


# ==========================================================================
# [Gate R3-7] 予約取込(import_jobs / extraction_candidates、FR-011)
# ==========================================================================
# DOC-05 §6.7: import_jobs(ジョブ状態、provider、原本、モデル、同意、
# 開始終了、エラー)、extraction_candidates(field_path、
# candidate_value_ciphertext、confidence、evidence_locator、
# review_status、reviewed_by/at)。DOC-05 §18.2状態遷移:
# uploaded -> scanning -> extracting -> review_required -> confirmed/rejected。
# 「確定前に本テーブルからドメインへ反映しない」(§6.7)。
#
# [スコープ限定] 本コードベースにはAI/OCR providerが一切導入されて
# いない(DOC-08 §3のImage/OCR行はPillow/OpenCV + provider adapterを
# 候補としているのみで未実装)。そのため本Gateでは:
# - `uploaded -> scanning -> extracting`の自動遷移(実際のOCR/AI抽出)を
#   実装しない。ジョブは作成時点で直接`review_required`となり、
#   候補(extraction_candidates)は利用者自身が(実質的に手動転記として)
#   登録する運用とする(DOC-02「AIは提案と抽出を行うが…重要変更を無確認で
#   実行しない」の「無確認で実行しない」部分、すなわち人間レビュー必須
#   という制約は本Gateでも厳格に維持する。AIによる自動生成が無いだけ)。
# - `quarantined`(malware検知)/`retry_wait`(provider障害)は対応する
#   provider自体が無いため本Gateでは到達しない状態として定義だけ残す。
# - `confirmed`確定時、review_status="accepted"の候補のみをReservation
#   フィールドへ反映する(DOC-05 §6.7の「確定前に反映しない」を実装で
#   保証。confirm操作自体がowner/editor限定かつ監査ログ必須)。

class ImportJobStatus(str, Enum):
    """DOC-05 §18.2。本Gateではuploaded/scanning/extractingへの自動遷移は
    発生しない(スコープ限定、上部コメント参照)。ジョブはreview_required
    として作成される。"""
    UPLOADED = "uploaded"
    SCANNING = "scanning"
    EXTRACTING = "extracting"
    REVIEW_REQUIRED = "review_required"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    QUARANTINED = "quarantined"
    RETRY_WAIT = "retry_wait"
    FAILED = "failed"


class ExtractionCandidateReviewStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ImportJob(Base):
    """[Gate R3-7] FR-011予約取込ジョブの最小永続モデル。"""
    __tablename__ = "import_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("travel_plans.id"), nullable=False, index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # [スコープ限定] providerは常に"manual"(AI/OCR provider未導入のため)。
    provider = Column(String, nullable=False, default="manual")
    status = Column(String, nullable=False, default=ImportJobStatus.REVIEW_REQUIRED.value)
    consent_given = Column(Boolean, nullable=False, default=False)
    error_message = Column(Text, nullable=True)

    # 確定時に生成されたReservationへの参照(confirm操作で設定)。
    result_reservation_id = Column(UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=True)

    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    plan = relationship("TravelPlan")
    document = relationship("Document")
    result_reservation = relationship("Reservation")


class ExtractionCandidate(Base):
    """[Gate R3-7] 抽出候補(DOC-05 §6.7)。確定前はドメインへ一切反映
    されない。candidate_valueはGate R2-2/R3-0と同じFernet field
    encryptionで保護する(confirmation_number等の機微情報を含みうる)。"""
    __tablename__ = "extraction_candidates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    import_job_id = Column(UUID(as_uuid=True), ForeignKey("import_jobs.id"), nullable=False, index=True)

    field_path = Column(String, nullable=False)  # 例: "type"/"confirmation_number"/"start_at"
    candidate_value_ciphertext = Column(LargeBinary, nullable=False)
    confidence = Column(Float, nullable=False, default=1.0)  # [スコープ限定] 手動入力のため既定1.0
    evidence_locator = Column(String, nullable=True)  # 例: 原本内の参照(ページ番号等の自由記述)

    review_status = Column(String, nullable=False, default=ExtractionCandidateReviewStatus.PENDING.value)
    reviewed_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    import_job = relationship("ImportJob")
    reviewed_by = relationship("User")
