"""
TravelCanvas Backend - 旅行プラン用スキーマ
競合優位機能に対応した包括的なスキーマ定義
"""

from typing import Optional, List, Dict, Any, Union
from datetime import datetime, date, time
from enum import Enum
from uuid import UUID
from decimal import Decimal

from pydantic import BaseModel, Field, validator, root_validator
from app.schemas.common import BaseResponse, PaginatedResponse


# ==========================================
# Enum定義
# ==========================================

class PlanStatus(str, Enum):
    """プラン状態"""
    DRAFT = "draft"              # 下書き
    ACTIVE = "active"            # アクティブ
    COMPLETED = "completed"      # 完了
    ARCHIVED = "archived"        # アーカイブ
    SHARED = "shared"            # 共有中


class PlanVisibility(str, Enum):
    """プランの公開設定"""
    PRIVATE = "private"          # 非公開
    SHARED_LINK = "shared_link"  # リンク共有
    PUBLIC = "public"            # 公開


class SharePermission(str, Enum):
    """共有権限"""
    VIEW = "view"                # 閲覧のみ
    COMMENT = "comment"          # コメント可能
    EDIT = "edit"                # 編集可能
    ADMIN = "admin"              # 管理者権限


class EventType(str, Enum):
    """イベントタイプ"""
    SIGHTSEEING = "sightseeing"  # 観光
    RESTAURANT = "restaurant"    # 食事
    ACCOMMODATION = "accommodation"  # 宿泊
    TRANSPORTATION = "transportation"  # 移動
    SHOPPING = "shopping"        # ショッピング
    ENTERTAINMENT = "entertainment"  # エンターテイメント
    ACTIVITY = "activity"        # アクティビティ
    MEETING = "meeting"          # 会合
    FREE_TIME = "free_time"      # 自由時間
    OTHER = "other"              # その他


class EventStatus(str, Enum):
    """イベント状態"""
    PLANNED = "planned"          # 予定
    IN_PROGRESS = "in_progress"  # 進行中
    COMPLETED = "completed"      # 完了
    CANCELLED = "cancelled"      # キャンセル
    DELAYED = "delayed"          # 遅延


class TransportMode(str, Enum):
    """交通手段"""
    WALKING = "walking"
    BICYCLE = "bicycle"
    CAR = "car"
    TAXI = "taxi"
    BUS = "bus"
    TRAIN = "train"
    SUBWAY = "subway"
    PLANE = "plane"
    BOAT = "boat"
    OTHER = "other"


class OptimizationType(str, Enum):
    """最適化タイプ"""
    TIME = "time"                # 時間最適化
    COST = "cost"                # 費用最適化
    DISTANCE = "distance"        # 距離最適化
    EXPERIENCE = "experience"    # 体験最適化
    BALANCED = "balanced"        # バランス型


# ==========================================
# 基本データ構造
# ==========================================

class Location(BaseModel):
    """位置情報"""
    latitude: float = Field(..., description="緯度", ge=-90, le=90)
    longitude: float = Field(..., description="経度", ge=-180, le=180)
    address: Optional[str] = Field(None, description="住所", max_length=500)
    place_id: Optional[str] = Field(None, description="Google Place ID")
    timezone: Optional[str] = Field(None, description="タイムゾーン")
    
    class Config:
        schema_extra = {
            "example": {
                "latitude": 35.6762,
                "longitude": 139.6503,
                "address": "東京都港区芝公園4-2-8",
                "place_id": "ChIJCewJkL2LGGAR3Qmk0vCTGkg",
                "timezone": "Asia/Tokyo"
            }
        }


class TimeRange(BaseModel):
    """時間範囲"""
    start_time: time = Field(..., description="開始時間")
    end_time: time = Field(..., description="終了時間")
    
    @root_validator
    def validate_time_range(cls, values):
        start = values.get('start_time')
        end = values.get('end_time')
        
        if start and end and start >= end:
            raise ValueError('開始時間は終了時間より前である必要があります')
        
        return values


class CostInfo(BaseModel):
    """費用情報"""
    amount: Decimal = Field(..., description="金額", ge=0)
    currency: str = Field(default="JPY", description="通貨コード")
    category: Optional[str] = Field(None, description="費用カテゴリ")
    per_person: bool = Field(default=True, description="一人当たりかどうか")
    
    class Config:
        schema_extra = {
            "example": {
                "amount": 2000,
                "currency": "JPY",
                "category": "入場料",
                "per_person": True
            }
        }


