from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, validator
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
import hashlib
import secrets
import logging

from app.core.database import get_db
from app.core.config import settings
from app.core.auth import get_current_active_user, get_current_session_id, auth_manager
from app.models.models import User, UserSession
from app.utils.rate_limiter import check_rate_limit

router = APIRouter()

logger = logging.getLogger("travelcanvas.auth")

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/api/v1/auth"

# パスワードハッシュ化
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Pydantic models
class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    user_type: str
    is_verified: bool

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class UserDetailResponse(BaseModel):
    """[Gate #20] GET/PUT /me用の詳細ユーザー情報。preferences(JSON)を含む。"""
    id: str
    username: str
    email: str
    user_type: str
    is_verified: bool
    is_active: bool
    preferences: Optional[Dict[str, Any]] = None
    created_at: datetime

    # [Gate #27] User.idはDB上UUID型カラムのため、ORMオブジェクトから直接
    # 変換するとPydantic v2ではstrへ暗黙変換されずResponseValidationError
    # (実質500エラー)になっていた実バグの修正。GET/PUT /auth/meを実際に
    # 呼び出すpytestで発覚した。
    @validator('id', pre=True)
    def _stringify_id(cls, v):
        return str(v)

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    """[Gate #20] プロフィール更新スキーマ。渡されたフィールドのみ更新する。"""
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    preferences: Optional[Dict[str, Any]] = None


class PasswordChange(BaseModel):
    """[Gate #21] パスワード変更スキーマ"""
    current_password: str
    new_password: str

    @validator('new_password')
    def new_password_min_length(cls, v):
        if len(v) < 8:
            raise ValueError('新しいパスワードは8文字以上にしてください')
        return v


class SessionInfo(BaseModel):
    """[Gate #28] セッション(device/session)一覧表示用"""
    id: str
    ip_address: Optional[str] = None
    device_info: Optional[Dict[str, Any]] = None
    created_at: datetime
    expires_at: datetime
    is_current: bool

    class Config:
        from_attributes = True

# ユーティリティ関数
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


# ===== [Gate #28] refresh token ユーティリティ =====
# refresh tokenは "{session_id}.{secret}" という不透明な文字列としてhttpOnly
# cookieでのみ発行する(レスポンスJSONには含めない/localStorageにも置かない)。
# DBにはsecretの平文ではなくSHA-256ハッシュ(session_token列)のみを保存し、
# 使用の度に新しいsecretへローテーションする。ハッシュが一致しない
# (=既にローテーション済みの古いtokenが再送されてきた)場合は盗用の兆候と
# みなし、そのセッションを即座に失効させる。

def _hash_refresh_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _generate_refresh_secret() -> str:
    return secrets.token_urlsafe(32)


def _parse_refresh_cookie(raw: str):
    if not raw or "." not in raw:
        return None, None
    session_id, _, secret = raw.partition(".")
    return session_id, secret


def _access_token_for(user: User, session_id: str) -> str:
    return create_access_token(
        data={"sub": str(user.id), "username": user.username, "session_id": str(session_id)}
    )

@router.post("/register", response_model=TokenResponse)
async def register(
    user_data: UserRegister,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """新規ユーザー登録"""

    # [Gate #28] IPベースのレート制限。ログインと同じ閾値を流用する。
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"register:{client_ip}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登録試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )

    try:
        # ユーザー重複チェック
        existing_user = db.query(User).filter(
            (User.email == user_data.email) | 
            (User.username == user_data.username)
        ).first()
        
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="このメールアドレスまたはユーザー名は既に使用されています"
            )
        
        # パスワードハッシュ化
        hashed_password = hash_password(user_data.password)
        
        # 新規ユーザー作成
        new_user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=hashed_password,
            user_type="registered",
            is_active=True,
            is_verified=False
        )
        
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        # [Gate #28] セッションを作成し、refresh tokenをhttpOnly cookieで発行する。
        secret = _generate_refresh_secret()
        session = auth_manager.create_session(
            user_id=new_user.id,
            refresh_token_hash=_hash_refresh_secret(secret),
            ip_address=client_ip,
            device_info={"user_agent": request.headers.get("user-agent", "")[:255]},
            db=db,
        )
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=f"{session.id}.{secret}",
            httponly=True,
            secure=settings.APP_ENV == "production",
            samesite="lax",
            path=REFRESH_COOKIE_PATH,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        )
        access_token = _access_token_for(new_user, session.id)
        
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            user=UserResponse(
                id=str(new_user.id),
                username=new_user.username,
                email=new_user.email,
                user_type=new_user.user_type,
                is_verified=new_user.is_verified
            )
        )
        
    except HTTPException:
        raise
    except Exception:
        # [Gate #28] 内部例外の文字列(SQL文言等)をそのままクライアントへ返す
        # と情報漏洩になるため、汎用メッセージのみを返し、詳細はサーバー
        # ログ(request_id付き)にのみ記録する。
        request_id = getattr(request.state, "request_id", "unknown")
        logger.exception(f"[{request_id}] registration failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="登録に失敗しました。しばらくしてから再試行してください。"
        )

