"""
TravelCanvas Backend - 統一Pydanticスキーマ（完成版）
API リクエスト・レスポンス形式の統一定義

改善点:
- リクエスト・レスポンススキーマの統一
- バリデーション機能の統合
- カスタムバリデーターの実装
- エラーレスポンス形式の統一
- 多言語対応メッセージ
- 競合分析に基づく差別化機能対応
"""

from typing import List, Dict, Any, Optional, Union, Generic, TypeVar, Literal
from datetime import datetime, date, time
from enum import Enum
import uuid
import re
from decimal import Decimal

from pydantic import (
    BaseModel, Field, validator, root_validator, 
    EmailStr, HttpUrl, constr, conint, confloat,
    UUID4, Json
)
from pydantic.generics import GenericModel

# アプリケーションインポート
from app.models.models import UserType, PlanStatus, EventCategory, OptimizationType, SharePermission


# ==========================================
# 基底スキーマクラス
# ==========================================

T = TypeVar('T')

class BaseSchema(BaseModel):
    """基底スキーマクラス"""
    
    class Config:
        # Pydantic設定
        use_enum_values = True
        allow_population_by_field_name = True
        validate_assignment = True
        arbitrary_types_allowed = True
        json_encoders = {
            datetime: lambda v: v.isoformat() if v else None,
            date: lambda v: v.isoformat() if v else None,
            uuid.UUID: lambda v: str(v) if v else None,
            Decimal: lambda v: float(v) if v else None,
        }
    
    def dict_exclude_none(self, **kwargs) -> Dict[str, Any]:
        """None値を除外した辞書取得"""
        return self.dict(exclude_none=True, **kwargs)


class TimestampMixin(BaseModel):
    """タイムスタンプミックスイン"""
    
    created_at: Optional[datetime] = Field(None, description="作成日時")
    updated_at: Optional[datetime] = Field(None, description="更新日時")


# ==========================================
# 共通レスポンススキーマ
# ==========================================

class BaseResponse(BaseSchema):
    """基底レスポンススキーマ"""
    
    success: bool = Field(True, description="成功フラグ")
    message: str = Field("", description="メッセージ")
    timestamp: float = Field(default_factory=lambda: datetime.now().timestamp(), description="タイムスタンプ")


class DataResponse(BaseResponse, GenericModel, Generic[T]):
    """データレスポンススキーマ"""
    
    data: Optional[T] = Field(None, description="データ")


class ListResponse(BaseResponse, GenericModel, Generic[T]):
    """リストレスポンススキーマ"""
    
    data: List[T] = Field(default_factory=list, description="データリスト")
    count: int = Field(0, description="データ件数")


class PaginationMeta(BaseSchema):
    """ページネーション情報"""
    
    page: int = Field(1, ge=1, description="現在ページ")
    page_size: int = Field(20, ge=1, le=100, description="ページサイズ")
    total_count: int = Field(0, ge=0, description="総件数")
    total_pages: int = Field(0, ge=0, description="総ページ数")
    has_next: bool = Field(False, description="次ページ有無")
    has_prev: bool = Field(False, description="前ページ有無")


class PaginatedResponse(BaseResponse, GenericModel, Generic[T]):
    """ページネーションレスポンススキーマ"""
    
    data: List[T] = Field(default_factory=list, description="データリスト")
    pagination: PaginationMeta = Field(..., description="ページネーション情報")


class ErrorResponse(BaseSchema):
    """エラーレスポンススキーマ"""
    
    success: bool = Field(False, description="成功フラグ")
    error: str = Field(..., description="エラータイプ")
    message: str = Field(..., description="エラーメッセージ")
    details: Optional[Dict[str, Any]] = Field(None, description="詳細情報")
    field_errors: Optional[Dict[str, List[str]]] = Field(None, description="フィールドエラー")
    error_code: Optional[str] = Field(None, description="エラーコード")
    timestamp: float = Field(default_factory=lambda: datetime.now().timestamp(), description="タイムスタンプ")


# ==========================================
# バリデーター・制約定義
# ==========================================

# 文字列制約
Username = constr(min_length=3, max_length=50, regex=r'^[a-zA-Z0-9_-]+$')
Password = constr(min_length=8, max_length=128)
Title = constr(min_length=1, max_length=300, strip_whitespace=True)
Description = constr(max_length=2000, strip_whitespace=True)
Location = constr(max_length=300, strip_whitespace=True)
Address = constr(max_length=500, strip_whitespace=True)

# 数値制約
Latitude = confloat(ge=-90, le=90)
Longitude = confloat(ge=-180, le=180)
Rating = confloat(ge=1, le=5)
Cost = confloat(ge=0)
Duration = conint(ge=0)


