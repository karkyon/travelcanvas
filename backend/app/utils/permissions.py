"""
TravelCanvas Backend - 統一権限管理システム
ロールベースアクセス制御（RBAC）とリソースベースアクセス制御を統合

改善点:
- 権限チェックの統一化
- セキュリティ監査の統合
- エンドポイント監視機能
- 動的権限評価
- 管理者権限の階層化
"""

from typing import List, Dict, Any, Optional, Callable, Union
from enum import Enum
from functools import wraps
import time
import inspect
from collections import defaultdict

from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

# アプリケーションインポート
from app.core.config import settings
from app.core.database import get_db
from app.core.auth import get_current_user, AuthResult
from app.core.logging import get_logger, log_security_event, SecurityEvents
from app.core.exceptions import (
    AuthorizationError, InsufficientPermissionError, 
    AdminRequiredError, AuthenticationError
)
from app.models.models import User, TravelPlan, UserType


# ログ設定
logger = get_logger(__name__)


# ==========================================
# 権限・ロール定義
# ==========================================

class Permission(str, Enum):
    """権限定義"""
    
    # 基本権限
    READ_OWN_DATA = "read_own_data"
    WRITE_OWN_DATA = "write_own_data"
    DELETE_OWN_DATA = "delete_own_data"
    
    # ユーザー管理
    USER_READ_ALL = "user_read_all"
    USER_WRITE_ALL = "user_write_all"
    USER_DELETE_ALL = "user_delete_all"
    
    # 旅行プラン権限
    PLAN_CREATE = "plan_create"
    PLAN_READ_OWN = "plan_read_own"
    PLAN_READ_SHARED = "plan_read_shared"
    PLAN_READ_PUBLIC = "plan_read_public"
    PLAN_READ_ALL = "plan_read_all"
    PLAN_WRITE_OWN = "plan_write_own"
    PLAN_WRITE_SHARED = "plan_write_shared"
    PLAN_WRITE_ALL = "plan_write_all"
    PLAN_DELETE_OWN = "plan_delete_own"
    PLAN_DELETE_ALL = "plan_delete_all"
    PLAN_SHARE = "plan_share"
    PLAN_EXPORT = "plan_export"
    
    # AI機能権限
    AI_OPTIMIZATION = "ai_optimization"
    AI_IMAGE_SEARCH = "ai_image_search"
    AI_VOICE_SEARCH = "ai_voice_search"
    AI_ADVANCED_FEATURES = "ai_advanced_features"
    
    # 管理機能
    ADMIN_SYSTEM_MONITOR = "admin_system_monitor"
    ADMIN_USER_MANAGE = "admin_user_manage"
    ADMIN_LOGS_VIEW = "admin_logs_view"
    ADMIN_SETTINGS_MANAGE = "admin_settings_manage"
    ADMIN_DATA_EXPORT = "admin_data_export"
    ADMIN_MAINTENANCE = "admin_maintenance"


class Role(str, Enum):
    """ロール定義"""
    GUEST = "guest"
    REGISTERED = "registered"
    PREMIUM = "premium"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"


# ==========================================
# 権限マッピング定義
# ==========================================

