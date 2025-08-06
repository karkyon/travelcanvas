from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# SQLAlchemyのベースクラス
Base = declarative_base()

# データベースエンジンの作成
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    echo=settings.DEBUG
)

# セッションメーカーの作成
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# データベース依存性
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()