def validate_password_strength(password: str) -> str:
    """パスワード強度バリデーション"""
    
    if len(password) < 8:
        raise ValueError('パスワードは8文字以上である必要があります')
    
    # 文字種チェック
    has_upper = bool(re.search(r'[A-Z]', password))
    has_lower = bool(re.search(r'[a-z]', password))
    has_digit = bool(re.search(r'\d', password))
    has_special = bool(re.search(r'[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]', password))
    
    strength_score = sum([has_upper, has_lower, has_digit, has_special])
    
    if strength_score < 3:
        raise ValueError('パスワードは大文字、小文字、数字、記号のうち3種類以上を含む必要があります')
    
    # 弱いパスワードパターンチェック
    weak_patterns = ['password', '123456', 'qwerty', 'admin', 'guest']
    if any(pattern in password.lower() for pattern in weak_patterns):
        raise ValueError('一般的なパスワードパターンは使用できません')
    
    return password


def validate_phone_number(phone: str) -> str:
    """電話番号バリデーション"""
    
    # 日本の電話番号パターン
    patterns = [
        r'^\d{10,11}$',  # 09012345678, 0312345678
        r'^\+81\d{9,10}$',  # +819012345678
        r'^0\d{1,4}-\d{1,4}-\d{4}$',  # 090-1234-5678, 03-1234-5678
    ]
    
    clean_phone = re.sub(r'[\s\-\(\)]', '', phone)
    
    if not any(re.match(pattern, clean_phone) for pattern in patterns):
        raise ValueError('有効な電話番号を入力してください')
    
    return clean_phone


# ==========================================
# 認証関連スキーマ
# ==========================================

class UserBase(BaseSchema):
    """ユーザー基底スキーマ"""
    
    email: Optional[EmailStr] = Field(None, description="メールアドレス")
    username: Optional[Username] = Field(None, description="ユーザー名")
    full_name: Optional[constr(max_length=200)] = Field(None, description="氏名")
    phone_number: Optional[str] = Field(None, description="電話番号")
    bio: Optional[constr(max_length=500)] = Field(None, description="自己紹介")
    timezone: Optional[str] = Field("Asia/Tokyo", description="タイムゾーン")
    language: Optional[str] = Field("ja", description="言語設定")
    
    @validator('phone_number')
    def validate_phone(cls, v):
        if v:
            return validate_phone_number(v)
        return v
    
    @root_validator
    def validate_identity(cls, values):
        email = values.get('email')
        username = values.get('username')
        
        if not email and not username:
            raise ValueError('メールアドレスまたはユーザー名のいずれかは必須です')
        
        return values


class UserCreate(UserBase):
    """ユーザー作成スキーマ"""
    
    password: Password = Field(..., description="パスワード")
    password_confirm: str = Field(..., description="パスワード確認")
    terms_accepted: bool = Field(False, description="利用規約同意")
    
    @validator('password')
    def validate_password_strength(cls, v):
        return validate_password_strength(v)
    
    @root_validator
    def validate_passwords_match(cls, values):
        password = values.get('password')
        password_confirm = values.get('password_confirm')
        
        if password and password_confirm and password != password_confirm:
            raise ValueError('パスワードが一致しません')
        
        return values
    
    @validator('terms_accepted')
    def validate_terms(cls, v):
        if not v:
            raise ValueError('利用規約への同意が必要です')
        return v


class UserUpdate(UserBase):
    """ユーザー更新スキーマ"""
    
    current_password: Optional[str] = Field(None, description="現在のパスワード")
    new_password: Optional[Password] = Field(None, description="新しいパスワード")
    new_password_confirm: Optional[str] = Field(None, description="新しいパスワード確認")
    
    @validator('new_password')
    def validate_new_password_strength(cls, v):
        if v:
            return validate_password_strength(v)
        return v
    
    @root_validator
    def validate_password_change(cls, values):
        current_password = values.get('current_password')
        new_password = values.get('new_password')
        new_password_confirm = values.get('new_password_confirm')
        
        if new_password:
            if not current_password:
                raise ValueError('パスワードを変更するには現在のパスワードが必要です')
            
            if new_password != new_password_confirm:
                raise ValueError('新しいパスワードが一致しません')
        
        return values


class UserResponse(UserBase, TimestampMixin):
    """ユーザーレスポンススキーマ"""
    
    id: UUID4 = Field(..., description="ユーザーID")
    user_type: UserType = Field(..., description="ユーザータイプ")
    is_active: bool = Field(True, description="アクティブフラグ")
    is_verified: bool = Field(False, description="認証済みフラグ")
    email_verified_at: Optional[datetime] = Field(None, description="メール認証日時")
    last_login_at: Optional[datetime] = Field(None, description="最終ログイン日時")
    
    # 統計情報（オプション）
    travel_plans_count: Optional[int] = Field(None, description="旅行プラン数")
    
    class Config(UserBase.Config):
        orm_mode = True


