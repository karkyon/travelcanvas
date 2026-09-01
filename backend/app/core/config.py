import os
from typing import List, Optional, Union
from pydantic_settings import BaseSettings
from pydantic import field_validator
from pathlib import Path

# プロジェクトルートのパスを取得
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent

class Settings(BaseSettings):
    # データベース設定
    # 注意: 以前はここに実際のDBパスワードを含む接続文字列がデフォルト値と
    # してハードコードされていた(TravelCanvas_フェーズM1セキュリティ監査で
    # 発見)。デフォルト値を持たせず必須項目とし、環境変数DATABASE_URLが
    # 未設定なら起動時に明確なエラーで止まるようにする。
    DATABASE_URL: str

    # JWT設定
    # 注意: 以前は "your-secret-key-change-in-production..." という
    # プレースホルダがデフォルト値になっており、環境変数設定を忘れても
    # 起動できてしまう危険な設計だった。必須項目へ変更する。
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    REMEMBER_ME_EXPIRE_DAYS: int = 30
    
    # ゲストユーザー設定
    GUEST_TOKEN_EXPIRE_HOURS: int = 24
    
    # セッション設定
    SESSION_EXPIRE_MINUTES: int = 60
    
    # パスワード設定
    PASSWORD_MIN_LENGTH: int = 8
    PASSWORD_MAX_LENGTH: int = 128
    
    # Redis設定
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_MAX_CONNECTIONS: int = 10
    REDIS_RETRY_ON_TIMEOUT: bool = True
    REDIS_SOCKET_CONNECT_TIMEOUT: int = 5
    REDIS_SOCKET_TIMEOUT: int = 5
    
    # レート制限設定
    RATE_LIMIT_AUTH: int = 5       # 認証試行回数制限
    RATE_LIMIT_GUEST: int = 100    # ゲストユーザー制限
    RATE_LIMIT_REGISTERED: int = 1000  # 登録ユーザー制限
    RATE_LIMIT_PREMIUM: int = 5000     # プレミアムユーザー制限
    
    # CORS設定 - Union[str, List[str]]にして文字列も受け入れる
    CORS_ORIGINS: Union[str, List[str]] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.1.248:3000"
    ]
    
    # アプリケーション設定
    DEBUG: bool = True
    APP_NAME: str = "TravelCanvas"
    APP_VERSION: str = "1.0.0"
    
    # API設定
    API_V1_STR: str = "/api/v1"
    
    # 外部API設定（オプション）
    GOOGLE_VISION_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    
    # 環境変数から来る追加設定
    SECRET_KEY: Optional[str] = None  # JWT_SECRET_KEYと同じ役割
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"
    UPLOAD_MAX_SIZE: int = 10485760  # 10MB
    ENABLE_IMAGE_RECOGNITION: bool = False
    ENABLE_AI_OPTIMIZATION: bool = False
    
    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            # 空文字列の場合はデフォルト値を使用
            if not v.strip():
                return [
                    "http://localhost:3000",
                    "http://127.0.0.1:3000",
                    "http://192.168.1.248:3000"
                ]
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, list):
            return v
        return v

    class Config:
        env_file = PROJECT_ROOT / ".env.local"  # 絶対パスを使用
        case_sensitive = True
        extra = "allow"  # 余分な環境変数を許可

# グローバル設定インスタンス
settings = Settings()