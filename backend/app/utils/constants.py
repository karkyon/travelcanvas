"""
TravelCanvas 定数定義 (統合版)
~/travelcanvas/backend/app/utils/constants.py
"""

from enum import Enum
from typing import Dict, List, Any

# ===== アプリケーション基本定数 =====

APP_NAME = "TravelCanvas"
APP_VERSION = "1.0.0"
API_VERSION = "v1"

# ===== ユーザー関連定数 =====

class UserRole(str, Enum):
    """ユーザーロール"""
    GUEST = "guest"
    USER = "user"
    PREMIUM = "premium"
    ADMIN = "admin"

class UserStatus(str, Enum):
    """ユーザーステータス"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    DELETED = "deleted"

# ユーザー制限
USER_LIMITS = {
    UserRole.GUEST: {
        "max_plans": 3,
        "max_items_per_day": 10,
        "ai_requests_per_day": 10,
        "image_recognition_per_day": 5,
        "max_collaborators": 0,
        "max_file_size_mb": 5,
        "plan_retention_days": 7
    },
    UserRole.USER: {
        "max_plans": 50,
        "max_items_per_day": 50,
        "ai_requests_per_day": 100,
        "image_recognition_per_day": 30,
        "max_collaborators": 10,
        "max_file_size_mb": 10,
        "plan_retention_days": 365
    },
    UserRole.PREMIUM: {
        "max_plans": -1,  # 無制限
        "max_items_per_day": -1,
        "ai_requests_per_day": 500,
        "image_recognition_per_day": 100,
        "max_collaborators": 50,
        "max_file_size_mb": 50,
        "plan_retention_days": -1
    },
    UserRole.ADMIN: {
        "max_plans": -1,
        "max_items_per_day": -1,
        "ai_requests_per_day": -1,
        "image_recognition_per_day": -1,
        "max_collaborators": -1,
        "max_file_size_mb": 100,
        "plan_retention_days": -1
    }
}

# ===== 旅行プラン関連定数 =====

class PlanStatus(str, Enum):
    """旅行プラン状態"""
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    CANCELLED = "cancelled"

class PlanVisibility(str, Enum):
    """旅行プラン公開設定"""
    PRIVATE = "private"
    LINK_ONLY = "link_only"
    PUBLIC = "public"

class SpotCategory(str, Enum):
    """スポットカテゴリ"""
    SIGHTSEEING = "sightseeing"      # 観光
    RESTAURANT = "restaurant"        # レストラン
    SHOPPING = "shopping"            # ショッピング
    ACCOMMODATION = "accommodation"  # 宿泊
    TRANSPORT = "transport"          # 交通
    ACTIVITY = "activity"            # アクティビティ
    CULTURE = "culture"              # 文化・歴史
    NATURE = "nature"                # 自然

class ItemStatus(str, Enum):
    """スケジュールアイテム状態"""
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"

class ItemPriority(str, Enum):
    """スケジュールアイテム優先度"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

# 旅行プラン制限
PLAN_LIMITS = {
    "max_duration_days": 365,      # 最大期間
    "max_days_in_advance": 730,    # 最大何日先まで
    "max_title_length": 300,       # タイトル最大長
    "max_description_length": 2000, # 説明最大長
    "max_items_per_day": 20,       # 1日最大アイテム数
    "max_collaborators": 50        # 最大コラボレーター数
}

# ===== 最適化関連定数 =====

class OptimizationType(str, Enum):
    """最適化タイプ"""
    TIME = "time"           # 時間最適化
    COST = "cost"           # コスト最適化
    DISTANCE = "distance"   # 距離最適化
    BALANCED = "balanced"   # バランス最適化