class LoginRequest(BaseSchema):
    """ログインリクエストスキーマ"""
    
    email: Optional[EmailStr] = Field(None, description="メールアドレス")
    username: Optional[str] = Field(None, description="ユーザー名")
    password: str = Field(..., description="パスワード")
    remember_me: bool = Field(False, description="ログイン記憶")
    
    @root_validator
    def validate_identity(cls, values):
        email = values.get('email')
        username = values.get('username')
        
        if not email and not username:
            raise ValueError('メールアドレスまたはユーザー名のいずれかは必須です')
        
        return values


class LoginResponse(BaseResponse):
    """ログインレスポンススキーマ"""
    
    data: Dict[str, Any] = Field(..., description="認証データ")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "ログインに成功しました",
                "data": {
                    "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
                    "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
                    "token_type": "bearer",
                    "expires_in": 3600,
                    "user": {
                        "id": "123e4567-e89b-12d3-a456-426614174000",
                        "username": "testuser",
                        "email": "test@example.com",
                        "user_type": "registered"
                    }
                },
                "timestamp": 1635724800.0
            }
        }


class GuestSessionRequest(BaseSchema):
    """ゲストセッション作成リクエスト"""
    
    device_info: Optional[Dict[str, Any]] = Field(None, description="デバイス情報")


class TokenRefreshRequest(BaseSchema):
    """トークンリフレッシュリクエスト"""
    
    refresh_token: str = Field(..., description="リフレッシュトークン")


class PasswordResetRequest(BaseSchema):
    """パスワードリセットリクエスト"""
    
    email: EmailStr = Field(..., description="メールアドレス")


class PasswordResetConfirm(BaseSchema):
    """パスワードリセット確認"""
    
    token: str = Field(..., description="リセットトークン")
    new_password: Password = Field(..., description="新しいパスワード")
    new_password_confirm: str = Field(..., description="新しいパスワード確認")
    
    @validator('new_password')
    def validate_password_strength(cls, v):
        return validate_password_strength(v)
    
    @root_validator
    def validate_passwords_match(cls, values):
        password = values.get('new_password')
        password_confirm = values.get('new_password_confirm')
        
        if password and password_confirm and password != password_confirm:
            raise ValueError('パスワードが一致しません')
        
        return values


# ==========================================
# 旅行プラン関連スキーマ
# ==========================================

class TravelEventBase(BaseSchema):
    """旅行イベント基底スキーマ"""
    
    title: Title = Field(..., description="イベントタイトル")
    description: Optional[Description] = Field(None, description="イベント説明")
    category: EventCategory = Field(EventCategory.OTHER, description="カテゴリ")
    start_time: datetime = Field(..., description="開始時刻")
    end_time: datetime = Field(..., description="終了時刻")
    location: Optional[Location] = Field(None, description="場所名")
    address: Optional[Address] = Field(None, description="住所")
    latitude: Optional[Latitude] = Field(None, description="緯度")
    longitude: Optional[Longitude] = Field(None, description="経度")
    estimated_cost: Optional[Cost] = Field(None, description="推定費用")
    rating: Optional[Rating] = Field(None, description="評価")
    notes: Optional[Description] = Field(None, description="メモ")
    icon: Optional[str] = Field(None, description="アイコン名")
    booking_url: Optional[HttpUrl] = Field(None, description="予約URL")
    is_fixed: bool = Field(False, description="時間固定フラグ")
    
    @validator('end_time')
    def validate_time_order(cls, v, values):
        start_time = values.get('start_time')
        if start_time and v <= start_time:
            raise ValueError('終了時刻は開始時刻より後である必要があります')
        return v


class TravelEventCreate(TravelEventBase):
    """旅行イベント作成スキーマ"""
    pass


class TravelEventUpdate(BaseSchema):
    """旅行イベント更新スキーマ"""
    
    title: Optional[Title] = Field(None, description="イベントタイトル")
    description: Optional[Description] = Field(None, description="イベント説明")
    category: Optional[EventCategory] = Field(None, description="カテゴリ")
    start_time: Optional[datetime] = Field(None, description="開始時刻")
    end_time: Optional[datetime] = Field(None, description="終了時刻")
    location: Optional[Location] = Field(None, description="場所名")
    address: Optional[Address] = Field(None, description="住所")
    latitude: Optional[Latitude] = Field(None, description="緯度")
    longitude: Optional[Longitude] = Field(None, description="経度")
    estimated_cost: Optional[Cost] = Field(None, description="推定費用")
    rating: Optional[Rating] = Field(None, description="評価")
    notes: Optional[Description] = Field(None, description="メモ")
    icon: Optional[str] = Field(None, description="アイコン名")
    booking_url: Optional[HttpUrl] = Field(None, description="予約URL")
    is_fixed: Optional[bool] = Field(None, description="時間固定フラグ")


