#!/bin/bash
# TravelCanvas 開発環境起動スクリプト（React + Vite対応）

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

echo "🚀 TravelCanvas 開発環境を起動しています（React + Vite）..."

# プロジェクトディレクトリに移動
cd "$HOME/travelcanvas" || exit 1

# 環境変数読み込み
if [[ -f ".env.local" ]]; then
    source .env.local
    log_info "環境変数を読み込みました"
else
    log_warning ".env.local が見つかりません。.env.example をコピーして設定してください"
fi

# サービス確認・起動
log_step "システムサービスを確認しています..."

services=("postgresql" "redis-server" "docker" "nginx")
for service in "${services[@]}"; do
    if ! systemctl is-active --quiet "$service"; then
        log_info "$service を起動しています..."
        if sudo systemctl start "$service"; then
            log_info "✓ $service 起動完了"
        else
            log_error "✗ $service の起動に失敗しました"
        fi
    else
        log_info "✓ $service は既に起動中"
    fi
done

# Python仮想環境確認
log_step "Python仮想環境を確認しています..."
if [[ -d "$HOME/travelcanvas_venv" ]]; then
    log_info "Python仮想環境: $HOME/travelcanvas_venv"
    log_info "有効化コマンド: source ~/travelcanvas_venv/bin/activate"
else
    log_warning "Python仮想環境が見つかりません"
fi

# データベース接続確認
log_step "データベース接続を確認しています..."
if command -v psql &> /dev/null && [[ -n "${DB_USER:-}" ]]; then
    if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME_DEV" -c "SELECT 1;" &> /dev/null; then
        log_info "✓ PostgreSQL 接続確認完了"
    else
        log_warning "PostgreSQL 接続に失敗しました"
    fi
fi

# Redis接続確認
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        log_info "✓ Redis 接続確認完了"
    else
        log_warning "Redis 接続に失敗しました"
    fi
fi

# ポート使用状況確認
log_step "ポート使用状況を確認しています..."
important_ports=(3000 8000 5432 6379 80 443)
for port in "${important_ports[@]}"; do
    if netstat -tuln 2>/dev/null | grep -q ":$port "; then
        process=$(lsof -ti :$port 2>/dev/null | head -1)
        if [[ -n "$process" ]]; then
            process_name=$(ps -p $process -o comm= 2>/dev/null || echo "unknown")
            log_info "ポート $port: 使用中 ($process_name)"
        else
            log_info "ポート $port: 使用中"
        fi
    else
        log_info "ポート $port: 空き"
    fi
done

echo ""
log_info "🎯 開発環境準備完了（React + Vite）"
echo ""
echo "📝 次のステップ:"
echo "1. 仮想環境有効化: source ~/travelcanvas_venv/bin/activate"
echo "2. バックエンド起動: tc-backend"
echo "3. フロントエンド起動: tc-frontend （Vite開発サーバー）"
echo ""
echo "📊 利用可能なコマンド:"
echo "  tc-dev        - 開発環境起動"
echo "  tc-backend    - バックエンド開発サーバー起動"
echo "  tc-frontend   - React + Vite フロントエンド開発サーバー起動"
echo "  tc-test       - テスト実行"
echo "  tc-docker     - Docker Compose 起動"
echo ""
echo "🌐 アクセスURL:"
echo "  Frontend (Vite): http://localhost:3000"
echo "  Backend API:     http://localhost:8000"
echo "  API Docs:        http://localhost:8000/docs"
echo ""
