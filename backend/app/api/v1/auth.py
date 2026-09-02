from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, validator
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from app.core.database import get_db
from app.core.config import settings
from app.core.auth import get_current_active_user
from app.models.models import User

router = APIRouter()

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

@router.post("/register", response_model=TokenResponse)
async def register(
    user_data: UserRegister,
    request: Request,
    db: Session = Depends(get_db)
):
    """新規ユーザー登録"""
    
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
        
        # アクセストークン作成
        access_token = create_access_token(
            data={"sub": str(new_user.id), "username": new_user.username}
        )
        
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"登録に失敗しました: {str(e)}"
        )

@router.post("/login", response_model=TokenResponse)
async def login(
    login_data: UserLogin,
    db: Session = Depends(get_db)
):
    """ユーザーログイン"""
    
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
        
        # アクセストークン作成
        access_token = create_access_token(
            data={"sub": str(user.id), "username": user.username}
        )
        
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ログインに失敗しました: {str(e)}"
        )

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
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"プロフィール更新エラー: {str(e)}"
        )


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """[Gate #21] パスワード変更。SettingsPage.tsxで「開発中」として無効化
    されていた機能を実装する。frontend/src/services/api.tsのchangePasswordが
    既に呼んでいた /auth/change-password をここで実装する。"""
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="現在のパスワードが正しくありません"
        )

    try:
        current_user.hashed_password = hash_password(password_data.new_password)
        db.commit()
        return {"message": "パスワードを変更しました"}
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"パスワード変更エラー: {str(e)}"
        )