ROLE_PERMISSIONS: Dict[Role, List[Permission]] = {
    Role.GUEST: [
        # 基本権限（制限付き）
        Permission.READ_OWN_DATA,
        Permission.WRITE_OWN_DATA,
        
        # プラン権限（制限付き）
        Permission.PLAN_CREATE,
        Permission.PLAN_READ_OWN,
        Permission.PLAN_READ_PUBLIC,
        Permission.PLAN_WRITE_OWN,
        Permission.PLAN_DELETE_OWN,
        Permission.PLAN_EXPORT,
        
        # AI機能（制限付き）
        Permission.AI_OPTIMIZATION,
        Permission.AI_IMAGE_SEARCH,
    ],
    
    Role.REGISTERED: [
        # 基本権限
        Permission.READ_OWN_DATA,
        Permission.WRITE_OWN_DATA,
        Permission.DELETE_OWN_DATA,
        
        # プラン権限
        Permission.PLAN_CREATE,
        Permission.PLAN_READ_OWN,
        Permission.PLAN_READ_SHARED,
        Permission.PLAN_READ_PUBLIC,
        Permission.PLAN_WRITE_OWN,
        Permission.PLAN_WRITE_SHARED,
        Permission.PLAN_DELETE_OWN,
        Permission.PLAN_SHARE,
        Permission.PLAN_EXPORT,
        
        # AI機能
        Permission.AI_OPTIMIZATION,
        Permission.AI_IMAGE_SEARCH,
        Permission.AI_VOICE_SEARCH,
    ],
    
    Role.PREMIUM: [
        # 登録ユーザーの全権限を継承
#         *ROLE_PERMISSIONS[Role.REGISTERED],
        
        # プレミアム限定
        Permission.AI_ADVANCED_FEATURES,
        Permission.PLAN_READ_ALL,  # プレミアムは全公開プラン閲覧可能
    ],
    
    Role.ADMIN: [
        # プレミアムユーザーの全権限を継承
#         *ROLE_PERMISSIONS[Role.PREMIUM],
        
        # 管理権限
        Permission.USER_READ_ALL,
        Permission.USER_WRITE_ALL,
        Permission.PLAN_READ_ALL,
        Permission.PLAN_WRITE_ALL,
        Permission.PLAN_DELETE_ALL,
        Permission.ADMIN_SYSTEM_MONITOR,
        Permission.ADMIN_USER_MANAGE,
        Permission.ADMIN_LOGS_VIEW,
        Permission.ADMIN_DATA_EXPORT,
    ],
    
    Role.SUPER_ADMIN: [
        # 管理者の全権限を継承
#         *ROLE_PERMISSIONS[Role.ADMIN],
        
        # スーパー管理者限定
        Permission.USER_DELETE_ALL,
        Permission.ADMIN_SETTINGS_MANAGE,
        Permission.ADMIN_MAINTENANCE,
    ]
}


# ==========================================
# 権限マネージャー
# ==========================================