# ==========================================
# 観光スポット・イベント関連
# ==========================================

class SpotBase(BaseModel):
    """観光スポット基本情報"""
    name: str = Field(..., description="スポット名", max_length=200)
    description: Optional[str] = Field(None, description="説明", max_length=2000)
    location: Location = Field(..., description="位置情報")
    category: EventType = Field(..., description="カテゴリ")
    tags: List[str] = Field(default=[], description="タグ")
    rating: Optional[float] = Field(None, description="評価", ge=0, le=5)
    phone: Optional[str] = Field(None, description="電話番号", max_length=20)
    website: Optional[str] = Field(None, description="ウェブサイト", max_length=500)
    opening_hours: Optional[Dict[str, str]] = Field(None, description="営業時間")
    price_range: Optional[str] = Field(None, description="価格帯")


class SpotCreate(SpotBase):
    """観光スポット作成"""
    images: List[str] = Field(default=[], description="画像URL", max_items=10)
    
    class Config:
        schema_extra = {
            "example": {
                "name": "東京タワー",
                "description": "東京のシンボルタワー",
                "location": {
                    "latitude": 35.6585,
                    "longitude": 139.7454,
                    "address": "東京都港区芝公園4-2-8"
                },
                "category": "sightseeing",
                "tags": ["観光", "ランドマーク", "展望"],
                "rating": 4.2,
                "phone": "03-3433-5111",
                "website": "https://www.tokyotower.co.jp",
                "opening_hours": {
                    "monday": "09:00-23:00",
                    "tuesday": "09:00-23:00"
                },
                "price_range": "¥1,000-¥3,000"
            }
        }


class SpotResponse(SpotBase):
    """観光スポット情報レスポンス"""
    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    images: List[str] = []
    visit_count: int = 0
    average_visit_duration: Optional[int] = Field(None, description="平均滞在時間（分）")
    best_visit_time: Optional[str] = Field(None, description="おすすめ訪問時間")
    crowd_level: Optional[str] = Field(None, description="混雑度")
    accessibility: Optional[Dict[str, bool]] = Field(None, description="アクセシビリティ情報")
    
    class Config:
        from_attributes = True


# ==========================================
# 旅行イベント（スケジュール項目）
# ==========================================

class TravelEventBase(BaseModel):
    """旅行イベント基本情報"""
    title: str = Field(..., description="イベントタイトル", max_length=200)
    description: Optional[str] = Field(None, description="説明", max_length=1000)
    event_type: EventType = Field(..., description="イベントタイプ")
    start_time: datetime = Field(..., description="開始時間")
    end_time: datetime = Field(..., description="終了時間")
    location: Optional[Location] = Field(None, description="位置情報")
    
    @root_validator
    def validate_time_range(cls, values):
        start = values.get('start_time')
        end = values.get('end_time')
        
        if start and end and start >= end:
            raise ValueError('開始時間は終了時間より前である必要があります')
        
        return values


class TravelEventCreate(TravelEventBase):
    """旅行イベント作成"""
    spot_id: Optional[UUID] = Field(None, description="関連スポットID")
    cost: Optional[CostInfo] = Field(None, description="費用情報")
    notes: Optional[str] = Field(None, description="メモ", max_length=1000)
    priority: int = Field(default=1, description="優先度", ge=1, le=5)
    color: Optional[str] = Field(None, description="表示色", regex=r"^#[0-9A-Fa-f]{6}$")
    icon: Optional[str] = Field(None, description="表示アイコン")
    
    class Config:
        schema_extra = {
            "example": {
                "title": "東京タワー見学",
                "description": "展望台からの景色を楽しむ",
                "event_type": "sightseeing",
                "start_time": "2024-08-01T09:00:00+09:00",
                "end_time": "2024-08-01T11:00:00+09:00",
                "location": {
                    "latitude": 35.6585,
                    "longitude": 139.7454,
                    "address": "東京都港区芝公園4-2-8"
                },
                "cost": {
                    "amount": 1200,
                    "currency": "JPY",
                    "category": "入場料"
                },
                "priority": 3,
                "color": "#FF6B6B",
                "icon": "tower"
            }
        }


