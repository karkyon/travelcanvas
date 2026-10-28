"""
TravelCanvas Database Models - 最終完成版
統一されたBaseクラスを使用、重複定義なし
"""
import uuid
from decimal import Decimal
from typing import Any, Optional
from datetime import date, datetime, timedelta
from sqlalchemy import (
    SmallInteger,
    Integer, String, Float, Boolean, DateTime, Date, Text, JSON,
    ForeignKey, UniqueConstraint, LargeBinary, Index, CheckConstraint, text,
    Numeric, BigInteger,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    username: Mapped[Optional[str]] = mapped_column(String, unique=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[Optional[str]] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)      # ← 認証で必要
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)     # ← 管理者権限
    role: Mapped[str] = mapped_column(String, default="user", nullable=True)
    user_type: Mapped[str] = mapped_column(String, default="registered", nullable=True)  # ← ユーザータイプ
    preferences: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    # [Gate G7] FR-039 猶予つきのアカウント削除。申し込んだ時刻と削除する時刻(この間は取り消せる。
    # 時刻を過ぎたら定期の処理 tcops.py jobs account-deletions が削除する。app/services/account_deletion.py)
    deletion_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deletion_due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("(deletion_requested_at IS NULL) = (deletion_due_at IS NULL)",
                        name="ck_users_deletion_schedule"),
        Index("ix_users_deletion_due_at", "deletion_due_at", postgresql_where=text("deletion_due_at IS NOT NULL")),
    )

    # リレーションシップ
    travels = relationship("Travel", back_populates="owner")
    travel_plans = relationship("TravelPlan", back_populates="user", foreign_keys="TravelPlan.user_id")
    sessions = relationship("UserSession", back_populates="user")
    created_spots = relationship("Spot", back_populates="creator")


class UserSession(Base):
    """ユーザーセッションモデル"""
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    session_token: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=True)
    device_info: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    # リレーションシップ
    user = relationship("User", back_populates="sessions")


class UserMfa(Base):
    """[Gate S11] SEC-06 多要素認証(TOTP)の設定。1人1行。

    totp_secret_ciphertext は ENCRYPTION_KEY で暗号化した秘密(base32)。confirmed_at が NULL の間は
    設定の途中(認証アプリへの登録を確かめる前)で、ログインには使わない。回復コードはハッシュだけを持つ。"""
    __tablename__ = "user_mfa"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    method: Mapped[str] = mapped_column(String(8), nullable=False, default="totp", server_default="totp")
    totp_secret_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_step: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    recovery_code_hashes: Mapped[Any] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    recovery_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (CheckConstraint("method IN ('totp')", name="ck_user_mfa_method"),)


class Travel(Base):
    """旅行モデル"""
    __tablename__ = "travels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title: Mapped[Optional[str]] = mapped_column(String, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    location: Mapped[Optional[str]] = mapped_column(String)
    duration: Mapped[Optional[int]] = mapped_column(Integer)  # days
    estimated_cost: Mapped[Optional[float]] = mapped_column(Float)
    optimized_route: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    optimization_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    transport_modes: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    waypoints: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    preferences: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)

    # 外部キー
    owner_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # タイムスタンプ
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    # リレーションシップ
    owner = relationship("User", back_populates="travels")
    optimization_results = relationship("OptimizationResult", back_populates="travel")


class TravelPlan(Base):
    """旅行プランモデル"""
    __tablename__ = "travel_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    destination: Mapped[Optional[str]] = mapped_column(String)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    budget: Mapped[Optional[float]] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String, default="draft", nullable=True)
    preferences: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    itinerary: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    # [Gate #29] 楽観的並行制御用のリビジョン番号。/plans系の新エンドポイントの
    # 更新・削除・並べ替えはこの値をIf-Matchヘッダーで要求し、一致しない場合は
    # 409を返す。更新の度に加算される。既存の/travel-plansエンドポイント
    # (itinerary JSONベース)は当面この値を変更しない(後方互換維持のため)。
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    # [Gate G2] FR-045 参加者(編集者・閲覧者)に隠す項目の、役割ごとの既定。NULL は何も隠さない(本Gate以前と同じ)
    member_field_policy: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    # [Gate B-012] 2段階削除。DELETEで論理削除(deleted_at)し、purge_after(既定30日後)を
    # 過ぎたらapp/services/plan_deletion.pyの完全削除で子データごと物理削除する。
    # 論理削除中はrequire_plan_access等で存在しないもの(404)として扱う。
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    purge_after: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate G11] 表紙の写真(同じ旅行の kind=photo の記録。記録が消えたら NULL)と、見せる位置(%)・拡大(%)。
    # 見えるかどうかは記録の公開範囲で決まる(app/services/plan_cover.py)。PUT /travel-plans では変えない
    cover_memory_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("memories.id", ondelete="SET NULL", use_alter=True,
                                       name="fk_travel_plans_cover_memory"), nullable=True)
    cover_focus_x: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50, server_default="50")
    cover_focus_y: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50, server_default="50")
    cover_zoom: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=100, server_default="100")

    __table_args__ = (
        CheckConstraint(
            "(deleted_at IS NULL AND purge_after IS NULL) OR (deleted_at IS NOT NULL AND purge_after IS NOT NULL)",
            name="ck_travel_plans_deleted_consistency",
        ),
        Index("ix_travel_plans_purge_after", "purge_after", postgresql_where=text("deleted_at IS NOT NULL")),
        CheckConstraint("cover_focus_x BETWEEN 0 AND 100 AND cover_focus_y BETWEEN 0 AND 100",
                        name="ck_travel_plans_cover_focus"),
        CheckConstraint("cover_zoom BETWEEN 100 AND 300", name="ck_travel_plans_cover_zoom"),
        Index("ix_travel_plans_cover_memory", "cover_memory_id", postgresql_where=text("cover_memory_id IS NOT NULL")),
    )

    # リレーションシップ
    user = relationship("User", back_populates="travel_plans", foreign_keys=[user_id])
    # [Gate B-012] passive_deletes: プランの物理削除はDBのON DELETE CASCADEに任せる
    # (ORMが子を1件ずつ消すと、プラン内の横の参照の検査順で失敗するため)
    share_links = relationship(
        "PlanShareLink", back_populates="plan", cascade="all, delete-orphan", passive_deletes=True,
    )
    collaborators = relationship(
        "PlanCollaborator", back_populates="plan", cascade="all, delete-orphan", passive_deletes=True,
    )
    days = relationship(
        "TravelDay", back_populates="plan", cascade="all, delete-orphan", order_by="TravelDay.sort_order",
        passive_deletes=True,
    )


class PlanShareLink(Base):
    """旅行プラン共有リンクモデル

    [Gate #30] トークンの生値はDBに平文保存しない(監査指摘)。生成時に
    一度だけ生値を発行し、DBにはSHA-256ハッシュ(token_hash)のみを保存
    する。token_prefixは一覧画面でリンクを識別するための非秘匿な表示用
    先頭数文字(単体では推測に使えない長さ)。
    """
    __tablename__ = "plan_share_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    permission: Mapped[str] = mapped_column(String, default="view", nullable=True)  # view | edit
    passcode_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    # [Gate F45] FR-045 項目単位の共有の規則({"version":1,"fields":[...],"preset":...})。
    # NULL は本Gate以前のリンク(=標準の項目)。app/services/share_policy.py が正本。
    policy: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    # [Gate G4] COL-05 受け取った人が、許可された項目だけを自分の旅行へ複製してよい(所有者が選ぶ。既定は不可)
    allow_clone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # [Gate G4] FC-097 失効の理由(owner / admin_abuse など。所有者の失効は NULL のまま)
    revoked_reason: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    # リレーションシップ
    plan = relationship("TravelPlan", back_populates="share_links")


class PlanCollaborator(Base):
    """旅行プランコラボレーターモデル"""
    __tablename__ = "plan_collaborators"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    email: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="viewer", nullable=True)  # viewer | editor | owner
    status: Mapped[str] = mapped_column(String, default="pending", nullable=True)  # pending | accepted | declined
    invite_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    # [Gate #30] 招待された側がaccept/declineした日時。pending中はNULL。
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate G2] FR-045 この参加者だけに適用する項目の規則({"version":1,"hidden":[...]})。
    # NULL は役割の既定(travel_plans.member_field_policy)に従う。app/services/member_policy.py が正本。
    field_policy: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)

    # リレーションシップ
    plan = relationship("TravelPlan", back_populates="collaborators")
    user = relationship("User")


class Notification(Base):
    """通知モデル"""
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    related_plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="SET NULL"), nullable=True)
    # [Gate G4] COL-03 コメントの対象(予定・予約・費用・投票)へ移るため。本文は入れない
    target_type: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    target_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    # リレーションシップ
    user = relationship("User")
    related_plan = relationship("TravelPlan")


class OptimizationResult(Base):
    """最適化結果モデル"""
    __tablename__ = "optimization_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    travel_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("travels.id"))
    optimization_type: Mapped[Optional[str]] = mapped_column(String)
    original_data: Mapped[Optional[Any]] = mapped_column(JSON)
    optimized_data: Mapped[Optional[Any]] = mapped_column(JSON)
    improvement_metrics: Mapped[Optional[Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

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
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(50), nullable=False, default="other")

    # 位置情報（MVP版：手動入力）
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # MVPメタデータ
    rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 1-5評価
    price_range: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # $, $$, $$$

    # 画像（MVP版：URL文字列）
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # ユーザー関連
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=True)

    # 統計
    visit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=True)

    # タイムスタンプ
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    # リレーションシップ
    creator = relationship("User", back_populates="created_spots")


class UserSpotFavorite(Base):
    """ユーザーお気に入りスポット - MVP版"""
    __tablename__ = "user_spot_favorites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    spot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("spots.id"), nullable=False)

    # 個人メモ
    personal_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    personal_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    spot_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("spots.id"), nullable=False)

    # 訪問メモ
    visit_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    visited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    # [Gate #37] Visited Area Layer: GPS自動判定による訪問記録に対応する。
    # 既存の手動記録行はsource='manual'のまま(server_defaultにより後方互換)。
    # confidence/detected_accuracy_metersは手動記録では常にNULL。
    source: Mapped[str] = mapped_column(String, nullable=False, server_default="manual")
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    detected_accuracy_meters: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    timezone_id: Mapped[str] = mapped_column(String, nullable=False, default="UTC")
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    day_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_days.id", ondelete="CASCADE"), nullable=False)
    spot_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("spots.id"), nullable=True)
    # [Gate #32] このイベントがcandidate/place(Gate #31正規化検索結果)から
    # 採用されたものであれば、そのPlaceを参照する(出典追跡・地図上の
    # candidate<->event紐付けのため)。手動作成されたイベントはNULL。
    place_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)

    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False, default="activity")

    start_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    local_start_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # "HH:MM" 表示用
    is_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # 最適化対象から除外
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # [Gate G11] 予定のカードの写真(同じ旅行の kind=photo の記録。記録が消えたら NULL)
    image_memory_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("memories.id", ondelete="SET NULL", use_alter=True,
                                       name="fk_travel_events_image_memory"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    day = relationship("TravelDay", back_populates="events")


class EventLink(Base):
    """イベントへの補助的な関連情報(メモ/URL等)。将来の文書・予約テーブルへの
    参照はsource_type/source_idの汎用形で拡張する想定。"""
    __tablename__ = "event_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", ondelete="CASCADE"), nullable=False)
    link_type: Mapped[str] = mapped_column(String, nullable=False)  # note | url | other
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)


class PlanVersion(Base):
    """プラン全体の論理版。変更が確定するたびに1行追加する。"""
    __tablename__ = "plan_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("plan_id", "revision", name="uq_plan_versions_plan_revision"),
    )


class ChangeSet(Base):
    """1回の変更操作(作成/更新/削除/並べ替え/Undo)の単位。"""
    __tablename__ = "change_sets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # manual|optimization|replan|import|undo
    source: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    base_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    undone_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    items = relationship("ChangeItem", back_populates="change_set", cascade="all, delete-orphan")


