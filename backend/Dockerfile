# TravelCanvas Backend Dockerfile
# マルチステージビルドで開発・本番環境に対応

# =================================
# Base Image
# =================================
FROM python:3.11-slim as base

# 環境変数設定
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=100

# システムパッケージの更新とインストール
RUN apt-get update && apt-get install -y \
    # PostgreSQL client
    libpq-dev \
    # Build tools
    gcc \
    g++ \
    # Image processing
    libjpeg-dev \
    libpng-dev \
    # Geographic libraries
    libgeos-dev \
    libproj-dev \
    # SSL
    ca-certificates \
    # Network tools
    curl \
    wget \
    # Process monitoring
    procps \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリ設定
WORKDIR /app

# ユーザー作成（セキュリティ向上）
RUN groupadd -r appuser && useradd -r -g appuser appuser

# =================================
# Dependencies Stage
# =================================
FROM base as dependencies

# Poetry または pip を使用
COPY requirements.txt .

# Python依存関係のインストール
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# =================================
# Development Stage
# =================================
FROM dependencies as development

# 開発用追加パッケージ
RUN pip install --no-cache-dir \
    pytest \
    pytest-asyncio \
    pytest-cov \
    black \
    isort \
    flake8 \
    mypy \
    pre-commit

# アプリケーションコードをコピー
COPY . .

# ログ・アップロード・一時ディレクトリ作成
RUN mkdir -p logs uploads temp && \
    chown -R appuser:appuser /app

# 権限設定
USER appuser

# 開発サーバー起動（ホットリロード対応）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# =================================
# Testing Stage
# =================================
FROM development as testing

# テスト実行用
USER root
RUN chown -R appuser:appuser /app
USER appuser

# テストコマンド
CMD ["python", "-m", "pytest", "-v", "--cov=app", "--cov-report=html", "--cov-report=term"]

# =================================
# Production Stage
# =================================
FROM dependencies as production

# 本番用システム設定
RUN apt-get update && apt-get install -y \
    # Health check用
    curl \
    # Process monitoring
    procps \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# アプリケーションコードをコピー（.dockerignoreを使用して不要なファイルを除外）
COPY --chown=appuser:appuser . .

# 必要なディレクトリを作成
RUN mkdir -p logs uploads temp && \
    chown -R appuser:appuser /app

# 実行可能ファイルの権限設定
RUN chmod +x docker-entrypoint.sh || true

# 本番用Gunicorn設定ファイル作成
RUN echo 'import multiprocessing\n\
\n\
bind = "0.0.0.0:8000"\n\
workers = multiprocessing.cpu_count() * 2 + 1\n\
worker_class = "uvicorn.workers.UvicornWorker"\n\
worker_connections = 1000\n\
max_requests = 1000\n\
max_requests_jitter = 100\n\
timeout = 30\n\
keepalive = 2\n\
preload_app = True\n\
\n\
# Logging\n\
accesslog = "/app/logs/access.log"\n\
errorlog = "/app/logs/error.log"\n\
loglevel = "info"\n\
access_log_format = "%(h)s %(l)s %(u)s %(t)s \"%(r)s\" %(s)s %(b)s \"%(f)s\" \"%(a)s\" %(D)s"\n\
\n\
# Process names\n\
proc_name = "travelcanvas"\n\
\n\
# Server mechanics\n\
pidfile = "/app/gunicorn.pid"\n\
user = "appuser"\n\
group = "appuser"\n\
daemon = False\n\
\n\
# SSL (if needed)\n\
# keyfile = "/app/ssl/key.pem"\n\
# certfile = "/app/ssl/cert.pem"\n' > gunicorn.conf.py

# ユーザー切り替え
USER appuser

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# ポート公開
EXPOSE 8000

# 本番環境起動コマンド
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]

# =================================
# Migration Stage (データベース初期化用)
# =================================
FROM production as migration

USER root

# Alembic migration実行用エントリーポイント
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
echo "Waiting for database..."\n\
while ! pg_isready -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER; do\n\
  echo "Waiting for database connection..."\n\
  sleep 2\n\
done\n\
echo "Database is ready!"\n\
\n\
echo "Running database migrations..."\n\
alembic upgrade head\n\
\n\
echo "Migration completed!"\n' > /app/migrate.sh && \
    chmod +x /app/migrate.sh

USER appuser

CMD ["/app/migrate.sh"]

# =================================
# Multi-arch build support
# =================================
# Build arguments for different architectures
ARG TARGETPLATFORM
ARG BUILDPLATFORM

# Show build info
RUN echo "Building on $BUILDPLATFORM, targeting $TARGETPLATFORM"

# =================================
# Labels (Metadata)
# =================================
LABEL maintainer="TravelCanvas Team <dev@travelcanvas.com>"
LABEL version="1.0.0"
LABEL description="TravelCanvas AI-powered travel planning backend"
LABEL vendor="TravelCanvas"

# Build info
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.label-schema.build-date=$BUILD_DATE \
      org.label-schema.name="TravelCanvas Backend" \
      org.label-schema.description="AI-powered travel planning application backend" \
      org.label-schema.url="https://travelcanvas.com" \
      org.label-schema.vcs-ref=$VCS_REF \
      org.label-schema.vcs-url="https://github.com/your-org/travelcanvas-backend" \
      org.label-schema.vendor="TravelCanvas" \
      org.label-schema.version=$VERSION \
      org.label-schema.schema-version="1.0"
