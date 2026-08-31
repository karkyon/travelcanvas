#!/bin/bash
# TravelCanvas Docker開発環境起動（React + Vite対応）

cd "$HOME/travelcanvas" || exit 1

echo "🐳 Docker開発環境を起動しています（React + Vite対応）..."

# 環境変数確認
if [[ ! -f ".env.local" ]]; then
    echo "⚠️  .env.local が見つかりません。サンプルから作成してください："
    echo "cp .env.example .env.local"
    exit 1
fi

# Docker Compose起動（Plugin版とスタンドアロン版の両方に対応）
if docker compose version &> /dev/null; then
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
elif command -v docker-compose &> /dev/null; then
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
else
    echo "❌ Docker Compose が見つかりません"
    exit 1
fi

echo "✅ Docker開発環境起動完了（React + Vite対応）"
echo ""
echo "🌐 アクセスURL:"
echo "  Frontend (Vite): http://localhost:3000"
echo "  Backend API:     http://localhost:8000"
echo "  API Docs:        http://localhost:8000/docs"
echo ""
echo "🔧 管理コマンド:"
if docker compose version &> /dev/null; then
    echo "  docker compose logs -f        # ログ確認"
    echo "  docker compose down           # 停止"
    echo "  docker compose restart        # 再起動"
else
    echo "  docker-compose logs -f        # ログ確認"
    echo "  docker-compose down           # 停止"
    echo "  docker-compose restart        # 再起動"
fi