class ChangeItem(Base):
    """ChangeSet内の個別エンティティ差分。Undo時にafter->beforeへ戻す。"""
    __tablename__ = "change_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    change_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("change_sets.id", ondelete="CASCADE"), nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)  # travel_day | travel_event
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)  # create | update | delete | reorder
    before_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    after_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    change_set = relationship("ChangeSet", back_populates="items")


# [Gate G10-Q] 下の IdempotencyRecord.payload_hash の既定値が読むため、クラスより前に置く
_LEGACY_PAYLOAD_HASH_SENTINEL = b"\x00" * 32


class IdempotencyRecord(Base):
    """[Gate #29 / Gate R2-1改訂] Idempotency-Keyによる重複実行防止。
    R2-1でanonymous device(匿名端末)actorにも対応し、payload hash比較・
    処理中(IN_PROGRESS)状態・TTLを追加した。既存user経由の呼び出し(plans.py等)
    はpayload_hash/status/expires_atを明示せずINSERTしているため、Python側
    default(下記_LEGACY_PAYLOAD_HASH_SENTINEL/_default_idempotency_expiry)で
    後方互換を保つ。詳細はdocs/adr/ADR-quick-draft.md参照。"""
    __tablename__ = "idempotency_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    key: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    device_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("devices.id"), nullable=True)
    endpoint: Mapped[str] = mapped_column(String, nullable=False)
    payload_hash: Mapped[bytes] = mapped_column(
        LargeBinary(32), nullable=False, default=lambda: _LEGACY_PAYLOAD_HASH_SENTINEL)
    status: Mapped[str] = mapped_column(String, nullable=False, default="COMPLETED")  # IN_PROGRESS/COMPLETED/FAILED
    response_status: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    response_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    error_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: _default_idempotency_expiry())

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    token_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_default_device_expiry)

    quick_drafts = relationship("QuickDraft", back_populates="device")


class QuickDraft(Base):
    """[Gate R2-1] DOC-06 `POST /v1/quick-drafts` の正式永続モデル。
    作成・promote APIの実装はGate R2-2/R2-3で行う(本Gateはスキーマのみ)。"""
    __tablename__ = "quick_drafts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id"), nullable=False, index=True)
    payload_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String, nullable=False, default=QuickDraftStatus.ACTIVE.value)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_default_quick_draft_expiry)
    promoted_plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    query: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)  # wikipedia | nominatim | overpass
    external_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    raw_payload: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    searched_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    source_records = relationship(
        "SourceRecord", back_populates="candidate", cascade="all, delete-orphan"
    )


class Place(Base):
    """候補(Candidate)をユーザーが採用(adopt)して確定した正規の場所。"""
    __tablename__ = "places"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    adopted_from_candidate_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("search_candidates.id"), nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # [Gate C2] FR-008 場所の一元管理(DOC-02 FR-008、DOC-04 SC-09)。項目ごとの出典は field_sources
    aliases: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)            # 別名の一覧
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    entrance_note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # 入口(駅の改札・施設の入口・ロビー・駐車場など)
    floor: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    reservation_required: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # NULL = 分からない
    price_range: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    accessibility_note: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    closed_days: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    candidate_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("search_candidates.id"), nullable=True)
    place_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    freshness_state: Mapped[str] = mapped_column(String, nullable=False, default="fresh")  # fresh | stale | expired
    raw_response: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    candidate = relationship("SearchCandidate", back_populates="source_records")
    place = relationship("Place")


class FieldSource(Base):
    """Placeの個々のフィールドがどのSourceRecordに由来するかを記録する。
    1つのPlaceの複数フィールドが異なるproviderに由来するケースを表現できる。"""
    __tablename__ = "field_sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    field_name: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source_records.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    place = relationship("Place", back_populates="field_sources")
    source_record = relationship("SourceRecord")


class OpeningHours(Base):
    """[Gate #31 スコープ] モデルのみ新設。providerからの自動取得・
    populateは次Gate以降(Overpassのopening_hoursタグ解析等)。"""
    __tablename__ = "opening_hours"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=月 ... 6=日
    open_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # "09:00"
    close_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # "18:00"
    # [Gate G4] MAP-02 最終入場・ラストオーダー("HH:MM"。無ければ閉じる時刻まで)
    last_entry: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    last_order: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    source_record_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source_records.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    place = relationship("Place", back_populates="opening_hours")


# ==========================================
# [Gate #31.5B] 共有リンクアクセス監査ログ
# ==========================================
# 公開共有リンク解決(未認証)への全アクセス試行を記録する。誰が(IPアドレス)
# ・いつ・どの結果(成功/失効/期限切れ/上限到達/パスコード誤り/レート制限)
# でアクセスしたかを追跡できるようにし、不正利用の調査を可能にする。
# tokenの生値は記録しない(token_hashのみ)。

class PlaceSpecialHours(Base):
    """[Gate G4] MAP-02 日付ごとの例外の営業(臨時休業・祝日・年末年始・特別営業)。その日は曜日の営業時間より優先する。

    kind = closed(その日は休み。時刻なし)/ open(その日だけの営業時間。1日に3つまで)。"""
    __tablename__ = "place_special_hours"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("places.id", ondelete="CASCADE"), nullable=False, index=True)
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    open_time: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    close_time: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    last_entry: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    last_order: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    source_record_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source_records.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('closed', 'open')", name="ck_place_special_hours_kind"),
        CheckConstraint("(kind = 'closed') = (open_time IS NULL AND close_time IS NULL)",
                        name="ck_place_special_hours_times"),
        Index("ix_place_special_hours_place_date", "place_id", "local_date"),
    )


class PlaceEntrance(Base):
    """[Gate G4] MAP-02 入口(正面・裏口・駐車場・駅の出口など)。地点(座標)を別に持てる。"""
    __tablename__ = "place_entrances"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("places.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    accessible: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # 段差なしで入れるか(NULL = 分からない)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_record_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source_records.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)


class ShareAccessLog(Base):
    """公開共有リンクへのアクセス試行監査ログ"""
    __tablename__ = "share_access_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    share_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plan_share_links.id", ondelete="SET NULL"), nullable=True)
    token_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # result: success | invalid | passcode_failed | rate_limited
    result: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)


# ==========================================
# [Gate #32→M1] PLAN移動区間 — TravelSegment (旧RouteSegment)
# ==========================================

class TravelSegment(Base):
    """[Gate M1] FR-014 移動区間(DOC-05 §7.1 travel_segments)。

    Gate #32では`RouteSegment`/`route_segments`という名称で「1日の中で
    連続する2イベント間の移動区間の(haversine概算による)推定」のみを
    持っていた。Gate M1でDOC-05 §7.1の正式仕様に合わせて`TravelSegment`/
    `travel_segments`へrenameし、Event/Place双方を端点に取れるようにし、
    計画出発・到着、費用、準備・余裕時間、便名、platform、乗換、荷物条件、
    予約紐付け、状態、revisionを追加した(docs/adr/ADR-travel-segment.md
    参照)。table renameはexpand migrationとし、既存行のID・値は保持する
    (drop/recreateしない)。

    端点(from/to)はEvent/Placeのどちらか一方のみを指す(XOR)。DB CHECK
    制約`ck_travel_segments_from_endpoint_xor`/`..._to_endpoint_xor`で
    強制する(migration側)。
    """
    __tablename__ = "travel_segments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    from_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", deferrable=True, initially="IMMEDIATE"), nullable=True)
    from_place_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)
    to_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", deferrable=True, initially="IMMEDIATE"), nullable=True)
    to_place_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)

    # walking | driving | train | bus | ferry | flight | bicycle | taxi | mixed
    mode: Mapped[str] = mapped_column(String, nullable=False)
    # planned | confirmed | cancelled
    status: Mapped[str] = mapped_column(String, nullable=False, default="planned", server_default="planned")

    planned_departure_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_arrival_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    distance_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # [Gate M1] 金額はFloatではなくNumericで保持する(DOC-03の金額精度規約)。
    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)

    preparation_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    buffer_before_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    buffer_after_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    transport_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 便名・列車番号等
    platform: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    transfer_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    luggage_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    reservation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id", deferrable=True, initially="IMMEDIATE"), nullable=True)

    # [Gate M3] FR-015複数経路比較。採用されたRouteOption(候補)への参照。
    # additive(nullable)。route_optionsテーブルはGate M3で新設したため、
    # Gate M1時点ではこの列を先行追加しなかった(ADR-travel-segment.md
    # 「参照先tableが無い状態でFKなしのUUID列だけ先行追加しない」を参照)。
    route_option_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("route_options.id", deferrable=True, initially="IMMEDIATE"), nullable=True)

    # [Gate #32から継続] haversine fallback由来かどうかの由来管理(provenance)。
    # [Gate G7] MOVE-03 最終の便(終電・最終のバス・船の最終便)の出発時刻。利用者が入れる(時刻表の提供元は未接続)。
    # 実行可能性の判定が、この時刻までに出発できるかを確かめる(LAST_TRANSPORT_MISSED / LAST_TRANSPORT_TIGHT)
    last_departure_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    is_estimate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    provider: Mapped[str] = mapped_column(String, nullable=False)  # "haversine_estimate" | "manual" 等
    algorithm_version: Mapped[str] = mapped_column(String, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())


# 後方互換エイリアス(Gate #32時点のimport元を壊さないため)。
# 新規コードはTravelSegmentを使うこと。
RouteSegment = TravelSegment


# ==========================================
# [Gate M3] FR-015 複数経路比較 — RouteOption / RouteLeg
# ==========================================