class TravelEventResponse(TravelEventBase, TimestampMixin):
    """旅行イベントレスポンススキーマ"""
    
    id: UUID4 = Field(..., description="イベントID")
    travel_day_id: UUID4 = Field(..., description="旅行日程ID")
    duration_minutes: Optional[int] = Field(None, description="所要時間（分）")
    actual_cost: Optional[Cost] = Field(None, description="実際の費用")
    order_index: int = Field(0, description="表示順序")
    image_urls: Optional[List[HttpUrl]] = Field(None, description="画像URL配列")
    
    class Config(TravelEventBase.Config):
        orm_mode = True


class TravelDayBase(BaseSchema):
    """旅行日程基底スキーマ"""
    
    day_number: conint(ge=1) = Field(..., description="日程番号")
    date: date = Field(..., description="日付")
    title: Optional[Title] = Field(None, description="日程タイトル")
    description: Optional[Description] = Field(None, description="日程説明")


class TravelDayCreate(TravelDayBase):
    """旅行日程作成スキーマ"""
    
    events: List[TravelEventCreate] = Field(default_factory=list, description="イベントリスト")


class TravelDayUpdate(BaseSchema):
    """旅行日程更新スキーマ"""
    
    title: Optional[Title] = Field(None, description="日程タイトル")
    description: Optional[Description] = Field(None, description="日程説明")


class TravelDayResponse(TravelDayBase, TimestampMixin):
    """旅行日程レスポンススキーマ"""
    
    id: UUID4 = Field(..., description="日程ID")
    travel_plan_id: UUID4 = Field(..., description="旅行プランID")
    total_events: int = Field(0, description="総イベント数")
    estimated_cost: Optional[Cost] = Field(None, description="推定費用")
    estimated_duration_minutes: Optional[int] = Field(None, description="推定所要時間")
    
    # 関連データ
    events: List[TravelEventResponse] = Field(default_factory=list, description="イベントリスト")
    
    class Config(TravelDayBase.Config):
        orm_mode = True


class TravelPlanBase(BaseSchema):
    """旅行プラン基底スキーマ"""
    
    title: Title = Field(..., description="プランタイトル")
    description: Optional[Description] = Field(None, description="プラン説明")
    destination: Location = Field(..., description="目的地")
    start_date: date = Field(..., description="開始日")
    end_date: date = Field(..., description="終了日")
    is_public: bool = Field(False, description="公開フラグ")
    tags: Optional[List[constr(max_length=50)]] = Field(None, description="タグ配列")
    
    @validator('end_date')
    def validate_date_order(cls, v, values):
        start_date = values.get('start_date')
        if start_date and v < start_date:
            raise ValueError('終了日は開始日以降である必要があります')
        return v
    
    @validator('tags')
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError('タグは20個以下である必要があります')
        return v


class TravelPlanCreate(TravelPlanBase):
    """旅行プラン作成スキーマ"""
    
    days: List[TravelDayCreate] = Field(default_factory=list, description="日程リスト")


class TravelPlanUpdate(BaseSchema):
    """旅行プラン更新スキーマ"""
    
    title: Optional[Title] = Field(None, description="プランタイトル")
    description: Optional[Description] = Field(None, description="プラン説明")
    destination: Optional[Location] = Field(None, description="目的地")
    start_date: Optional[date] = Field(None, description="開始日")
    end_date: Optional[date] = Field(None, description="終了日")
    status: Optional[PlanStatus] = Field(None, description="プラン状態")
    is_public: Optional[bool] = Field(None, description="公開フラグ")
    tags: Optional[List[constr(max_length=50)]] = Field(None, description="タグ配列")


class TravelPlanResponse(TravelPlanBase, TimestampMixin):
    """旅行プランレスポンススキーマ"""
    
    id: UUID4 = Field(..., description="プランID")
    user_id: UUID4 = Field(..., description="作成者ユーザーID")
    status: PlanStatus = Field(..., description="プラン状態")
    is_template: bool = Field(False, description="テンプレートフラグ")
    is_optimized: bool = Field(False, description="最適化済みフラグ")
    optimization_type: Optional[OptimizationType] = Field(None, description="最適化タイプ")
    optimization_score: Optional[float] = Field(None, description="最適化スコア")
    total_cost: Optional[Cost] = Field(None, description="総費用")
    total_duration_minutes: Optional[int] = Field(None, description="総所要時間")
    total_distance_km: Optional[float] = Field(None, description="総移動距離")
    share_token: Optional[str] = Field(None, description="共有トークン")
    
    # 計算プロパティ
    duration_days: Optional[int] = Field(None, description="期間（日数）")
    
    # 関連データ
    days: List[TravelDayResponse] = Field(default_factory=list, description="日程リスト")
    
    class Config(TravelPlanBase.Config):
        orm_mode = True


# ==========================================
# AI機能関連スキーマ
# ==========================================

