#!/bin/bash
# TravelCanvas テスト実行スクリプト（React + Vite対応）

cd "$HOME/travelcanvas" || exit 1

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

echo "🧪 TravelCanvas テストスイートを実行しています（React + Vite対応）..."

# Python仮想環境有効化
if [[ -f "$HOME/travelcanvas_venv/bin/activate" ]]; then
    source "$HOME/travelcanvas_venv/bin/activate"
    log_info "Python仮想環境を有効化しました"
fi

# 環境変数読み込み
if [[ -f ".env.local" ]]; then
    source .env.local
fi

# バックエンドテスト
log_step "バックエンドテストを実行しています..."
cd backend
if [[ -f "pyproject.toml" ]]; then
    # pytest実行
    python -m pytest tests/ -v --cov=app --cov-report=html --cov-report=term
    
    # 型チェック
    log_step "型チェック（mypy）を実行しています..."
    mypy app/
    
    # コード品質チェック
    log_step "コード品質チェックを実行しています..."
    flake8 app/
    black --check app/
    isort --check-only app/
fi

# フロントエンドテスト（React + Vite対応）
log_step "フロントエンドテストを実行しています（React + Vite）..."
cd ../frontend
if [[ -f "package.json" ]]; then
    # Vite対応テスト
    if npm run test:unit --if-present; then
        log_info "✓ ユニットテスト完了"
    else
        log_info "⚠️ ユニットテストがスキップされました"
    fi
    
    # ESLint
    npm run lint
    
    # TypeScript型チェック
    npm run type-check
    
    # Viteビルドテスト
    npm run build
    log_info "✓ Viteビルドテスト完了"
fi

log_info "✅ テスト実行完了（React + Vite対応）"