class PermissionManager:
    """権限管理マネージャー"""
    
    def __init__(self):
        self.role_permissions = ROLE_PERMISSIONS
        self._cache = {}
        self._access_log = defaultdict(list)
        
    def get_user_role(self, user: Optional[User]) -> Role:
        """ユーザーロール取得"""
        if not user:
            return Role.GUEST
        
        user_type_to_role = {
            UserType.GUEST.value: Role.GUEST,
            UserType.REGISTERED.value: Role.REGISTERED,
            UserType.PREMIUM.value: Role.PREMIUM,
            UserType.ADMIN.value: Role.ADMIN,
            UserType.SUPER_ADMIN.value: Role.SUPER_ADMIN,
        }
        
        return user_type_to_role.get(user.user_type, Role.GUEST)
    
    def get_role_permissions(self, role: Role) -> List[Permission]:
        """ロール権限取得"""
        return self.role_permissions.get(role, [])
    
    def has_permission(
        self,
        user: Optional[User],
        permission: Permission,
        resource: Optional[Any] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """権限チェック"""
        
        # キャッシュキー生成
        cache_key = self._generate_cache_key(user, permission, resource)
        
        # キャッシュから取得
        if cache_key in self._cache:
            cached_result, cached_time = self._cache[cache_key]
            if time.time() - cached_time < 300:  # 5分間キャッシュ
                return cached_result
        
        # 権限評価
        result = self._evaluate_permission(user, permission, resource, context)
        
        # キャッシュに保存
        self._cache[cache_key] = (result, time.time())
        
        # アクセスログ記録
        self._log_permission_check(user, permission, resource, result, context)
        
        return result
    
    def _evaluate_permission(
        self,
        user: Optional[User],
        permission: Permission,
        resource: Optional[Any] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """権限評価ロジック"""
        
        # ユーザーロール取得
        user_role = self.get_user_role(user)
        role_permissions = self.get_role_permissions(user_role)
        
        # 基本権限チェック
        if permission not in role_permissions:
            return False
        
        # リソースベース権限チェック
        if resource:
            return self._check_resource_permission(user, permission, resource, context)
        
        return True
    
    def _check_resource_permission(
        self,
        user: Optional[User],
        permission: Permission,
        resource: Any,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """リソースベース権限チェック"""
        
        # 旅行プランリソース
        if isinstance(resource, TravelPlan):
            return self._check_travel_plan_permission(user, permission, resource, context)
        
        # ユーザーリソース
        if isinstance(resource, User):
            return self._check_user_permission(user, permission, resource, context)
        
        # その他のリソース
        return True
    
    def _check_travel_plan_permission(
        self,
        user: Optional[User],
        permission: Permission,
        plan: TravelPlan,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """旅行プラン権限チェック"""
        
        if not user:
            # ゲストユーザーは公開プランのみ閲覧可能
            if permission == Permission.PLAN_READ_PUBLIC:
                return plan.is_public
            return False
        
        # 所有者チェック
        if str(plan.user_id) == str(user.id):
            return permission in [
                Permission.PLAN_READ_OWN,
                Permission.PLAN_WRITE_OWN,
                Permission.PLAN_DELETE_OWN,
                Permission.PLAN_SHARE,
                Permission.PLAN_EXPORT
            ]
        
        # 共有プランチェック
        if permission in [Permission.PLAN_READ_SHARED, Permission.PLAN_WRITE_SHARED]:
            # TODO: 共有権限チェック実装
            # 現在は簡易実装
            return False
        
        # 公開プランチェック
        if permission == Permission.PLAN_READ_PUBLIC:
            return plan.is_public
        
        # 管理者権限
        user_role = self.get_user_role(user)
        if user_role in [Role.ADMIN, Role.SUPER_ADMIN]:
            return permission in [
                Permission.PLAN_READ_ALL,
                Permission.PLAN_WRITE_ALL,
                Permission.PLAN_DELETE_ALL
            ]
        
        return False
    
    def _check_user_permission(
        self,
        current_user: Optional[User],
        permission: Permission,
        target_user: User,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """ユーザー権限チェック"""
        
        if not current_user:
            return False
        
        # 自分自身の場合
        if str(current_user.id) == str(target_user.id):
            return permission in [
                Permission.READ_OWN_DATA,
                Permission.WRITE_OWN_DATA,
                Permission.DELETE_OWN_DATA
            ]
        
        # 管理者権限
        current_role = self.get_user_role(current_user)
        target_role = self.get_user_role(target_user)
        
        if current_role == Role.SUPER_ADMIN:
            return True  # スーパー管理者は全権限
        
        if current_role == Role.ADMIN:
            # 管理者は他の管理者以外を管理可能
            if target_role in [Role.ADMIN, Role.SUPER_ADMIN]:
                return False
            return permission in [
                Permission.USER_READ_ALL,
                Permission.USER_WRITE_ALL
            ]
        
        return False
    
    def _generate_cache_key(
        self,
        user: Optional[User],
        permission: Permission,
        resource: Optional[Any] = None
    ) -> str:
        """キャッシュキー生成"""
        user_id = str(user.id) if user else "anonymous"
        resource_id = str(getattr(resource, 'id', 'none')) if resource else "none"
        resource_type = type(resource).__name__ if resource else "none"
        
        return f"{user_id}:{permission.value}:{resource_type}:{resource_id}"
    
    def _log_permission_check(
        self,
        user: Optional[User],
        permission: Permission,
        resource: Optional[Any],
        result: bool,
        context: Optional[Dict[str, Any]] = None
    ):
        """権限チェックログ"""
        
        # アクセスログに記録
        access_record = {
            "timestamp": time.time(),
            "user_id": str(user.id) if user else None,
            "permission": permission.value,
            "resource_type": type(resource).__name__ if resource else None,
            "resource_id": str(getattr(resource, 'id', None)) if resource else None,
            "result": result,
            "context": context
        }
        
        self._access_log[str(user.id) if user else "anonymous"].append(access_record)
        
        # セキュリティログ（拒否された場合）
        if not result:
            log_security_event(
                SecurityEvents.ACCESS_DENIED,
                user_id=str(user.id) if user else None,
                details={
                    "permission": permission.value,
                    "resource_type": type(resource).__name__ if resource else None,
                    "resource_id": str(getattr(resource, 'id', None)) if resource else None,
                    "context": context
                }
            )
    
    def clear_cache(self):
        """キャッシュクリア"""
        self._cache.clear()
    
    def get_access_stats(self, hours: int = 24) -> Dict[str, Any]:
        """アクセス統計取得"""
        cutoff_time = time.time() - (hours * 3600)
        
        stats = {
            "total_checks": 0,
            "denied_checks": 0,
            "unique_users": set(),
            "permission_usage": defaultdict(int),
            "denial_rate": 0.0
        }
        
        for user_id, records in self._access_log.items():
            for record in records:
                if record["timestamp"] > cutoff_time:
                    stats["total_checks"] += 1
                    stats["unique_users"].add(user_id)
                    stats["permission_usage"][record["permission"]] += 1
                    
                    if not record["result"]:
                        stats["denied_checks"] += 1
        
        # 拒否率計算
        if stats["total_checks"] > 0:
            stats["denial_rate"] = (stats["denied_checks"] / stats["total_checks"]) * 100
        
        stats["unique_users"] = len(stats["unique_users"])
        stats["permission_usage"] = dict(stats["permission_usage"])
        
        return stats


# ==========================================
# グローバルインスタンス
# ==========================================

permission_manager = PermissionManager()


# ==========================================
# 権限チェック関数
# ==========================================

def check_permission(
    user: Optional[User],
    permission: Permission,
    resource: Optional[Any] = None,
    context: Optional[Dict[str, Any]] = None
) -> bool:
    """権限チェック"""
    return permission_manager.has_permission(user, permission, resource, context)


def require_permission(
    permission: Permission,
    resource_getter: Optional[Callable] = None
):
    """権限要求デコレータ"""
    
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 依存性注入からユーザーを取得
            user = None
            for arg in args:
                if isinstance(arg, (User, AuthResult)):
                    if isinstance(arg, AuthResult):
                        user = arg.user
                    else:
                        user = arg
                    break
            
            # kwargsからユーザーを取得
            if not user:
                for key, value in kwargs.items():
                    if isinstance(value, (User, AuthResult)):
                        if isinstance(value, AuthResult):
                            user = value.user
                        else:
                            user = value
                        break
            
            # リソース取得
            resource = None
            if resource_getter:
                if callable(resource_getter):
                    resource = resource_getter(*args, **kwargs)
                else:
                    resource = resource_getter
            
            # 権限チェック
            if not check_permission(user, permission, resource):
                if not user:
                    raise AuthenticationError("認証が必要です")
                else:
                    raise InsufficientPermissionError(
                        required_permission=permission.value,
                        user_permissions=[p.value for p in permission_manager.get_role_permissions(permission_manager.get_user_role(user))]
                    )
            
            return await func(*args, **kwargs)
        
        return wrapper
    return decorator


def require_admin_user(
    auth_result: Union[User, AuthResult] = Depends(get_current_user)
) -> User:
    """管理者権限要求"""
    
    if isinstance(auth_result, AuthResult):
        if not auth_result.is_authenticated:
            raise AuthenticationError("認証が必要です")
        
        if auth_result.is_guest:
            raise AdminRequiredError("この機能は管理者のみ利用できます")
        
        user = auth_result.user
    else:
        user = auth_result
    
    if not user or not user.is_admin:
        raise AdminRequiredError("管理者権限が必要です")
    
    return user


def require_super_admin_user(
    auth_result: Union[User, AuthResult] = Depends(get_current_user)
) -> User:
    """スーパー管理者権限要求"""
    
    if isinstance(auth_result, AuthResult):
        if not auth_result.is_authenticated:
            raise AuthenticationError("認証が必要です")
        
        if auth_result.is_guest:
            raise AdminRequiredError("この機能はスーパー管理者のみ利用できます")
        
        user = auth_result.user
    else:
        user = auth_result
    
    if not user or user.user_type != UserType.SUPER_ADMIN.value:
        raise AdminRequiredError("スーパー管理者権限が必要です")
    
    return user


# ==========================================
# エンドポイント監視
# ==========================================

class EndpointMonitor:
    """エンドポイント監視"""
    
    def __init__(self):
        self._access_log = defaultdict(list)
        self._endpoint_stats = defaultdict(lambda: {
            "total_requests": 0,
            "authenticated_requests": 0,
            "denied_requests": 0,
            "error_requests": 0,
            "avg_response_time": 0.0
        })
    
    def log_access(
        self,
        endpoint: str,
        method: str,
        user: Optional[User],
        status_code: int,
        response_time_ms: float,
        ip_address: Optional[str] = None
    ):
        """アクセスログ記録"""
        
        record = {
            "timestamp": time.time(),
            "endpoint": endpoint,
            "method": method,
            "user_id": str(user.id) if user else None,
            "user_type": user.user_type if user else "anonymous",
            "status_code": status_code,
            "response_time_ms": response_time_ms,
            "ip_address": ip_address
        }
        
        self._access_log[endpoint].append(record)
        
        # 統計更新
        stats = self._endpoint_stats[f"{method} {endpoint}"]
        stats["total_requests"] += 1
        
        if user:
            stats["authenticated_requests"] += 1
        
        if status_code >= 400:
            if status_code == 403:
                stats["denied_requests"] += 1
            else:
                stats["error_requests"] += 1
        
        # 平均応答時間更新
        current_avg = stats["avg_response_time"]
        total = stats["total_requests"]
        stats["avg_response_time"] = ((current_avg * (total - 1)) + response_time_ms) / total
    
    def get_endpoint_stats(self, hours: int = 24) -> Dict[str, Any]:
        """エンドポイント統計取得"""
        cutoff_time = time.time() - (hours * 3600)
        
        filtered_stats = {}
        
        for endpoint, stats in self._endpoint_stats.items():
            # 時間範囲内のレコードをフィルタ
            recent_records = []
            for records in self._access_log.values():
                recent_records.extend([
                    r for r in records 
                    if r["timestamp"] > cutoff_time
                ])
            
            if recent_records:
                filtered_stats[endpoint] = {
                    "total_requests": len(recent_records),
                    "unique_users": len(set(r["user_id"] for r in recent_records if r["user_id"])),
                    "avg_response_time": sum(r["response_time_ms"] for r in recent_records) / len(recent_records),
                    "error_rate": len([r for r in recent_records if r["status_code"] >= 400]) / len(recent_records) * 100,
                    "denial_rate": len([r for r in recent_records if r["status_code"] == 403]) / len(recent_records) * 100
                }
        
        return filtered_stats
    
    def get_security_alerts(self, hours: int = 24) -> List[Dict[str, Any]]:
        """セキュリティアラート取得"""
        cutoff_time = time.time() - (hours * 3600)
        alerts = []
        
        # 拒否率の高いエンドポイント
        stats = self.get_endpoint_stats(hours)
        for endpoint, stat in stats.items():
            if stat["denial_rate"] > 20:  # 20%以上の拒否率
                alerts.append({
                    "type": "high_denial_rate",
                    "endpoint": endpoint,
                    "denial_rate": stat["denial_rate"],
                    "severity": "medium"
                })
        
        # 異常なアクセスパターン
        ip_requests = defaultdict(int)
        for records in self._access_log.values():
            for record in records:
                if record["timestamp"] > cutoff_time and record["ip_address"]:
                    ip_requests[record["ip_address"]] += 1
        
        for ip, count in ip_requests.items():
            if count > 1000:  # 1時間に1000リクエスト以上
                alerts.append({
                    "type": "suspicious_activity",
                    "ip_address": ip,
                    "request_count": count,
                    "severity": "high"
                })
        
        return alerts


# ==========================================
# グローバル監視インスタンス
# ==========================================

endpoint_monitor = EndpointMonitor()


def monitor_endpoint_access(endpoint_name: str):
    """エンドポイント監視デコレータ"""
    
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start_time = time.perf_counter()
            user = None
            status_code = 200
            
            try:
                # ユーザー取得
                for arg in args:
                    if isinstance(arg, (User, AuthResult)):
                        if isinstance(arg, AuthResult):
                            user = arg.user
                        else:
                            user = arg
                        break
                
                # 関数実行
                result = await func(*args, **kwargs)
                
                return result
                
            except HTTPException as e:
                status_code = e.status_code
                raise
            except Exception as e:
                status_code = 500
                raise
            finally:
                # 監視ログ記録
                response_time = (time.perf_counter() - start_time) * 1000
                endpoint_monitor.log_access(
                    endpoint=endpoint_name,
                    method="unknown",  # リクエストオブジェクトがない場合
                    user=user,
                    status_code=status_code,
                    response_time_ms=response_time
                )
        
        return wrapper
    return decorator


# ==========================================
# セキュリティ監査
# ==========================================

class SecurityAuditor:
    """セキュリティ監査"""
    
    def __init__(self):
        self.permission_manager = permission_manager
        self.endpoint_monitor = endpoint_monitor
    
    def audit_user_permissions(self, user: User) -> Dict[str, Any]:
        """ユーザー権限監査"""
        
        user_role = self.permission_manager.get_user_role(user)
        user_permissions = self.permission_manager.get_role_permissions(user_role)
        
        audit_result = {
            "user_id": str(user.id),
            "username": user.username,
            "user_type": user.user_type,
            "role": user_role.value,
            "permissions": [p.value for p in user_permissions],
            "is_admin": user.is_admin,
            "account_status": {
                "is_active": user.is_active,
                "is_verified": user.is_verified,
                "is_locked": user.locked_until is not None and user.locked_until > datetime.utcnow()
            },
            "last_login": user.last_login_at.isoformat() if user.last_login_at else None,
            "created_at": user.created_at.isoformat(),
            "audit_timestamp": time.time()
        }
        
        return audit_result
    
    def audit_system_security(self) -> Dict[str, Any]:
        """システムセキュリティ監査"""
        
        # 権限統計
        permission_stats = self.permission_manager.get_access_stats()
        
        # エンドポイント統計
        endpoint_stats = self.endpoint_monitor.get_endpoint_stats()
        
        # セキュリティアラート
        security_alerts = self.endpoint_monitor.get_security_alerts()
        
        return {
            "permission_stats": permission_stats,
            "endpoint_stats": endpoint_stats,
            "security_alerts": security_alerts,
            "audit_timestamp": time.time()
        }
    
    def generate_security_report(self, hours: int = 24) -> Dict[str, Any]:
        """セキュリティレポート生成"""
        
        system_audit = self.audit_system_security()
        
        # 推奨事項生成
        recommendations = []
        
        if system_audit["permission_stats"]["denial_rate"] > 10:
            recommendations.append({
                "type": "high_denial_rate",
                "message": "権限拒否率が高いです。権限設定を見直してください。",
                "priority": "medium"
            })
        
        if len(system_audit["security_alerts"]) > 0:
            recommendations.append({
                "type": "security_alerts",
                "message": "セキュリティアラートが発生しています。詳細を確認してください。",
                "priority": "high"
            })
        
        return {
            "report_period_hours": hours,
            "system_audit": system_audit,
            "recommendations": recommendations,
            "generated_at": time.time()
        }


# ==========================================
# セキュリティミドルウェア
# ==========================================

class SecurityMiddleware:
    """セキュリティミドルウェア"""
    
    def __init__(self, app):
        self.app = app
        self.auditor = SecurityAuditor()
    
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            # セキュリティヘッダー追加
            async def send_wrapper(message):
                if message["type"] == "http.response.start":
                    headers = list(message.get("headers", []))
                    
                    # セキュリティヘッダー追加
                    for header, value in settings.SECURITY_HEADERS.items():
                        headers.append([header.encode(), value.encode()])
                    
                    message["headers"] = headers
                
                await send(message)
            
            await self.app(scope, receive, send_wrapper)
        else:
            await self.app(scope, receive, send)


# ==========================================
# ユーティリティ関数
# ==========================================

def get_security_auditor() -> SecurityAuditor:
    """セキュリティ監査インスタンス取得"""
    return SecurityAuditor()


def get_permission_manager() -> PermissionManager:
    """権限管理インスタンス取得"""
    return permission_manager


def get_endpoint_monitor() -> EndpointMonitor:
    """エンドポイント監視インスタンス取得"""
    return endpoint_monitor


# ==========================================
# エクスポート
# ==========================================

__all__ = [
    'Permission',
    'Role',
    'PermissionManager',
    'SecurityAuditor',
    'SecurityMiddleware',
    'EndpointMonitor',
    'check_permission',
    'require_permission',
    'require_admin_user',
    'require_super_admin_user',
    'monitor_endpoint_access',
    'get_security_auditor',
    'get_permission_manager',
    'get_endpoint_monitor',
    'permission_manager',
    'endpoint_monitor'
]