class SearchRequest(BaseSchema):
    """検索リクエストスキーマ"""
    
    query: constr(min_length=1, max_length=500) = Field(..., description="検索クエリ")
    location: Optional[str] = Field(None, description="検索地域")
    category: Optional[EventCategory] = Field(None, description="カテゴリフィルター")
    max_results: conint(ge=1, le=50) = Field(10, description="最大結果数")


class ImageSearchRequest(BaseSchema):
    """画像検索リクエストスキーマ"""
    
    image_url: Optional[HttpUrl] = Field(None, description="画像URL")
    image_base64: Optional[str] = Field(None, description="Base64エンコード画像")
    location: Optional[str] = Field(None, description="検索地域")
    max_results: conint(ge=1, le=20) = Field(10, description="最大結果数")
    
    @root_validator
    def validate_image_source(cls, values):
        image_url = values.get('image_url')
        image_base64 = values.get('image_base64')
        
        if not image_url and not image_base64:
            raise ValueError('画像URLまたはBase64画像のいずれかは必須です')
        
        return values


class VoiceSearchRequest(BaseSchema):
    """音声検索リクエストスキーマ"""
    
    audio_url: Optional[HttpUrl] = Field(None, description="音声URL")
    audio_base64: Optional[str] = Field(None, description="Base64エンコード音声")
    language: str = Field("ja", description="音声言語")
    max_results: conint(ge=1, le=20) = Field(10, description="最大結果数")
    
    @root_validator
    def validate_audio_source(cls, values):
        audio_url = values.get('audio_url')
        audio_base64 = values.get('audio_base64')
        
        if not audio_url and not audio_base64:
            raise ValueError('音声URLまたはBase64音声のいずれかは必須です')
        
        return values


class SearchResult(BaseSchema):
    """検索結果スキーマ"""
    
    id: str = Field(..., description="結果ID")
    title: str = Field(..., description="タイトル")
    description: Optional[str] = Field(None, description="説明")
    category: EventCategory = Field(..., description="カテゴリ")
    location: Optional[str] = Field(None, description="場所")
    address: Optional[str] = Field(None, description="住所")
    latitude: Optional[Latitude] = Field(None, description="緯度")
    longitude: Optional[Longitude] = Field(None, description="経度")
    rating: Optional[Rating] = Field(None, description="評価")
    price_range: Optional[str] = Field(None, description="価格帯")
    opening_hours: Optional[str] = Field(None, description="営業時間")
    website: Optional[HttpUrl] = Field(None, description="ウェブサイト")
    phone: Optional[str] = Field(None, description="電話番号")
    image_url: Optional[HttpUrl] = Field(None, description="画像URL")
    source: str = Field(..., description="データソース")
    confidence: float = Field(..., description="信頼度スコア")


class SearchResponse(DataResponse[List[SearchResult]]):
    """検索レスポンススキーマ"""
    
    query_info: Dict[str, Any] = Field(..., description="クエリ情報")
    processing_time_ms: float = Field(..., description="処理時間（ミリ秒）")


class OptimizationRequest(BaseSchema):
    """最適化リクエストスキーマ"""
    
    plan_id: UUID4 = Field(..., description="旅行プランID")
    optimization_type: OptimizationType = Field(OptimizationType.BALANCED, description="最適化タイプ")
    constraints: Optional[Dict[str, Any]] = Field(None, description="制約条件")
    preferences: Optional[Dict[str, Any]] = Field(None, description="優先度設定")


class OptimizationResult(BaseSchema):
    """最適化結果スキーマ"""
    
    success: bool = Field(..., description="最適化成功フラグ")
    optimization_type: OptimizationType = Field(..., description="最適化タイプ")
    score: float = Field(..., description="最適化スコア")
    improvements: Dict[str, Any] = Field(..., description="改善情報")
    processing_time_ms: float = Field(..., description="処理時間（ミリ秒）")
    
    # 最適化後のプラン
    optimized_plan: Optional[TravelPlanResponse] = Field(None, description="最適化後プラン")


class OptimizationResponse(DataResponse[OptimizationResult]):
    """最適化レスポンススキーマ"""
    pass


# ==========================================
# 共有関連スキーマ
# ==========================================

class PlanShareRequest(BaseSchema):
    """プラン共有リクエストスキーマ"""
    
    plan_id: UUID4 = Field(..., description="旅行プランID")
    permission: SharePermission = Field(SharePermission.VIEW_ONLY, description="共有権限")
    expires_at: Optional[datetime] = Field(None, description="有効期限")
    share_password: Optional[str] = Field(None, description="共有パスワード")
    invite_emails: Optional[List[EmailStr]] = Field(None, description="招待メールアドレス")
    
    @validator('invite_emails')
    def validate_invite_emails(cls, v):
        if v and len(v) > 10:
            raise ValueError('招待メールアドレスは10個以下である必要があります')
        return v


