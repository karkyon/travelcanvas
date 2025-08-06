"""
TravelCanvas Backend - 共通スキーマ
API レスポンス、ページネーション、エラーハンドリングの統一
"""

from typing import Optional, Any, Dict, List, Generic, TypeVar, Union
from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic.generics import GenericModel


# ==========================================
# 共通Enum定義
# ==========================================

class ResponseStatus(str, Enum):
    """レスポンスステータス"""
    SUCCESS = "success"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class SortOrder(str, Enum):
    """ソート順序"""
    ASC = "asc"
    DESC = "desc"


class LogLevel(str, Enum):
    """ログレベル"""
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


# ==========================================
# 基本レスポンス
# ==========================================

class BaseResponse(BaseModel):
    """基本APIレスポンス"""
    success: bool = Field(..., description="処理成功フラグ")
    message: str = Field(..., description="レスポンスメッセージ")
    timestamp: float = Field(..., description="タイムスタンプ（UNIX時間）")
    request_id: Optional[str] = Field(None, description="リクエストID")
    
    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "処理が正常に完了しました",
                "timestamp": 1704067200.0,
                "request_id": "req_abc123def456"
            }
        }


T = TypeVar('T')

class DataResponse(GenericModel, Generic[T]):
    """データ付きレスポンス"""
    success: bool = Field(..., description="処理成功フラグ")
    message: str = Field(..., description="レスポンスメッセージ")
    data: T = Field(..., description="レスポンスデータ")
    timestamp: float = Field(..., description="タイムスタンプ（UNIX時間）")
    request_id: Optional[str] = Field(None, description="リクエストID")


class ErrorDetail(BaseModel):
    """エラー詳細"""
    field: Optional[str] = Field(None, description="エラーフィールド")
    code: str = Field(..., description="エラーコード")
    message: str = Field(..., description="エラーメッセージ")
    value: Optional[Any] = Field(None, description="エラー値")


class ErrorResponse(BaseResponse):
    """エラーレスポンス"""
    success: bool = Field(default=False, description="処理成功フラグ")
    error_code: str = Field(..., description="エラーコード")
    error_type: str = Field(..., description="エラータイプ")
    details: Optional[List[ErrorDetail]] = Field(None, description="エラー詳細")
    help_url: Optional[str] = Field(None, description="ヘルプURL")
    
    class Config:
        schema_extra = {
            "example": {
                "success": False,
                "message": "バリデーションエラーが発生しました",
                "error_code": "VALIDATION_ERROR",
                "error_type": "ValidationError",
                "details": [
                    {
                        "field": "email",
                        "code": "INVALID_FORMAT",
                        "message": "メールアドレスの形式が正しくありません",
                        "value": "invalid-email"
                    }
                ],
                "timestamp": 1704067200.0,
                "help_url": "https://docs.travelcanvas.com/errors/validation"
            }
        }


# ==========================================
# ページネーション
# ==========================================

class PaginationMeta(BaseModel):
    """ページネーション情報"""
    page: int = Field(..., description="現在のページ番号", ge=1)
    page_size: int = Field(..., description="1ページあたりの項目数", ge=1, le=100)
    total_items: int = Field(..., description="総項目数", ge=0)
    total_pages: int = Field(..., description="総ページ数", ge=0)
    has_next: bool = Field(..., description="次のページがあるか")
    has_previous: bool = Field(..., description="前のページがあるか")
    next_page: Optional[int] = Field(None, description="次のページ番号")
    previous_page: Optional[int] = Field(None, description="前のページ番号")
    
    class Config:
        schema_extra = {
            "example": {
                "page": 2,
                "page_size": 20,
                "total_items": 157,
                "total_pages": 8,
                "has_next": True,
                "has_previous": True,
                "next_page": 3,
                "previous_page": 1
            }
        }


class PaginatedResponse(BaseResponse):
    """ページネーション付きレスポンス"""
    data: List[Any] = Field(..., description="データリスト")
    pagination: PaginationMeta = Field(..., description="ページネーション情報")


class PaginationParams(BaseModel):
    """ページネーションパラメータ"""
    page: int = Field(default=1, description="ページ番号", ge=1)
    page_size: int = Field(default=20, description="1ページあたりの項目数", ge=1, le=100)
    
    def offset(self) -> int:
        """オフセット計算"""
        return (self.page - 1) * self.page_size
    
    def limit(self) -> int:
        """リミット取得"""
        return self.page_size


# ==========================================
# ソート・フィルタリング
# ==========================================

