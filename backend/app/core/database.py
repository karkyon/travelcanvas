from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# SQLAlchemyのベースクラス
Base = declarative_base()

# データベースエンジンの作成
# [Gate O2] 以前は echo=settings.DEBUG で、DEBUG=true の環境(omega-dev2 を含む)では全SQLの値
# (メールアドレス・パスワードのハッシュ・暗号文・位置・メモの本文など)が backend のログへ出ていた(B-009)。
# echo は専用の SQL_ECHO(既定 off)に分け、値は常に伏せる(hide_parameters はDBエラーの文面にも効く)。
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    echo=settings.SQL_ECHO,
    hide_parameters=True,
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
