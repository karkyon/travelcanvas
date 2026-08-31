#!/bin/bash
# TravelCanvas ヘルスチェックスクリプト（React + Vite対応）

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }

echo "🔍 TravelCanvas React + Vite Enhanced Health Check - $(date)"
echo "============================================"

# システム基本情報
echo ""
log_info "System Information:"
echo "  OS: $(lsb_release -d | cut -f2)"
echo "  Kernel: $(uname -r)"
echo "  Architecture: $(uname -m)"

# サービス確認
echo ""
log_info "Core Services Status:"
services=("postgresql" "redis-server" "docker" "nginx")
all_services_ok=true

for service in "${services[@]}"; do
    if systemctl is-active --quiet "$service"; then
        log_ok "$service is running"
    else
        log_error "$service is not running"
        all_services_ok=false
    fi
done

# ポート確認
echo ""
log_info "Port Status:"
ports=("5432:PostgreSQL" "6379:Redis" "3000:React+Vite" "8000:Backend" "80:HTTP" "443:HTTPS")

for port_info in "${ports[@]}"; do
    port=$(echo $port_info | cut -d':' -f1)
    name=$(echo $port_info | cut -d':' -f2)
    
    if netstat -tuln 2>/dev/null | grep -q ":$port "; then
        log_ok "$name (port $port) is listening"
    else
        log_warn "$name (port $port) is not listening"
    fi
done

# Python環境確認
echo ""
log_info "Python Environment:"
if [[ -f "$HOME/travelcanvas_venv/bin/python" ]]; then
    log_ok "Virtual environment exists"
    source "$HOME/travelcanvas_venv/bin/activate"
    
    # 重要パッケージ確認
    packages=("fastapi" "ortools" "pandas" "sqlalchemy" "redis")
    for pkg in "${packages[@]}"; do
        if python -c "import $pkg" 2>/dev/null; then
            version=$(python -c "import $pkg; print(getattr($pkg, '__version__', 'unknown'))" 2>/dev/null)
            log_ok "$pkg: $version"
        else
            log_error "$pkg: not installed"
            all_services_ok=false
        fi
    done
    deactivate
else
    log_error "Python virtual environment not found"
    all_services_ok=false
fi

# Node.js環境確認（React + Vite対応）
echo ""
log_info "Node.js Environment (React + Vite):"
if command -v node &> /dev/null; then
    log_ok "Node.js: $(node --version)"
    
    # パッケージマネージャー確認
    managers=("npm" "yarn" "pnpm")
    for mgr in "${managers[@]}"; do
        if command -v $mgr &> /dev/null; then
            log_ok "$mgr: $($mgr --version)"
        else
            log_warn "$mgr: not installed"
        fi
    done
    
    # Vite確認
    if command -v vite &> /dev/null; then
        log_ok "Vite: $(vite --version)"
    else
        log_warn "Vite: not installed globally"
    fi
else
    log_error "Node.js: not installed"
    all_services_ok=false
fi

# Docker環境確認
echo ""
log_info "Docker Environment:"
if command -v docker &> /dev/null; then
    log_ok "Docker: $(docker --version | cut -d' ' -f3 | sed 's/,//')"
    
    if systemctl is-active --quiet docker; then
        log_ok "Docker service: running"
        
        # Docker Compose確認
        if docker compose version &> /dev/null; then
            log_ok "Docker Compose Plugin: available"
        elif command -v docker-compose &> /dev/null; then
            log_ok "Docker Compose: $(docker-compose --version | cut -d' ' -f3 | sed 's/,//')"
        else
            log_warn "Docker Compose: not available"
        fi
    else
        log_error "Docker service: not running"
        all_services_ok=false
    fi
else
    log_error "Docker: not installed"
    all_services_ok=false
fi

# プロジェクト構造確認（React + Vite対応）
echo ""
log_info "Project Structure (React + Vite):"
if [[ -d "$HOME/travelcanvas" ]]; then
    log_ok "Project directory exists"
    
    # 重要ファイル確認
    important_files=(
        ".env.local:Environment configuration"
        "backend/app/main.py:Backend application"
        "frontend/package.json:Frontend configuration"
        "frontend/vite.config.ts:Vite configuration"
        "docker-compose.yml:Docker configuration"
    )
    
    for file_info in "${important_files[@]}"; do
        file=$(echo $file_info | cut -d':' -f1)
        desc=$(echo $file_info | cut -d':' -f2)
        
        if [[ -f "$HOME/travelcanvas/$file" ]]; then
            log_ok "$desc: exists"
        else
            log_warn "$desc: missing"
        fi
    done
else
    log_error "Project directory not found"
    all_services_ok=false
fi

# 総合判定
echo ""
echo "============================================"
if $all_services_ok; then
    log_ok "🎉 All core systems are healthy!"
    echo ""
    log_info "Quick Start Commands:"
    echo "  tc-dev        - Start development environment"
    echo "  tc-backend    - Start backend server"
    echo "  tc-frontend   - Start React + Vite frontend server"
    echo "  tc-docker     - Start Docker environment"
    exit 0
else
    log_error "⚠️  Some issues detected. Please review the above."
    echo ""
    log_info "Troubleshooting:"
    echo "  tc-help       - Show all commands"
    echo "  tc-status     - Detailed status check"
    echo "  Setup log:    ~/travelcanvas_react_vite_setup_*.log"
    exit 1
fi
