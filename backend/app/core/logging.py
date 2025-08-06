"""
TravelCanvas Backend - 統一ログシステム
構造化ログ、セキュリティログ、パフォーマンスログを統合管理

改善点:
- print文使用 → 統一ログシステム
- 構造化ログの標準化
- セキュリティイベントの専用ログ
- パフォーマンス監視ログ
- JSON形式対応
- ログローテーション
"""

import logging
import logging.handlers
import json
import time
import traceback
import sys
import os
from typing import Dict, Any, Optional, Union, List
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from contextvars import ContextVar
import uuid

# アプリケーションインポート
from app.core.config import settings


# ==========================================
# ログレベル・分類定義
# ==========================================

class LogLevel(str, Enum):
    """ログレベル"""
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class LogCategory(str, Enum):
    """ログカテゴリ"""
    APPLICATION = "application"
    SECURITY = "security"
    PERFORMANCE = "performance"
    AUDIT = "audit"
    SYSTEM = "system"
    DATABASE = "database"
    EXTERNAL_API = "external_api"
    USER_ACTION = "user_action"


class SecurityEvents(str, Enum):
    """セキュリティイベント定義"""
    # 認証関連
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    TOKEN_CREATED = "token_created"
    TOKEN_EXPIRED = "token_expired"
    TOKEN_REVOKED = "token_revoked"
    
    # セッション関連
    SESSION_CREATED = "session_created"
    SESSION_EXPIRED = "session_expired"
    SESSION_REVOKED = "session_revoked"
    GUEST_SESSION_CREATED = "guest_session_created"
    
    # アクセス制御
    ACCESS_GRANTED = "access_granted"
    ACCESS_DENIED = "access_denied"
    PERMISSION_CHECK = "permission_check"
    ADMIN_ACCESS = "admin_access"
    
    # データ操作
    DATA_CREATED = "data_created"
    DATA_UPDATED = "data_updated"
    DATA_DELETED = "data_deleted"
    DATA_EXPORTED = "data_exported"
    DATA_IMPORTED = "data_imported"
    
    # セキュリティ違反
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    BRUTE_FORCE_ATTEMPT = "brute_force_attempt"
    IP_BLOCKED = "ip_blocked"
    
    # システム管理
    ADMIN_SETTINGS_MANAGE = "admin_settings_manage"
    ADMIN_DATA_EXPORT = "admin_data_export"
    ADMIN_USER_MANAGE = "admin_user_manage"
    SYSTEM_MAINTENANCE = "system_maintenance"


# ==========================================
# コンテキスト変数（リクエスト追跡用）
# ==========================================

request_id_var: ContextVar[Optional[str]] = ContextVar('request_id', default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar('user_id', default=None)
session_id_var: ContextVar[Optional[str]] = ContextVar('session_id', default=None)
client_ip_var: ContextVar[Optional[str]] = ContextVar('client_ip', default=None)


# ==========================================
# カスタムフォーマッター
# ==========================================

class StructuredFormatter(logging.Formatter):
    """構造化ログフォーマッター"""
    
    def __init__(self, json_format: bool = False):
        super().__init__()
        self.json_format = json_format
    
    def format(self, record: logging.LogRecord) -> str:
        """ログレコードフォーマット"""
        
        # 基本情報
        log_data = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno
        }
        
        # コンテキスト情報追加
        if request_id_var.get():
            log_data["request_id"] = request_id_var.get()
        
        if user_id_var.get():
            log_data["user_id"] = user_id_var.get()
        
        if session_id_var.get():
            log_data["session_id"] = session_id_var.get()
        
        if client_ip_var.get():
            log_data["client_ip"] = client_ip_var.get()
        
        # 追加情報（extra）
        if hasattr(record, 'extra_data'):
            log_data.update(record.extra_data)
        
        # カテゴリ情報
        if hasattr(record, 'category'):
            log_data["category"] = record.category
        
        # エラー情報
        if record.exc_info:
            log_data["exception"] = {
                "type": record.exc_info[0].__name__ if record.exc_info[0] else None,
                "message": str(record.exc_info[1]) if record.exc_info[1] else None,
                "traceback": traceback.format_exception(*record.exc_info)
            }
        
        # パフォーマンス情報
        if hasattr(record, 'duration_ms'):
            log_data["duration_ms"] = record.duration_ms
        
        if hasattr(record, 'memory_usage'):
            log_data["memory_usage"] = record.memory_usage
        
        # JSON形式 vs 人間可読形式
        if self.json_format:
            return json.dumps(log_data, ensure_ascii=False, default=str)
        else:
            # 人間可読形式
            base_msg = f"{log_data['timestamp']} - {log_data['level']} - {log_data['logger']} - {log_data['message']}"
            
            context_parts = []
            if log_data.get('request_id'):
                context_parts.append(f"req_id={log_data['request_id']}")
            if log_data.get('user_id'):
                context_parts.append(f"user_id={log_data['user_id']}")
            if log_data.get('duration_ms'):
                context_parts.append(f"duration={log_data['duration_ms']}ms")
            
            if context_parts:
                base_msg += f" [{', '.join(context_parts)}]"
            
            # エラー情報追加
            if 'exception' in log_data:
                base_msg += f"\nException: {log_data['exception']['type']}: {log_data['exception']['message']}"
            
            return base_msg


