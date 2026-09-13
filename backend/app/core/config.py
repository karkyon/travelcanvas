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
    # [Gate #31.5B] 公開共有リンク解決は未認証で叩けるため、token総当たり
    # 攻撃を緩和する目的でIPベースのレート制限を設ける。
    RATE_LIMIT_PUBLIC_SHARE: int = 30  # 1分あたりのIPごとの試行回数上限
    RATE_LIMIT_GUEST: int = 100    # ゲストユーザー制限
    RATE_LIMIT_REGISTERED: int = 1000  # 登録ユーザー制限
    RATE_LIMIT_PREMIUM: int = 5000     # プレミアムユーザー制限
    # [Gate R2-2] anonymous device tokenでの匿名作成のため、IPベースの
    # レート制限を別途設ける(1時間あたり)。
    RATE_LIMIT_QUICKDRAFT_CREATE: int = 20

    # [Gate R2-2] QuickDraft payload field encryption用の鍵。
    # 注意: DATABASE_URL/JWT_SECRET_KEYと異なり意図的にOptionalとする。
    # 必須化するとomega-dev2の.envに未設定の場合にbackend全体が起動不能に
    # なる(QuickDraftという新機能のために既存全APIを道連れにしてしまう)
    # ため、未設定時はQuickDraft関連呼び出し時にのみ明確なエラーを返す設計
    # とする(backend/app/core/crypto.py参照)。
    ENCRYPTION_KEY: Optional[str] = None

    # [Gate R3-13] confirmation_number等の暗号化フィールドに対する盲検索
    # (blind index)用のHMAC鍵。DOC-08 §19「Lookup: HMAC blind index、用途別key」
    # に従い、ENCRYPTION_KEY(データ暗号化用)とは別鍵にする(鍵の用途分離。
    # 片方が漏洩してももう片方の保護には影響しない設計)。ENCRYPTION_KEY同様、
    # 未設定でもbackend全体は起動可能とし、検索機能呼び出し時にのみ明確な
    # エラーを返す(app/core/crypto.py参照)。
    LOOKUP_INDEX_KEY: Optional[str] = None

    # [Gate M5] FR-013文書ウォレットのObject Storage実連携。
    # 実クラウドストレージ(S3等)のAPIキーは未提供のため、
    # app/services/storage_backend.pyのLocalFilesystemBackend
    # (dockerボリューム上のローカルディスク)を既定とする。将来
    # 実クラウドproviderの認証情報が提供された場合は、同モジュールの
    # StorageBackendインターフェースを実装するアダプタへ差し替える設計。
    DOCUMENT_STORAGE_DIR: str = "/app/storage/documents"
    DOCUMENT_MAX_UPLOAD_SIZE_BYTES: int = 20 * 1024 * 1024  # 20MB

    # [Gate M5] 期限付きダウンロードURL(DOC-02 FR-013)の署名鍵。
    # ENCRYPTION_KEY/LOOKUP_INDEX_KEYと同じ理由で別鍵にする(用途別鍵分離)。
    # 未設定でもbackend全体は起動可能とし、ダウンロードURL発行時にのみ
    # 明確なエラーを返す(app/services/storage_backend.py参照)。
    DOCUMENT_DOWNLOAD_SIGNING_KEY: Optional[str] = None
    DOCUMENT_DOWNLOAD_URL_TTL_SECONDS: int = 900  # 15分
    
    # CORS設定 - Union[str, List[str]]にして文字列も受け入れる
    # [Gate R0] 廃止済みの開発機IP(192.168.1.248)を既定値から除去。
    CORS_ORIGINS: Union[str, List[str]] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
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
                    "http://127.0.0.1:3000"
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