class RouteOption(Base):
    """[Gate M3] FR-015 複数経路比較(DOC-05 §7.2 route_options)。

    TravelSegment(FR-014、採用済みの移動区間)とは異なり、RouteOptionは
    「まだ採用されていない候補」を表す。同一のfrom/to端点に対して複数の
    RouteOptionを作成・比較し(最速/最安/乗換少/徒歩少/バリアフリー/景観/
    環境負荷等)、ユーザーが選んだ1件をTravelSegmentとして採用する
    (`POST .../route-options/{id}/adopt`。採用後はTravelSegment.
    route_option_idが本テーブルの行を指す)。

    外部ルーティングAPIは未導入のため、本Gateでは`provider="manual"`
    (手動登録、DOC-02 FR-015「ルート取得不能時は手動区間を登録できる」)
    のみをサポートする。将来、外部providerを追加する場合も
    provider列で区別できるよう設計している。
    """
    __tablename__ = "route_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)

    from_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", deferrable=True, initially="IMMEDIATE"), nullable=True)
    from_place_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)
    to_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", deferrable=True, initially="IMMEDIATE"), nullable=True)
    to_place_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)

    # candidate | adopted | discarded
    status: Mapped[str] = mapped_column(String, nullable=False, default="candidate", server_default="candidate")

    # [Gate M3] DOC-02 FR-015の比較軸。全て概算・推定であり確定値ではない。
    total_duration_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)
    total_distance_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    walking_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    transfer_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    accessibility_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0.0-1.0、高いほどバリアフリー
    scenic_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0.0-1.0、高いほど景観が良い
    co2_estimate_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # [Gate M3] DOC-02「外部経路値には提供元、取得時刻、推定幅を保存する」。
    duration_estimate_low_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration_estimate_high_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    provider: Mapped[str] = mapped_column(String, nullable=False)  # "manual" 等
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_estimate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    algorithm_version: Mapped[str] = mapped_column(String, nullable=False)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class RouteLeg(Base):
    """[Gate M3] FR-015複数経路比較(DOC-05 §7.2 route_legs)。RouteOption
    内の個別の乗り継ぎ区間(徒歩→鉄道→徒歩、のような複合交通の1ステップ)。
    順序はleg_orderで保持する。

    from/to はEvent/Placeのような正式なエンティティへの参照ではなく、
    自由記述のラベル(例: "渋谷駅"、"3番出口")とする。経路候補の途中
    経由地はTravelEvent/Placeとして正式登録されているとは限らないため。
    """
    __tablename__ = "route_legs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    route_option_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("route_options.id", ondelete="CASCADE"), nullable=False, index=True)

    leg_order: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String, nullable=False)
    line: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 路線名
    operator: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 事業者
    platform: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    from_label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    to_label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    departure_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    arrival_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    distance_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    duration_minutes: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # unknown | on_time | delayed | cancelled。外部providerからのリアルタイム
    # 運行情報は本Gateでは未導入のため、常にunknownとなる(捏造しない)。
    realtime_status: Mapped[str] = mapped_column(String, nullable=False, default="unknown", server_default="unknown")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("route_option_id", "leg_order", name="uq_route_legs_option_order"),
    )


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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String, nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    details: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=True)


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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    # [Gate R3-0スコープ限定] 単一イベントのみへの紐付け(§上部コメント2参照)。
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", deferrable=True, initially="IMMEDIATE"), nullable=True,
        index=True)
    place_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=True)

    type: Mapped[str] = mapped_column(String, nullable=False)  # ReservationType
    status: Mapped[str] = mapped_column(String, nullable=False, default=ReservationStatus.CONFIRMED.value)
    provider_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # 秘密値(Fernet field encryption。app/core/crypto.py参照)。
    confirmation_number_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    # 一覧・masked表示用の非機微プレフィックス("****1234"形式)。単体では
    # 予約特定に使えない末尾4文字相当のみを平文保持する(DOC-11 §6.3の
    # 盲検索indexとは異なる、表示専用の簡易マスク)。
    confirmation_number_masked: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # [Gate R3-13] DOC-11 §6.3 / DOC-08 §19 blind index。confirmation_number
    # (暗号化フィールド)に対する完全一致検索のためのHMAC-SHA256決定的ハッシュ
    # (app/core/crypto.py compute_lookup_hash参照)。LOOKUP_INDEX_KEYで導出し、
    # ENCRYPTION_KEYとは異なる鍵を使う(用途別鍵分離)。APIレスポンスには
    # 一切含めない(内部的な検索索引専用)。
    confirmation_number_lookup_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    # [Gate R3-14] DOC-04 SC-10/SC-17・POC-03対応。末尾4文字専用のHMAC blind
    # index(app/core/crypto.py compute_suffix_lookup_hash参照)。上の完全一致用
    # lookup_hashとは別列・別ドメインのHMAC値であり、混同できない。
    confirmation_number_suffix_lookup_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    pin_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    # [Gate R3-16] holder_name平文列はDOC-11 §14 expand/contractのcontract
    # フェーズとして削除した(Gate R3-8のコメントを参照。以前はここに
    # `holder_name = Column(String, nullable=True)` が存在した)。
    # holder_name_ciphertextのみが正本となる。
    holder_name_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    guest_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    start_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    timezone_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    total_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)
    payment_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    cancellation_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate R3-16] contact_phone平文列も同様にcontract済み(削除)。
    contact_phone_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    contact_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_events.id", deferrable=True, initially="IMMEDIATE"), nullable=False,
        index=True)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True)
    relation_type: Mapped[str] = mapped_column(
        String, nullable=False, default=ReservationEventRelationType.PRIMARY.value)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

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
# [Gate R3-8で解消] Gate R3-0時点ではname/seat/special_requestを平文
# カラムとするスコープ限定を行っていたが、本Gateで暗号化列を追加した
# (下記ReservationParticipantクラス参照)。
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_member_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plan_collaborators.id", deferrable=True, initially="IMMEDIATE"), nullable=True)

    # [Gate R3-16] name/seat/special_requestの平文列はDOC-11 §14
    # expand/contractのcontractフェーズとして削除した(Gate R3-8時点では
    # ここに`name`/`seat`/`special_request`平文Columnが存在した)。
    # *_ciphertext列のみが正本となる。

    # [Gate R3-8] Gate R2-2/R3-0と同じFernet field encryption。
    name_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    seat_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    special_request_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    # [Gate R3-15] DOC-11 §6.3 blind index。nameに対する完全一致検索用の
    # HMAC-SHA256(app/core/crypto.py compute_participant_name_lookup_hash
    # 参照)。confirmation_number用lookup_hashとは別ドメインのHMAC値。
    name_lookup_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    reservation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_type: Mapped[str] = mapped_column(String, nullable=False)  # 例: boarding_pass/entry_ticket/other
    holder_member_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plan_collaborators.id", deferrable=True, initially="IMMEDIATE"), nullable=True)

    # 秘密値(Fernet field encryption)。QR/バーコードの生データ本体。
    payload_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    barcode_format: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 例: QR_CODE/CODE128/PDF417
    # [スコープ限定] documentsテーブル未実装のためFK制約は付与しない(上部コメント参照)。
    display_document_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    valid_from: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default=TicketStatus.ACTIVE.value)
    offline_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    share_policy: Mapped[str] = mapped_column(String, nullable=False, default=TicketSharePolicy.OWNER_EDITOR.value)
    key_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

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


class DocumentPurgeStatus(str, Enum):
    """[Gate M7] soft delete後の実storage file purgeの進捗状態。
    P0-04是正: DELETE後もstorage file自体は残ったままだった問題への対応。
    pending: 未purge(未削除、または削除試行前/再試行待ち)。
    purged: storage file削除試行が成功(ファイル不在も成功扱い、idempotent)。
    failed: 直近の削除試行が失敗し再試行待ち(app/services/document_purge_service.py参照)。
    """
    PENDING = "pending"
    PURGED = "purged"
    FAILED = "failed"


class Document(Base):
    """[Gate R3-6] FR-013文書ウォレットの最小永続モデル(メタデータのみ)。"""
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    classification: Mapped[str] = mapped_column(String, nullable=False, default=DocumentClassification.INTERNAL.value)
    # 例: receipt/ticket/passport/map/other(自由記述)
    document_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # 秘密値(Fernet field encryption)。ファイル名自体が機微な情報を
    # 含みうるため暗号化する(DOC-05 §6.5)。
    original_filename_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    storage_key: Mapped[str] = mapped_column(String, nullable=False)  # [スコープ限定] 呼び出し側が別途アップロード済みの参照
    mime_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # バイト数
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    encryption_key_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # [スコープ限定] KMS未導入のため常にNULL

    malware_status: Mapped[str] = mapped_column(String, nullable=False, default=DocumentMalwareStatus.NOT_SCANNED.value)
    ocr_status: Mapped[str] = mapped_column(String, nullable=False, default=DocumentOcrStatus.NOT_REQUESTED.value)
    retention_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # [Gate M7] P0-04是正: soft delete後の実storage file purgeを再試行可能に
    # 追跡するための状態列(app/services/document_purge_service.py参照)。
    purge_status: Mapped[str] = mapped_column(
        String, nullable=False, default=DocumentPurgeStatus.PENDING.value, server_default="pending")

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    plan = relationship("TravelPlan")
    owner = relationship("User")


class DocumentLink(Base):
    """[Gate R3-6] 文書と他エンティティ(予約・チケット・イベント等)の
    紐付け(DOC-05 §6.6)。entity_id はポリモーフィックのためFK制約を
    持たない(entity_typeごとにAPI側で存在検証する)。"""
    __tablename__ = "document_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)  # 例: reservation/ticket/event/attachment
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    relation_type: Mapped[str] = mapped_column(
        String, nullable=False, default=DocumentLinkRelationType.ATTACHMENT.value)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", deferrable=True, initially="IMMEDIATE"), nullable=True)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # [スコープ限定] providerは常に"manual"(AI/OCR provider未導入のため)。
    provider: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String, nullable=False, default=ImportJobStatus.REVIEW_REQUIRED.value)
    consent_given: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 確定時に生成されたReservationへの参照(confirm操作で設定)。
    result_reservation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reservations.id", deferrable=True, initially="IMMEDIATE"), nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    plan = relationship("TravelPlan")
    document = relationship("Document")
    result_reservation = relationship("Reservation")


class ExtractionCandidate(Base):
    """[Gate R3-7] 抽出候補(DOC-05 §6.7)。確定前はドメインへ一切反映
    されない。candidate_valueはGate R2-2/R3-0と同じFernet field
    encryptionで保護する(confirmation_number等の機微情報を含みうる)。"""
    __tablename__ = "extraction_candidates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    import_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("import_jobs.id", ondelete="CASCADE"), nullable=False, index=True)

    field_path: Mapped[str] = mapped_column(String, nullable=False)  # 例: "type"/"confirmation_number"/"start_at"
    candidate_value_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)  # [スコープ限定] 手動入力のため既定1.0
    evidence_locator: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 例: 原本内の参照(ページ番号等の自由記述)

    review_status: Mapped[str] = mapped_column(
        String, nullable=False, default=ExtractionCandidateReviewStatus.PENDING.value)
    reviewed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    import_job = relationship("ImportJob")
    reviewed_by = relationship("User")


# ==========================================================================
# [Gate L2] 制約(constraints、FR-016 制約管理 / DOC-05 §7.3)
# ==========================================================================
# DOC-05 §7.3: id、plan_id、owner_member_id、scope_type/id、type、hardness、
# operator、value_ciphertext/json、weight、privacy_level、active_from/to、
# reason_ciphertext、revision。
# DOC-05 §17: hardness=hardの場合weight不要、privacy=privateならowner_member必須。
# DOC-05 §19: constraints.reasonは分類R(本人のみ表示、AI禁止)。
#
# [スコープ限定] plan_membersテーブルは本コードベースに存在しない(招待は
# plan_collaborators、所有者はtravel_plans.user_id)。そのためowner_member_id
# の代わりにowner_user_id(作成者=本人)を必須列として持つ(privateの
# 「owner必須」は常に満たされる)。
#
# privacy_level:
#   shared  … 題名(title)・値(value_json)を平文列に持ち、プランのメンバー全員が
#              詳細を閲覧できる。
#   private … 題名・値を平文列に一切持たず、value_ciphertext(Fernet)だけに持つ。
#              詳細は作成者本人のみ(プラン所有者にも見せない。FR-016「秘匿制約は
#              詳細非表示のまま判定へ使う」/ DOC-06 §21「Constraint private: 本人」)。
# reason_ciphertext … privacy_levelに関係なく常に暗号化し、作成者本人のみ閲覧可。
#
# scope_id … scope_typeがday/event/memberの場合の対象ID。day/eventは削除され得る
# ため外部キーにしない(書込時にプラン所属を検証し、読出時に存在しなければ
# scope_missingとして返す)。
class PlanConstraint(Base):
    """[Gate L2] 旅行の制約(ハード/ソフト、共有/秘匿)。"""
    __tablename__ = "constraints"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    scope_type: Mapped[str] = mapped_column(String(10), nullable=False)
    scope_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    constraint_type: Mapped[str] = mapped_column(String(30), nullable=False)
    hardness: Mapped[str] = mapped_column(String(4), nullable=False)
    operator: Mapped[str] = mapped_column(String(12), nullable=False)
    weight: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    privacy_level: Mapped[str] = mapped_column(String(7), nullable=False, default="shared")

    # shared時のみ使用(private時はNULL)
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # none_as_null=True: Python の None を JSON の null ではなく SQL の NULL として書く
    # (既定の JSON 型は 'null' という値を保存し、private時の CHECK に違反する)。
    value_json: Mapped[Optional[Any]] = mapped_column(JSON(none_as_null=True), nullable=True)
    # private時のみ使用: {"title": ..., "value": {...}} をFernetで暗号化したもの
    value_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    reason_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    active_from: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    active_to: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate C1] FR-023 秘匿プロフィールから作った制約の印(プロフィールの項目の ID)。プロフィールの変更で作り直す
    profile_item_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    plan = relationship("TravelPlan")
    owner = relationship("User")

    __table_args__ = (
        CheckConstraint("scope_type IN ('plan','day','event','member')", name="ck_constraints_scope_type"),
        CheckConstraint("(scope_type = 'plan') = (scope_id IS NULL)", name="ck_constraints_scope_id"),
        CheckConstraint("hardness IN ('hard','soft')", name="ck_constraints_hardness"),
        CheckConstraint(
            "(hardness = 'hard' AND weight IS NULL) OR "
            "(hardness = 'soft' AND weight IS NOT NULL AND weight BETWEEN 1 AND 100)",
            name="ck_constraints_weight",
        ),
        CheckConstraint("privacy_level IN ('shared','private')", name="ck_constraints_privacy_level"),
        CheckConstraint(
            "(privacy_level = 'private' AND value_ciphertext IS NOT NULL AND title IS NULL AND value_json IS NULL)"
            " OR (privacy_level = 'shared' AND value_ciphertext IS NULL AND title IS NOT NULL)",
            name="ck_constraints_privacy_payload",
        ),
        CheckConstraint(
            "active_from IS NULL OR active_to IS NULL OR active_from < active_to",
            name="ck_constraints_active_window",
        ),
        Index("ix_constraints_plan_deleted", "plan_id", "deleted_at"),
    )