class OptimizationStatus(str, Enum):
    """最適化状態"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class OptimizationAlgorithm(str, Enum):
    """最適化アルゴリズム"""
    OR_TOOLS_VRP = "or_tools_vrp"
    GENETIC_ALGORITHM = "genetic_algorithm"
    SIMULATED_ANNEALING = "simulated_annealing"
    NEAREST_NEIGHBOR = "nearest_neighbor"

# 最適化設定
OPTIMIZATION_CONFIG = {
    "default_algorithm": OptimizationAlgorithm.OR_TOOLS_VRP,
    "max_computation_time_seconds": 300,
    "quick_optimization_time_seconds": 30,
    "default_weights": {
        "time": 0.4,
        "cost": 0.3,
        "distance": 0.3
    },
    "max_iterations": 1000
}

# ===== 交通手段関連定数 =====

class TransportMode(str, Enum):
    """交通手段"""
    WALKING = "walking"
    BICYCLE = "bicycle"
    CAR = "car"
    MOTORCYCLE = "motorcycle"
    BUS = "bus"
    TRAIN = "train"
    SUBWAY = "subway"
    TAXI = "taxi"
    RIDESHARE = "rideshare"
    PLANE = "plane"
    FERRY = "ferry"
    SHINKANSEN = "shinkansen"

# 交通手段別設定
TRANSPORT_CONFIG = {
    TransportMode.WALKING: {
        "speed_kmh": 4,
        "cost_per_km": 0,
        "min_time_minutes": 5,
        "max_distance_km": 10,
        "icon": "🚶",
        "color": "#10b981"
    },
    TransportMode.BICYCLE: {
        "speed_kmh": 15,
        "cost_per_km": 0,
        "min_time_minutes": 3,
        "max_distance_km": 30,
        "icon": "🚴",
        "color": "#06b6d4"
    },
    TransportMode.CAR: {
        "speed_kmh": 30,
        "cost_per_km": 25,
        "min_time_minutes": 5,
        "max_distance_km": 500,
        "icon": "🚗",
        "color": "#3b82f6"
    },
    TransportMode.TRAIN: {
        "speed_kmh": 40,
        "cost_per_km": 20,
        "min_time_minutes": 10,
        "max_distance_km": 300,
        "icon": "🚃",
        "color": "#8b5cf6"
    },
    TransportMode.BUS: {
        "speed_kmh": 20,
        "cost_per_km": 15,
        "min_time_minutes": 10,
        "max_distance_km": 100,
        "icon": "🚌",
        "color": "#f59e0b"
    },
    TransportMode.TAXI: {
        "speed_kmh": 25,
        "cost_per_km": 280,
        "min_time_minutes": 5,
        "max_distance_km": 50,
        "icon": "🚕",
        "color": "#ef4444"
    },
    TransportMode.PLANE: {
        "speed_kmh": 500,
        "cost_per_km": 50,
        "min_time_minutes": 120,
        "max_distance_km": 10000,
        "icon": "✈️",
        "color": "#6366f1"
    },
    TransportMode.SHINKANSEN: {
        "speed_kmh": 200,
        "cost_per_km": 40,
        "min_time_minutes": 30,
        "max_distance_km": 1000,
        "icon": "🚄",
        "color": "#ec4899"
    }
}

# ===== 地域・エリア関連定数 =====

# 日本の主要地域
JAPAN_REGIONS = {
    "hokkaido": {
        "name": "北海道",
        "name_en": "Hokkaido",
        "bounds": {"north": 45.52, "south": 41.40, "east": 145.82, "west": 139.40},
        "timezone": "Asia/Tokyo"
    },
    "tohoku": {
        "name": "東北",
        "name_en": "Tohoku",
        "bounds": {"north": 41.50, "south": 36.70, "east": 141.90, "west": 139.00},
        "timezone": "Asia/Tokyo"
    },
    "kanto": {
        "name": "関東",
        "name_en": "Kanto",
        "bounds": {"north": 37.00, "south": 34.80, "east": 141.00, "west": 138.70},
        "timezone": "Asia/Tokyo"
    },
    "chubu": {
        "name": "中部",
        "name_en": "Chubu",
        "bounds": {"north": 37.50, "south": 34.50, "east": 139.00, "west": 136.00},
        "timezone": "Asia/Tokyo"
    },
    "kansai": {
        "name": "関西",
        "name_en": "Kansai",
        "bounds": {"north": 36.00, "south": 33.50, "east": 137.00, "west": 134.00},
        "timezone": "Asia/Tokyo"
    },
    "chugoku": {
        "name": "中国",
        "name_en": "Chugoku",
        "bounds": {"north": 35.50, "south": 33.00, "east": 134.50, "west": 130.90},
        "timezone": "Asia/Tokyo"
    },
    "shikoku": {
        "name": "四国",
        "name_en": "Shikoku",
        "bounds": {"north": 34.40, "south": 32.70, "east": 134.80, "west": 132.50},
        "timezone": "Asia/Tokyo"
    },
    "kyushu": {
        "name": "九州",
        "name_en": "Kyushu",
        "bounds": {"north": 34.00, "south": 31.00, "east": 132.00, "west": 129.00},
        "timezone": "Asia/Tokyo"
    }
}

# 主要都市
MAJOR_CITIES = {
    "tokyo": {"name": "東京", "lat": 35.6762, "lng": 139.6503, "region": "kanto"},
    "osaka": {"name": "大阪", "lat": 34.6937, "lng": 135.5023, "region": "kansai"},
    "kyoto": {"name": "京都", "lat": 35.0116, "lng": 135.7681, "region": "kansai"},
    "nagoya": {"name": "名古屋", "lat": 35.1815, "lng": 136.9066, "region": "chubu"},
    "fukuoka": {"name": "福岡", "lat": 33.5904, "lng": 130.4017, "region": "kyushu"},
    "sapporo": {"name": "札幌", "lat": 43.0642, "lng": 141.3469, "region": "hokkaido"},
    "hiroshima": {"name": "広島", "lat": 34.3853, "lng": 132.4553, "region": "chugoku"},
    "sendai": {"name": "仙台", "lat": 38.2682, "lng": 140.8694, "region": "tohoku"}
}

# ===== AI・検索関連定数 =====

class AIServiceType(str, Enum):
    """AIサービスタイプ"""
    SPOT_SEARCH = "spot_search"
    IMAGE_RECOGNITION = "image_recognition"
    OPTIMIZATION = "optimization"
    ROUTE_PLANNING = "route_planning"
    RECOMMENDATION = "recommendation"

class SearchProvider(str, Enum):
    """検索プロバイダー"""
    GOOGLE_PLACES = "google_places"
    OPENAI_GPT = "openai_gpt"
    CUSTOM_DATABASE = "custom_database"
    HYBRID = "hybrid"

# AI設定
AI_CONFIG = {
    "default_confidence_threshold": 0.7,
    "max_search_results": 50,
    "image_recognition_timeout_seconds": 30,
    "optimization_timeout_seconds": 300,
    "cache_ttl_seconds": 3600,
    "supported_image_formats": ["JPEG", "PNG", "WEBP", "GIF"],
    "max_image_size_mb": 10
}

# ===== ファイル・メディア関連定数 =====

class FileType(str, Enum):
    """ファイルタイプ"""
    IMAGE = "image"
    DOCUMENT = "document"
    VIDEO = "video"
    AUDIO = "audio"

# ファイル制限
FILE_LIMITS = {
    FileType.IMAGE: {
        "max_size_mb": 10,
        "allowed_extensions": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"],
        "max_dimensions": (4000, 4000)
    },
    FileType.DOCUMENT: {
        "max_size_mb": 5,
        "allowed_extensions": [".pdf", ".doc", ".docx", ".txt", ".md"]
    },
    FileType.VIDEO: {
        "max_size_mb": 100,
        "allowed_extensions": [".mp4", ".avi", ".mov", ".wmv"]
    },
    FileType.AUDIO: {
        "max_size_mb": 20,
        "allowed_extensions": [".mp3", ".wav", ".ogg", ".m4a"]
    }
}

# 危険なファイル拡張子
DANGEROUS_EXTENSIONS = {
    ".exe", ".bat", ".cmd", ".com", ".pif", ".scr", ".vbs", ".js", ".jar",
    ".msi", ".dll", ".sh", ".ps1", ".app", ".deb", ".rpm"
}

# ===== レート制限関連定数 =====

class RateLimitType(str, Enum):
    """レート制限タイプ"""
    GLOBAL = "global"
    USER = "user"
    IP = "ip"
    ENDPOINT = "endpoint"
    AI_SERVICE = "ai_service"

# レート制限設定
RATE_LIMITS = {
    "guest": {
        "requests_per_hour": 100,
        "api_calls_per_hour": 50,
        "login_attempts_per_hour": 5,
        "register_attempts_per_hour": 3,
        "ai_requests_per_day": 10,
        "image_recognition_per_day": 5
    },
    "user": {
        "requests_per_hour": 1000,
        "api_calls_per_hour": 500,
        "login_attempts_per_hour": 10,
        "register_attempts_per_hour": 5,
        "ai_requests_per_day": 100,
        "image_recognition_per_day": 30
    },
    "premium": {
        "requests_per_hour": 10000,
        "api_calls_per_hour": 5000,
        "login_attempts_per_hour": 20,
        "register_attempts_per_hour": 10,
        "ai_requests_per_day": 500,
        "image_recognition_per_day": 100
    },
    "admin": {
        "requests_per_hour": -1,  # 無制限
        "api_calls_per_hour": -1,
        "login_attempts_per_hour": -1,
        "register_attempts_per_hour": -1,
        "ai_requests_per_day": -1,
        "image_recognition_per_day": -1
    }
}

# ===== エラーコード関連定数 =====

class ErrorCode(str, Enum):
    """エラーコード"""
    # 認証関連
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    TOKEN_INVALID = "TOKEN_INVALID"
    USER_NOT_FOUND = "USER_NOT_FOUND"
    USER_INACTIVE = "USER_INACTIVE"
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS"
    
    # バリデーション関連
    REQUIRED_FIELD_MISSING = "REQUIRED_FIELD_MISSING"
    INVALID_EMAIL_FORMAT = "INVALID_EMAIL_FORMAT"
    INVALID_PASSWORD_FORMAT = "INVALID_PASSWORD_FORMAT"
    INVALID_DATE_RANGE = "INVALID_DATE_RANGE"
    
    # データ関連
    DUPLICATE_EMAIL = "DUPLICATE_EMAIL"
    DUPLICATE_USERNAME = "DUPLICATE_USERNAME"
    TRAVEL_PLAN_NOT_FOUND = "TRAVEL_PLAN_NOT_FOUND"
    
    # 制限関連
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    FILE_SIZE_TOO_LARGE = "FILE_SIZE_TOO_LARGE"
    INVALID_FILE_TYPE = "INVALID_FILE_TYPE"
    
    # システム関連
    DATABASE_ERROR = "DATABASE_ERROR"
    EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR"
    OPTIMIZATION_ERROR = "OPTIMIZATION_ERROR"

# エラーメッセージ
ERROR_MESSAGES = {
    ErrorCode.INVALID_CREDENTIALS: "メールアドレス/ユーザー名またはパスワードが正しくありません",
    ErrorCode.TOKEN_EXPIRED: "トークンの有効期限が切れています",
    ErrorCode.TOKEN_INVALID: "無効なトークンです",
    ErrorCode.USER_NOT_FOUND: "ユーザーが見つかりません",
    ErrorCode.USER_INACTIVE: "アカウントが無効化されています",
    ErrorCode.INSUFFICIENT_PERMISSIONS: "この操作を実行する権限がありません",
    ErrorCode.REQUIRED_FIELD_MISSING: "必須フィールドが入力されていません",
    ErrorCode.INVALID_EMAIL_FORMAT: "メールアドレスの形式が正しくありません",
    ErrorCode.INVALID_PASSWORD_FORMAT: "パスワードの形式が正しくありません",
    ErrorCode.INVALID_DATE_RANGE: "日付の範囲が正しくありません",
    ErrorCode.DUPLICATE_EMAIL: "このメールアドレスは既に使用されています",
    ErrorCode.DUPLICATE_USERNAME: "このユーザー名は既に使用されています",
    ErrorCode.TRAVEL_PLAN_NOT_FOUND: "旅行プランが見つかりません",
    ErrorCode.RATE_LIMIT_EXCEEDED: "リクエスト回数の上限に達しました",
    ErrorCode.FILE_SIZE_TOO_LARGE: "ファイルサイズが上限を超えています",
    ErrorCode.INVALID_FILE_TYPE: "サポートされていないファイル形式です",
    ErrorCode.DATABASE_ERROR: "データベースエラーが発生しました",
    ErrorCode.EXTERNAL_API_ERROR: "外部APIの呼び出しに失敗しました",
    ErrorCode.OPTIMIZATION_ERROR: "最適化処理に失敗しました"
}

# ===== 通知・メール関連定数 =====

class NotificationType(str, Enum):
    """通知タイプ"""
    EMAIL = "email"
    PUSH = "push"
    SMS = "sms"
    IN_APP = "in_app"

class NotificationEvent(str, Enum):
    """通知イベント"""
    USER_REGISTERED = "user_registered"
    PASSWORD_RESET = "password_reset"
    PLAN_SHARED = "plan_shared"
    COLLABORATION_INVITE = "collaboration_invite"
    OPTIMIZATION_COMPLETE = "optimization_complete"
    SYSTEM_MAINTENANCE = "system_maintenance"

# メールテンプレート
EMAIL_TEMPLATES = {
    NotificationEvent.USER_REGISTERED: {
        "subject": "TravelCanvasへようこそ！",
        "template": "welcome"
    },
    NotificationEvent.PASSWORD_RESET: {
        "subject": "パスワードリセットのご案内",
        "template": "password_reset"
    },
    NotificationEvent.PLAN_SHARED: {
        "subject": "旅行プランが共有されました",
        "template": "plan_shared"
    },
    NotificationEvent.COLLABORATION_INVITE: {
        "subject": "旅行プランへの招待",
        "template": "collaboration_invite"
    }
}

# ===== システム設定関連定数 =====

class SystemStatus(str, Enum):
    """システム状態"""
    OPERATIONAL = "operational"
    MAINTENANCE = "maintenance"
    DEGRADED = "degraded"
    OUTAGE = "outage"

class FeatureFlag(str, Enum):
    """機能フラグ"""
    AI_OPTIMIZATION = "ai_optimization"
    IMAGE_RECOGNITION = "image_recognition"
    COLLABORATION = "collaboration"
    EXPORT_PDF = "export_pdf"
    PREMIUM_FEATURES = "premium_features"

# デフォルト設定値
DEFAULT_SETTINGS = {
    "timezone": "Asia/Tokyo",
    "language": "ja",
    "currency": "JPY",
    "date_format": "YYYY-MM-DD",
    "time_format": "24h",
    "theme": "light",
    "notifications_enabled": True,
    "auto_save": True,
    "map_provider": "google"
}

# ===== API関連定数 =====

# APIエンドポイント
API_ENDPOINTS = {
    "auth": "/api/v1/auth",
    "travel": "/api/v1/travel",
    "ai": "/api/v1/ai",
    "admin": "/api/v1/admin",
    "health": "/api/v1/health"
}

# HTTPステータスコード別メッセージ
HTTP_STATUS_MESSAGES = {
    200: "成功",
    201: "作成されました",
    400: "リクエストが無効です",
    401: "認証が必要です",
    403: "アクセスが禁止されています",
    404: "リソースが見つかりません",
    429: "リクエスト回数の制限に達しました",
    500: "サーバー内部エラーが発生しました",
    503: "サービスが利用できません"
}

# ===== バージョン・互換性関連定数 =====

API_VERSIONS = {
    "v1": {
        "version": "1.0.0",
        "status": "stable",
        "deprecated": False,
        "sunset_date": None
    }
}

# サポートされているクライアントバージョン
SUPPORTED_CLIENT_VERSIONS = {
    "web": ["1.0.0"],
    "mobile": ["1.0.0"],
    "api": ["1.0.0"]
}