"""
TravelCanvas Backend - 統一例外処理システム
一貫性のあるエラーハンドリングとレスポンス形式を提供

改善点:
- HTTPException直接使用 → カスタム例外クラス統一
- ValueError等の標準例外 → アプリケーション専用例外
- エラーメッセージの多言語対応
- セキュリティ考慮のエラー情報制御
- 構造化エラーレスポンス
"""

from typing import Optional, Dict, Any, List, Union
from enum import Enum
import time
from datetime import datetime


# ==========================================
# エラー分類・レベル定義
# ==========================================

class ErrorCategory(str, Enum):
    """エラーカテゴリ"""
    AUTHENTICATION = "authentication"
    AUTHORIZATION = "authorization"
    VALIDATION = "validation"
    BUSINESS_LOGIC = "business_logic"
    EXTERNAL_SERVICE = "external_service"
    SYSTEM = "system"
    RATE_LIMIT = "rate_limit"
    MAINTENANCE = "maintenance"


class ErrorSeverity(str, Enum):
    """エラー深刻度"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ErrorCode(str, Enum):
    """エラーコード定義"""
    
    # 認証エラー (AUTH_xxx)
    AUTH_TOKEN_INVALID = "AUTH_001"
    AUTH_TOKEN_EXPIRED = "AUTH_002"
    AUTH_CREDENTIALS_INVALID = "AUTH_003"
    AUTH_USER_NOT_FOUND = "AUTH_004"
    AUTH_ACCOUNT_INACTIVE = "AUTH_005"
    AUTH_ACCOUNT_LOCKED = "AUTH_006"
    AUTH_SESSION_EXPIRED = "AUTH_007"
    AUTH_GUEST_RESTRICTED = "AUTH_008"
    
    # 認可エラー (AUTHZ_xxx)
    AUTHZ_PERMISSION_DENIED = "AUTHZ_001"
    AUTHZ_ROLE_INSUFFICIENT = "AUTHZ_002"
    AUTHZ_RESOURCE_ACCESS_DENIED = "AUTHZ_003"
    AUTHZ_ADMIN_REQUIRED = "AUTHZ_004"
    
    # バリデーションエラー (VALID_xxx)
    VALID_FIELD_REQUIRED = "VALID_001"
    VALID_FIELD_INVALID = "VALID_002"
    VALID_FORMAT_INVALID = "VALID_003"
    VALID_LENGTH_INVALID = "VALID_004"
    VALID_VALUE_OUT_OF_RANGE = "VALID_005"
    VALID_DUPLICATE_VALUE = "VALID_006"
    VALID_CONSTRAINT_VIOLATION = "VALID_007"
    VALID_PASSWORD_WEAK = "VALID_008"
    
    # ビジネスロジックエラー (BIZ_xxx)
    BIZ_TRAVEL_PLAN_NOT_FOUND = "BIZ_001"
    BIZ_TRAVEL_PLAN_ACCESS_DENIED = "BIZ_002"
    BIZ_OPTIMIZATION_FAILED = "BIZ_003"
    BIZ_SEARCH_NO_RESULTS = "BIZ_004"
    BIZ_IMAGE_RECOGNITION_FAILED = "BIZ_005"
    BIZ_VOICE_RECOGNITION_FAILED = "BIZ_006"
    BIZ_EXPORT_FAILED = "BIZ_007"
    BIZ_IMPORT_FAILED = "BIZ_008"
    
    # 外部サービスエラー (EXT_xxx)
    EXT_API_UNAVAILABLE = "EXT_001"
    EXT_API_RATE_LIMITED = "EXT_002"
    EXT_API_INVALID_RESPONSE = "EXT_003"
    EXT_DATABASE_CONNECTION_FAILED = "EXT_004"
    EXT_REDIS_CONNECTION_FAILED = "EXT_005"
    EXT_FILE_STORAGE_ERROR = "EXT_006"
    EXT_EMAIL_SEND_FAILED = "EXT_007"
    
    # システムエラー (SYS_xxx)
    SYS_INTERNAL_ERROR = "SYS_001"
    SYS_SERVICE_UNAVAILABLE = "SYS_002"
    SYS_TIMEOUT = "SYS_003"
    SYS_RESOURCE_EXHAUSTED = "SYS_004"
    SYS_CONFIGURATION_ERROR = "SYS_005"
    
    # レート制限エラー (RATE_xxx)
    RATE_LIMIT_EXCEEDED = "RATE_001"
    RATE_LIMIT_IP_BLOCKED = "RATE_002"
    RATE_LIMIT_USER_SUSPENDED = "RATE_003"
    
    # メンテナンスエラー (MAINT_xxx)
    MAINT_SCHEDULED_MAINTENANCE = "MAINT_001"
    MAINT_EMERGENCY_MAINTENANCE = "MAINT_002"


# ==========================================
# 基底例外クラス
# ==========================================

class TravelCanvasException(Exception):
    """TravelCanvas アプリケーション基底例外"""
    
    def __init__(
        self,
        message: str,
        error_code: Optional[ErrorCode] = None,
        category: ErrorCategory = ErrorCategory.SYSTEM,
        severity: ErrorSeverity = ErrorSeverity.MEDIUM,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None,
        field_errors: Optional[Dict[str, List[str]]] = None,
        context: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message)
        
        self.message = message
        self.error_code = error_code
        self.category = category
        self.severity = severity
        self.details = details or {}
        self.user_message = user_message or message
        self.field_errors = field_errors or {}
        self.context = context or {}
        self.timestamp = time.time()
        self.datetime = datetime.utcnow()
        
        # エラーID生成（追跡用）
        self.error_id = f"{category.value}_{int(self.timestamp)}_{hash(message) % 10000:04d}"
    
    def to_dict(self) -> Dict[str, Any]:
        """辞書形式変換"""
        return {
            "error_id": self.error_id,
            "error_code": self.error_code.value if self.error_code else None,
            "category": self.category.value,
            "severity": self.severity.value,
            "message": self.message,
            "user_message": self.user_message,
            "details": self.details,
            "field_errors": self.field_errors,
            "context": self.context,
            "timestamp": self.timestamp
        }
    
    def __str__(self) -> str:
        return f"[{self.error_code.value if self.error_code else 'UNKNOWN'}] {self.message}"
    
    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"message='{self.message}', "
            f"error_code={self.error_code}, "
            f"category={self.category})"
        )


# ==========================================
# 認証・認可例外
# ==========================================

class AuthenticationError(TravelCanvasException):
    """認証エラー"""
    
    def __init__(
        self,
        message: str = "認証に失敗しました",
        error_code: ErrorCode = ErrorCode.AUTH_CREDENTIALS_INVALID,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        super().__init__(
            message=message,
            error_code=error_code,
            category=ErrorCategory.AUTHENTICATION,
            severity=ErrorSeverity.MEDIUM,
            details=details,
            user_message=user_message or "認証が必要です。ログインしてください。"
        )


class TokenError(AuthenticationError):
    """トークンエラー"""
    
    def __init__(
        self,
        message: str = "トークンが無効です",
        error_code: ErrorCode = ErrorCode.AUTH_TOKEN_INVALID,
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            error_code=error_code,
            details=details,
            user_message="認証トークンが無効です。再度ログインしてください。"
        )


class TokenExpiredError(AuthenticationError):
    """トークン有効期限切れエラー"""
    
    def __init__(
        self,
        message: str = "トークンの有効期限が切れました",
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            error_code=ErrorCode.AUTH_TOKEN_EXPIRED,
            details=details,
            user_message="認証の有効期限が切れました。再度ログインしてください。"
        )


class AuthorizationError(TravelCanvasException):
    """認可エラー"""
    
    def __init__(
        self,
        message: str = "アクセス権限がありません",
        error_code: ErrorCode = ErrorCode.AUTHZ_PERMISSION_DENIED,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        super().__init__(
            message=message,
            error_code=error_code,
            category=ErrorCategory.AUTHORIZATION,
            severity=ErrorSeverity.MEDIUM,
            details=details,
            user_message=user_message or "この操作を実行する権限がありません。"
        )


class InsufficientPermissionError(AuthorizationError):
    """権限不足エラー"""
    
    def __init__(
        self,
        required_permission: str,
        user_permissions: Optional[List[str]] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        details.update({
            "required_permission": required_permission,
            "user_permissions": user_permissions or []
        })
        
        super().__init__(
            message=f"必要な権限がありません: {required_permission}",
            error_code=ErrorCode.AUTHZ_PERMISSION_DENIED,
            details=details,
            user_message="この機能を使用する権限がありません。"
        )


class AdminRequiredError(AuthorizationError):
    """管理者権限必須エラー"""
    
    def __init__(
        self,
        message: str = "管理者権限が必要です",
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            error_code=ErrorCode.AUTHZ_ADMIN_REQUIRED,
            details=details,
            user_message="この機能は管理者のみ利用できます。"
        )


# ==========================================
# バリデーション例外
# ==========================================

class ValidationError(TravelCanvasException):
    """バリデーションエラー"""
    
    def __init__(
        self,
        message: str = "入力データが無効です",
        error_code: ErrorCode = ErrorCode.VALID_FIELD_INVALID,
        field_errors: Optional[Dict[str, List[str]]] = None,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        super().__init__(
            message=message,
            error_code=error_code,
            category=ErrorCategory.VALIDATION,
            severity=ErrorSeverity.LOW,
            field_errors=field_errors,
            details=details,
            user_message=user_message or "入力内容に誤りがあります。確認してください。"
        )


class RequiredFieldError(ValidationError):
    """必須フィールドエラー"""
    
    def __init__(
        self,
        field_name: str,
        details: Optional[Dict[str, Any]] = None
    ):
        field_errors = {field_name: ["この項目は必須です"]}
        
        super().__init__(
            message=f"必須フィールドが不足しています: {field_name}",
            error_code=ErrorCode.VALID_FIELD_REQUIRED,
            field_errors=field_errors,
            details=details,
            user_message=f"{field_name}は必須項目です。"
        )


class InvalidFormatError(ValidationError):
    """フォーマット無効エラー"""
    
    def __init__(
        self,
        field_name: str,
        expected_format: str,
        provided_value: Any = None,
        details: Optional[Dict[str, Any]] = None
    ):
        field_errors = {field_name: [f"正しい形式で入力してください（例: {expected_format}）"]}
        
        details = details or {}
        details.update({
            "field_name": field_name,
            "expected_format": expected_format,
            "provided_value": str(provided_value) if provided_value is not None else None
        })
        
        super().__init__(
            message=f"フィールド '{field_name}' の形式が無効です。期待する形式: {expected_format}",
            error_code=ErrorCode.VALID_FORMAT_INVALID,
            field_errors=field_errors,
            details=details,
            user_message=f"{field_name}の形式が正しくありません。"
        )


class DuplicateValueError(ValidationError):
    """重複値エラー"""
    
    def __init__(
        self,
        field_name: str,
        value: Any,
        details: Optional[Dict[str, Any]] = None
    ):
        field_errors = {field_name: ["この値は既に使用されています"]}
        
        details = details or {}
        details.update({
            "field_name": field_name,
            "duplicate_value": str(value)
        })
        
        super().__init__(
            message=f"重複した値が検出されました: {field_name} = {value}",
            error_code=ErrorCode.VALID_DUPLICATE_VALUE,
            field_errors=field_errors,
            details=details,
            user_message=f"{field_name}は既に使用されています。別の値を入力してください。"
        )


class PasswordTooWeakError(ValidationError):
    """パスワード強度不足エラー"""
    
    def __init__(
        self,
        requirements: List[str],
        details: Optional[Dict[str, Any]] = None
    ):
        field_errors = {"password": requirements}
        
        super().__init__(
            message="パスワードの強度が不足しています",
            error_code=ErrorCode.VALID_PASSWORD_WEAK,
            field_errors=field_errors,
            details=details,
            user_message="より強力なパスワードを設定してください。"
        )


# ==========================================
# ビジネスロジック例外
# ==========================================

class BusinessLogicError(TravelCanvasException):
    """ビジネスロジックエラー"""
    
    def __init__(
        self,
        message: str,
        error_code: Optional[ErrorCode] = None,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        super().__init__(
            message=message,
            error_code=error_code or ErrorCode.SYS_INTERNAL_ERROR,
            category=ErrorCategory.BUSINESS_LOGIC,
            severity=ErrorSeverity.MEDIUM,
            details=details,
            user_message=user_message or "処理中にエラーが発生しました。"
        )


class TravelPlanNotFoundError(BusinessLogicError):
    """旅行プラン未発見エラー"""
    
    def __init__(
        self,
        plan_id: str,
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        details["plan_id"] = plan_id
        
        super().__init__(
            message=f"旅行プランが見つかりません: {plan_id}",
            error_code=ErrorCode.BIZ_TRAVEL_PLAN_NOT_FOUND,
            details=details,
            user_message="指定された旅行プランが見つかりません。"
        )


class TravelPlanAccessDeniedError(BusinessLogicError):
    """旅行プランアクセス拒否エラー"""
    
    def __init__(
        self,
        plan_id: str,
        user_id: str,
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        details.update({
            "plan_id": plan_id,
            "user_id": user_id
        })
        
        super().__init__(
            message=f"旅行プランへのアクセスが拒否されました: {plan_id}",
            error_code=ErrorCode.BIZ_TRAVEL_PLAN_ACCESS_DENIED,
            details=details,
            user_message="この旅行プランにアクセスする権限がありません。"
        )


class OptimizationError(BusinessLogicError):
    """最適化エラー"""
    
    def __init__(
        self,
        message: str = "最適化処理に失敗しました",
        optimization_type: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        if optimization_type:
            details["optimization_type"] = optimization_type
        
        super().__init__(
            message=message,
            error_code=ErrorCode.BIZ_OPTIMIZATION_FAILED,
            details=details,
            user_message="プランの最適化に失敗しました。しばらく経ってから再試行してください。"
        )


class SearchNoResultsError(BusinessLogicError):
    """検索結果なしエラー"""
    
    def __init__(
        self,
        search_query: str,
        search_type: str = "general",
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        details.update({
            "search_query": search_query,
            "search_type": search_type
        })
        
        super().__init__(
            message=f"検索結果が見つかりません: {search_query}",
            error_code=ErrorCode.BIZ_SEARCH_NO_RESULTS,
            details=details,
            user_message="検索条件に一致する結果が見つかりませんでした。検索条件を変更してください。"
        )


# ==========================================
# 外部サービス例外
# ==========================================

class ExternalServiceError(TravelCanvasException):
    """外部サービスエラー"""
    
    def __init__(
        self,
        message: str,
        service_name: str,
        error_code: ErrorCode = ErrorCode.EXT_API_UNAVAILABLE,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        details = details or {}
        details["service_name"] = service_name
        
        super().__init__(
            message=message,
            error_code=error_code,
            category=ErrorCategory.EXTERNAL_SERVICE,
            severity=ErrorSeverity.HIGH,
            details=details,
            user_message=user_message or "外部サービスとの通信でエラーが発生しました。"
        )


class APIUnavailableError(ExternalServiceError):
    """API利用不可エラー"""
    
    def __init__(
        self,
        service_name: str,
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=f"外部APIが利用できません: {service_name}",
            service_name=service_name,
            error_code=ErrorCode.EXT_API_UNAVAILABLE,
            details=details,
            user_message="現在、一部の機能が利用できません。しばらく経ってから再試行してください。"
        )


class DatabaseConnectionError(ExternalServiceError):
    """データベース接続エラー"""
    
    def __init__(
        self,
        message: str = "データベース接続に失敗しました",
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            service_name="database",
            error_code=ErrorCode.EXT_DATABASE_CONNECTION_FAILED,
            details=details,
            user_message="システムエラーが発生しました。しばらく経ってから再試行してください。"
        )


# ==========================================
# レート制限例外
# ==========================================

class RateLimitError(TravelCanvasException):
    """レート制限エラー"""
    
    def __init__(
        self,
        message: str = "アクセス制限に達しました",
        limit: int = 0,
        remaining: int = 0,
        retry_after: int = 60,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        details = details or {}
        details.update({
            "limit": limit,
            "remaining": remaining,
            "retry_after": retry_after
        })
        
        self.limit = limit
        self.remaining = remaining
        self.retry_after = retry_after
        
        super().__init__(
            message=message,
            error_code=ErrorCode.RATE_LIMIT_EXCEEDED,
            category=ErrorCategory.RATE_LIMIT,
            severity=ErrorSeverity.MEDIUM,
            details=details,
            user_message=user_message or f"アクセス制限に達しました。{retry_after}秒後に再試行してください。"
        )


class IPBlockedError(RateLimitError):
    """IP ブロックエラー"""
    
    def __init__(
        self,
        client_ip: str,
        block_duration: int = 3600,
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        details.update({
            "client_ip": client_ip,
            "block_duration": block_duration
        })
        
        super().__init__(
            message=f"IPアドレスがブロックされました: {client_ip}",
            retry_after=block_duration,
            details=details,
            user_message="一時的にアクセスが制限されています。しばらく経ってから再度お試しください。"
        )


# ==========================================
# メンテナンス例外
# ==========================================

class MaintenanceError(TravelCanvasException):
    """メンテナンスエラー"""
    
    def __init__(
        self,
        message: str = "システムメンテナンス中です",
        estimated_end: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        details = details or {}
        if estimated_end:
            details["estimated_end"] = estimated_end
        
        self.estimated_end = estimated_end
        
        super().__init__(
            message=message,
            error_code=ErrorCode.MAINT_SCHEDULED_MAINTENANCE,
            category=ErrorCategory.MAINTENANCE,
            severity=ErrorSeverity.HIGH,
            details=details,
            user_message=user_message or "システムメンテナンス中です。しばらくお待ちください。"
        )


# ==========================================
# システム例外
# ==========================================

class SystemError(TravelCanvasException):
    """システムエラー"""
    
    def __init__(
        self,
        message: str = "システムエラーが発生しました",
        error_code: ErrorCode = ErrorCode.SYS_INTERNAL_ERROR,
        details: Optional[Dict[str, Any]] = None,
        user_message: Optional[str] = None
    ):
        super().__init__(
            message=message,
            error_code=error_code,
            category=ErrorCategory.SYSTEM,
            severity=ErrorSeverity.HIGH,
            details=details,
            user_message=user_message or "システムエラーが発生しました。管理者にお問い合わせください。"
        )


class ServiceUnavailableError(SystemError):
    """サービス利用不可エラー"""
    
    def __init__(
        self,
        message: str = "サービスが一時的に利用できません",
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            error_code=ErrorCode.SYS_SERVICE_UNAVAILABLE,
            details=details,
            user_message="サービスが一時的に利用できません。しばらく経ってから再試行してください。"
        )


class TimeoutError(SystemError):
    """タイムアウトエラー"""
    
    def __init__(
        self,
        operation: str,
        timeout_seconds: int,
        details: Optional[Dict[str, Any]] = None
    ):
        details = details or {}
        details.update({
            "operation": operation,
            "timeout_seconds": timeout_seconds
        })
        
        super().__init__(
            message=f"操作がタイムアウトしました: {operation} ({timeout_seconds}秒)",
            error_code=ErrorCode.SYS_TIMEOUT,
            details=details,
            user_message="処理に時間がかかりすぎました。再度お試しください。"
        )


# ==========================================
# 例外ユーティリティ関数
# ==========================================

def create_validation_error(
    field_errors: Dict[str, List[str]],
    message: str = "入力データが無効です"
) -> ValidationError:
    """バリデーションエラー作成ヘルパー"""
    return ValidationError(
        message=message,
        field_errors=field_errors,
        user_message="入力内容に誤りがあります。確認してください。"
    )


def create_not_found_error(
    resource_type: str,
    resource_id: str,
    details: Optional[Dict[str, Any]] = None
) -> BusinessLogicError:
    """リソース未発見エラー作成ヘルパー"""
    details = details or {}
    details.update({
        "resource_type": resource_type,
        "resource_id": resource_id
    })
    
    return BusinessLogicError(
        message=f"{resource_type}が見つかりません: {resource_id}",
        details=details,
        user_message=f"指定された{resource_type}が見つかりません。"
    )


def create_access_denied_error(
    resource_type: str,
    resource_id: str,
    user_id: str,
    details: Optional[Dict[str, Any]] = None
) -> AuthorizationError:
    """アクセス拒否エラー作成ヘルパー"""
    details = details or {}
    details.update({
        "resource_type": resource_type,
        "resource_id": resource_id,
        "user_id": user_id
    })
    
    return AuthorizationError(
        message=f"{resource_type}へのアクセスが拒否されました: {resource_id}",
        details=details,
        user_message=f"この{resource_type}にアクセスする権限がありません。"
    )


def handle_external_api_error(
    service_name: str,
    status_code: int,
    response_text: str,
    operation: str
) -> ExternalServiceError:
    """外部APIエラーハンドリング"""
    
    details = {
        "service_name": service_name,
        "status_code": status_code,
        "response_text": response_text[:500],  # レスポンステキストは500文字まで
        "operation": operation
    }
    
    if status_code == 429:
        return ExternalServiceError(
            message=f"{service_name} APIのレート制限に達しました",
            service_name=service_name,
            error_code=ErrorCode.EXT_API_RATE_LIMITED,
            details=details,
            user_message="現在、サービスが混雑しています。しばらく経ってから再試行してください。"
        )
    elif 500 <= status_code < 600:
        return ExternalServiceError(
            message=f"{service_name} APIでサーバーエラーが発生しました",
            service_name=service_name,
            error_code=ErrorCode.EXT_API_UNAVAILABLE,
            details=details,
            user_message="外部サービスで一時的な問題が発生しています。"
        )
    else:
        return ExternalServiceError(
            message=f"{service_name} APIでエラーが発生しました",
            service_name=service_name,
            error_code=ErrorCode.EXT_API_INVALID_RESPONSE,
            details=details,
            user_message="外部サービスとの通信でエラーが発生しました。"
        )


def extract_error_summary(exception: Exception) -> Dict[str, Any]:
    """例外からエラーサマリー抽出"""
    
    if isinstance(exception, TravelCanvasException):
        return {
            "error_id": exception.error_id,
            "error_code": exception.error_code.value if exception.error_code else None,
            "category": exception.category.value,
            "severity": exception.severity.value,
            "message": exception.user_message,
            "timestamp": exception.timestamp
        }
    else:
        # 標準例外の場合
        return {
            "error_id": None,
            "error_code": None,
            "category": ErrorCategory.SYSTEM.value,
            "severity": ErrorSeverity.HIGH.value,
            "message": "予期しないエラーが発生しました",
            "timestamp": time.time()
        }


def is_client_error(exception: Exception) -> bool:
    """クライアントエラー判定"""
    if isinstance(exception, TravelCanvasException):
        return exception.category in [
            ErrorCategory.AUTHENTICATION,
            ErrorCategory.AUTHORIZATION,
            ErrorCategory.VALIDATION,
            ErrorCategory.RATE_LIMIT
        ]
    return False


def is_server_error(exception: Exception) -> bool:
    """サーバーエラー判定"""
    if isinstance(exception, TravelCanvasException):
        return exception.category in [
            ErrorCategory.SYSTEM,
            ErrorCategory.EXTERNAL_SERVICE,
            ErrorCategory.MAINTENANCE
        ]
    return True  # 標準例外は全てサーバーエラーとして扱う


def should_log_error(exception: Exception) -> bool:
    """エラーログ出力判定"""
    if isinstance(exception, TravelCanvasException):
        return exception.severity in [ErrorSeverity.HIGH, ErrorSeverity.CRITICAL]
    return True  # 標準例外は全てログ出力


def mask_sensitive_details(details: Dict[str, Any]) -> Dict[str, Any]:
    """機密情報マスク処理"""
    masked_details = details.copy()
    
    sensitive_keys = [
        "password", "token", "secret", "key", "credential",
        "authorization", "cookie", "session"
    ]
    
    for key, value in masked_details.items():
        if any(sensitive_key in key.lower() for sensitive_key in sensitive_keys):
            if isinstance(value, str) and len(value) > 4:
                masked_details[key] = f"{value[:2]}***{value[-2:]}"
            else:
                masked_details[key] = "***"
    
    return masked_details