# ==========================================================================
# [Gate L3] 実行可能性検証(validation_runs / validation_issues、FR-017 / DOC-05 §7.4)
# ==========================================================================
# DOC-05 §7.4: 入力revision、情報鮮度、実行時刻、結果。issueはcode、severity、
# entity、message_key、evidence_json、suggestion_json、resolved_at。
#
# - 検証1回分をスナップショットとして保存する(旅程を変えたら再検証する。
#   resolved_atは持たず、再検証で消えたものが解消済み)。
# - kind: violation(違反) / unverified(情報不足で検証できない)。
#   「検証不能を問題なしにしない」(FR-017)ため、unverifiedを別枠で数える。
# - 秘匿制約に関する問題は、制約の値を message / evidence / suggestion に
#   一切保存しない(作成者本人には読出時に制約APIと同じ規則で題名を付ける)。
class ValidationRun(Base):
    """[Gate L3] 実行可能性検証の1回分。"""
    __tablename__ = "validation_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    input_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    # 旅程・制約・予約・区間の版の組み合わせのハッシュ。現在値と違えば結果は古い(is_stale)。
    input_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    algorithm_version: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    info_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unverified_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # {"unchecked": {...件数}, "constraint_results": [{"constraint_id","status"}]}
    summary_json: Mapped[Any] = mapped_column(JSON, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    issues = relationship(
        "ValidationIssue", back_populates="run", cascade="all, delete-orphan",
        order_by="ValidationIssue.sort_order",
    )

    __table_args__ = (
        CheckConstraint("status IN ('completed','failed')", name="ck_validation_runs_status"),
        Index("ix_validation_runs_plan_created", "plan_id", "created_at"),
    )


class ValidationIssue(Base):
    """[Gate L3] 検証で見つかった問題(違反または検証不能)。"""
    __tablename__ = "validation_issues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("validation_runs.id", ondelete="CASCADE"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    severity: Mapped[str] = mapped_column(String(7), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    entity_label: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    day_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    constraint_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("constraints.id", ondelete="CASCADE"), nullable=True)
    constraint_owner_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    is_private_constraint: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    evidence_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    suggestion_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)

    run = relationship("ValidationRun", back_populates="issues")

    __table_args__ = (
        CheckConstraint("kind IN ('violation','unverified')", name="ck_validation_issues_kind"),
        CheckConstraint("severity IN ('ERROR','WARNING','INFO')", name="ck_validation_issues_severity"),
        CheckConstraint(
            "is_private_constraint = false OR (constraint_id IS NOT NULL AND constraint_owner_user_id IS NOT NULL)",
            name="ck_validation_issues_private_owner",
        ),
        Index("ix_validation_issues_run", "run_id", "sort_order"),
    )


# ==========================================================================
# [Gate P1] 持ち物(FR-025)・準備タスク(FR-026)
# ==========================================================================
# DOC-05 §8.5 packing_items / preparation_tasks。レディネス(準備状況、FR-026)は
# 保存せず、予約・持ち物・タスクから都度算出する読み取りモデル
# (app/services/readiness.py)。

class PackingItem(Base):
    """[Gate P1] 持ち物。共有(shared)はメンバー全員、個人(personal)は作成者本人だけに見える。

    個人の持ち物は薬・健康用品などを含み得るため(FC-070「本人限定」)、名前とメモを
    平文列に持たず payload_ciphertext(Fernet)だけに保存する。
    """
    __tablename__ = "packing_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    scope: Mapped[str] = mapped_column(String(8), nullable=False, default="shared")
    # 共有の持ち物の担当者(メンバーのユーザーID)。メンバーから外れた担当者は未割当として扱う。
    assignee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # shared時のみ使用(personal時はNULL)
    name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # personal時のみ使用: {"name": ..., "note": ...} をFernetで暗号化したもの
    payload_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)

    category: Mapped[str] = mapped_column(String(20), nullable=False, default="other")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # to_prepare(未準備) / to_buy(要購入) / packed(梱包済み) / after_use(使用後・片付け済み)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="to_prepare")
    # manual(手入力) / suggested(候補から採用)。採用した候補の識別子を残し、旅程変更時に
    # 「もう不要かもしれない」候補を判定する。
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")
    suggestion_key: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("scope IN ('shared','personal')", name="ck_packing_items_scope"),
        CheckConstraint(
            "(scope = 'personal' AND payload_ciphertext IS NOT NULL AND name IS NULL AND note IS NULL"
            " AND assignee_user_id IS NULL)"
            " OR (scope = 'shared' AND payload_ciphertext IS NULL AND name IS NOT NULL)",
            name="ck_packing_items_scope_payload",
        ),
        CheckConstraint(
            "category IN ('clothing','toiletries','health','documents','electronics','money','gear','other')",
            name="ck_packing_items_category",
        ),
        CheckConstraint("quantity BETWEEN 1 AND 999", name="ck_packing_items_quantity"),
        CheckConstraint(
            "status IN ('to_prepare','to_buy','packed','after_use')", name="ck_packing_items_status",
        ),
        CheckConstraint("source IN ('manual','suggested')", name="ck_packing_items_source"),
        CheckConstraint(
            "(source = 'suggested') = (suggestion_key IS NOT NULL)", name="ck_packing_items_suggestion_key",
        ),
        Index("ix_packing_items_plan_deleted", "plan_id", "deleted_at"),
        Index(
            "uq_packing_items_shared_suggestion", "plan_id", "suggestion_key", unique=True,
            postgresql_where=text("deleted_at IS NULL AND scope = 'shared' AND suggestion_key IS NOT NULL"),
        ),
        Index(
            "uq_packing_items_personal_suggestion", "plan_id", "owner_user_id", "suggestion_key", unique=True,
            postgresql_where=text("deleted_at IS NULL AND scope = 'personal' AND suggestion_key IS NOT NULL"),
        ),
    )


class PreparationTask(Base):
    """[Gate P1] 準備タスク(FR-026)。完了条件・担当者・期限を持つ。

    readiness_key はレディネスの項目(例: 予約が無い宿泊予定)から作ったタスクの識別子。
    同じ項目のタスクが完了していれば、その項目は「対応済み」として一覧から外れる
    (例: 予約不要と確認した)。
    """
    __tablename__ = "preparation_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    assignee_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    completion_criteria: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # open(未完了) / done(完了)
    status: Mapped[str] = mapped_column(String(4), nullable=False, default="open")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # 関連する対象(外部キーにしない。対象の個別削除を妨げないため。表示時に存在を確認する)
    related_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    related_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    readiness_key: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('open','done')", name="ck_preparation_tasks_status"),
        CheckConstraint(
            "(status = 'done') = (completed_at IS NOT NULL)", name="ck_preparation_tasks_completed",
        ),
        CheckConstraint(
            "related_type IS NULL OR related_type IN ('event','reservation','segment','document','packing_item')",
            name="ck_preparation_tasks_related_type",
        ),
        CheckConstraint(
            "(related_type IS NULL) = (related_id IS NULL)", name="ck_preparation_tasks_related_pair",
        ),
        Index("ix_preparation_tasks_plan_deleted", "plan_id", "deleted_at"),
        Index(
            "uq_preparation_tasks_readiness_key", "plan_id", "readiness_key", unique=True,
            postgresql_where=text("deleted_at IS NULL AND readiness_key IS NOT NULL"),
        ),
    )


# ==========================================================================
# [Gate P2] 予算・費用(FR-027)・立替・精算(FR-028)
# ==========================================================================
# DOC-05 §8.6 budgets / expenses / expense_shares / settlements。金額はNumeric(Decimal)と
# ISO 4217通貨コードで保持し(NFR-006)、丸め差は分担行の rounding_adjustment に明示する。
# 換算レートは利用者が入力する(外部の為替providerは未接続)。レートの無い外貨の支出は
# 基準通貨へ換算せず(base_amount NULL)、集計から除外したことを件数で示す(EX-013)。

class PlanFinanceSettings(Base):
    """[Gate P2] プランの基準通貨(予算・集計・精算の通貨)。行が無ければJPYとして扱う。"""
    __tablename__ = "plan_finance_settings"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), primary_key=True)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="JPY")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # [Gate G5] FIN-02 端数の規則と精算の締め
    rounding_mode: Mapped[str] = mapped_column(String(8), nullable=False, default="half_up", server_default="half_up")
    remainder_to: Mapped[str] = mapped_column(String(8), nullable=False, default="largest", server_default="largest")
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("base_currency ~ '^[A-Z]{3}$'", name="ck_plan_finance_settings_currency"),
        CheckConstraint("rounding_mode IN ('half_up', 'down', 'up')", name="ck_plan_finance_settings_rounding"),
        CheckConstraint("remainder_to IN ('largest', 'payer', 'first')", name="ck_plan_finance_settings_remainder"),
        Index("ix_fk_plan_finance_settings_locked_by_user_id", "locked_by_user_id"),
    )


class FxRate(Base):
    """[Gate G5] FIN-01 為替レートの記録(1 currency あたりの base_currency 額)。出典・取得時刻・基準日を持ち、
    支出は使ったレートを fx_rate_id で指す(後でレートを足しても過去の換算は変わらない)。"""
    __tablename__ = "fx_rates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    rate_date: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("rate > 0", name="ck_fx_rates_rate"),
        CheckConstraint("currency ~ '^[A-Z]{3}$' AND base_currency ~ '^[A-Z]{3}$' AND currency <> base_currency",
                        name="ck_fx_rates_currency"),
        Index("ix_fx_rates_lookup", "plan_id", "currency", "base_currency", "rate_date"),
    )


class BudgetVersion(Base):
    """[Gate G5] FIN-01 予算の版(当初 initial・更新 revised・確定 committed・実績 actual)。作った時点の写しで、上書きしない。

    lines は [{key, label, amount}](基準通貨)、unconverted は換算できなかった金額の通貨ごとの合計
    (基準通貨の合計に混ぜない)。"""
    __tablename__ = "budget_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(9), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    lines: Mapped[Any] = mapped_column(JSON, nullable=False)
    unconverted: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('initial', 'revised', 'committed', 'actual')", name="ck_budget_versions_kind"),
    )


class Budget(Base):
    """[Gate P2] 予算。kind=total(旅行全体)/category(カテゴリ別)/day(日別)/member(個人)。

    個人の予算(FC-055 個人の秘匿上限)は本人だけに見え、金額を amount_ciphertext だけに保存する
    (DOC-05 §19 budgets.private_limit = R、本人)。それ以外は基準通貨の amount を平文で持つ。
    """
    __tablename__ = "budgets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    local_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    member_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    amount_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('total','category','day','member')", name="ck_budgets_kind"),
        CheckConstraint(
            "(kind = 'total' AND category IS NULL AND local_date IS NULL AND member_user_id IS NULL)"
            " OR (kind = 'category' AND category IS NOT NULL AND local_date IS NULL AND member_user_id IS NULL)"
            " OR (kind = 'day' AND category IS NULL AND local_date IS NOT NULL AND member_user_id IS NULL)"
            " OR (kind = 'member' AND category IS NULL AND local_date IS NULL AND member_user_id IS NOT NULL)",
            name="ck_budgets_kind_target",
        ),
        CheckConstraint(
            "(kind = 'member' AND amount IS NULL AND amount_ciphertext IS NOT NULL)"
            " OR (kind <> 'member' AND amount IS NOT NULL AND amount >= 0 AND amount_ciphertext IS NULL)",
            name="ck_budgets_amount",
        ),
        Index("ix_budgets_plan_deleted", "plan_id", "deleted_at"),
    )


