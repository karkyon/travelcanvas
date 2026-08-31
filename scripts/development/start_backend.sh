#!/bin/bash
# TravelCanvas バックエンド開発サーバー起動（統合強化版）

cd "$HOME/travelcanvas" || exit 1

# 仮想環境有効化
if [[ -f "$HOME/travelcanvas_venv/bin/activate" ]]; then
    source "$HOME/travelcanvas_venv/bin/activate"
    echo "✓ Python仮想環境を有効化しました"
else
    echo "❌ Python仮想環境が見つかりません"
    exit 1
fi

# 環境変数読み込み
if [[ -f ".env.local" ]]; then
    source .env.local
    echo "✓ 環境変数を読み込みました"
fi

# データベースマイグレーション
echo "🔄 データベースマイグレーションを実行しています..."
cd backend
if [[ -f "alembic.ini" ]]; then
    alembic upgrade head
else
    echo "🔧 Alembic を初期化しています..."
    alembic init alembic
    
    # alembic.ini設定更新
    sed -i 's|sqlalchemy.url = .*|# sqlalchemy.url = |' alembic.ini
    
    # env.py更新（エラーハンドリング付き）
    cat > alembic/env.py << 'ALEMBICEOF'
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import sys
import os

# プロジェクトディレクトリをパスに追加
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from app.models import Base
    from app.core.config import settings
except ImportError as e:
    print(f"Warning: Could not import models or config: {e}")
    Base = None
    class MockSettings:
        DATABASE_URL = "postgresql://travelcanvas:password@localhost:5432/travelcanvas_dev"
    settings = MockSettings()

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata if Base else None

def get_url():
    return settings.DATABASE_URL

def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    connectable = engine_from_config(
        {"sqlalchemy.url": get_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
ALEMBICEOF
    
    echo "✅ Alembic 初期化完了"
    
    # 初期マイグレーション作成（エラー処理付き）
    alembic revision --autogenerate -m "Initial migration" 2>/dev/null || echo "⚠️ マイグレーション作成をスキップ"
    alembic upgrade head 2>/dev/null || echo "⚠️ マイグレーション適用をスキップ"
fi

echo "🚀 バックエンド開発サーバーを起動しています..."
echo "📊 API ドキュメント: http://localhost:8000/docs"
echo "🔍 管理画面: http://localhost:8000/admin"
echo ""

# 開発サーバー起動
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --log-level debug
