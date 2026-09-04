from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.v1 import spots, travel, ai, admin, share, notifications, plans, public_share
from app.core.exceptions import TravelCanvasException, ErrorCategory
from app.core.config import settings
import logging
import uuid

logger = logging.getLogger("travelcanvas")

# アプリケーション作成
app = FastAPI(
    title="TravelCanvas API",
    description="AI-powered travel planning application",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)


# [Gate #28] request_idをリクエストごとに発行し、レスポンスヘッダーと
# エラーレスポンス両方に載せる。内部例外の文字列自体はクライアントへ
# 返さず(下のグローバルハンドラ参照)、サーバー側ログとrequest_idで
# 追跡できるようにする。
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """[Gate #28] 個別routeのexcept Exception as e節が str(e) をそのまま
    detailへ返し、内部の例外メッセージ(SQLエラー文等)をクライアントへ
    露出させていた(auth.pyのregister/login/change_password等)。
    この後の修正でそれらは汎用メッセージ+request_idを返すよう変更したが、
    想定外の未捕捉例外についても、ここで最終防波堤として同様に扱う。"""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception(f"[{request_id}] Unhandled exception on {request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={
            "detail": "サーバー内部でエラーが発生しました。しばらくしてから再試行してください。",
            "request_id": request_id,
        },
    )


# CORS設定
# [Gate #28] allow_origins=["*"] と allow_credentials=True の組み合わせは
# 仕様上無効(ブラウザはワイルドカードOriginへのcredentials付きレスポンスを
# 拒否する)。refresh tokenをhttpOnly cookieで発行する都合上、Cookie送信には
# credentials付きリクエストが必須のため、実際に許可するオリジンを明示する
# settings.CORS_ORIGINSへ切り替える。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else [settings.CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 基本エンドポイント
@app.get("/")
async def root():
    return {
        "message": "TravelCanvas API is running", 
        "status": "OK",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "OK",
        "message": "TravelCanvas API is healthy",
        "version": "1.0.0"
    }

@app.get("/api/v1/health")
async def api_health():
    return {
        "status": "healthy", 
        "api_version": "v1",
        "endpoints": [
            "/docs",
            "/health", 
            "/api/v1/auth/register",
            "/api/v1/auth/login",
            "/api/v1/auth/test"
        ]
    }

@app.get("/test")
async def test_endpoint():
    return {
        "message": "Test endpoint working",
        "cors": "enabled"
    }

# エラーハンドラー
@app.exception_handler(404)
async def not_found_handler(request, exc):
    # [Gate #29] このハンドラはステータスコード404の"全て"を横取りする
    # ため、以前はルーティング自体が一致しなかった場合(Starletteの既定
    # detail="Not Found")と、route内で意図的にraiseしたHTTPException(404,
    # detail="...")の両方を区別せず、後者の具体的なメッセージまで
    # "Endpoint not found: ..." という汎用文言で上書きしてしまっていた
    # (/plans/{id}/undoの「取り消せる変更がありません」で発覚したが、
    # spots.py/travel.py等、404を意図的に返す全routeに影響していた
    # 既存バグ)。Starletteの既定detailの時だけ汎用メッセージにする。
    detail = getattr(exc, "detail", None)
    if detail and detail != "Not Found":
        return JSONResponse(status_code=404, content={"detail": detail})
    return JSONResponse(
        status_code=404,
        content={"detail": f"Endpoint not found: {request.url.path}"}
    )

# [Gate #27] app/core/exceptions.py には AuthenticationError/AuthorizationError/
# ValidationError等の統一例外クラス一式が定義されていたが、これらを捕捉する
# exception_handlerがこれまで一切登録されておらず、例えば未認証状態で保護された
# エンドポイントへアクセスした場合(get_current_active_userがAuthenticationErrorを
# raiseするケース)、クリーンな401ではなく未処理例外としてサーバーエラーになって
# いた(通常のログイン済みフローでは踏まれない経路のため、手動テストや監査でも
# 発見されていなかった)。カテゴリ別に適切なHTTPステータスへ変換する。
_CATEGORY_STATUS_MAP = {
    ErrorCategory.AUTHENTICATION: 401,
    ErrorCategory.AUTHORIZATION: 403,
    ErrorCategory.VALIDATION: 422,
    ErrorCategory.BUSINESS_LOGIC: 400,
    ErrorCategory.RATE_LIMIT: 429,
    ErrorCategory.EXTERNAL_SERVICE: 502,
    ErrorCategory.MAINTENANCE: 503,
    ErrorCategory.SYSTEM: 500,
}


@app.exception_handler(TravelCanvasException)
async def travelcanvas_exception_handler(request: Request, exc: TravelCanvasException):
    status_code = _CATEGORY_STATUS_MAP.get(exc.category, 500)
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": exc.user_message,
            "error_code": exc.error_code.value if exc.error_code else None,
            "error_id": exc.error_id,
        },
    )

# 認証APIルートを含める
try:
    from app.api.v1.auth import router as auth_router
    app.include_router(auth_router, prefix="/api/v1/auth", tags=["authentication"])
    print("✅ Auth routes loaded successfully")
except ImportError as e:
    print(f"⚠️ Auth routes could not be loaded: {e}")
    print("   基本機能のみで起動します")

print("🚀 TravelCanvas API - Ready to start")

app.include_router(spots.router, prefix="/api/v1")
app.include_router(travel.router, prefix="/api/v1")
# [Gate #23] ai.pyはこれまでファイルは存在するがinclude_routerされておらず、
# /optimize-route・/optimization/*系エンドポイントが実際には一切到達不能だった。
app.include_router(ai.router, prefix="/api/v1")
# [Gate #24] admin.pyも同様にinclude_routerされておらず、/admin/*は一切到達不能だった。
app.include_router(admin.router, prefix="/api/v1")
# [Gate #25] share.pyも新規実装。プラン共有・コラボレーター機能のエンドポイント。
app.include_router(share.router, prefix="/api/v1")
# [Gate #30] 認証不要の共有トークン解決API。share.router(owner専用管理API)
# とはpath prefixレベルで完全に分離している(/public/share vs /travel-plans)。
app.include_router(public_share.router, prefix="/api/v1")
# [Gate #26] notifications.pyも新規実装。通知一覧・既読管理のエンドポイント。
app.include_router(notifications.router, prefix="/api/v1")
# [Gate #29] /plans: travel_days/travel_events正規テーブルを正本とする新API。
# 既存の/travel-plans(itinerary JSONベース)と並行稼働する。
app.include_router(plans.router, prefix="/api/v1")