class PlanShareResponse(BaseSchema):
    """プラン共有レスポンススキーマ"""
    
    share_token: str = Field(..., description="共有トークン")
    share_url: HttpUrl = Field(..., description="共有URL")
    qr_code_url: Optional[HttpUrl] = Field(None, description="QRコードURL")
    permission: SharePermission = Field(..., description="共有権限")
    expires_at: Optional[datetime] = Field(None, description="有効期限")
    invited_count: int = Field(0, description="招待送信数")


# ==========================================
# 差別化機能スキーマ（競合分析対応）
# ==========================================

class TimeProgressRequest(BaseSchema):
    """現在時刻・進行状況リクエスト（行程さん復活機能）"""
    
    plan_id: UUID4 = Field(..., description="旅行プランID")
    current_time: Optional[datetime] = Field(None, description="現在時刻（テスト用）")
    timezone: Optional[str] = Field("Asia/Tokyo", description="タイムゾーン")


class NextEventInfo(BaseSchema):
    """次イベント情報"""
    
    event_id: UUID4 = Field(..., description="イベントID")
    title: str = Field(..., description="イベントタイトル")
    start_time: datetime = Field(..., description="開始時刻")
    end_time: datetime = Field(..., description="終了時刻")
    location: Optional[str] = Field(None, description="場所")
    time_until: str = Field(..., description="開始まで時間")
    is_current: bool = Field(False, description="進行中フラグ")
    is_overdue: bool = Field(False, description="遅延フラグ")


class ProgressIndicator(BaseSchema):
    """進行状況表示"""
    
    completed_events: int = Field(0, description="完了イベント数")
    total_events: int = Field(0, description="総イベント数")
    current_day: int = Field(1, description="現在日程")
    total_days: int = Field(1, description="総日程数")
    day_progress: float = Field(0.0, description="日程進行率")
    overall_progress: float = Field(0.0, description="全体進行率")


class TimeProgressResponse(DataResponse[Dict[str, Any]]):
    """時刻進行状況レスポンス"""
    
    current_time: datetime = Field(..., description="現在時刻")
    next_event: Optional[NextEventInfo] = Field(None, description="次イベント")
    progress: ProgressIndicator = Field(..., description="進行状況")


class DayNavigationRequest(BaseSchema):
    """日付ジャンプナビゲーションリクエスト（Pen復活機能）"""
    
    plan_id: UUID4 = Field(..., description="旅行プランID")
    target_day: Optional[int] = Field(None, description="移動対象日")


class DayTab(BaseSchema):
    """日付タブ情報"""
    
    day_number: int = Field(..., description="日程番号")
    date: date = Field(..., description="日付")
    day_of_week: str = Field(..., description="曜日")
    is_active: bool = Field(False, description="アクティブフラグ")
    is_completed: bool = Field(False, description="完了フラグ")
    event_count: int = Field(0, description="イベント数")
    status: Literal['upcoming', 'current', 'completed'] = Field('upcoming', description="ステータス")


class DayOverview(BaseSchema):
    """日程概要"""
    
    day_number: int = Field(..., description="日程番号")
    total_events: int = Field(0, description="総イベント数")
    completed_events: int = Field(0, description="完了イベント数")
    estimated_duration: int = Field(0, description="推定所要時間（分）")
    estimated_cost: float = Field(0.0, description="推定費用")
    highlights: List[str] = Field(default_factory=list, description="ハイライト")


class DayNavigationResponse(DataResponse[Dict[str, Any]]):
    """日付ナビゲーションレスポンス"""
    
    day_tabs: List[DayTab] = Field(..., description="日付タブ配列")
    day_overviews: List[DayOverview] = Field(..., description="日程概要配列")
    current_day: int = Field(1, description="現在日程")


class SmartDragDropRequest(BaseSchema):
    """高度ドラッグ&ドロップリクエスト"""
    
    plan_id: UUID4 = Field(..., description="旅行プランID")
    dragged_event_ids: List[UUID4] = Field(..., description="ドラッグ対象イベントID配列")
    target_day: int = Field(..., description="ドロップ先日程")
    target_position: int = Field(..., description="ドロップ先位置")
    smart_optimization: bool = Field(True, description="スマート最適化有効")


class DropSuggestion(BaseSchema):
    """ドロップ位置提案"""
    
    position: int = Field(..., description="推奨位置")
    score: float = Field(..., description="適合スコア")
    reason: str = Field(..., description="推奨理由")
    time_adjustment: Optional[Dict[str, Any]] = Field(None, description="時間調整提案")


class ConflictResolution(BaseSchema):
    """競合解決案"""
    
    conflict_type: str = Field(..., description="競合タイプ")
    resolution_type: str = Field(..., description="解決方法")
    affected_events: List[UUID4] = Field(..., description="影響イベント")
    adjustments: Dict[str, Any] = Field(..., description="調整内容")
    score: float = Field(..., description="解決案スコア")


