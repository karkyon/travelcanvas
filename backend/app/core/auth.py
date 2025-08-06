"""
TravelCanvas Backend - 統一認証システム
複数の認証戦略を統合し、一貫性のある認証処理を提供

改善点:
- Redis + JWT の統一実装
- トークン検証ロジックの統一
- ユーザー取得関数の統一
- 設定値の統一（config.pyから取得）
- ゲスト認証と会員認証のハイブリッド対応
"""

from typing import List, Optional, Union, Dict, Any, Tuple
from datetime import datetime, timedelta
from uuid import uuid4
import time
import json
import hashlib
from enum import Enum

from fastapi import Depends, HTTPException, status, Request, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session
import redis

# アプリケーションインポート
from app.core.config import settings
from app.core.database import get_db
from app.core.logging import get_logger, log_security_event, SecurityEvents
from app.core.exceptions import AuthenticationError, ValidationError
from app.models.models import User, UserSession
from app.utils.rate_limiter import check_rate_limit


# ログ設定
logger = get_logger(__name__)

# パスワードハッシュ化（統一版）
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTPベアラー認証（統一版）
security = HTTPBearer(auto_error=False)

# Redis接続（統一版）
redis_client = None
try:
    redis_client = redis.from_url(
        settings.REDIS_URL,
        max_connections=settings.REDIS_MAX_CONNECTIONS,
        retry_on_timeout=settings.REDIS_RETRY_ON_TIMEOUT,
        socket_connect_timeout=settings.REDIS_SOCKET_CONNECT_TIMEOUT,
        socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
        decode_responses=True
    )
    logger.info("✅ Redis connection established for authentication")
except Exception as e:
    logger.error(f"❌ Redis connection failed: {str(e)}")
    redis_client = None


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


class TokenType(str, Enum):
    """トークンタイプ"""
    ACCESS = "access"
    REFRESH = "refresh"
    GUEST = "guest"
    RESET_PASSWORD = "reset_password"
    EMAIL_VERIFICATION = "email_verification"