@router.post("/login", response_model=TokenResponse)
async def login(
    login_data: UserLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """ユーザーログイン"""

    # [Gate #28] IPベース・メールアドレスベース両方でレート制限する
    # (単一IPからの複数アカウント総当り、単一アカウントへの分散総当り
    # の双方をある程度緩和する)。
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login_ip:{client_ip}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )
    if not check_rate_limit(f"login_email:{login_data.email}", settings.RATE_LIMIT_AUTH, 60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。"
        )

    try:
        # ユーザー取得
        user = db.query(User).filter(User.email == login_data.email).first()
        
        if not user or not verify_password(login_data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="メールアドレスまたはパスワードが正しくありません"
            )
        
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="アカウントが無効です"
            )

        # [Gate #28] セッションを作成し、refresh tokenをhttpOnly cookieで発行する。
        secret = _generate_refresh_secret()
        session = auth_manager.create_session(
            user_id=user.id,
            refresh_token_hash=_hash_refresh_secret(secret),
            ip_address=client_ip,
            device_info={"user_agent": request.headers.get("user-agent", "")[:255]},
            db=db,
        )
        response.set_cookie(
            key=REFRESH_COOKIE_NAME,
            value=f"{session.id}.{secret}",
            httponly=True,
            secure=settings.APP_ENV == "production",
            samesite="lax",
            path=REFRESH_COOKIE_PATH,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        )
        access_token = _access_token_for(user, session.id)
        
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            user=UserResponse(
                id=str(user.id),
                username=user.username,
                email=user.email,
                user_type=user.user_type,
                is_verified=user.is_verified
            )
        )
        
    except HTTPException:
        raise
    except Exception:
        request_id = getattr(request.state, "request_id", "unknown")
        logger.exception(f"[{request_id}] login failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ログインに失敗しました。しばらくしてから再試行してください。"
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token_endpoint(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """[Gate #28] refresh tokenをhttpOnly cookieから読み取り、ローテーション
    したうえで新しいaccess token/refresh tokenを発行する。1つのrefresh
    tokenは1回しか使えない(使うたびに新しいものへ入れ替わる)。既に
    ローテーション済みの(=一度使われた)tokenが再送された場合は盗用の
    兆候とみなし、そのセッションを即座に失効させて401を返す。"""
    raw_cookie = request.cookies.get(REFRESH_COOKIE_NAME)
    session_id, secret = _parse_refresh_cookie(raw_cookie) if raw_cookie else (None, None)

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="セッションが無効です。再度ログインしてください。"
    )
    if not session_id or not secret:
        raise invalid

    session = db.query(UserSession).filter(UserSession.id == session_id).first()
    if not session:
        raise invalid

    presented_hash = _hash_refresh_secret(secret)

    if not session.is_active or (session.expires_at and session.expires_at <= datetime.now(timezone.utc)):
        response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
        raise invalid

    if session.session_token != presented_hash:
        # [Gate #28] 再利用検知: 既にローテーション済みのtokenが送られてきた。
        # 盗用されたrefresh tokenが使われた可能性があるため、このセッション
        # を即座に失効させる。
        auth_manager.revoke_session(str(session.id), db)
        response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
        logger.warning(f"refresh token reuse detected, session revoked: {session.id}")
        raise invalid

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user or not user.is_active:
        auth_manager.revoke_session(str(session.id), db)
        response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
        raise invalid

    new_secret = _generate_refresh_secret()
    auth_manager.rotate_session_token(str(session.id), _hash_refresh_secret(new_secret), db)
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=f"{session.id}.{new_secret}",
        httponly=True,
        secure=settings.APP_ENV == "production",
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )
    access_token = _access_token_for(user, session.id)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse(
            id=str(user.id),
            username=user.username,
            email=user.email,
            user_type=user.user_type,
            is_verified=user.is_verified,
        ),
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    session_id: Optional[str] = Depends(get_current_session_id),
    db: Session = Depends(get_db),
):
    """[Gate #28] 現在のセッションのみ失効させる。"""
    if session_id:
        auth_manager.revoke_session(session_id, db)
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return {"message": "ログアウトしました"}


