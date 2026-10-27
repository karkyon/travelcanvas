# TravelCanvas Backend Dockerfile
# マルチステージビルドで開発・本番環境に対応

# =================================
# Base Image
# =================================
FROM python:3.12-slim AS base

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
FROM base AS dependencies

# Poetry または pip を使用
COPY requirements.txt .

# Python依存関係のインストール
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# =================================
# Development Stage
# =================================
FROM dependencies AS development

# 開発用追加パッケージ
# [Gate S1] 以前は pytest・black・mypy 等を版を固定せずに入れていた(ビルドのたびに版が変わり、
# 脆弱性の検査もできなかった)。試験・lint・監査の道具は requirements-dev.txt で版を固定する。
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt

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
FROM development AS testing

# テスト実行用
USER root
RUN chown -R appuser:appuser /app
USER appuser

# テストコマンド
CMD ["python", "-m", "pytest", "-v", "--cov=app", "--cov-report=html", "--cov-report=term"]

# =================================
# Production Stage
# =================================
FROM dependencies AS production

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

# Gunicorn設定はレビュー可能な追跡ファイル gunicorn.conf.py を使用する
RUN test -f gunicorn.conf.py && chown appuser:appuser gunicorn.conf.py

# ユーザー切り替え
USER appuser

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/health || exit 1

# ポート公開
EXPOSE 8000

# 本番環境起動コマンド
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]

# =================================
# Migration Stage (データベース初期化用)
# =================================
FROM production AS migration

USER root

# pg_isready と追跡済みの migration スクリプトを使用する
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && \
    rm -rf /var/lib/apt/lists/* && \
    test -f /app/migrate.sh && \
    chmod +x /app/migrate.sh && \
    chown appuser:appuser /app/migrate.sh

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