class Expense(Base):
    """[Gate P2] 支出(実費)または返金。返金(kind=refund)は元の支出を参照し、集計では差し引く。

    amount は支出した通貨(currency)の金額(税・手数料込み)。tax_amount / fee_amount は内訳。
    fx_rate は 1 currency あたりの基準通貨額(利用者入力)。base_amount = amount × fx_rate を
    基準通貨の最小単位へ丸めた値で、換算できない(レート未入力の外貨)場合はNULL。
    関連する予約・予定・領収書(文書)は外部キーにしない(個別削除を妨げないため。表示時に存在を確認する)。
    """
    __tablename__ = "expenses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(7), nullable=False, default="expense")
    refund_of_expense_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="other")
    local_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    tax_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    fee_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    fx_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 8), nullable=True)
    fx_source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    fx_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    base_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    paid_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    split_method: Mapped[str] = mapped_column(String(6), nullable=False, default="equal")
    related_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    related_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    receipt_document_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # [Gate G5] FIN-01 使ったレートの記録、FIN-02 取消(消さずに集計から外す)
    fx_rate_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fx_rates.id", ondelete="SET NULL"), nullable=True)
    voided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    void_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    voided_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    shares = relationship(
        "ExpenseShare", back_populates="expense", cascade="all, delete-orphan", passive_deletes=True,
        order_by="ExpenseShare.sort_order",
    )

    __table_args__ = (
        CheckConstraint("kind IN ('expense','refund')", name="ck_expenses_kind"),
        CheckConstraint("(kind = 'refund') = (refund_of_expense_id IS NOT NULL)", name="ck_expenses_refund_ref"),
        CheckConstraint("amount >= 0", name="ck_expenses_amount"),
        CheckConstraint("tax_amount IS NULL OR (tax_amount >= 0 AND tax_amount <= amount)", name="ck_expenses_tax"),
        CheckConstraint("fee_amount IS NULL OR (fee_amount >= 0 AND fee_amount <= amount)", name="ck_expenses_fee"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_expenses_currency"),
        CheckConstraint("fx_rate IS NULL OR fx_rate > 0", name="ck_expenses_fx_rate"),
        CheckConstraint("(fx_rate IS NULL) = (base_amount IS NULL)", name="ck_expenses_base_amount"),
        CheckConstraint(
            "category IN ('lodging','transport','food','activity','shopping','fee','cancellation','other')",
            name="ck_expenses_category",
        ),
        CheckConstraint("split_method IN ('equal','ratio','amount','none')", name="ck_expenses_split_method"),
        CheckConstraint(
            "related_type IS NULL OR related_type IN ('event','reservation','segment')",
            name="ck_expenses_related_type",
        ),
        CheckConstraint("(related_type IS NULL) = (related_id IS NULL)", name="ck_expenses_related_pair"),
        CheckConstraint("(voided_at IS NULL) = (void_reason IS NULL)", name="ck_expenses_void"),
        Index("ix_expenses_plan_deleted", "plan_id", "deleted_at"),
        Index("ix_fk_expenses_fx_rate_id", "fx_rate_id"),
        Index("ix_fk_expenses_voided_by_user_id", "voided_by_user_id"),
    )


class ExpenseShare(Base):
    """[Gate P2] 支出の負担者ごとの負担額。合計は支出額と必ず一致する(丸め差は rounding_adjustment に明示)。"""
    __tablename__ = "expense_shares"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    expense_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    weight: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 4), nullable=True)
    share_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    base_share_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 2), nullable=True)
    rounding_adjustment: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0, server_default="0")

    expense = relationship("Expense", back_populates="shares")

    __table_args__ = (
        UniqueConstraint("expense_id", "user_id", name="uq_expense_shares_expense_user"),
        CheckConstraint("share_amount >= 0", name="ck_expense_shares_amount"),
        CheckConstraint("base_share_amount IS NULL OR base_share_amount >= 0", name="ck_expense_shares_base"),
        CheckConstraint("weight IS NULL OR weight > 0", name="ck_expense_shares_weight"),
        Index("ix_expense_shares_expense", "expense_id", "sort_order"),
    )


class Settlement(Base):
    """[Gate P2] メンバー間の精算(from が to へ基準通貨で支払った記録)。"""
    __tablename__ = "settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    from_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    to_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    settled_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # [Gate G5] FIN-02 二重の記録の防止

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_settlements_amount"),
        CheckConstraint("from_user_id <> to_user_id", name="ck_settlements_parties"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_settlements_currency"),
        Index("ix_settlements_plan_deleted", "plan_id", "deleted_at"),
        Index("uq_settlements_idempotency", "plan_id", "created_by_user_id", "idempotency_key", unique=True,
              postgresql_where=text("idempotency_key IS NOT NULL")),
    )


# ==========================================================================
# [Gate P3] 合意形成(FR-022)・コメント(FR-024)
# ==========================================================================
# DOC-05 §8.4 votes / concerns / comments。投票は「選択肢ごとに Love/OK/懸念/不可/棄権」を
# メンバーが1票ずつ入れる。懸念・不可は理由を必須にし、解決(resolved_at)の履歴を持つ(FC-066)。
# 対象(予定など)は外部キーにしない(予定の個別削除(B-013)を妨げないため。表示時に存在を確認する)。

class Poll(Base):
    """[Gate P3] 投票(候補の比較・決定)。veto_policy で「不可」の扱いを旅行ごとに決める(拒否権の濫用対策)。"""
    __tablename__ = "polls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    deadline_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(6), nullable=False, default="open")
    # block: 不可1票で不成立(理由必須) / block_with_alternative: 不可には理由と代替案が必須 /
    # advisory: 不可も参考意見として扱い、不成立にしない
    veto_policy: Mapped[str] = mapped_column(String(24), nullable=False, default="block")
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    decided_option_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate G4] COL-02 決定に要る回答者の数(NULL は制限なし)・締切の理由・締切前の知らせ・採用(予定への反映)
    quorum: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    closed_reason: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # manual / deadline / decided
    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    adopted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    adopted_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    adopted_change_set_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("change_sets.id", ondelete="SET NULL"), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    options = relationship(
        "PollOption", back_populates="poll", cascade="all, delete-orphan", passive_deletes=True,
        order_by="PollOption.sort_order",
    )

    __table_args__ = (
        CheckConstraint("status IN ('open','closed')", name="ck_polls_status"),
        CheckConstraint("(status = 'closed') = (closed_at IS NOT NULL)", name="ck_polls_closed_at"),
        CheckConstraint(
            "veto_policy IN ('block','block_with_alternative','advisory')", name="ck_polls_veto_policy",
        ),
        Index("ix_polls_plan_deleted", "plan_id", "deleted_at"),
    )


class PollOption(Base):
    """[Gate P3] 投票の選択肢。予定(event_id)を候補にする場合は外部キーにせず、表示時に存在を確認する。"""
    __tablename__ = "poll_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("polls.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    # [Gate G4] COL-02 候補箱の候補を選択肢にする(採用すると予定に置く)
    candidate_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plan_candidates.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    poll = relationship("Poll", back_populates="options")

    __table_args__ = (Index("ix_poll_options_poll", "poll_id", "sort_order"),)


class Vote(Base):
    """[Gate P3] 選択肢へのメンバーの回答。懸念・不可は理由必須で、解決の記録を持つ(FC-066)。"""
    __tablename__ = "votes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("polls.id", ondelete="CASCADE"), nullable=False)
    option_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("poll_options.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    value: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    alternative: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolution_note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("option_id", "user_id", name="uq_votes_option_user"),
        CheckConstraint("value IN ('love','ok','concern','veto','abstain')", name="ck_votes_value"),
        CheckConstraint(
            "value NOT IN ('concern','veto') OR reason IS NOT NULL", name="ck_votes_reason_required",
        ),
        CheckConstraint(
            "resolved_at IS NULL OR value IN ('concern','veto')", name="ck_votes_resolution_kind",
        ),
        Index("ix_votes_poll", "poll_id"),
    )


class Comment(Base):
    """[Gate P3] コメント(FR-024)。プラン・予定・予約・投票・支出に付ける。返信はparent_idでつなぐ。

    削除は論理削除で、スレッドの形を保つため本文だけを返さなくする。メンションした相手には、本文を含まない通知を送る
    (通知本文に予約番号や健康情報を含めない)。
    """
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    target_type: Mapped[str] = mapped_column(String(12), nullable=False, default="plan")
    target_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[Optional[Any]] = mapped_column(JSON(none_as_null=True), nullable=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="open")
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "target_type IN ('plan','event','reservation','poll','expense')", name="ck_comments_target_type",
        ),
        CheckConstraint("(target_type = 'plan') = (target_id IS NULL)", name="ck_comments_target_id"),
        CheckConstraint("status IN ('open','resolved')", name="ck_comments_status"),
        CheckConstraint("char_length(body) BETWEEN 1 AND 2000", name="ck_comments_body_length"),
        Index("ix_comments_plan_target", "plan_id", "target_type", "target_id"),
    )


class BookletExport(Base):
    """[Gate P4] しおり・印刷版の版(FR-034/035/046、DOC-05 export_jobs の成果物なし版)。

    PDF・印刷物そのものはサーバーに保存しない。ブラウザが同じ構造化データ(しおり投影)から
    Web表示・印刷・PDF保存を行う。ここには「どの設定で、どの版番号を、どの旅程revisionから作ったか」、
    作成時点の投影(暗号化)、機密情報を含む版の透かし・有効期限・失効を記録する。
    """
    __tablename__ = "booklet_exports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    format: Mapped[str] = mapped_column(String(5), nullable=False, default="print")
    theme: Mapped[str] = mapped_column(String(12), nullable=False, default="simple")
    density: Mapped[str] = mapped_column(String(7), nullable=False, default="normal")
    sections: Mapped[Any] = mapped_column(JSON, nullable=False)
    includes: Mapped[Any] = mapped_column(JSON, nullable=False)
    contains_sensitive: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false"))
    watermark_text: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    valid_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    input_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(20), nullable=False)
    # 作成時点のしおり投影(JSON)を暗号化して保持する(版は作成後に変わらない)。失効時に消去する。
    snapshot_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    status: Mapped[str] = mapped_column(String(7), nullable=False, default="active")
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("plan_id", "version_no", name="uq_booklet_exports_plan_version"),
        CheckConstraint("format IN ('web','print')", name="ck_booklet_exports_format"),
        CheckConstraint(
            "theme IN ('cute','simple','family','school','business','accessible','mono')",
            name="ck_booklet_exports_theme",
        ),
        CheckConstraint("density IN ('normal','compact')", name="ck_booklet_exports_density"),
        CheckConstraint("status IN ('active','revoked')", name="ck_booklet_exports_status"),
        CheckConstraint("(status = 'revoked') = (revoked_at IS NOT NULL)", name="ck_booklet_exports_revoked_at"),
        CheckConstraint(
            "(status = 'active') = (snapshot_ciphertext IS NOT NULL)", name="ck_booklet_exports_snapshot",
        ),
        CheckConstraint(
            "NOT contains_sensitive OR (watermark_text IS NOT NULL AND valid_until IS NOT NULL)",
            name="ck_booklet_exports_sensitive_guard",
        ),
        CheckConstraint("version_no >= 1", name="ck_booklet_exports_version_no"),
    )