class SortParam(BaseModel):
    """ソートパラメータ"""
    field: str = Field(..., description="ソートフィールド")
    order: SortOrder = Field(default=SortOrder.ASC, description="ソート順序")
    
    class Config:
        schema_extra = {
            "example": {
                "field": "created_at",
                "order": "desc"
            }
        }


class FilterParams(BaseModel):
    """基本フィルターパラメータ"""
    search: Optional[str] = Field(None, description="検索キーワード", max_length=200)
    created_after: Optional[datetime] = Field(None, description="作成日時（以降）")
    created_before: Optional[datetime] = Field(None, description="作成日時（以前）")
    updated_after: Optional[datetime] = Field(None, description="更新日時（以降）")
    updated_before: Optional[datetime] = Field(None, description="更新日時（以前）")


class SearchParams(BaseModel):
    """検索パラメータ"""
    query: str = Field(..., description="検索クエリ", min_length=1, max_length=200)
    exact_match: bool = Field(default=False, description="完全一致検索")
    case_sensitive: bool = Field(default=False, description="大文字小文字を区別")
    fields: Optional[List[str]] = Field(None, description="検索対象フィールド")
    
    class Config:
        schema_extra = {
            "example": {
                "query": "東京 観光",
                "exact_match": False,
                "case_sensitive": False,
                "fields": ["title", "description", "tags"]
            }
        }


# ==========================================
# ファイル・メディア関連
# ==========================================

class FileInfo(BaseModel):
    """ファイル情報"""
    filename: str = Field(..., description="ファイル名")
    content_type: str = Field(..., description="コンテンツタイプ")
    size: int = Field(..., description="ファイルサイズ（バイト）", ge=0)
    url: str = Field(..., description="ファイルURL")
    thumbnail_url: Optional[str] = Field(None, description="サムネイルURL")
    
    class Config:
        schema_extra = {
            "example": {
                "filename": "tokyo-tower.jpg",
                "content_type": "image/jpeg",
                "size": 2048576,
                "url": "https://cdn.travelcanvas.com/images/tokyo-tower.jpg",
                "thumbnail_url": "https://cdn.travelcanvas.com/thumbnails/tokyo-tower.jpg"
            }
        }


class ImageUploadResponse(BaseResponse):
    """画像アップロードレスポンス"""
    data: FileInfo


class FileUploadRequest(BaseModel):
    """ファイルアップロードリクエスト"""
    purpose: str = Field(..., description="アップロード目的")
    folder: Optional[str] = Field(None, description="保存フォルダ")
    public: bool = Field(default=False, description="公開ファイル")
    
    class Config:
        schema_extra = {
            "example": {
                "purpose": "profile_avatar",
                "folder": "users/avatars",
                "public": True
            }
        }


# ==========================================
# 位置情報・地理データ
# ==========================================

class Coordinates(BaseModel):
    """座標情報"""
    latitude: float = Field(..., description="緯度", ge=-90, le=90)
    longitude: float = Field(..., description="経度", ge=-180, le=180)
    altitude: Optional[float] = Field(None, description="高度（メートル）")
    accuracy: Optional[float] = Field(None, description="精度（メートル）", ge=0)
    
    class Config:
        schema_extra = {
            "example": {
                "latitude": 35.6762,
                "longitude": 139.6503,
                "altitude": 10.5,
                "accuracy": 5.0
            }
        }


class BoundingBox(BaseModel):
    """境界ボックス"""
    north: float = Field(..., description="北緯", ge=-90, le=90)
    south: float = Field(..., description="南緯", ge=-90, le=90)
    east: float = Field(..., description="東経", ge=-180, le=180)
    west: float = Field(..., description="西経", ge=-180, le=180)


class GeographicArea(BaseModel):
    """地理的範囲"""
    center: Coordinates = Field(..., description="中心座標")
    radius: float = Field(..., description="半径（km）", gt=0)
    bounding_box: Optional[BoundingBox] = Field(None, description="境界ボックス")


# ==========================================
# 統計・メトリクス
# ==========================================

class CountMetric(BaseModel):
    """カウント指標"""
    label: str = Field(..., description="指標名")
    count: int = Field(..., description="件数", ge=0)
    percentage: Optional[float] = Field(None, description="割合", ge=0, le=100)
    
    class Config:
        schema_extra = {
            "example": {
                "label": "完了済みプラン",
                "count": 15,
                "percentage": 75.0
            }
        }


