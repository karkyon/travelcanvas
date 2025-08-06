from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.v1 import spots

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