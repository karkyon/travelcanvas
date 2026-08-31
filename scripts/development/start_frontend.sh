#!/bin/bash
# TravelCanvas フロントエンド開発サーバー起動（React + Vite対応）

cd "$HOME/travelcanvas/frontend" || exit 1

# 依存関係確認・インストール
if [[ ! -d "node_modules" ]]; then
    echo "📦 依存関係をインストールしています..."
    
    # パッケージマネージャー自動検出
    if [[ -f "package-lock.json" ]]; then
        npm install
    elif [[ -f "yarn.lock" ]]; then
        yarn install
    elif [[ -f "pnpm-lock.yaml" ]]; then
        pnpm install
    else
        npm install
    fi
    echo "✓ 依存関係インストール完了"
fi

# 環境変数設定（Vite対応）
if [[ ! -f ".env.local" ]]; then
    echo "🔧 フロントエンド環境変数を設定しています..."
    cat > .env.local << 'ENVEOF'
VITE_API_URL=http://localhost:8000
VITE_APP_NAME=TravelCanvas
VITE_APP_VERSION=1.0.0
VITE_DEV_PORT=3000
ENVEOF
    echo "✓ 環境変数ファイルを作成しました"
fi

echo "🚀 React + Vite 開発サーバーを起動しています..."
echo "🌐 アプリケーション: http://localhost:3000"
echo "⚡ Vite HMR: 有効"
echo ""

# 開発サーバー起動（Vite）
npm run dev