class SmartDragDropResponse(DataResponse[Dict[str, Any]]):
    """スマートドラッグ&ドロップレスポンス"""
    
    success: bool = Field(..., description="実行成功フラグ")
    drop_suggestions: List[DropSuggestion] = Field(default_factory=list, description="ドロップ提案")
    conflict_resolutions: List[ConflictResolution] = Field(default_factory=list, description="競合解決案")
    updated_plan: Optional[TravelPlanResponse] = Field(None, description="更新後プラン")


class TemplateRequest(BaseSchema):
    """テンプレート関連リクエスト"""
    
    destination: str = Field(..., description="目的地")
    duration_days: conint(ge=1, le=30) = Field(..., description="日数")
    budget_range: Optional[str] = Field(None, description="予算帯")
    travel_style: Optional[str] = Field(None, description="旅行スタイル")
    interests: Optional[List[str]] = Field(None, description="興味・関心")


class TemplateResponse(DataResponse[List[TravelPlanResponse]]):
    """テンプレートレスポンス"""
    
    recommended_templates: List[TravelPlanResponse] = Field(..., description="推奨テンプレート")
    popularity_score: Dict[str, float] = Field(..., description="人気度スコア")


# ==========================================
# 管理機能スキーマ
# ==========================================

class AdminUserResponse(UserResponse):
    """管理用ユーザーレスポンス"""
    
    total_plans: int = Field(0, description="総プラン数")
    active_sessions: int = Field(0, description="アクティブセッション数")
    last_activity: Optional[datetime] = Field(None, description="最終活動日時")
    registration_source: Optional[str] = Field(None, description="登録元")


class SystemStatsResponse(BaseResponse):
    """システム統計レスポンス"""
    
    data: Dict[str, Any] = Field(..., description="統計データ")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "システム統計を取得しました",
                "data": {
                    "total_users": 1500,
                    "active_users_today": 89,
                    "total_plans": 3200,
                    "plans_created_today": 23,
                    "optimization_requests_today": 45,
                    "search_requests_today": 234
                },
                "timestamp": 1635724800.0
            }
        }


class AuditLog(BaseSchema):
    """監査ログスキーマ"""
    
    id: UUID4 = Field(..., description="ログID")
    user_id: Optional[UUID4] = Field(None, description="ユーザーID")
    action: str = Field(..., description="アクション")
    resource_type: str = Field(..., description="リソースタイプ")
    resource_id: Optional[UUID4] = Field(None, description="リソースID")
    ip_address: Optional[str] = Field(None, description="IPアドレス")
    user_agent: Optional[str] = Field(None, description="ユーザーエージェント")
    details: Optional[Dict[str, Any]] = Field(None, description="詳細情報")
    created_at: datetime = Field(..., description="作成日時")


class AuditLogResponse(PaginatedResponse[AuditLog]):
    """監査ログレスポンス"""
    pass


# ==========================================
# 通知関連スキーマ
# ==========================================

class NotificationRequest(BaseSchema):
    """通知リクエスト"""
    
    user_id: UUID4 = Field(..., description="ユーザーID")
    type: str = Field(..., description="通知タイプ")
    title: str = Field(..., description="通知タイトル")
    message: str = Field(..., description="通知メッセージ")
    action_url: Optional[HttpUrl] = Field(None, description="アクションURL")
    scheduled_at: Optional[datetime] = Field(None, description="配信予定日時")


class NotificationResponse(BaseSchema, TimestampMixin):
    """通知レスポンス"""
    
    id: UUID4 = Field(..., description="通知ID")
    user_id: UUID4 = Field(..., description="ユーザーID")
    type: str = Field(..., description="通知タイプ")
    title: str = Field(..., description="通知タイトル")
    message: str = Field(..., description="通知メッセージ")
    is_read: bool = Field(False, description="既読フラグ")
    action_url: Optional[HttpUrl] = Field(None, description="アクションURL")
    sent_at: Optional[datetime] = Field(None, description="配信日時")
    
    class Config:
        orm_mode = True


# ==========================================
# ファイル・メディア関連スキーマ
# ==========================================

class FileUploadRequest(BaseSchema):
    """ファイルアップロードリクエスト"""
    
    file_type: str = Field(..., description="ファイルタイプ")
    file_size: int = Field(..., description="ファイルサイズ")
    content_type: str = Field(..., description="コンテンツタイプ")
    purpose: str = Field(..., description="用途")


class FileUploadResponse(BaseResponse):
    """ファイルアップロードレスポンス"""
    
    data: Dict[str, Any] = Field(..., description="アップロード情報")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "ファイルのアップロード準備が完了しました",
                "data": {
                    "upload_url": "https://storage.example.com/upload/...",
                    "file_id": "123e4567-e89b-12d3-a456-426614174000",
                    "expires_at": "2023-12-01T10:00:00Z"
                },
                "timestamp": 1635724800.0
            }
        }