class TravelEventUpdate(BaseModel):
    """旅行イベント更新"""
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    event_type: Optional[EventType] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    location: Optional[Location] = None
    cost: Optional[CostInfo] = None
    notes: Optional[str] = Field(None, max_length=1000)
    priority: Optional[int] = Field(None, ge=1, le=5)
    color: Optional[str] = Field(None, regex=r"^#[0-9A-Fa-f]{6}$")
    icon: Optional[str] = None
    status: Optional[EventStatus] = None


class TravelEventResponse(TravelEventBase):
    """旅行イベントレスポンス"""
    id: UUID
    day_number: int
    order_index: int
    status: EventStatus
    spot: Optional[SpotResponse] = None
    cost: Optional[CostInfo] = None
    notes: Optional[str] = None
    priority: int
    color: Optional[str] = None
    icon: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    # 現在時刻表示機能用
    is_current: bool = Field(default=False, description="現在進行中")
    is_next: bool = Field(default=False, description="次の予定")
    time_until: Optional[str] = Field(None, description="開始までの時間")
    time_remaining: Optional[str] = Field(None, description="残り時間")
    is_overdue: bool = Field(default=False, description="予定時刻超過")
    
    # 移動情報
    transport_to_here: Optional[Dict[str, Any]] = Field(None, description="ここまでの移動情報")
    
    class Config:
        from_attributes = True


# ==========================================
# 旅行日程
# ==========================================

class TravelDayBase(BaseModel):
    """旅行日程基本情報"""
    date: date = Field(..., description="日付")
    day_number: int = Field(..., description="日数", ge=1)
    title: Optional[str] = Field(None, description="日程タイトル", max_length=200)
    description: Optional[str] = Field(None, description="日程説明", max_length=1000)


class TravelDayCreate(TravelDayBase):
    """旅行日程作成"""
    events: List[TravelEventCreate] = Field(default=[], description="イベントリスト")


class TravelDayUpdate(BaseModel):
    """旅行日程更新"""
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)


class TravelDayResponse(TravelDayBase):
    """旅行日程レスポンス"""
    id: UUID
    events: List[TravelEventResponse] = []
    total_events: int = 0
    completed_events: int = 0
    total_duration: int = Field(0, description="総所要時間（分）")
    estimated_cost: Decimal = Field(Decimal('0'), description="推定費用")
    weather_forecast: Optional[Dict[str, Any]] = Field(None, description="天気予報")
    
    # 日付ジャンプナビゲーション用
    is_current_day: bool = Field(default=False, description="今日かどうか")
    is_completed: bool = Field(default=False, description="完了済みかどうか")
    progress_percentage: float = Field(0, description="進行率")
    
    class Config:
        from_attributes = True


# ==========================================
# 旅行プラン
# ==========================================

class TravelPlanBase(BaseModel):
    """旅行プラン基本情報"""
    title: str = Field(..., description="プラン名", max_length=300)
    description: Optional[str] = Field(None, description="プラン説明", max_length=2000)
    destination: str = Field(..., description="目的地", max_length=200)
    start_date: date = Field(..., description="開始日")
    end_date: date = Field(..., description="終了日")
    
    @root_validator
    def validate_date_range(cls, values):
        start = values.get('start_date')
        end = values.get('end_date')
        
        if start and end and start > end:
            raise ValueError('開始日は終了日より前である必要があります')
        
        return values


class TravelPlanCreate(TravelPlanBase):
    """旅行プラン作成"""
    visibility: PlanVisibility = Field(default=PlanVisibility.PRIVATE, description="公開設定")
    tags: List[str] = Field(default=[], description="タグ", max_items=20)
    budget: Optional[CostInfo] = Field(None, description="予算")
    participants: int = Field(default=1, description="参加者数", ge=1, le=100)
    preferences: Optional[Dict[str, Any]] = Field(None, description="旅行設定")
    
    class Config:
        schema_extra = {
            "example": {
                "title": "東京観光2泊3日",
                "description": "初めての東京観光",
                "destination": "東京",
                "start_date": "2024-08-01",
                "end_date": "2024-08-03",
                "visibility": "private",
                "tags": ["観光", "グルメ", "文化"],
                "budget": {
                    "amount": 50000,
                    "currency": "JPY",
                    "per_person": True
                },
                "participants": 2
            }
        }


class TravelPlanUpdate(BaseModel):
    """旅行プラン更新"""
    title: Optional[str] = Field(None, max_length=300)
    description: Optional[str] = Field(None, max_length=2000)
    destination: Optional[str] = Field(None, max_length=200)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    visibility: Optional[PlanVisibility] = None
    status: Optional[PlanStatus] = None
    tags: Optional[List[str]] = Field(None, max_items=20)
    budget: Optional[CostInfo] = None
    participants: Optional[int] = Field(None, ge=1, le=100)
    preferences: Optional[Dict[str, Any]] = None