class SecurityFormatter(StructuredFormatter):
    """セキュリティログ専用フォーマッター"""
    
    def format(self, record: logging.LogRecord) -> str:
        """セキュリティログフォーマット"""
        
        log_data = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "event_type": getattr(record, 'event_type', 'unknown'),
            "severity": getattr(record, 'severity', 'medium'),
            "message": record.getMessage(),
            "category": "security"
        }
        
        # コンテキスト情報
        if user_id_var.get():
            log_data["user_id"] = user_id_var.get()
        
        if session_id_var.get():
            log_data["session_id"] = session_id_var.get()
        
        if client_ip_var.get():
            log_data["client_ip"] = client_ip_var.get()
        
        if request_id_var.get():
            log_data["request_id"] = request_id_var.get()
        
        # セキュリティ詳細
        if hasattr(record, 'security_details'):
            log_data["details"] = record.security_details
        
        # リスク評価
        if hasattr(record, 'risk_score'):
            log_data["risk_score"] = record.risk_score
        
        return json.dumps(log_data, ensure_ascii=False, default=str)


# ==========================================
# カスタムハンドラー
# ==========================================

class AsyncSafeRotatingFileHandler(logging.handlers.RotatingFileHandler):
    """非同期安全なローテーティングファイルハンドラー"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # ファイルロック対応等の実装は必要に応じて追加
    
    def emit(self, record):
        """レコード出力"""
        try:
            super().emit(record)
        except Exception as e:
            # ハンドラーエラーでアプリケーションを停止させない
            print(f"Log handler error: {e}", file=sys.stderr)


class SecurityLogHandler(AsyncSafeRotatingFileHandler):
    """セキュリティログ専用ハンドラー"""
    
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        self.setFormatter(SecurityFormatter())
    
    def filter(self, record):
        """セキュリティログのみをフィルタ"""
        return hasattr(record, 'event_type') or getattr(record, 'category', '') == 'security'


# ==========================================
# ログ設定・初期化
# ==========================================

def setup_logging():
    """ログシステム初期化"""
    
    # ログディレクトリ作成
    log_dir = Path(settings.LOG_DIR)
    log_dir.mkdir(exist_ok=True)
    
    # ルートロガー設定
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, settings.LOG_LEVEL))
    
    # 既存のハンドラーをクリア
    root_logger.handlers.clear()
    
    # アプリケーションログハンドラー
    app_handler = AsyncSafeRotatingFileHandler(
        filename=log_dir / "app.log",
        maxBytes=settings.LOG_FILE_MAX_SIZE,
        backupCount=settings.LOG_FILE_BACKUP_COUNT,
        encoding='utf-8'
    )
    app_handler.setFormatter(StructuredFormatter(json_format=settings.LOG_JSON_FORMAT))
    app_handler.setLevel(getattr(logging, settings.LOG_LEVEL))
    
    # コンソールハンドラー（開発時）
    if settings.is_development or settings.DEBUG:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(StructuredFormatter(json_format=False))
        console_handler.setLevel(logging.DEBUG)
        root_logger.addHandler(console_handler)
    
    # エラーログハンドラー
    error_handler = AsyncSafeRotatingFileHandler(
        filename=log_dir / "error.log",
        maxBytes=settings.LOG_FILE_MAX_SIZE,
        backupCount=settings.LOG_FILE_BACKUP_COUNT,
        encoding='utf-8'
    )
    error_handler.setFormatter(StructuredFormatter(json_format=True))
    error_handler.setLevel(logging.ERROR)
    
    # セキュリティログハンドラー
    if settings.SECURITY_LOG_ENABLED:
        security_handler = SecurityLogHandler(
            filename=log_dir / settings.SECURITY_LOG_FILE,
            maxBytes=settings.LOG_FILE_MAX_SIZE,
            backupCount=settings.LOG_FILE_BACKUP_COUNT
        )
        security_handler.setLevel(logging.INFO)
        
        # セキュリティロガー設定
        security_logger = logging.getLogger('security')
        security_logger.setLevel(logging.INFO)
        security_logger.addHandler(security_handler)
        security_logger.propagate = False  # ルートロガーに伝播しない
    
    root_logger.addHandler(app_handler)
    root_logger.addHandler(error_handler)
    
    # サードパーティライブラリのログレベル調整
    logging.getLogger('uvicorn').setLevel(logging.INFO)
    logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('redis').setLevel(logging.WARNING)
    
    print(f"✅ Logging system initialized (level: {settings.LOG_LEVEL})")


# ==========================================
# ログ関数・ユーティリティ
# ==========================================

def get_logger(name: Optional[str] = None) -> logging.Logger:
    """ロガー取得"""
    return logging.getLogger(name or __name__)


def set_request_context(
    request_id: Optional[str] = None,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    client_ip: Optional[str] = None
):
    """リクエストコンテキスト設定"""
    if request_id:
        request_id_var.set(request_id)
    if user_id:
        user_id_var.set(user_id)
    if session_id:
        session_id_var.set(session_id)
    if client_ip:
        client_ip_var.set(client_ip)


def clear_request_context():
    """リクエストコンテキストクリア"""
    request_id_var.set(None)
    user_id_var.set(None)
    session_id_var.set(None)
    client_ip_var.set(None)


def log_with_context(
    logger: logging.Logger,
    level: str,
    message: str,
    category: Optional[LogCategory] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    **kwargs
):
    """コンテキスト付きログ出力"""
    
    # LogRecordに追加情報を設定
    extra = {
        'category': category.value if category else LogCategory.APPLICATION.value,
        'extra_data': extra_data or {}
    }
    extra.update(kwargs)
    
    # ログレベルに応じて出力
    log_func = getattr(logger, level.lower())
    log_func(message, extra=extra)


def log_performance(
    logger: logging.Logger,
    operation: str,
    duration_ms: float,
    success: bool = True,
    metadata: Optional[Dict[str, Any]] = None
):
    """パフォーマンスログ"""
    
    extra_data = {
        "operation": operation,
        "duration_ms": round(duration_ms, 2),
        "success": success
    }
    
    if metadata:
        extra_data.update(metadata)
    
    level = "INFO" if success else "WARNING"
    message = f"Operation '{operation}' completed in {duration_ms:.2f}ms (success: {success})"
    
    log_with_context(
        logger=logger,
        level=level,
        message=message,
        category=LogCategory.PERFORMANCE,
        extra_data=extra_data,
        duration_ms=duration_ms
    )


def log_database_query(
    logger: logging.Logger,
    query: str,
    duration_ms: float,
    row_count: Optional[int] = None,
    success: bool = True
):
    """データベースクエリログ"""
    
    extra_data = {
        "query": query[:200] if len(query) > 200 else query,  # クエリは200文字まで
        "duration_ms": round(duration_ms, 2),
        "row_count": row_count,
        "success": success
    }
    
    # パフォーマンス警告
    level = "INFO"
    if duration_ms > 1000:  # 1秒以上
        level = "WARNING"
    elif duration_ms > 5000:  # 5秒以上
        level = "ERROR"
    
    message = f"DB Query executed in {duration_ms:.2f}ms (rows: {row_count or '?'})"
    
    log_with_context(
        logger=logger,
        level=level,
        message=message,
        category=LogCategory.DATABASE,
        extra_data=extra_data,
        duration_ms=duration_ms
    )


def log_external_api_call(
    logger: logging.Logger,
    service_name: str,
    endpoint: str,
    method: str,
    status_code: Optional[int],
    duration_ms: float,
    success: bool = True,
    error_message: Optional[str] = None
):
    """外部API呼び出しログ"""
    
    extra_data = {
        "service_name": service_name,
        "endpoint": endpoint,
        "method": method,
        "status_code": status_code,
        "duration_ms": round(duration_ms, 2),
        "success": success
    }
    
    if error_message:
        extra_data["error_message"] = error_message
    
    level = "INFO" if success else "ERROR"
    message = f"External API call to {service_name} ({method} {endpoint}) - {status_code or 'N/A'} in {duration_ms:.2f}ms"
    
    log_with_context(
        logger=logger,
        level=level,
        message=message,
        category=LogCategory.EXTERNAL_API,
        extra_data=extra_data,
        duration_ms=duration_ms
    )


def log_user_action(
    logger: logging.Logger,
    action: str,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    success: bool = True,
    metadata: Optional[Dict[str, Any]] = None
):
    """ユーザーアクションログ"""
    
    extra_data = {
        "action": action,
        "user_id": user_id or user_id_var.get(),
        "resource_type": resource_type,
        "resource_id": resource_id,
        "success": success
    }
    
    if metadata:
        extra_data.update(metadata)
    
    level = "INFO" if success else "WARNING"
    message = f"User action: {action}"
    if resource_type and resource_id:
        message += f" (resource: {resource_type}:{resource_id})"
    
    log_with_context(
        logger=logger,
        level=level,
        message=message,
        category=LogCategory.USER_ACTION,
        extra_data=extra_data
    )


def log_security_event(
    event_type: SecurityEvents,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    severity: str = "medium",
    message: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    risk_score: Optional[int] = None
):
    """セキュリティイベントログ"""
    
    security_logger = logging.getLogger('security')
    
    # デフォルトメッセージ
    if not message:
        message = f"Security event: {event_type.value}"
    
    # LogRecordに追加情報を設定
    extra = {
        'event_type': event_type.value,
        'severity': severity,
        'security_details': details or {},
        'risk_score': risk_score
    }
    
    # 一時的にコンテキスト設定
    original_user_id = user_id_var.get()
    original_session_id = session_id_var.get()
    original_client_ip = client_ip_var.get()
    
    try:
        if user_id:
            user_id_var.set(user_id)
        if session_id:
            session_id_var.set(session_id)
        if client_ip:
            client_ip_var.set(client_ip)
        
        security_logger.info(message, extra=extra)
        
    finally:
        # コンテキスト復元
        user_id_var.set(original_user_id)
        session_id_var.set(original_session_id)
        client_ip_var.set(original_client_ip)


def log_system_event(
    logger: logging.Logger,
    event: str,
    level: str = "INFO",
    metadata: Optional[Dict[str, Any]] = None
):
    """システムイベントログ"""
    
    extra_data = {
        "event": event,
        "system_info": {
            "environment": settings.ENVIRONMENT,
            "version": getattr(settings, 'APP_VERSION', '1.0.0')
        }
    }
    
    if metadata:
        extra_data.update(metadata)
    
    message = f"System event: {event}"
    
    log_with_context(
        logger=logger,
        level=level,
        message=message,
        category=LogCategory.SYSTEM,
        extra_data=extra_data
    )


# ==========================================
# パフォーマンス監視デコレータ
# ==========================================

def log_execution_time(
    logger: Optional[logging.Logger] = None,
    operation_name: Optional[str] = None,
    log_args: bool = False,
    log_result: bool = False,
    threshold_ms: float = 1000.0
):
    """実行時間ログデコレータ"""
    
    def decorator(func):
        def wrapper(*args, **kwargs):
            if not logger:
                func_logger = get_logger(func.__module__)
            else:
                func_logger = logger
            
            operation = operation_name or f"{func.__module__}.{func.__name__}"
            start_time = time.perf_counter()
            
            try:
                # 引数ログ（オプション）
                if log_args:
                    args_info = {
                        "args": [str(arg)[:100] for arg in args],  # 100文字まで
                        "kwargs": {k: str(v)[:100] for k, v in kwargs.items()}
                    }
                    log_with_context(
                        func_logger, "DEBUG", f"Function {operation} called with args",
                        extra_data=args_info
                    )
                
                # 関数実行
                result = func(*args, **kwargs)
                
                # 実行時間計算
                duration_ms = (time.perf_counter() - start_time) * 1000
                
                # 結果ログ（オプション）
                result_info = {}
                if log_result:
                    result_info["result_type"] = type(result).__name__
                    if hasattr(result, '__len__'):
                        result_info["result_length"] = len(result)
                
                # パフォーマンスログ
                log_performance(
                    func_logger, operation, duration_ms, 
                    success=True, metadata=result_info
                )
                
                # 閾値チェック
                if duration_ms > threshold_ms:
                    log_with_context(
                        func_logger, "WARNING", 
                        f"Slow operation detected: {operation} took {duration_ms:.2f}ms",
                        category=LogCategory.PERFORMANCE,
                        extra_data={"threshold_ms": threshold_ms, "actual_ms": duration_ms}
                    )
                
                return result
                
            except Exception as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                
                # エラーログ
                log_performance(
                    func_logger, operation, duration_ms, 
                    success=False, metadata={"error": str(e)}
                )
                
                raise
        
        return wrapper
    return decorator


# ==========================================
# ログ分析・ユーティリティ
# ==========================================

def get_log_stats(log_file_path: str, hours: int = 24) -> Dict[str, Any]:
    """ログ統計取得"""
    
    try:
        stats = {
            "total_lines": 0,
            "error_count": 0,
            "warning_count": 0,
            "info_count": 0,
            "debug_count": 0,
            "unique_users": set(),
            "unique_ips": set(),
            "performance_issues": 0
        }
        
        cutoff_time = time.time() - (hours * 3600)
        
        with open(log_file_path, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    if settings.LOG_JSON_FORMAT:
                        log_data = json.loads(line.strip())
                        log_time = log_data.get("timestamp")
                        
                        if log_time:
                            log_timestamp = datetime.fromisoformat(log_time.replace('Z', '+00:00')).timestamp()
                            if log_timestamp < cutoff_time:
                                continue
                        
                        stats["total_lines"] += 1
                        
                        level = log_data.get("level", "").upper()
                        if level == "ERROR":
                            stats["error_count"] += 1
                        elif level == "WARNING":
                            stats["warning_count"] += 1
                        elif level == "INFO":
                            stats["info_count"] += 1
                        elif level == "DEBUG":
                            stats["debug_count"] += 1
                        
                        if log_data.get("user_id"):
                            stats["unique_users"].add(log_data["user_id"])
                        
                        if log_data.get("client_ip"):
                            stats["unique_ips"].add(log_data["client_ip"])
                        
                        if log_data.get("duration_ms", 0) > 1000:
                            stats["performance_issues"] += 1
                            
                except json.JSONDecodeError:
                    continue
        
        # セットを数値に変換
        stats["unique_users"] = len(stats["unique_users"])
        stats["unique_ips"] = len(stats["unique_ips"])
        
        return stats
        
    except Exception as e:
        return {"error": str(e)}


def cleanup_old_logs(days_to_keep: int = 30):
    """古いログファイルクリーンアップ"""
    
    try:
        log_dir = Path(settings.LOG_DIR)
        if not log_dir.exists():
            return
        
        cutoff_time = time.time() - (days_to_keep * 24 * 3600)
        cleaned_count = 0
        
        for log_file in log_dir.glob("*.log*"):
            if log_file.stat().st_mtime < cutoff_time:
                log_file.unlink()
                cleaned_count += 1
        
        if cleaned_count > 0:
            logger = get_logger(__name__)
            log_system_event(
                logger, f"Cleaned up {cleaned_count} old log files",
                metadata={"days_to_keep": days_to_keep}
            )
    
    except Exception as e:
        logger = get_logger(__name__)
        logger.error(f"Failed to cleanup old logs: {str(e)}")


# ==========================================
# エクスポート
# ==========================================

__all__ = [
    'setup_logging',
    'get_logger',
    'set_request_context',
    'clear_request_context',
    'log_with_context',
    'log_performance',
    'log_database_query',
    'log_external_api_call',
    'log_user_action',
    'log_security_event',
    'log_system_event',
    'log_execution_time',
    'get_log_stats',
    'cleanup_old_logs',
    'LogLevel',
    'LogCategory',
    'SecurityEvents'
]