# ==========================================
# ユーティリティ関数
# ==========================================

def create_success_response(
    message: str = "成功しました",
    data: Any = None
) -> Dict[str, Any]:
    """成功レスポンス作成"""
    
    response = {
        "success": True,
        "message": message,
        "timestamp": datetime.now().timestamp()
    }
    
    if data is not None:
        response["data"] = data
    
    return response


def create_error_response(
    error: str,
    message: str,
    details: Optional[Dict[str, Any]] = None,
    field_errors: Optional[Dict[str, List[str]]] = None,
    error_code: Optional[str] = None
) -> Dict[str, Any]:
    """エラーレスポンス作成"""
    
    response = {
        "success": False,
        "error": error,
        "message": message,
        "timestamp": datetime.now().timestamp()
    }
    
    if details:
        response["details"] = details
    
    if field_errors:
        response["field_errors"] = field_errors
    
    if error_code:
        response["error_code"] = error_code
    
    return response


def create_pagination_meta(
    page: int,
    page_size: int,
    total_count: int
) -> PaginationMeta:
    """ページネーション情報作成"""
    
    total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 0
    
    return PaginationMeta(
        page=page,
        page_size=page_size,
        total_count=total_count,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_prev=page > 1
    )


def validate_date_range(start_date: date, end_date: date, max_days: int = 365) -> bool:
    """日付範囲バリデーション"""
    
    if end_date < start_date:
        raise ValueError('終了日は開始日以降である必要があります')
    
    duration = (end_date - start_date).days + 1
    if duration > max_days:
        raise ValueError(f'旅行期間は{max_days}日以下である必要があります')
    
    return True


def sanitize_search_query(query: str) -> str:
    """検索クエリのサニタイズ"""
    
    # 危険な文字の除去
    query = re.sub(r'[<>"\'\\\x00-\x1f\x7f]', '', query)
    
    # 連続空白の正規化
    query = re.sub(r'\s+', ' ', query.strip())
    
    return query


def generate_share_token() -> str:
    """共有トークン生成"""
    
    import secrets
    import string
    
    # 8文字のランダム文字列
    characters = string.ascii_letters + string.digits
    return ''.join(secrets.choice(characters) for _ in range(8))


# ==========================================
# エクスポート
# ==========================================

__all__ = [
    # 基底クラス
    'BaseSchema',
    'TimestampMixin',
    
    # 共通レスポンス
    'BaseResponse',
    'DataResponse',
    'ListResponse',
    'PaginatedResponse',
    'PaginationMeta',
    'ErrorResponse',
    
    # 認証関連
    'UserBase',
    'UserCreate',
    'UserUpdate',
    'UserResponse',
    'LoginRequest',
    'LoginResponse',
    'GuestSessionRequest',
    'TokenRefreshRequest',
    'PasswordResetRequest',
    'PasswordResetConfirm',
    
    # 旅行プラン関連
    'TravelEventBase',
    'TravelEventCreate',
    'TravelEventUpdate',
    'TravelEventResponse',
    'TravelDayBase',
    'TravelDayCreate',
    'TravelDayUpdate',
    'TravelDayResponse',
    'TravelPlanBase',
    'TravelPlanCreate',
    'TravelPlanUpdate',
    'TravelPlanResponse',
    
    # AI機能関連
    'SearchRequest',
    'ImageSearchRequest',
    'VoiceSearchRequest',
    'SearchResult',
    'SearchResponse',
    'OptimizationRequest',
    'OptimizationResult',
    'OptimizationResponse',
    
    # 共有関連
    'PlanShareRequest',
    'PlanShareResponse',
    
    # 差別化機能（競合分析対応）
    'TimeProgressRequest',
    'NextEventInfo',
    'ProgressIndicator',
    'TimeProgressResponse',
    'DayNavigationRequest',
    'DayTab',
    'DayOverview',
    'DayNavigationResponse',
    'SmartDragDropRequest',
    'DropSuggestion',
    'ConflictResolution',
    'SmartDragDropResponse',
    'TemplateRequest',
    'TemplateResponse',
    
    # 管理機能
    'AdminUserResponse',
    'SystemStatsResponse',
    'AuditLog',
    'AuditLogResponse',
    
    # 通知関連
    'NotificationRequest',
    'NotificationResponse',
    
    # ファイル・メディア関連
    'FileUploadRequest',
    'FileUploadResponse',
    
    # ユーティリティ
    'create_success_response',
    'create_error_response',
    'create_pagination_meta',
    'validate_date_range',
    'sanitize_search_query',
    'generate_share_token',
    
    # バリデーター
    'validate_password_strength',
    'validate_phone_number',
    
    # 制約型
    'Username',
    'Password',
    'Title',
    'Description',
    'Location',
    'Address',
    'Latitude',
    'Longitude',
    'Rating',
    'Cost',
    'Duration'
]