class TravelPlanResponse(TravelPlanBase):
    """旅行プランレスポンス"""
    id: UUID
    user_id: UUID
    status: PlanStatus
    visibility: PlanVisibility
    tags: List[str] = []
    budget: Optional[CostInfo] = None
    participants: int
    preferences: Optional[Dict[str, Any]] = None
    
    # 統計情報
    total_days: int = 0
    total_events: int = 0
    total_duration: int = 0
    estimated_cost: Decimal = Decimal('0')
    
    # 日程データ
    days: List[TravelDayResponse] = []
    
    # AI最適化情報
    is_optimized: bool = False
    optimization_score: Optional[float] = Field(None, description="最適化スコア", ge=0, le=100)
    last_optimized: Optional[datetime] = None
    
    # 共有情報
    share_token: Optional[str] = None
    qr_code_url: Optional[str] = None
    
    # メタデータ
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_accessed: Optional[datetime] = None
    
    class Config:
        from_attributes = True


# ==========================================
# 移動情報・経路
# ==========================================

class RouteStep(BaseModel):
    """経路ステップ"""
    instruction: str = Field(..., description="移動指示")
    distance: int = Field(..., description="距離（メートル）")
    duration: int = Field(..., description="所要時間（秒）")
    transport_mode: TransportMode = Field(..., description="交通手段")
    start_location: Location = Field(..., description="出発地")
    end_location: Location = Field(..., description="到着地")


class Route(BaseModel):
    """経路情報"""
    origin: Location = Field(..., description="出発地")
    destination: Location = Field(..., description="目的地")
    steps: List[RouteStep] = Field(..., description="経路ステップ")
    total_distance: int = Field(..., description="総距離（メートル）")
    total_duration: int = Field(..., description="総所要時間（秒）")
    transport_mode: TransportMode = Field(..., description="主要交通手段")
    cost: Optional[CostInfo] = Field(None, description="移動費用")
    
    class Config:
        schema_extra = {
            "example": {
                "origin": {
                    "latitude": 35.6762,
                    "longitude": 139.6503,
                    "address": "東京駅"
                },
                "destination": {
                    "latitude": 35.6585,
                    "longitude": 139.7454,
                    "address": "東京タワー"
                },
                "total_distance": 3200,
                "total_duration": 1800,
                "transport_mode": "train",
                "cost": {
                    "amount": 160,
                    "currency": "JPY"
                }
            }
        }


# ==========================================
# AI最適化関連
# ==========================================

class OptimizationRequest(BaseModel):
    """最適化リクエスト"""
    optimization_type: OptimizationType = Field(..., description="最適化タイプ")
    constraints: Optional[Dict[str, Any]] = Field(None, description="制約条件")
    preferences: Optional[Dict[str, Any]] = Field(None, description="優先設定")
    
    class Config:
        schema_extra = {
            "example": {
                "optimization_type": "balanced",
                "constraints": {
                    "max_travel_time": 60,
                    "budget_limit": 10000,
                    "avoid_crowds": True
                },
                "preferences": {
                    "prefer_public_transport": True,
                    "include_lunch_break": True,
                    "walking_tolerance": "medium"
                }
            }
        }


class OptimizationResult(BaseModel):
    """最適化結果"""
    original_plan: List[TravelDayResponse] = Field(..., description="元のプラン")
    optimized_plan: List[TravelDayResponse] = Field(..., description="最適化後のプラン")
    improvements: Dict[str, Any] = Field(..., description="改善内容")
    score: float = Field(..., description="最適化スコア", ge=0, le=100)
    execution_time: float = Field(..., description="処理時間（秒）")
    
    class Config:
        schema_extra = {
            "example": {
                "improvements": {
                    "time_saved": 45,
                    "cost_reduced": 1200,
                    "distance_reduced": 2.5,
                    "experience_score": 8.5
                },
                "score": 87.5,
                "execution_time": 2.34
            }
        }


# ==========================================
# 共有・コラボレーション
# ==========================================

