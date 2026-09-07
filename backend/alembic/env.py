from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import sys
import os
from dotenv import load_dotenv

# プロジェクトディレクトリをパスに追加
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(project_root)

# .env.localファイルを読み込み
env_path = os.path.join(os.path.dirname(project_root), '.env.local')
if os.path.exists(env_path):
    load_dotenv(env_path)
    print(f"✓ Loaded environment from: {env_path}")

# [Gate R0] 以前はここに固定fallback URL(パスワード"password"を含む)を
# 持たせており、かつ後段でDATABASE_URLの先頭50文字をprintしていた。
# 接続情報の断片をログへ出す設計・偽の既定認証情報を持たせる設計はどちらも
# secret管理として不適切なため、どちらも廃止する。設定が見つからない場合は
# 起動時に明確な例外で停止させる。
DATABASE_URL = None
target_metadata = None

# モデルインポート
try:
    from app.models.models import Base
    target_metadata = Base.metadata
    print("✓ Models imported successfully")
except ImportError as e:
    print(f"⚠️ Could not import models: {e}")

# 設定からDATABASE_URLを取得
try:
    from app.core.config import settings
    DATABASE_URL = settings.DATABASE_URL
    print("✓ Using DATABASE_URL from settings")
except ImportError:
    # 環境変数から直接取得(値そのものはログに出さない)
    DATABASE_URL = os.getenv('DATABASE_URL')
    if DATABASE_URL:
        print("✓ Using DATABASE_URL from environment variable")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not configured. Set it via .env.local or the "
        "DATABASE_URL environment variable before running Alembic."
    )

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

def get_url():
    return DATABASE_URL

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
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
    """Run migrations in 'online' mode."""
    # 設定セクションを取得し、DATABASE_URLを設定
    configuration = config.get_section(config.config_ini_section)
    if configuration is None:
        configuration = {}
    configuration['sqlalchemy.url'] = get_url()
    
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, 
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