class ItineraryBranch(Base):
    """[Gate P7] What-if・旅程ブランチ(FR-019、DOC-05 §7.6 itinerary_branches)。

    本案(正本の予定)を壊さずに、雨天・遅延・欠席・予算・体力などの想定で予定を組み替えた案を保存する。
    base_snapshot は作成時点の本案の予定、content は分岐案の予定。採用時は
    「分岐案での変更(base_snapshot→content の差分)」を現在の本案へ1つの変更セットとして適用する(Undo可能)。
    """
    __tablename__ = "itinerary_branches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scenario_type: Mapped[str] = mapped_column(String(10), nullable=False, default="custom")
    assumptions: Mapped[Any] = mapped_column(JSON, nullable=False)
    base_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    base_snapshot: Mapped[Any] = mapped_column(JSON, nullable=False)
    content: Mapped[Any] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="draft")
    adopted_change_set_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("change_sets.id", ondelete="SET NULL"), nullable=True)
    adopted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    adopted_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # [Gate G8] FR-019 案の中で予約・移動区間そのものを変える分岐(branch-v2)。NULL は予定だけの案(G7 まで)。
    # {"base": {"segments": [...], "reservations": [...]}, "segments": [変更], "reservations": [変更]}。
    # base は変更を初めて保存した時の本案の区間・予約(三方向の取り込みの基準)。予約は外部へ取消・変更を送らない
    # (取消は「手続きの準備」を作るだけ。app/services/branch_resources.py)
    resources: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "scenario_type IN ('rain','delay','absence','budget','fatigue','custom')",
            name="ck_itinerary_branches_scenario",
        ),
        CheckConstraint("status IN ('draft','adopted','discarded')", name="ck_itinerary_branches_status"),
        CheckConstraint("(status = 'adopted') = (adopted_at IS NOT NULL)", name="ck_itinerary_branches_adopted_at"),
        CheckConstraint("char_length(title) BETWEEN 1 AND 200", name="ck_itinerary_branches_title"),
        Index("ix_itinerary_branches_plan_deleted", "plan_id", "deleted_at"),
    )


class PlanAlert(Base):
    """[Gate P10] 旅程に影響する出来事(FR-030 外部状況、DOC-04 SC-24、DOC-13 AlertReceived)。

    遅延・運休/欠航・休業/中止・天候を、利用者の報告(user_report)または登録済み経路の運行状態(route_status)から登録する。
    情報源(source/source_label)・取得時刻(observed_at)・確度(confidence)を必ず持ち、古い情報を現在値のように見せない。
    影響を受ける予定・日(event_id/day_id)には外部キーを張らない(B-013の個別削除を妨げないため。使う時に存在を確認する)。
    """
    __tablename__ = "plan_alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    source: Mapped[str] = mapped_column(String(12), nullable=False, default="user_report")
    source_label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    confidence: Mapped[str] = mapped_column(String(9), nullable=False, default="reported")
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    day_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    delay_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="active")
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("kind IN ('delay','cancellation','closure','weather')", name="ck_plan_alerts_kind"),
        CheckConstraint("source IN ('user_report','route_status')", name="ck_plan_alerts_source"),
        CheckConstraint("confidence IN ('confirmed','reported')", name="ck_plan_alerts_confidence"),
        CheckConstraint("status IN ('active','resolved','dismissed')", name="ck_plan_alerts_status"),
        CheckConstraint("(status = 'active') = (resolved_at IS NULL)", name="ck_plan_alerts_resolved_at"),
        CheckConstraint(
            "delay_minutes IS NULL OR delay_minutes BETWEEN 15 AND 720", name="ck_plan_alerts_delay_minutes",
        ),
        CheckConstraint(
            "(kind IN ('delay','cancellation')) = (delay_minutes IS NOT NULL)", name="ck_plan_alerts_delay_kind",
        ),
        CheckConstraint("event_id IS NOT NULL OR day_id IS NOT NULL", name="ck_plan_alerts_target"),
        Index("ix_plan_alerts_plan_status", "plan_id", "status"),
    )


class Replan(Base):
    """[Gate P10] 安全な再計画(FR-031、DOC-13 ReplanReady/ReplanApplied)。

    アラートを起点に、守る予定(確定・予約付き)を動かさない代わりの案A/Bを作る(candidates)。承認されるまで本案は変えない。
    承認時は base_revision が本案の現在のrevisionと一致する場合だけ、選んだ案を1つの変更セット(source=replan)として適用する
    (本案の「元に戻す」で取り消せる)。本案がその後変わっていれば古い案として適用を止める(黙って上書きしない)。
    """
    __tablename__ = "replans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plan_alerts.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    base_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    base_snapshot: Mapped[Any] = mapped_column(JSON, nullable=False)
    candidates: Mapped[Any] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="proposed")
    applied_candidate: Mapped[Optional[str]] = mapped_column(String(1), nullable=True)
    applied_change_set_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("change_sets.id", ondelete="SET NULL"), nullable=True)
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('proposed','applied','rejected')", name="ck_replans_status"),
        CheckConstraint(
            "(status = 'applied') = (applied_at IS NOT NULL AND applied_candidate IS NOT NULL)",
            name="ck_replans_applied",
        ),
        CheckConstraint("applied_candidate IS NULL OR applied_candidate IN ('A','B')", name="ck_replans_candidate"),
        Index("ix_replans_plan_alert", "plan_id", "alert_id"),
    )


class SyncOperation(Base):
    """[Gate P11] オフラインで行った操作の受領記録(FR-033、DOC-06 §30、DOC-13 Operation ID)。

    端末が付けた operation_id を利用者ごとに一意とし、同じ操作の再送は記録した結果を返す(二重に適用しない)。
    競合(conflicted)は、操作した利用者が「サーバーの内容を残す」か「自分の変更を使う」で解決するまで残す。
    temp_id は端末で作った予定の仮のIDで、作成が適用された後は同じ端末の後続の操作から本当のIDへ対応付ける。
    予定(entity_id)には外部キーを張らない(B-013の個別削除を妨げないため。使う時に存在を確認する)。
    """
    __tablename__ = "sync_operations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    operation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    device_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # [Gate G6] OFF-02 対象: event(予定)・day(日程)・order(日程の中の予定の並び)・reservation(常にオンラインへ)
    entity_type: Mapped[str] = mapped_column(String(16), nullable=False, default="event")
    action: Mapped[str] = mapped_column(String(8), nullable=False)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    temp_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    base_revision: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fields: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    client_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(15), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    conflict: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    resulting_revision: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "operation_id", name="uq_sync_operations_user_operation"),
        CheckConstraint("entity_type IN ('event', 'day', 'order', 'reservation')",
                        name="ck_sync_operations_entity_type"),
        CheckConstraint("action IN ('create', 'update', 'delete', 'reorder')", name="ck_sync_operations_action"),
        CheckConstraint(
            "status IN ('applied','conflicted','rejected','resolved_mine','resolved_server')",
            name="ck_sync_operations_status",
        ),
        CheckConstraint(
            "(status IN ('resolved_mine','resolved_server')) = (resolved_at IS NOT NULL)",
            name="ck_sync_operations_resolved_at",
        ),
        Index("ix_sync_operations_plan_user_status", "plan_id", "user_id", "status"),
        Index("ix_sync_operations_plan_user_temp", "plan_id", "user_id", "temp_id"),
    )


class Memory(Base):
    """[Gate P12] FR-037 写真・メモ・旅行記(DOC-04 SC-28、DOC-14 §4.5 MEMORY)。

    予定・日・日時・場所へ、文章のメモ・写真・音声メモ・動画の参照(URL)を紐付ける。
    - 写真・音声のファイルは文書と同じ保存先へ暗号化して保存する(storage_key は API が作り、利用者からは受け取らない)。
    - 公開範囲(visibility): private=書いた本人だけ(既定、DOC-11 Privacy by Default)/ members=旅行のメンバー。
    - 予定・日(event_id/day_id)には外部キーを張らない(B-013の個別削除を妨げないため。使う時に存在を確認する)。
    - 位置(latitude/longitude)は旅行記の下書きでは既定で除外する(SC-28 公開前の検査)。
    """
    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    day_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    occurred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    place_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    video_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    storage_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    visibility: Mapped[str] = mapped_column(String(8), nullable=False, default="private")
    include_in_journal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # [Gate G11] 外部から取り込んだ写真の出典(provider・作者・ライセンス・取得日時。仕様 §5.3)。手で上げた写真は NULL
    source: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("kind IN ('note','photo','audio','video')", name="ck_memories_kind"),
        CheckConstraint("visibility IN ('private','members')", name="ck_memories_visibility"),
        CheckConstraint("(kind IN ('photo','audio')) = (storage_key IS NOT NULL)", name="ck_memories_media"),
        CheckConstraint("(kind = 'video') = (video_url IS NOT NULL)", name="ck_memories_video"),
        CheckConstraint("kind <> 'note' OR body IS NOT NULL", name="ck_memories_note_body"),
        CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name="ck_memories_location_pair"),
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="ck_memories_latitude"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="ck_memories_longitude"),
        Index("ix_memories_plan_occurred", "plan_id", "occurred_at"),
    )


class LocationTrack(Base):
    """[Gate P13] FR-038 任意の位置軌跡(DOC-15 CA-013/014、DOC-14 §4.4 TRACK、DOC-04 SC-43)。

    本人の旅行記のための位置の記録。参加者への位置共有とは分離し、記録した本人以外(旅行の所有者を含む)には見せない。
    - 記録は明示的に開始する(既定はOFF)。位置情報の利用への同意(P9の同意台帳 location)が必要で、撤回すると止まる。
    - 旅行の期間に限る(auto_stop_at を過ぎたら止まる)。精度(precision)で保存する座標の細かさを丸める。
    - mode: device_only=座標をサーバーへ送らない(端末だけに保存)/ synced=暗号化してサーバーへ保存する。
    """
    __tablename__ = "location_tracks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(11), nullable=False)
    precision: Mapped[str] = mapped_column(String(9), nullable=False)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="recording")
    stopped_reason: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    auto_stop_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stopped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    point_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # [Gate L5] 端末の記録の観測値(電池・欠測率・取得の間隔の内訳。座標を含まない。app/services/location_tracks.py)
    sampling: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # [Gate L5] areas_only = 生の座標は端末だけに置き、集計した訪問地域(区画)だけを同期する
        CheckConstraint("mode IN ('device_only','areas_only','synced')", name="ck_location_tracks_mode"),
        CheckConstraint("precision IN ('high','standard','low')", name="ck_location_tracks_precision"),
        CheckConstraint("status IN ('recording','paused','stopped')", name="ck_location_tracks_status"),
        CheckConstraint("(status = 'stopped') = (stopped_at IS NOT NULL)", name="ck_location_tracks_stopped_at"),
        CheckConstraint("mode = 'synced' OR point_count = 0", name="ck_location_tracks_device_only_points"),
        Index("ix_location_tracks_plan_user", "plan_id", "user_id"),
    )


class TripLocationSetting(Base):
    """[Gate L5] FR-055 旅行ごと・利用者ごとの位置の扱い(DOC-15 CA-013)。

    off=記録しない / device_only=この端末だけ / areas_only=訪問地域だけ同期 / synced=暗号化してサーバーへ。
    行が無い時は「まだ選んでいない」(記録は始まっていない。初期値は OFF)。"""
    __tablename__ = "trip_location_settings"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[str] = mapped_column(String(11), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("mode IN ('off','device_only','areas_only','synced')", name="ck_trip_location_settings_mode"),
    )


class LocationAreaCell(Base):
    """[Gate L5] FR-055「訪問地域だけ同期」の区画(0.1度 ≒ 11km)。端末が生の座標から集計した結果だけを持つ。"""
    __tablename__ = "location_area_cells"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    track_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("location_tracks.id", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    cell_key: Mapped[str] = mapped_column(String(24), nullable=False)
    first_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    dwell_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    samples: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("track_id", "cell_key", name="uq_location_area_cells_track_cell"),
        CheckConstraint("last_at >= first_at", name="ck_location_area_cells_time_order"),
        CheckConstraint("dwell_seconds >= 0 AND samples >= 0", name="ck_location_area_cells_nonnegative"),
        Index("ix_location_area_cells_plan_user", "plan_id", "user_id"),
    )


class LocationPointBatch(Base):
    """[Gate P13] 位置軌跡の点のまとまり(端末から送られた単位)。座標はまとめてFernetで暗号化して保存する。
    batch_id は端末が付ける再送用のID(同じ軌跡で一意。再送しても二重に保存しない)。"""
    __tablename__ = "location_point_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    track_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("location_tracks.id", ondelete="CASCADE"), nullable=False)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    points_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    point_count: Mapped[int] = mapped_column(Integer, nullable=False)
    first_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("track_id", "batch_id", name="uq_location_point_batches_track_batch"),
        CheckConstraint("point_count >= 0", name="ck_location_point_batches_count"),
        Index("ix_location_point_batches_track_first", "track_id", "first_at"),
    )


