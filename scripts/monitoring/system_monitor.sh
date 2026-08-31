#!/bin/bash
# TravelCanvas システム監視スクリプト（React + Vite対応）

LOG_DIR="$HOME/travelcanvas/logs/system"
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')

# ログファイル
SYSTEM_LOG="$LOG_DIR/system_${TIMESTAMP}.log"
PERFORMANCE_LOG="$LOG_DIR/performance_${TIMESTAMP}.log"

# システム情報収集
{
    echo "=== TravelCanvas System Monitor Report - $(date) ==="
    echo "Environment: React + Vite Enhanced Development"
    echo ""
    
    echo "CPU Usage:"
    top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1
    echo ""
    
    echo "Memory Usage:"
    free -h
    echo ""
    
    echo "Disk Usage:"
    df -h
    echo ""
    
    echo "Load Average:"
    uptime
    echo ""
    
    echo "Active Services:"
    for service in postgresql redis-server docker nginx; do
        if systemctl is-active --quiet $service; then
            echo "✓ $service: Active"
        else
            echo "✗ $service: Inactive"
        fi
    done
    echo ""
    
    echo "Network Connections:"
    netstat -tuln | grep -E ':(3000|8000|5432|6379|80|443) '
    echo ""
    
    echo "Docker Status:"
    if command -v docker &> /dev/null; then
        echo "Docker Engine: $(docker --version)"
        echo "Running Containers:"
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    else
        echo "Docker: Not installed"
    fi
    echo ""
    
    echo "Python Environment:"
    if [[ -f "$HOME/travelcanvas_venv/bin/python" ]]; then
        echo "Virtual Environment: Active"
        source "$HOME/travelcanvas_venv/bin/activate"
        echo "Python Version: $(python --version)"
        echo "Installed Packages: $(pip list | wc -l) packages"
        deactivate
    else
        echo "Virtual Environment: Not found"
    fi
    echo ""
    
    echo "Node.js Environment (React + Vite):"
    if command -v node &> /dev/null; then
        echo "Node.js: $(node --version)"
        echo "npm: $(npm --version)"
        if command -v yarn &> /dev/null; then
            echo "yarn: $(yarn --version)"
        fi
        if command -v pnpm &> /dev/null; then
            echo "pnpm: $(pnpm --version)"
        fi
        if command -v vite &> /dev/null; then
            echo "Vite: $(vite --version)"
        fi
    else
        echo "Node.js: Not installed"
    fi
    echo ""
    
} > "$SYSTEM_LOG"

echo "✅ System monitoring completed"
echo "📄 Log saved to: $SYSTEM_LOG"
