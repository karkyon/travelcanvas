from typing import List, Optional, Union
from pydantic_settings import BaseSettings
from pydantic import field_validator, model_validator
from pathlib import Path

# プロジェクトルートのパスを取得
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent


# [Gate S2] 外部に公開する環境。ここでは本番向けの検査(production_problems)を通らないと起動しない。
STRICT_ENVIRONMENTS = ("production", "prod", "staging")
_WEAK_MARKERS = ("change", "dummy", "example", "ci-only", "sandbox", "placeholder", "your", "default",
                 "password", "not-real", "test-only", "xxxx")
MIN_SECRET_LENGTH = 32


def _weak_secret(value: Optional[str]) -> Optional[str]:
    """弱い秘密なら理由を返す(値そのものは返さない)。"""
    if not value:
        return "未設定"
    if len(value) < MIN_SECRET_LENGTH:
        return f"{MIN_SECRET_LENGTH}文字未満"
    lowered = value.lower()
    if any(marker in lowered for marker in _WEAK_MARKERS):
        return "見本・試験用の値に見える"
    if len(set(value)) < 10:
        return "文字の種類が少なすぎる"
    return None


def production_problems(s) -> List[str]:
    """本番で直すべき設定の一覧(値は含めない)。"""
    problems: List[str] = []
    if s.DEBUG:
        problems.append("DEBUG=true(診断用のエンドポイントが開く)")
    if getattr(s, "SQL_ECHO", False):
        problems.append("SQL_ECHO=true")
    keys = {
        "JWT_SECRET_KEY": s.JWT_SECRET_KEY,
        "ENCRYPTION_KEY": s.ENCRYPTION_KEY,
        "LOOKUP_INDEX_KEY": s.LOOKUP_INDEX_KEY,
        "DOCUMENT_DOWNLOAD_SIGNING_KEY": s.DOCUMENT_DOWNLOAD_SIGNING_KEY,
    }
    if s.OFFLINE_PACK_KEY_SECRET:
        keys["OFFLINE_PACK_KEY_SECRET"] = s.OFFLINE_PACK_KEY_SECRET
    for name, value in keys.items():
        reason = _weak_secret(value)
        if reason:
            problems.append(f"{name} が弱い({reason})")
    present = [(n, v) for n, v in keys.items() if v]
    for i, (n1, v1) in enumerate(present):
        for n2, v2 in present[i + 1:]:
            if v1 == v2:
                problems.append(f"{n1} と {n2} が同じ値(用途ごとに別の鍵にする)")
    if not s.METRICS_TOKEN or len(s.METRICS_TOKEN) < 24:
        problems.append("METRICS_TOKEN が未設定か24文字未満(/metrics を守れない)")
    origins = s.CORS_ORIGINS if isinstance(s.CORS_ORIGINS, list) else [s.CORS_ORIGINS]
    if not origins:
        problems.append("CORS_ORIGINS が空")
    for origin in origins:
        o = str(origin).strip()
        if o == "*" or not o.startswith("https://") or "localhost" in o or "127.0.0.1" in o:
            problems.append("CORS_ORIGINS に https 以外・* ・localhost が含まれる")
            break
    # [Gate S4] 検査を必須にしたのに検査の仕組みが無いと、文書を1件も受け付けられない
    if getattr(s, "DOCUMENT_REQUIRE_CLEAN_SCAN", False) and getattr(s, "MALWARE_SCAN_BACKEND", "none") == "none":
        problems.append("DOCUMENT_REQUIRE_CLEAN_SCAN=true なのに MALWARE_SCAN_BACKEND=none")
    return problems


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
    # [Gate S3] refresh token の利用(IP ごと・1分)。盗んだ token の連続試行・総当たりを抑える
    RATE_LIMIT_REFRESH: int = 60
    # [Gate S3] 回数制限を Redis で数える時のキーの前置き(同じ Redis を使う別の環境と混ざらないように)
    RATE_LIMIT_NAMESPACE: str = "tc"

    # [Gate B-012] プラン削除の猶予期間(日)。DELETEは論理削除し、この期間内は所有者が
    # 復元できる。期間を過ぎたプランはscripts/run_plan_purge.pyで完全削除する(DOC-02 §5)。
    PLAN_DELETE_GRACE_DAYS: int = 30

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

    # [Gate K1] オフラインパック(端末内の暗号化保存)の鍵を利用者ごとに導出する元の秘密。
    # 未設定なら ENCRYPTION_KEY から用途ラベル付きで導出する(app/services/offline_keys.py)。
    # どちらも無い場合は鍵の配布APIだけが503を返す(他の機能は起動できる)。
    # 注意: この値(未設定なら ENCRYPTION_KEY)を変えると、全員の端末のオフラインデータが読めなくなる。
    OFFLINE_PACK_KEY_SECRET: Optional[str] = None

    # [Gate M5] FR-013文書ウォレットのObject Storage実連携。
    # 実クラウドストレージ(S3等)のAPIキーは未提供のため、
    # app/services/storage_backend.pyのLocalFilesystemBackend
    # (dockerボリューム上のローカルディスク)を既定とする。将来
    # 実クラウドproviderの認証情報が提供された場合は、同モジュールの
    # StorageBackendインターフェースを実装するアダプタへ差し替える設計。
    #
    # [Gate M10 CORS調査で判明した実バグの修正] 旧既定値
    # "/app/storage/documents" は、backendサービスのbind mount
    # (docker-compose.yml `./backend:/app`)配下の未管理パスであり、
    # dockerによる所有権初期化が一切行われない。この配下はhost側の
    # チェックアウトユーザーの所有のまま残るため、コンテナ内の非root
    # 実行ユーザー(Dockerfile `USER appuser`)がmkdir/writeしようとすると
    # 権限不一致でPermissionErrorになり得る(host側uidとappuserのuidが
    # 一致する保証がないため)。これがGate M10 E2Eで発生していた、
    # documents系エンドポイントのみ原因不明のCORSエラーになる不具合の
    # 実体(未処理のPermissionErrorがCORSMiddlewareの外側
    # ServerErrorMiddlewareまで伝播し、CORSヘッダーの付かない500に
    # なっていた)。
    # 既存のdocker-compose.ymlには`travelcanvas_uploads:/app/uploads`という
    # 名前付きvolumeが既に定義されており(Dockerfileの複数ステージで
    # `RUN mkdir -p logs uploads temp && chown -R appuser:appuser /app`
    # によりビルド時にappuser所有で初期化される)、dockerは名前付きvolumeを
    # 初回作成する際にマウント先のイメージ内容(所有権含む)をそのまま
    # 引き継ぐため、appuserは`/app/uploads`配下を常に書き込みできる。
    # 新規に別volumeを追加する運用変更を避けるため、文書保存先も
    # この既存の管理下ディレクトリ配下(`/app/uploads/documents`)に
    # 変更する。
    DOCUMENT_STORAGE_DIR: str = "/app/uploads/documents"
    DOCUMENT_MAX_UPLOAD_SIZE_BYTES: int = 20 * 1024 * 1024  # 20MB

    # [Gate M5] 期限付きダウンロードURL(DOC-02 FR-013)の署名鍵。
    # ENCRYPTION_KEY/LOOKUP_INDEX_KEYと同じ理由で別鍵にする(用途別鍵分離)。
    # 未設定でもbackend全体は起動可能とし、ダウンロードURL発行時にのみ
    # 明確なエラーを返す(app/services/storage_backend.py参照)。
    DOCUMENT_DOWNLOAD_SIGNING_KEY: Optional[str] = None
    # [Gate S4] 画面は URL を受け取ってすぐ開くので短くする(以前は15分)。URL が漏れても使える時間を縮める。
    DOCUMENT_DOWNLOAD_URL_TTL_SECONDS: int = 120

    # [Gate S4] F09 ウイルス検査(app/services/malware_scan.py)。none=外部の検査なし / clamav=clamd へ送る。
    MALWARE_SCAN_BACKEND: str = "none"
    CLAMAV_HOST: str = "clamav"
    CLAMAV_PORT: int = 3310
    MALWARE_SCAN_TIMEOUT_SECONDS: float = 30.0
    # true にすると、検査できなかったファイルは受け付けず、clean と確認できた文書だけを配る
    DOCUMENT_REQUIRE_CLEAN_SCAN: bool = False

    # [Gate S4] 要求の本文の上限(バイト。app/core/body_limit.py)。ファイルを受け取る口だけは
    # 文書の上限 + 余白(multipart の区切り等)まで受ける。
    API_MAX_BODY_BYTES: int = 2 * 1024 * 1024
    UPLOAD_BODY_OVERHEAD_BYTES: int = 1024 * 1024

    # [Gate O1] 監視用の計測値(GET /metrics)を見るための合言葉。未設定の時は
    # 同じ機械・LAN(私設アドレス)からだけ見られる(app/ops/metrics.py)。
    METRICS_TOKEN: Optional[str] = None

    # CORS設定 - Union[str, List[str]]にして文字列も受け入れる
    # [Gate R0] 廃止済みの開発機IP(192.168.1.248)を既定値から除去。
    CORS_ORIGINS: Union[str, List[str]] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    # アプリケーション設定
    DEBUG: bool = True
    # [Gate O2] SQL をログへ出すか(調査用)。出す場合も値は伏せる(app/core/database.py)。
    # 以前は DEBUG に連動しており、開発機で常に全SQLの値がログに出ていた。
    SQL_ECHO: bool = False
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

    @field_validator("JWT_ALGORITHM")
    @classmethod
    def restrict_jwt_algorithm(cls, v: str) -> str:
        """[Gate S1] 署名は共有の秘密(HMAC)だけを使う。none・公開鍵方式への切替や取り違えによる偽造を防ぐ。"""
        value = (v or "").strip().upper()
        if value not in ("HS256", "HS384", "HS512"):
            raise ValueError("JWT_ALGORITHM は HS256 / HS384 / HS512 のいずれかにしてください")
        return value

    @field_validator("MALWARE_SCAN_BACKEND")
    @classmethod
    def restrict_malware_scan_backend(cls, v: str) -> str:
        """[Gate S4] 綴りの誤りで黙って検査なしにならないよう、知っている方式だけを受け付ける。"""
        value = (v or "none").strip().lower()
        if value not in ("none", "clamav"):
            raise ValueError("MALWARE_SCAN_BACKEND は none / clamav のいずれかにしてください")
        return value

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

    @property
    def is_production(self) -> bool:
        """[Gate S2] 本番・ステージング(外部に公開する環境)か。"""
        return (self.APP_ENV or "").strip().lower() in STRICT_ENVIRONMENTS

    @property
    def is_development(self) -> bool:
        return (self.APP_ENV or "").strip().lower() in ("development", "dev", "local")

    @model_validator(mode="after")
    def refuse_unsafe_production(self):
        """[Gate S2] 本番で危険な設定のまま起動しない(セキュリティ監査 F10)。

        以前は DEBUG=True・APP_ENV=development が既定で、本番向けの検査が無かった。開発用の設定や弱い鍵を
        そのまま公開環境へ持ち込むと、診断用のエンドポイント・SQL の値の出力・推測できる署名鍵が残る。
        """
        if self.is_production:
            problems = production_problems(self)
            if problems:
                raise ValueError("本番(APP_ENV=%s)では次の設定を直すまで起動しません:\n  - %s"
                                 % (self.APP_ENV, "\n  - ".join(problems)))
        return self

    class Config:
        env_file = PROJECT_ROOT / ".env.local"  # 絶対パスを使用
        case_sensitive = True
        extra = "allow"  # 余分な環境変数を許可


# グローバル設定インスタンス
settings = Settings()