class EventActual(Base):
    """[Gate P14] FR-054 Plan-to-Memory の実績(DOC-15 CA-012、DOC-04 SC-42 Journey Review)。

    予定(TravelEvent)を実績で上書きせず、行った/行かなかった・実際の到着と出発を別の行で持つ(予定1件に実績1件)。
    写真・メモ(memories)・支出・軌跡は同じ予定ID(event_id)で結び付く。
    予定には外部キーを張らない(B-013の個別削除を妨げないため。予定が消えた実績は振り返りに出さない)。
    """
    __tablename__ = "event_actuals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(7), nullable=False)
    actual_start_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(9), nullable=False, default="manual")
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    recorded_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("plan_id", "event_id", name="uq_event_actuals_plan_event"),
        CheckConstraint("status IN ('visited','skipped')", name="ck_event_actuals_status"),
        CheckConstraint("source IN ('manual','suggested')", name="ck_event_actuals_source"),
        CheckConstraint(
            "status = 'visited' OR (actual_start_at IS NULL AND actual_end_at IS NULL)",
            name="ck_event_actuals_skipped_times",
        ),
        CheckConstraint(
            "actual_start_at IS NULL OR actual_end_at IS NULL OR actual_end_at >= actual_start_at",
            name="ck_event_actuals_time_order",
        ),
    )


class VisitAssessment(Base):
    """[Gate V2] FR-049〜051 訪問の判定(DOC-15 CA-007〜009、DOC-14「v5.1 訪問判定」。app/services/visit_assessment.py)。

    旅行・予定・本人ごとに1行。本人の位置の軌跡(または端末で計算した数値)と証拠(写真・予約・手動の記録)から
    自動で判定し(source=auto/device)、本人が確定・通過・取消・非表示で直す(source=user)。本人が直した状態は
    判定をやり直しても上書きしない(auto_state に最新の自動の判定を残す)。予定・実績は変えない。
    根拠(reasons)に座標を入れない。本人以外(旅行の所有者を含む)には見せない。
    予定には外部キーを張らない(B-013 の個別削除を妨げないため。予定が消えた判定は出さない)。"""
    __tablename__ = "visit_assessments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[str] = mapped_column(String(14), nullable=False)
    auto_state: Mapped[Optional[str]] = mapped_column(String(14), nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reasons: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    algorithm_version: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(6), nullable=False)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    corrected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("plan_id", "event_id", "user_id", name="uq_visit_assessments_plan_event_user"),
        CheckConstraint(
            "state IN ('VERIFIED_VISIT','LIKELY_VISIT','PASS_THROUGH','PLANNED_ONLY','MANUAL','REJECTED')",
            name="ck_visit_assessments_state"),
        CheckConstraint(
            "auto_state IS NULL OR auto_state IN "
            "('VERIFIED_VISIT','LIKELY_VISIT','PASS_THROUGH','PLANNED_ONLY','MANUAL','REJECTED')",
            name="ck_visit_assessments_auto_state"),
        CheckConstraint("source IN ('auto','device','user')", name="ck_visit_assessments_source"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
                        name="ck_visit_assessments_confidence"),
        Index("ix_visit_assessments_plan_user", "plan_id", "user_id"),
        Index("ix_visit_assessments_user", "user_id"),
    )


class PlanCandidate(Base):
    """[Gate C2] FR-007 候補箱(DOC-02 FR-007・FC-019/023、DOC-04 SC-08、DOC-14 §7.1/7.2)。

    旅行ごとの未確定の候補。出典(source_kind・source_url・provider)・登録した人・登録の時刻を持つ。
    予定に配置しても候補は消さず(status=scheduled・scheduled_event_id)、予定が消えれば候補に戻す(読む時に判定)。
    重複は自動で消さず、利用者が統合する(merged_into_id)。URL はサーバーから取りに行かない(SSRF を起こさない)。
    予定には外部キーを張らない(B-013 の個別削除を妨げないため)。"""
    __tablename__ = "plan_candidates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    source_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    provider: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    retrieved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    place_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("places.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="open", server_default="open")
    scheduled_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    merged_into_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("source_kind IN ('url','text','manual','search','social')",
                        name="ck_plan_candidates_source_kind"),
        CheckConstraint("status IN ('open','scheduled','dismissed')", name="ck_plan_candidates_status"),
        CheckConstraint("priority BETWEEN 1 AND 3", name="ck_plan_candidates_priority"),
        CheckConstraint("(latitude IS NULL) = (longitude IS NULL)", name="ck_plan_candidates_location_pair"),
        CheckConstraint("(status = 'scheduled') = (scheduled_event_id IS NOT NULL)",
                        name="ck_plan_candidates_scheduled"),
        Index("ix_plan_candidates_plan", "plan_id", "status"),
    )


class UserPrivateProfile(Base):
    """[Gate C1] FR-023 秘匿プロフィール。利用者ごとの非公開の条件を1つの暗号文だけで持つ(平文の列を持たない)。

    中身は app/services/private_profile.py の項目の一覧。本人だけが読み書きでき、運用管理者の画面・API にも出さない。"""
    __tablename__ = "user_private_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    items_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class PrivateProfileLink(Base):
    """[Gate C1] FR-023 秘匿プロフィールを適用している旅行(旅行・利用者)。適用中の旅行には、プロフィールの
    項目ごとに秘匿制約(constraints.profile_item_id)を作り、プロフィールの変更で作り直す。"""
    __tablename__ = "private_profile_links"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)


# ==========================================================================
# [Gate B1] FR-041 組織・B2B(最小形)/ FR-042 API・Webhook(最小形)
# ==========================================================================
# 組織は配布する旅程(配布版の写し)の境界。組織の管理者でも、メンバー個人の旅行は見られない
# (DOC-03 §24)。配布版は元の旅行から「標準の共有項目」だけを写した snapshot で、予約・番号・住所・
# メモ・位置を含めない。外部連携は組織単位の API クライアント(OAuth 2.0 client_credentials、
# スコープつき短命トークン)と、署名つき Webhook(HMAC-SHA256)。正本は app/services/organizations.py・
# app/services/org_api.py。

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    brand_color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # "#RRGGBB"
    # [Gate G5] ORG-01 ロゴ(検査して作り直した PNG だけ。一覧では読まない)・席の上限(NULL は上限なし)
    logo_png: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True, deferred=True)
    logo_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    logo_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seat_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("seat_limit IS NULL OR seat_limit >= 1", name="ck_organizations_seat_limit"),
    )


class OrganizationDomain(Base):
    """[Gate G5] ORG-01 独自のドメインの所有の確認(DNS の TXT `_travelcanvas.<domain>` に token を置く)。
    確認済みのドメインは1つの組織だけ(uq_organization_domains_verified)。"""
    __tablename__ = "organization_domains"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    domain: Mapped[str] = mapped_column(String(253), nullable=False)
    token: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="pending", server_default="pending")
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'verified', 'failed', 'revoked')",
                        name="ck_organization_domains_status"),
        UniqueConstraint("organization_id", "domain", name="uq_organization_domains_org_domain"),
        Index("uq_organization_domains_verified", "domain", unique=True, postgresql_where=text("status = 'verified'")),
    )


class OrganizationSeatEvent(Base):
    """[Gate G5] ORG-01 席の記録(参加・脱退・上限の変更。seats_after はその後の席の数)。"""
    __tablename__ = "organization_seat_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event: Mapped[str] = mapped_column(String(8), nullable=False)
    seats_after: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("event IN ('join', 'leave', 'limit')", name="ck_organization_seat_events_event"),
    )


class UsageCounter(Base):
    """[Gate G5] BILL-02 使用量(利用者 user・組織 org ごと、指標ごと、月 period=YYYY-MM ごと)。

    上限の確認と加算は1つの UPDATE ... WHERE used + n <= limit で行い、同時の要求でも上限を越えない。
    override_limit は管理者の上書き(理由つき・監査に残す)。"""
    __tablename__ = "usage_counters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_type: Mapped[str] = mapped_column(String(4), nullable=False)
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    metric: Mapped[str] = mapped_column(String(24), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    used: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    override_limit: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    override_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    override_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    warned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("subject_type", "subject_id", "metric", "period", name="uq_usage_counters_key"),
        CheckConstraint("subject_type IN ('user', 'org')", name="ck_usage_counters_subject"),
        CheckConstraint("used >= 0", name="ck_usage_counters_used"),
        CheckConstraint("period ~ '^[0-9]{4}-[0-9]{2}$'", name="ck_usage_counters_period"),
    )


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(6), nullable=False, default="member", server_default="member")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_organization_members_org_user"),
        CheckConstraint("role IN ('owner','admin','member')", name="ck_organization_members_role"),
    )


class OrgDistribution(Base):
    """配布する旅程。版を上げるたびに snapshot を作り直す(過去の版の確認は残る)。"""
    __tablename__ = "org_distributions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    source_plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    snapshot: Mapped[Any] = mapped_column(JSONB, nullable=False)
    change_note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    published_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OrgDistributionAck(Base):
    """閲覧確認(どの版を確認したか)。"""
    __tablename__ = "org_distribution_acks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    distribution_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_distributions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    acked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        UniqueConstraint("distribution_id", "user_id", "version", name="uq_org_distribution_acks_once"),
    )


class OrgApiClient(Base):
    """FR-042 組織の外部連携(OAuth 2.0 client_credentials)。秘密はハッシュだけを持つ。"""
    __tablename__ = "org_api_clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    client_id: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scopes: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate G2] 秘密の切り替え: 猶予の間は前の秘密でもトークンを取れる(ハッシュだけ)
    previous_secret_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    previous_secret_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    secret_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    secret_rotated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OrgApiToken(Base):
    """短命のアクセストークン(ハッシュだけを持つ)。"""
    __tablename__ = "org_api_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_api_clients.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    scopes: Mapped[Any] = mapped_column(JSONB, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)


class OrgWebhook(Base):
    """FR-042 署名つき Webhook。署名の鍵は暗号化して持つ(送るたびに署名に使うため)。"""
    __tablename__ = "org_webhooks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2000), nullable=False)
    secret_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    events: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate G2] 署名の鍵の切り替え: 猶予の間は新旧の両方で署名する(受け手が切り替える時間を取る)
    previous_secret_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    previous_secret_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    secret_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # 受け手が 410 Gone を返した等で自動で止めた理由
    disabled_reason: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)


class OrgWebhookDelivery(Base):
    """送信の記録(再送できるよう本文を持つ。本文に個人・秘密の値は入れない)。"""
    __tablename__ = "org_webhook_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    webhook_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_webhooks.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[Any] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # [Gate G2] 自動の再送: 次に送る時刻(失敗のたびに間隔を伸ばす)。上限に達したら dead(手で送り直せる)
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('pending','delivered','failed','dead')", name="ck_org_webhook_deliveries_status"),
        Index("ix_org_webhook_deliveries_due", "status", "next_attempt_at"),
    )


class SupportGrant(Base):
    """[Gate G2] FR-040 サポート閲覧の許可(利用者本人が作る。目的・期限つき・読み取りだけ・閲覧は全て監査)。

    plan_id が NULL ならアカウントの概要と旅行の一覧、あれば1つの旅行の中身(機密・個人の値は伏せる)を見られる。"""
    __tablename__ = "support_grants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(200), nullable=False)
    ticket_ref: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_accessed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class DataKey(Base):
    """[Gate G3] SEC-F5 旅行ごと・利用者ごとのデータ鍵(app/services/data_keys.py が正本)。

    wrapped_key_ciphertext は ENCRYPTION_KEY で包んだ鍵。破棄すると NULL になり、その鍵で暗号化した値は
    DB・バックアップのどちらからも読めなくなる(バックアップの鍵の写しも消す: app/ops/key_escrow.py)。"""
    __tablename__ = "data_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_type: Mapped[str] = mapped_column(String(8), nullable=False)
    subject_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    wrapped_key_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    destroyed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    destroy_reason: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        CheckConstraint("subject_type IN ('plan', 'user')", name="ck_data_keys_subject_type"),
        CheckConstraint("(destroyed_at IS NULL) = (wrapped_key_ciphertext IS NOT NULL)",
                        name="ck_data_keys_destroyed_has_no_key"),
        Index("ix_data_keys_subject", "subject_type", "subject_id"),
        Index("uq_data_keys_active", "subject_type", "subject_id", unique=True,
              postgresql_where=text("destroyed_at IS NULL")),
    )