class SessionStatus(str, Enum):
    """セッション状態"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    EXPIRED = "expired"
    REVOKED = "revoked"


# ==========================================
# データクラス定義
# ==========================================

class TokenData:
    """トークンデータ（統一版）"""
    
    def __init__(
        self,
        user_id: Optional[str] = None,
        username: Optional[str] = None,
        user_type: Optional[UserType] = None,
        session_id: Optional[str] = None,
        token_type: TokenType = TokenType.ACCESS,
        expires_at: Optional[datetime] = None,
        permissions: Optional[List[str]] = None,
        is_guest: bool = False
    ):
        self.user_id = user_id
        self.username = username
        self.user_type = user_type
        self.session_id = session_id
        self.token_type = token_type
        self.expires_at = expires_at
        self.permissions = permissions or []
        self.is_guest = is_guest
    
    def to_dict(self) -> Dict[str, Any]:
        """辞書形式に変換"""
        return {
            "user_id": self.user_id,
            "username": self.username,
            "user_type": self.user_type.value if self.user_type else None,
            "session_id": self.session_id,
            "token_type": self.token_type.value,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "permissions": self.permissions,
            "is_guest": self.is_guest
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TokenData":
        """辞書から作成"""
        return cls(
            user_id=data.get("user_id"),
            username=data.get("username"),
            user_type=UserType(data["user_type"]) if data.get("user_type") else None,
            session_id=data.get("session_id"),
            token_type=TokenType(data.get("token_type", "access")),
            expires_at=datetime.fromisoformat(data["expires_at"]) if data.get("expires_at") else None,
            permissions=data.get("permissions", []),
            is_guest=data.get("is_guest", False)
        )


class AuthResult:
    """認証結果"""
    
    def __init__(
        self,
        user: Optional[User] = None,
        token_data: Optional[TokenData] = None,
        is_authenticated: bool = False,
        is_guest: bool = False,
        session_id: Optional[str] = None
    ):
        self.user = user
        self.token_data = token_data
        self.is_authenticated = is_authenticated
        self.is_guest = is_guest
        self.session_id = session_id


# ==========================================
# 統一認証マネージャー
# ==========================================

class AuthManager:
    """統一認証マネージャー"""
    
    def __init__(self):
        self.pwd_context = pwd_context
        self.redis_client = redis_client
        self.logger = get_logger(f"{__name__}.AuthManager")
    
    # ==========================================
    # パスワード処理（統一版）
    # ==========================================
    
    def hash_password(self, password: str) -> str:
        """パスワードハッシュ化"""
        return self.pwd_context.hash(password)
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """パスワード検証"""
        return self.pwd_context.verify(plain_password, hashed_password)
    
    def validate_password_strength(self, password: str) -> Dict[str, Any]:
        """パスワード強度検証（統一版）"""
        result = {
            "is_valid": True,
            "errors": [],
            "strength_score": 0,
            "suggestions": []
        }
        
        # 長さチェック
        if len(password) < settings.PASSWORD_MIN_LENGTH:
            result["is_valid"] = False
            result["errors"].append(f"パスワードは{settings.PASSWORD_MIN_LENGTH}文字以上である必要があります")
        
        if len(password) > settings.PASSWORD_MAX_LENGTH:
            result["is_valid"] = False
            result["errors"].append(f"パスワードは{settings.PASSWORD_MAX_LENGTH}文字以下である必要があります")
        
        # 強度スコア計算
        score = 0
        
        # 文字種チェック
        has_upper = any(c.isupper() for c in password)
        has_lower = any(c.islower() for c in password)
        has_digit = any(c.isdigit() for c in password)
        has_special = any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password)
        
        if has_upper:
            score += 1
        else:
            result["suggestions"].append("大文字を含めてください")
        
        if has_lower:
            score += 1
        else:
            result["suggestions"].append("小文字を含めてください")
        
        if has_digit:
            score += 1
        else:
            result["suggestions"].append("数字を含めてください")
        
        if has_special:
            score += 1
        else:
            result["suggestions"].append("特殊文字を含めてください")
        
        # 長さボーナス
        if len(password) >= 12:
            score += 1
        elif len(password) >= 10:
            score += 0.5
        
        result["strength_score"] = min(score, 5)
        
        # 弱いパスワードパターンチェック
        weak_patterns = ["password", "123456", "qwerty", "admin", "guest"]
        if any(pattern in password.lower() for pattern in weak_patterns):
            result["is_valid"] = False
            result["errors"].append("一般的なパスワードパターンは使用できません")
        
        return result
    
    # ==========================================
    # JWT処理（統一版）
    # ==========================================
    
    def create_access_token(
        self,
        data: Dict[str, Any],
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """アクセストークン生成（統一版）"""
        
        to_encode = data.copy()
        
        # 有効期限設定
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "access"
        })
        
        # JWT生成
        encoded_jwt = jwt.encode(
            to_encode,
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM
        )
        
        return encoded_jwt
    
    def create_refresh_token(
        self,
        user_id: str,
        session_id: str
    ) -> str:
        """リフレッシュトークン生成"""
        
        expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        
        to_encode = {
            "user_id": user_id,
            "session_id": session_id,
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "refresh"
        }
        
        encoded_jwt = jwt.encode(
            to_encode,
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM
        )
        
        return encoded_jwt
    
    def create_guest_token(self, guest_id: str) -> str:
        """ゲストトークン生成"""
        
        expire = datetime.utcnow() + timedelta(hours=settings.GUEST_TOKEN_EXPIRE_HOURS)
        
        to_encode = {
            "guest_id": guest_id,
            "user_type": UserType.GUEST.value,
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "guest"
        }
        
        encoded_jwt = jwt.encode(
            to_encode,
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM
        )
        
        return encoded_jwt
    
    def verify_token(self, token: str) -> Optional[TokenData]:
        """トークン検証（統一版）"""
        
        try:
            # JWT デコード
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            # 基本データ取得
            token_type = payload.get("type", "access")
            
            # トークンタイプ別処理
            if token_type == "access":
                return self._parse_access_token(payload)
            elif token_type == "refresh":
                return self._parse_refresh_token(payload)
            elif token_type == "guest":
                return self._parse_guest_token(payload)
            else:
                self.logger.warning(f"Unknown token type: {token_type}")
                return None
        
        except JWTError as e:
            self.logger.warning(f"JWT verification failed: {str(e)}")
            return None
        except Exception as e:
            self.logger.error(f"Token verification error: {str(e)}")
            return None
    
    def _parse_access_token(self, payload: Dict[str, Any]) -> Optional[TokenData]:
        """アクセストークン解析"""
        
        user_id = payload.get("sub")
        if not user_id:
            return None
        
        return TokenData(
            user_id=user_id,
            username=payload.get("username"),
            user_type=UserType(payload["user_type"]) if payload.get("user_type") else None,
            session_id=payload.get("session_id"),
            token_type=TokenType.ACCESS,
            expires_at=datetime.fromtimestamp(payload["exp"]) if payload.get("exp") else None,
            permissions=payload.get("permissions", []),
            is_guest=payload.get("user_type") == UserType.GUEST.value
        )
    
    def _parse_refresh_token(self, payload: Dict[str, Any]) -> Optional[TokenData]:
        """リフレッシュトークン解析"""
        
        user_id = payload.get("user_id") 
        session_id = payload.get("session_id")
        
        if not user_id or not session_id:
            return None
        
        return TokenData(
            user_id=user_id,
            session_id=session_id,
            token_type=TokenType.REFRESH,
            expires_at=datetime.fromtimestamp(payload["exp"]) if payload.get("exp") else None
        )
    
    def _parse_guest_token(self, payload: Dict[str, Any]) -> Optional[TokenData]:
        """ゲストトークン解析"""
        
        guest_id = payload.get("guest_id")
        if not guest_id:
            return None
        
        return TokenData(
            user_id=guest_id,
            user_type=UserType.GUEST,
            token_type=TokenType.GUEST,
            expires_at=datetime.fromtimestamp(payload["exp"]) if payload.get("exp") else None,
            is_guest=True
        )
    
    # ==========================================
    # セッション管理（統一版）
    # ==========================================
    
    def create_session(
        self,
        user_id: str,
        client_ip: str,
        user_agent: str,
        db: Session
    ) -> str:
        """セッション作成"""
        
        session_id = str(uuid4())
        expires_at = datetime.utcnow() + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
        
        # データベースセッション記録
        db_session = UserSession(
            id=session_id,
            user_id=user_id,
            client_ip=client_ip,
            user_agent=user_agent,
            expires_at=expires_at,
            is_active=True
        )
        
        db.add(db_session)
        
        # Redisキャッシュ
        if self.redis_client:
            try:
                session_data = {
                    "user_id": user_id,
                    "client_ip": client_ip,
                    "user_agent": user_agent,
                    "created_at": datetime.utcnow().isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "is_active": True
                }
                
                self.redis_client.setex(
                    f"session:{session_id}",
                    settings.SESSION_EXPIRE_MINUTES * 60,
                    json.dumps(session_data)
                )
                
            except Exception as e:
                self.logger.warning(f"Failed to cache session: {str(e)}")
        
        db.commit()
        
        self.logger.info(f"Session created: {session_id} for user: {user_id}")
        return session_id
    
    def verify_session(self, session_id: str, db: Session) -> Optional[UserSession]:
        """セッション検証"""
        
        # Redisから取得試行
        if self.redis_client:
            try:
                session_data = self.redis_client.get(f"session:{session_id}")
                if session_data:
                    data = json.loads(session_data)
                    expires_at = datetime.fromisoformat(data["expires_at"])
                    
                    if datetime.utcnow() < expires_at and data.get("is_active"):
                        # セッション有効期限延長
                        self.extend_session(session_id, db)
                        
                        # 仮のUserSessionオブジェクト作成
                        session = UserSession()
                        session.id = session_id
                        session.user_id = data["user_id"]
                        session.client_ip = data["client_ip"]
                        session.user_agent = data["user_agent"]
                        session.expires_at = expires_at
                        session.is_active = data["is_active"]
                        
                        return session
                        
            except Exception as e:
                self.logger.warning(f"Failed to get session from cache: {str(e)}")
        
        # データベースから取得
        session = db.query(UserSession).filter(
            UserSession.id == session_id,
            UserSession.is_active == True,
            UserSession.expires_at > datetime.utcnow()
        ).first()
        
        if session:
            # セッション有効期限延長
            self.extend_session(session_id, db)
        
        return session
    
    def extend_session(self, session_id: str, db: Session):
        """セッション有効期限延長"""
        
        new_expires_at = datetime.utcnow() + timedelta(minutes=settings.SESSION_EXPIRE_MINUTES)
        
        # データベース更新
        db.query(UserSession).filter(UserSession.id == session_id).update({
            "expires_at": new_expires_at,
            "updated_at": datetime.utcnow()
        })
        
        # Redisキャッシュ更新
        if self.redis_client:
            try:
                session_data = self.redis_client.get(f"session:{session_id}")
                if session_data:
                    data = json.loads(session_data)
                    data["expires_at"] = new_expires_at.isoformat()
                    
                    self.redis_client.setex(
                        f"session:{session_id}",
                        settings.SESSION_EXPIRE_MINUTES * 60,
                        json.dumps(data)
                    )
                    
            except Exception as e:
                self.logger.warning(f"Failed to extend session cache: {str(e)}")
        
        db.commit()
    
    def revoke_session(self, session_id: str, db: Session):
        """セッション無効化"""
        
        # データベース更新
        db.query(UserSession).filter(UserSession.id == session_id).update({
            "is_active": False,
            "updated_at": datetime.utcnow()
        })
        
        # Redisキャッシュ削除
        if self.redis_client:
            try:
                self.redis_client.delete(f"session:{session_id}")
            except Exception as e:
                self.logger.warning(f"Failed to delete session cache: {str(e)}")
        
        db.commit()
        
        self.logger.info(f"Session revoked: {session_id}")
    
    def revoke_all_user_sessions(self, user_id: str, db: Session):
        """ユーザーの全セッション無効化"""
        
        # データベース更新
        sessions = db.query(UserSession).filter(
            UserSession.user_id == user_id,
            UserSession.is_active == True
        ).all()
        
        for session in sessions:
            session.is_active = False
            session.updated_at = datetime.utcnow()
            
            # Redisキャッシュ削除
            if self.redis_client:
                try:
                    self.redis_client.delete(f"session:{session.id}")
                except Exception as e:
                    self.logger.warning(f"Failed to delete session cache: {str(e)}")
        
        db.commit()
        
        self.logger.info(f"All sessions revoked for user: {user_id}")
    
    # ==========================================
    # ユーザー認証（統一版）
    # ==========================================
    
    def authenticate_user(
        self,
        email: Optional[str],
        username: Optional[str],
        password: str,
        db: Session
    ) -> Optional[User]:
        """ユーザー認証"""
        
        # ユーザー取得
        query = db.query(User)
        if email:
            query = query.filter(User.email == email)
        elif username:
            query = query.filter(User.username == username)
        else:
            return None
        
        user = query.first()
        
        if not user:
            self.logger.warning(f"User not found: {email or username}")
            return None
        
        if not user.is_active:
            self.logger.warning(f"Inactive user login attempt: {user.id}")
            return None
        
        if not user.hashed_password:
            self.logger.warning(f"User has no password set: {user.id}")
            return None
        
        # パスワード検証
        if not self.verify_password(password, user.hashed_password):
            self.logger.warning(f"Invalid password for user: {user.id}")
            return None
        
        self.logger.info(f"User authenticated successfully: {user.id}")
        return user
    
    def get_current_user(
        self,
        credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
        db: Session = Depends(get_db)
    ) -> Union[User, AuthResult]:
        """現在のユーザー取得（統一版）"""
        
        if not credentials:
            # 認証なしでもゲストとして扱う（ハイブリッド認証）
            return AuthResult(is_guest=True)
        
        # トークン検証
        token_data = self.verify_token(credentials.credentials)
        if not token_data:
            raise AuthenticationError("無効なトークンです")
        
        # ゲストユーザーの場合
        if token_data.is_guest:
            # ゲストユーザー情報を作成
            guest_user = User()
            guest_user.id = token_data.user_id
            guest_user.user_type = UserType.GUEST
            guest_user.is_active = True
            guest_user.is_verified = False
            
            return AuthResult(
                user=guest_user,
                token_data=token_data,
                is_authenticated=True,
                is_guest=True
            )
        
        # 登録ユーザーの場合
        user = db.query(User).filter(User.id == token_data.user_id).first()
        if not user:
            raise AuthenticationError("ユーザーが見つかりません")
        
        if not user.is_active:
            raise AuthenticationError("アカウントが無効です")
        
        # セッション検証（セッションIDがある場合）
        if token_data.session_id:
            session = self.verify_session(token_data.session_id, db)
            if not session:
                raise AuthenticationError("セッションが無効です")
        
        return AuthResult(
            user=user,
            token_data=token_data,
            is_authenticated=True,
            is_guest=False,
            session_id=token_data.session_id
        )
    
    # ==========================================
    # ログイン・ログアウト処理
    # ==========================================
    
    def login_user(
        self,
        email: Optional[str],
        username: Optional[str],
        password: str,
        client_ip: str,
        user_agent: str,
        remember_me: bool,
        db: Session
    ) -> Dict[str, Any]:
        """ユーザーログイン"""
        
        # レート制限チェック
        rate_limit_key = f"login_attempt:{client_ip}"
        if not check_rate_limit(rate_limit_key, settings.RATE_LIMIT_AUTH, 60):
            raise AuthenticationError("ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。")
        
        # ユーザー認証
        user = self.authenticate_user(email, username, password, db)
        if not user:
            # セキュリティログ
            log_security_event(
                SecurityEvents.LOGIN_FAILED,
                details={
                    "email": email,
                    "username": username,
                    "client_ip": client_ip,
                    "reason": "invalid_credentials"
                }
            )
            raise AuthenticationError("メールアドレス/ユーザー名またはパスワードが正しくありません")
        
        # セッション作成
        session_id = self.create_session(user.id, client_ip, user_agent, db)
        
        # トークン生成
        token_expire = timedelta(
            days=settings.REMEMBER_ME_EXPIRE_DAYS if remember_me 
            else settings.ACCESS_TOKEN_EXPIRE_MINUTES / 1440  # 分を日に変換
        )
        
        access_token = self.create_access_token(
            data={
                "sub": str(user.id),
                "username": user.username,
                "user_type": user.user_type.value,
                "session_id": session_id,
                "permissions": []  # TODO: 権限システム実装後に追加
            },
            expires_delta=token_expire
        )
        
        refresh_token = self.create_refresh_token(str(user.id), session_id)
        
        # セキュリティログ
        log_security_event(
            SecurityEvents.LOGIN_SUCCESS,
            user_id=str(user.id),
            details={
                "username": user.username,
                "client_ip": client_ip,
                "session_id": session_id,
                "remember_me": remember_me
            }
        )
        
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": int(token_expire.total_seconds()),
            "user": {
                "id": str(user.id),
                "username": user.username,
                "email": user.email,
                "user_type": user.user_type.value,
                "is_verified": user.is_verified
            },
            "session_id": session_id
        }
    
    def logout_user(
        self,
        session_id: Optional[str],
        user_id: Optional[str],
        all_sessions: bool,
        db: Session
    ):
        """ユーザーログアウト"""
        
        if all_sessions and user_id:
            # 全セッション無効化
            self.revoke_all_user_sessions(user_id, db)
            
            # セキュリティログ
            log_security_event(
                SecurityEvents.LOGOUT,
                user_id=user_id,
                details={
                    "type": "all_sessions",
                    "session_count": "all"
                }
            )
            
        elif session_id:
            # 特定セッション無効化
            self.revoke_session(session_id, db)
            
            # セキュリティログ
            log_security_event(
                SecurityEvents.LOGOUT,
                user_id=user_id,
                details={
                    "type": "single_session",
                    "session_id": session_id
                }
            )
    
    def refresh_token(
        self,
        refresh_token: str,
        db: Session
    ) -> Dict[str, Any]:
        """トークンリフレッシュ"""
        
        # リフレッシュトークン検証
        token_data = self.verify_token(refresh_token)
        if not token_data or token_data.token_type != TokenType.REFRESH:
            raise AuthenticationError("無効なリフレッシュトークンです")
        
        # ユーザー取得
        user = db.query(User).filter(User.id == token_data.user_id).first()
        if not user or not user.is_active:
            raise AuthenticationError("ユーザーが見つかりません")
        
        # セッション検証
        session = self.verify_session(token_data.session_id, db)
        if not session:
            raise AuthenticationError("セッションが無効です")
        
        # 新しいアクセストークン生成
        new_access_token = self.create_access_token(
            data={
                "sub": str(user.id),
                "username": user.username,
                "user_type": user.user_type.value,
                "session_id": token_data.session_id,
                "permissions": []
            }
        )
        
        return {
            "access_token": new_access_token,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        }
    
    # ==========================================
    # ゲストユーザー処理
    # ==========================================
    
    def create_guest_session(
        self,
        client_ip: str,
        user_agent: str
    ) -> Dict[str, Any]:
        """ゲストセッション作成"""
        
        # ゲストID生成
        guest_id = f"guest_{uuid4().hex[:12]}"
        
        # ゲストトークン生成
        guest_token = self.create_guest_token(guest_id)
        
        # セキュリティログ
        log_security_event(
            SecurityEvents.GUEST_SESSION_CREATED,
            details={
                "guest_id": guest_id,
                "client_ip": client_ip
            }
        )
        
        return {
            "guest_token": guest_token,
            "guest_id": guest_id,
            "token_type": "bearer",
            "expires_in": settings.GUEST_TOKEN_EXPIRE_HOURS * 3600
        }


# ==========================================
# グローバル認証マネージャーインスタンス
# ==========================================

auth_manager = AuthManager()


# ==========================================
# 依存性注入用関数（統一版）
# ==========================================

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    db: Session = Depends(get_db)
) -> Union[User, AuthResult]:
    """現在のユーザー取得（依存性注入用）"""
    return auth_manager.get_current_user(credentials, db)


def get_current_active_user(
    auth_result: Union[User, AuthResult] = Depends(get_current_user)
) -> User:
    """アクティブユーザー取得（認証必須）"""
    
    if isinstance(auth_result, AuthResult):
        if not auth_result.is_authenticated:
            raise AuthenticationError("認証が必要です")
        
        if auth_result.is_guest:
            raise AuthenticationError("この機能は会員のみ利用できます")
        
        return auth_result.user
    
    return auth_result


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    db: Session = Depends(get_db)
) -> Optional[Union[User, AuthResult]]:
    """現在のユーザー取得（認証オプション）"""
    
    try:
        return auth_manager.get_current_user(credentials, db)
    except AuthenticationError:
        return None


# ==========================================
# ユーティリティ関数
# ==========================================

def hash_password(password: str) -> str:
    """パスワードハッシュ化（ユーティリティ）"""
    return auth_manager.hash_password(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """パスワード検証（ユーティリティ）"""
    return auth_manager.verify_password(plain_password, hashed_password)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """アクセストークン生成（ユーティリティ）"""
    return auth_manager.create_access_token(data, expires_delta)


def verify_token(token: str) -> Optional[TokenData]:
    """トークン検証（ユーティリティ）"""
    return auth_manager.verify_token(token)