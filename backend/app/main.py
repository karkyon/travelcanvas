from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.v1 import spots, travel, ai, admin, share, notifications
from app.core.exceptions import TravelCanvasException, ErrorCategory

# アプリケーション作成
app = FastAPI(
    title="TravelCanvas API",
    description="AI-powered travel planning application",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開発環境：すべてのオリジンを許可
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
# [Gate #26] notifications.pyも新規実装。通知一覧・既読管理のエンドポイント。
app.include_router(notifications.router, prefix="/api/v1")