@router.post("/logout-all")
async def logout_all(
    response: Response,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate #28] 現在のユーザーの全セッションを失効させる(全デバイスでログアウト)。"""
    auth_manager.revoke_all_user_sessions(str(current_user.id), db)
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return {"message": "すべてのデバイスからログアウトしました"}


@router.get("/sessions", response_model=List[SessionInfo])
async def list_sessions(
    current_user: User = Depends(get_current_active_user),
    current_session_id: Optional[str] = Depends(get_current_session_id),
    db: Session = Depends(get_db),
):
    """[Gate #28] 現在有効なセッション(ログイン中デバイス)の一覧。"""
    sessions = (
        db.query(UserSession)
        .filter(
            UserSession.user_id == current_user.id,
            UserSession.is_active == True,
            UserSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(UserSession.created_at.desc())
        .all()
    )
    return [
        SessionInfo(
            id=str(s.id),
            ip_address=s.ip_address,
            device_info=s.device_info,
            created_at=s.created_at,
            expires_at=s.expires_at,
            is_current=(str(s.id) == str(current_session_id)),
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}")
async def revoke_session_endpoint(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """[Gate #28] 指定したセッションを失効させる(他デバイスの個別ログアウト)。
    自分以外のユーザーのセッションは失効できない(403)。"""
    session = db.query(UserSession).filter(UserSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="セッションが見つかりません")
    if str(session.user_id) != str(current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="このセッションを操作する権限がありません")
    auth_manager.revoke_session(session_id, db)
    return {"message": "セッションを失効させました"}

@router.get("/test")
async def test_auth():
    """認証API テスト"""
    return {
        "message": "Authentication API is working",
        "endpoints": [
            "POST /api/v1/auth/register",
            "POST /api/v1/auth/login"
        ]
    }


# ===== プロフィール関連API =====
# [Gate #20] SettingsPage.tsx(プロフィール/通知設定/環境設定)の保存処理は
# 常にsetTimeoutで成功を偽装するだけで、実際にはどこにも保存していなかった。
# User.preferencesはUUIDベースラインの時点で既にモデル・DBに存在していた
# (マイグレーション不要)ため、GET/PUT /auth/meを実装してこのJSONカラムに
# username/email以外の任意設定(通知設定・言語/タイムゾーン等)をまとめて保存する。
# あわせて、authStore.tsのcheckAuth()が呼んでいた/auth/me(GET)がこれまで
# 存在しておらず404になる状態だったのも解消する。

@router.get("/me", response_model=UserDetailResponse)
async def get_me(
    current_user: User = Depends(get_current_active_user)
):
    """現在のユーザー情報を取得(preferencesを含む)"""
    return current_user


@router.put("/me", response_model=UserDetailResponse)
async def update_me(
    update_data: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """現在のユーザー情報を更新"""
    try:
        if update_data.username is not None and update_data.username != current_user.username:
            existing = db.query(User).filter(
                User.username == update_data.username,
                User.id != current_user.id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="このユーザー名は既に使用されています"
                )
            current_user.username = update_data.username

        if update_data.email is not None and update_data.email != current_user.email:
            existing = db.query(User).filter(
                User.email == update_data.email,
                User.id != current_user.id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="このメールアドレスは既に使用されています"
                )
            current_user.email = update_data.email

        if update_data.preferences is not None:
            # 既存のpreferencesとマージ(通知設定だけ更新、等の部分更新に対応)
            merged = dict(current_user.preferences or {})
            merged.update(update_data.preferences)
            current_user.preferences = merged

        db.commit()
        db.refresh(current_user)
        return current_user
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("profile update failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロフィールの更新に失敗しました。しばらくしてから再試行してください。"
        )


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_active_user),
    current_session_id: Optional[str] = Depends(get_current_session_id),
    db: Session = Depends(get_db)
):
    """[Gate #21] パスワード変更。SettingsPage.tsxで「開発中」として無効化
    されていた機能を実装する。frontend/src/services/api.tsのchangePasswordが
    既に呼んでいた /auth/change-password をここで実装する。
    [Gate #28] パスワード変更後は今使っているセッション以外の全セッション
    (=他デバイスのログイン状態)を失効させる。パスワードが漏洩して変更した
    ケースを想定した既定挙動。"""
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="現在のパスワードが正しくありません"
        )

    try:
        current_user.hashed_password = hash_password(password_data.new_password)
        db.commit()
        auth_manager.revoke_all_user_sessions(
            str(current_user.id), db, except_session_id=current_session_id
        )
        return {"message": "パスワードを変更しました。他のデバイスからはログアウトされます。"}
    except Exception:
        db.rollback()
        logger.exception("password change failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="パスワードの変更に失敗しました。しばらくしてから再試行してください。"
        )