class ShareSettings(BaseModel):
    """共有設定"""
    visibility: PlanVisibility = Field(..., description="公開設定")
    default_permission: SharePermission = Field(..., description="デフォルト権限")
    allow_comments: bool = Field(default=True, description="コメント許可")
    allow_suggestions: bool = Field(default=True, description="提案許可")
    expiration_date: Optional[datetime] = Field(None, description="共有期限")
    password: Optional[str] = Field(None, description="パスワード保護")


class ShareInvitation(BaseModel):
    """共有招待"""
    email: str = Field(..., description="招待先メールアドレス")
    permission: SharePermission = Field(..., description="権限")
    message: Optional[str] = Field(None, description="招待メッセージ", max_length=500)


class ShareLinkResponse(BaseResponse):
    """共有リンクレスポンス"""
    data: Dict[str, Any]
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "共有リンクを生成しました",
                "data": {
                    "share_url": "https://travelcanvas.com/share/abc123def456",
                    "qr_code_url": "https://api.travelcanvas.com/qr/abc123def456.png",
                    "share_token": "abc123def456",
                    "permission": "view",
                    "expires_at": "2024-12-31T23:59:59Z"
                }
            }
        }


# ==========================================
# 検索・フィルタリング
# ==========================================

class PlanSearchFilters(BaseModel):
    """プラン検索フィルター"""
    query: Optional[str] = Field(None, description="検索キーワード")
    destination: Optional[str] = Field(None, description="目的地")
    status: Optional[List[PlanStatus]] = Field(None, description="ステータス")
    visibility: Optional[List[PlanVisibility]] = Field(None, description="公開設定")
    tags: Optional[List[str]] = Field(None, description="タグ")
    start_date_from: Optional[date] = Field(None, description="開始日（以降）")
    start_date_to: Optional[date] = Field(None, description="開始日（以前）")
    duration_min: Optional[int] = Field(None, description="最短期間（日）")
    duration_max: Optional[int] = Field(None, description="最長期間（日）")


class SpotSearchFilters(BaseModel):
    """スポット検索フィルター"""
    query: Optional[str] = Field(None, description="検索キーワード")
    category: Optional[List[EventType]] = Field(None, description="カテゴリ")
    location: Optional[Location] = Field(None, description="中心位置")
    radius: Optional[float] = Field(None, description="検索半径（km）", ge=0.1, le=100)
    rating_min: Optional[float] = Field(None, description="最低評価", ge=0, le=5)
    price_range: Optional[str] = Field(None, description="価格帯")
    tags: Optional[List[str]] = Field(None, description="タグ")


# ==========================================
# レスポンス統一
# ==========================================

class TravelPlanListResponse(PaginatedResponse):
    """旅行プラン一覧レスポンス"""
    data: List[TravelPlanResponse]


class SpotListResponse(PaginatedResponse):
    """観光スポット一覧レスポンス"""
    data: List[SpotResponse]


class TravelResponse(BaseResponse):
    """旅行関連統一レスポンス"""
    data: Optional[Dict[str, Any]] = None


# ==========================================
# ドラッグ&ドロップ対応
# ==========================================

class EventReorderRequest(BaseModel):
    """イベント並び替えリクエスト"""
    event_id: UUID = Field(..., description="移動するイベントID")
    target_day_id: UUID = Field(..., description="移動先の日ID")
    new_order_index: int = Field(..., description="新しい並び順", ge=0)
    time_adjustment: bool = Field(default=True, description="時間自動調整")


class BatchEventUpdate(BaseModel):
    """一括イベント更新"""
    updates: List[Dict[str, Any]] = Field(..., description="更新データ", max_items=50)
    auto_optimize: bool = Field(default=False, description="自動最適化")


# ==========================================
# 統計・分析
# ==========================================

class PlanStatistics(BaseModel):
    """プラン統計"""
    total_plans: int = 0
    active_plans: int = 0
    completed_plans: int = 0
    total_destinations: int = 0
    total_events: int = 0
    average_plan_duration: float = 0
    most_visited_destinations: List[Dict[str, Any]] = []
    popular_event_types: List[Dict[str, Any]] = []
    
    class Config:
        schema_extra = {
            "example": {
                "total_plans": 15,
                "active_plans": 3,
                "completed_plans": 10,
                "total_destinations": 8,
                "total_events": 127,
                "average_plan_duration": 3.2,
                "most_visited_destinations": [
                    {"destination": "東京", "count": 5},
                    {"destination": "京都", "count": 3}
                ],
                "popular_event_types": [
                    {"type": "sightseeing", "count": 45},
                    {"type": "restaurant", "count": 32}
                ]
            }
        }