class TimeSeriesData(BaseModel):
    """時系列データ"""
    timestamp: datetime = Field(..., description="タイムスタンプ")
    value: float = Field(..., description="値")
    label: Optional[str] = Field(None, description="ラベル")


class StatisticsSummary(BaseModel):
    """統計サマリー"""
    total: int = Field(..., description="総数", ge=0)
    average: Optional[float] = Field(None, description="平均値")
    minimum: Optional[float] = Field(None, description="最小値")
    maximum: Optional[float] = Field(None, description="最大値")
    median: Optional[float] = Field(None, description="中央値")
    
    class Config:
        schema_extra = {
            "example": {
                "total": 125,
                "average": 3.2,
                "minimum": 1.0,
                "maximum": 7.0,
                "median": 3.0
            }
        }


# ==========================================
# API制限・レート制限
# ==========================================

class RateLimitInfo(BaseModel):
    """レート制限情報"""
    limit: int = Field(..., description="制限値", ge=0)
    remaining: int = Field(..., description="残り回数", ge=0)
    reset_time: datetime = Field(..., description="リセット時刻")
    retry_after: Optional[int] = Field(None, description="再試行までの秒数", ge=0)
    
    class Config:
        schema_extra = {
            "example": {
                "limit": 1000,
                "remaining": 847,
                "reset_time": "2024-01-01T01:00:00Z",
                "retry_after": None
            }
        }


class APIUsageInfo(BaseModel):
    """API使用状況"""
    user_id: UUID = Field(..., description="ユーザーID")
    endpoint: str = Field(..., description="エンドポイント")
    method: str = Field(..., description="HTTPメソッド")
    requests_today: int = Field(..., description="今日のリクエスト数", ge=0)
    requests_this_hour: int = Field(..., description="今時間のリクエスト数", ge=0)
    rate_limit: RateLimitInfo = Field(..., description="レート制限情報")


# ==========================================
# 通知・アラート
# ==========================================

class NotificationLevel(str, Enum):
    """通知レベル"""
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class Notification(BaseModel):
    """通知"""
    id: UUID = Field(..., description="通知ID")
    title: str = Field(..., description="タイトル", max_length=200)
    message: str = Field(..., description="メッセージ", max_length=1000)
    level: NotificationLevel = Field(..., description="通知レベル")
    read: bool = Field(default=False, description="既読フラグ")
    created_at: datetime = Field(..., description="作成日時")
    expires_at: Optional[datetime] = Field(None, description="有効期限")
    action_url: Optional[str] = Field(None, description="アクションURL")
    metadata: Optional[Dict[str, Any]] = Field(None, description="メタデータ")
    
    class Config:
        from_attributes = True
        schema_extra = {
            "example": {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "title": "プランが最適化されました",
                "message": "東京観光プランの最適化が完了しました。15分の時間短縮が可能です。",
                "level": "success",
                "read": False,
                "created_at": "2024-01-01T10:00:00Z",
                "action_url": "/plans/123e4567-e89b-12d3-a456-426614174000"
            }
        }


# ==========================================
# 設定・環境情報
# ==========================================

class SystemStatus(BaseModel):
    """システム状態"""
    status: str = Field(..., description="システム状態")
    version: str = Field(..., description="バージョン")
    uptime: float = Field(..., description="稼働時間（秒）", ge=0)
    database_status: str = Field(..., description="データベース状態")
    redis_status: str = Field(..., description="Redis状態")
    ai_service_status: str = Field(..., description="AIサービス状態")
    last_health_check: datetime = Field(..., description="最終ヘルスチェック")
    
    class Config:
        schema_extra = {
            "example": {
                "status": "healthy",
                "version": "1.0.0",
                "uptime": 86400.0,
                "database_status": "connected",
                "redis_status": "connected",
                "ai_service_status": "available",
                "last_health_check": "2024-01-01T12:00:00Z"
            }
        }


class FeatureFlag(BaseModel):
    """機能フラグ"""
    name: str = Field(..., description="機能名")
    enabled: bool = Field(..., description="有効フラグ")
    description: Optional[str] = Field(None, description="説明")
    user_groups: Optional[List[str]] = Field(None, description="対象ユーザーグループ")
    
    class Config:
        schema_extra = {
            "example": {
                "name": "ai_optimization_v2",
                "enabled": True,
                "description": "新しいAI最適化エンジン",
                "user_groups": ["premium", "beta_testers"]
            }
        }


# ==========================================
# バリデーション・ヘルパー
# ==========================================