class MfaResetRequest(Base):
    """[Gate G3] SEC-F6 多要素認証の解除の申請と承認(scripts/security_incident.py の mfa-reset-request・mfa-reset)。"""
    __tablename__ = "mfa_reset_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    approved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    single_operator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'approved', 'cancelled', 'expired')",
                        name="ck_mfa_reset_requests_status"),
    )


class OrgApiIdempotency(Base):
    """[Gate G2] FR-042 外部 API の書き込みの Idempotency-Key(クライアントごと)。同じキーの再送は同じ応答を返す。"""
    __tablename__ = "org_api_idempotency"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_api_clients.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    route: Mapped[str] = mapped_column(String(120), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (UniqueConstraint("client_id", "key", name="uq_org_api_idempotency_client_key"),)


# ==========================================================================
# [Gate G4] MAP-03 / COL-03 / FC-097

class CommandRun(Base):
    """[Gate G4] MAP-03 検索のコマンド(``>予定を追加`` 等)の実行の記録。

    Idempotency-Key ごとに1件(同じキーの再送は同じ結果を返し、二重に作らない)。元に戻す時は change_set_id
    (予定・日程)か target(候補)を使う。題名などの入力値は response_json(実行した本人だけに返す)にだけ残し、監査には残さない。"""
    __tablename__ = "command_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    command: Mapped[str] = mapped_column(String(32), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    target_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    change_set_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("change_sets.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="executed", server_default="executed")
    response_json: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    undone_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_command_runs_user_key"),
        CheckConstraint("status IN ('executed', 'undone')", name="ck_command_runs_status"),
    )


class NotificationPreference(Base):
    """[Gate G4] COL-03 通知の設定。plan_id が NULL の行は全体の既定、旅行ごとの行がそれより優先する。

    level: all(すべて)/ mentions(自分へのメンション・自分の投稿への返信だけ)/ none(作らない)。
    email_digest: daily なら、読んでいない通知を1日1回メールでまとめて送る(本文は件数と旅行名だけ)。"""
    __tablename__ = "notification_preferences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=True, index=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="all", server_default="all")
    email_digest: Mapped[str] = mapped_column(String(8), nullable=False, default="off", server_default="off")
    last_digest_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("level IN ('all', 'mentions', 'none')", name="ck_notification_preferences_level"),
        CheckConstraint("email_digest IN ('off', 'daily')", name="ck_notification_preferences_digest"),
        Index("uq_notification_preferences_user_plan", "user_id", "plan_id", unique=True,
              postgresql_where=text("plan_id IS NOT NULL")),
        Index("uq_notification_preferences_user_global", "user_id", unique=True,
              postgresql_where=text("plan_id IS NULL")),
    )


class EmailOutbox(Base):
    """[Gate G4] COL-03 送るメールの記録(送信の失敗は指数的に間を空けて再送し、上限で dead にする)。

    本文に予約番号・コメントの本文・位置は入れない(件数・旅行名・画面への案内だけ)。"""
    __tablename__ = "email_outbox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'failed', 'dead')", name="ck_email_outbox_status"),
        Index("ix_email_outbox_due", "next_attempt_at", postgresql_where=text("status IN ('pending', 'failed')")),
    )


class AbuseReport(Base):
    """[Gate G4] FC-097 公開の共有への通報(phishing・malware・spam・scraping 等)と、自動の検知、管理者の対応。

    通報した人は特定しない(接続元の sha256 だけ。同じ人の連続の通報を数えるため)。"""
    __tablename__ = "abuse_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    share_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plan_share_links.id", ondelete="SET NULL"), nullable=True, index=True)
    plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="report", server_default="report")
    reason: Mapped[str] = mapped_column(String(10), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    reporter_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open", server_default="open")
    handled_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    handled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("reason IN ('phishing', 'malware', 'spam', 'scraping', 'privacy', 'other')",
                        name="ck_abuse_reports_reason"),
        CheckConstraint("source IN ('report', 'auto')", name="ck_abuse_reports_source"),
        CheckConstraint("status IN ('open', 'dismissed', 'actioned')", name="ck_abuse_reports_status"),
        Index("ix_abuse_reports_status_created", "status", "created_at"),
    )


# ==========================================================================
# [Gate G6] OFF-01 端末ごとのオフラインの鍵 / LOC-02 位置のぼかし / MEM-01 旅行記の公開・記録の削除の取り消し
# ==========================================================================

class OfflineDevice(Base):
    """[Gate G6] OFF-01 オフラインの鍵を受け取る端末(端末が作った device_id ごと)。

    鍵そのものは保存しない(backend の秘密・利用者・版・端末から導出する。app/services/offline_keys.py)。
    失効した端末には鍵を配らず(410)、その端末は次に通信した時に保存したデータを消す。他の端末は影響を受けない。"""
    __tablename__ = "offline_devices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    last_key_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_offline_devices_user_device"),
        CheckConstraint("(revoked_at IS NULL) = (revoked_reason IS NULL)", name="ck_offline_devices_revoked"),
    )


class PrivacyZone(Base):
    """[Gate G6] LOC-02 自宅・職場などの「書き出し・公開から外す範囲」(利用者ごと)。

    中心の座標は利用者のデータ鍵で暗号化する(center_ciphertext、{"lat","lng"})。書き出し(GPX/KML)・公開の共有・
    旅行記の公開では、この範囲の中の地点の座標を出さない(app/services/location_privacy.py)。"""
    __tablename__ = "privacy_zones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    center_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    radius_m: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("radius_m BETWEEN 100 AND 5000", name="ck_privacy_zones_radius"),
    )


class MemoryPublication(Base):
    """[Gate G6] MEM-01 旅行記の公開(URL)。公開した時点の本人の記録だけの写し(snapshot)で、他の人の記録は入れない。

    位置は既定で出さない(none)。area は地名だけ(座標は出さない)。写真は本人が選んだ時だけ(photo_ids)。
    公開の前の確認(写っている人・位置)を acknowledged に残す。トークンはハッシュだけを保存し、失効(revoked_at)できる。"""
    __tablename__ = "memory_publications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    token_prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    location_level: Mapped[str] = mapped_column(String(6), nullable=False, default="none", server_default="none")
    include_photos: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    snapshot: Mapped[Any] = mapped_column(JSON, nullable=False)
    photo_ids: Mapped[Any] = mapped_column(JSON, nullable=False)
    acknowledged: Mapped[Any] = mapped_column(JSON, nullable=False)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("location_level IN ('none', 'area')", name="ck_memory_publications_location"),
    )


class MemoryTrash(Base):
    """[Gate G6] MEM-01 削除した記録を元に戻すための一時の保管(既定7日。過ぎたら定期の処理がファイルごと消す)。

    行の中身(本文・場所を含む)は旅行のデータ鍵で暗号化する(row_ciphertext)。写真・音声のファイルは保管の間は消さない。"""
    __tablename__ = "memory_trash"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    memory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    deleted_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    row_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    storage_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_memory_trash_expires", "expires_at"),
    )


class PlanMovementSettings(Base):
    """[Gate G7] MOVE-03 旅行ごとの移動・滞在の既定(既定の滞在時間・歩く速さの見込み・休憩の規則・同行者の属性)。

    行が無い旅行は既定値(app/services/movement.py の DEFAULTS)で判定する。値は利用者の入力だけで、外部の提供元は使わない。
    revision は If-Match(変えた時に実行可能性の検証の結果が古くなる。feasibility.compute_fingerprint)。"""
    __tablename__ = "plan_movement_settings"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), primary_key=True)
    settings: Mapped[Any] = mapped_column(JSONB, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    updated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class PlanOwnershipTransfer(Base):
    """[Gate G8] FR-021・FR-039 旅行の所有者の移譲。

    所有者がパスワードで本人確認して、参加済みの会員の共同編集者へ申し出る(旅行ごとに手続き中は1件)。受け取る人が
    パスワードで本人確認して受け入れた時だけ所有者が替わる(前の所有者は選んだ役割の共同編集者として残るか、外れる)。
    期限(既定7日)を過ぎた申し出は受け入れられない。手続き中は旅行の削除と、受け取る人を共同編集者から外すことを止める。
    旅行の中身は旅行のデータ鍵で暗号化されているため、移譲で鍵を替える必要は無い(ADR-data-keys)。"""
    __tablename__ = "plan_ownership_transfers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    from_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    to_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # pending(手続き中) / accepted / declined / cancelled
    status: Mapped[str] = mapped_column(String(9), nullable=False, default="pending", server_default="pending")
    # 前の所有者が残る時の役割(editor / viewer)。none は共同編集者から外れる
    keep_role: Mapped[str] = mapped_column(String(6), nullable=False, default="editor", server_default="editor")
    message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('pending','accepted','declined','cancelled')",
                        name="ck_plan_ownership_transfers_status"),
        CheckConstraint("keep_role IN ('editor','viewer','none')", name="ck_plan_ownership_transfers_keep_role"),
        CheckConstraint("from_user_id <> to_user_id", name="ck_plan_ownership_transfers_distinct"),
        CheckConstraint("(status = 'pending') = (responded_at IS NULL)", name="ck_plan_ownership_transfers_responded"),
        Index("uq_plan_ownership_transfers_pending", "plan_id", unique=True,
              postgresql_where=text("status = 'pending'")),
    )


class DataCorrection(Base):
    """[Gate G8] FR-039・DOC-11 §15 出典・確認・履歴つきの訂正。

    kind = self: 本人が自分のアカウントの値(表示名・メールアドレス)を訂正した記録。訂正の前後の値は本人のデータ鍵で
    暗号化して持ち、本人だけが履歴で見て、取り消せる(今の値が訂正の後の値のままの時だけ)。メールアドレスはパスワードで
    本人確認し、確認済みの印を外して他の端末のセッションを失効させる(PUT /auth/me と同じ)。
    kind = request: 共同の旅行の中の本人に関わる情報の訂正を、その旅行の所有者へ申し出た記録(所有者が対応・見送りを
    記録する)。申し出の内容は旅行のデータ鍵で暗号化する(旅行の参加者の個人データのため)。
    source は訂正の根拠(本人の申告・公的な書類・予約の確認書・その他)、source_note はその補足(500文字まで)。"""
    __tablename__ = "data_corrections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(7), nullable=False)
    plan_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("travel_plans.id", ondelete="CASCADE"), nullable=True, index=True)
    field: Mapped[str] = mapped_column(String(40), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    # 本人確認の方法: password(パスワード) / session(ログイン中の本人)
    verification: Mapped[str] = mapped_column(String(8), nullable=False)
    payload_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # self: applied / reverted。request: open / resolved / declined
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    resolution_note_ciphertext: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    resolved_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('self','request')", name="ck_data_corrections_kind"),
        CheckConstraint("source IN ('self_statement','official_document','booking_document','other')",
                        name="ck_data_corrections_source"),
        CheckConstraint("verification IN ('password','session')", name="ck_data_corrections_verification"),
        CheckConstraint(
            "(kind = 'self' AND status IN ('applied','reverted') AND plan_id IS NULL) OR "
            "(kind = 'request' AND status IN ('open','resolved','declined') AND plan_id IS NOT NULL)",
            name="ck_data_corrections_kind_status",
        ),
        CheckConstraint("(status IN ('applied','open')) = (resolved_at IS NULL)", name="ck_data_corrections_resolved"),
    )


class OpsJobRun(Base):
    """[Gate G8] FR-004・O02 定期の処理の実行の記録(継続して動いているかを、最後の成功の時刻で確かめる)。

    各処理(app/ops/* と scripts/run_*_purge.py)が始めと終わりを記録する。中身は件数だけ(誰・どの旅行かは書かない)。
    30日より古い記録は処理のたびに消す。管理の画面(GET /admin/ops/jobs)と /metrics の最後の成功からの経過で見る。"""
    __tablename__ = "ops_job_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job: Mapped[str] = mapped_column(String(40), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    summary: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    __table_args__ = (
        Index("ix_ops_job_runs_job_started", "job", "started_at"),
    )