class ValidationRule(BaseModel):
    """バリデーションルール"""
    field: str = Field(..., description="対象フィールド")
    rule_type: str = Field(..., description="ルールタイプ")
    parameters: Dict[str, Any] = Field(..., description="パラメータ")
    error_message: str = Field(..., description="エラーメッセージ")


class BulkOperationRequest(BaseModel):
    """一括操作リクエスト"""
    operation: str = Field(..., description="操作タイプ")
    target_ids: List[UUID] = Field(..., description="対象ID", max_items=100)
    parameters: Optional[Dict[str, Any]] = Field(None, description="操作パラメータ")
    
    class Config:
        schema_extra = {
            "example": {
                "operation": "delete",
                "target_ids": [
                    "123e4567-e89b-12d3-a456-426614174000",
                    "123e4567-e89b-12d3-a456-426614174001"
                ],
                "parameters": {
                    "soft_delete": True,
                    "send_notification": False
                }
            }
        }


class BulkOperationResult(BaseModel):
    """一括操作結果"""
    operation: str = Field(..., description="操作タイプ")
    total_count: int = Field(..., description="総数", ge=0)
    success_count: int = Field(..., description="成功数", ge=0)
    error_count: int = Field(..., description="エラー数", ge=0)
    errors: List[ErrorDetail] = Field(default=[], description="エラー詳細")
    
    class Config:
        schema_extra = {
            "example": {
                "operation": "delete",
                "total_count": 5,
                "success_count": 4,
                "error_count": 1,
                "errors": [
                    {
                        "field": "target_ids[2]",
                        "code": "NOT_FOUND",
                        "message": "指定されたリソースが見つかりません"
                    }
                ]
            }
        }


# ==========================================
# ヘルスチェック・診断
# ==========================================

class HealthCheck(BaseModel):
    """ヘルスチェック"""
    service: str = Field(..., description="サービス名")
    status: str = Field(..., description="状態")
    response_time: float = Field(..., description="応答時間（ミリ秒）", ge=0)
    timestamp: datetime = Field(..., description="チェック時刻")
    details: Optional[Dict[str, Any]] = Field(None, description="詳細情報")
    
    class Config:
        schema_extra = {
            "example": {
                "service": "database",
                "status": "healthy",
                "response_time": 12.5,
                "timestamp": "2024-01-01T12:00:00Z",
                "details": {
                    "connection_pool": "8/10",
                    "active_connections": 3
                }
            }
        }


class SystemDiagnostics(BaseModel):
    """システム診断"""
    overall_status: str = Field(..., description="全体状態")
    checks: List[HealthCheck] = Field(..., description="チェック結果")
    performance_metrics: Dict[str, float] = Field(..., description="パフォーマンス指標")
    resource_usage: Dict[str, Any] = Field(..., description="リソース使用状況")
    
    class Config:
        schema_extra = {
            "example": {
                "overall_status": "healthy",
                "performance_metrics": {
                    "avg_response_time": 145.6,
                    "requests_per_minute": 2847,
                    "error_rate": 0.02
                },
                "resource_usage": {
                    "cpu_percent": 23.5,
                    "memory_percent": 67.2,
                    "disk_percent": 45.8
                }
            }
        }


# ==========================================
# ユーティリティ関数
# ==========================================

def create_success_response(
    message: str,
    data: Any = None,
    request_id: Optional[str] = None
) -> Dict[str, Any]:
    """成功レスポンス生成"""
    response = {
        "success": True,
        "message": message,
        "timestamp": datetime.now().timestamp()
    }
    
    if data is not None:
        response["data"] = data
    
    if request_id:
        response["request_id"] = request_id
    
    return response


def create_error_response(
    message: str,
    error_code: str,
    error_type: str = "Error",
    details: Optional[List[ErrorDetail]] = None,
    request_id: Optional[str] = None
) -> Dict[str, Any]:
    """エラーレスポンス生成"""
    response = {
        "success": False,
        "message": message,
        "error_code": error_code,
        "error_type": error_type,
        "timestamp": datetime.now().timestamp()
    }
    
    if details:
        response["details"] = [detail.dict() for detail in details]
    
    if request_id:
        response["request_id"] = request_id
    
    return response


def create_pagination_meta(
    page: int,
    page_size: int,
    total_items: int
) -> PaginationMeta:
    """ページネーション情報生成"""
    total_pages = (total_items + page_size - 1) // page_size
    
    return PaginationMeta(
        page=page,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_previous=page > 1,
        next_page=page + 1 if page < total_pages else None,
        previous_page=page - 1 if page > 1 else None
    )
