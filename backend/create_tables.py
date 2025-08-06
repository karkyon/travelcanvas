#!/usr/bin/env python3
"""
データベーステーブル作成スクリプト
app/models/models.py の最新定義と完全同期
"""
import sys
import os

# プロジェクトルートをPythonパスに追加
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from app.core.config import settings
from app.core.database import Base

# 最新のモデル定義を明示的にインポート
from app.models.models import (
    User, 
    UserSession, 
    Travel, 
    TravelPlan, 
    OptimizationResult
)

def create_tables():
    """データベーステーブルを作成"""
    try:
        print("🏗️  データベーステーブルを作成中...")
        
        # データベース接続
        engine = create_engine(settings.DATABASE_URL, echo=True)
        
        # 接続テスト
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version();"))
            version = result.fetchone()[0]
            print(f"✅ PostgreSQL接続成功: {version}")
        
        # 全テーブル作成（最新のモデル定義を使用）
        Base.metadata.create_all(bind=engine)
        
        # 作成されたテーブルを確認
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                ORDER BY table_name;
            """))
            tables = [row[0] for row in result.fetchall()]
        
        print("✅ データベーステーブルが正常に作成されました")
        print("\n📋 作成されたテーブル:")
        for table in tables:
            print(f"  - {table}")
        
        # 各テーブルの構造を詳細確認
        print("\n🔍 テーブル構造の詳細:")
        for table in tables:
            with engine.connect() as conn:
                result = conn.execute(text(f"""
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns 
                    WHERE table_name = '{table}' 
                    ORDER BY ordinal_position;
                """))
                columns = result.fetchall()
                
                print(f"\n📊 {table}テーブル:")
                for col in columns:
                    nullable = "NULL" if col[2] == "YES" else "NOT NULL"
                    default = f" DEFAULT {col[3]}" if col[3] else ""
                    print(f"  - {col[0]}: {col[1]} {nullable}{default}")
        
        # 特にusersテーブルのis_verifiedカラムを確認
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'is_verified';
            """))
            is_verified_exists = result.fetchone()
            
            if is_verified_exists:
                print("\n✅ is_verifiedカラムが正常に作成されました")
            else:
                print("\n❌ is_verifiedカラムが作成されていません！")
                
        print("\n🎉 テーブル作成処理完了！")
        
    except Exception as e:
        print(f"❌ エラーが発生しました: {str(e)}")
        print("\n🔧 トラブルシューティング:")
        print("1. データベースが起動しているか確認してください")
        print("2. DATABASE_URLが正しいか確認してください")
        print("3. PostgreSQLユーザーの権限を確認してください")
        sys.exit(1)

def verify_models():
    """モデル定義の整合性を確認"""
    print("🔍 モデル定義の整合性をチェック中...")
    
    # Userモデルの属性を確認
    user_attrs = [attr for attr in dir(User) if not attr.startswith('_')]
    print(f"\n📋 Userモデルの属性: {user_attrs}")
    
    # 特に重要な属性をチェック
    required_attrs = ['is_verified', 'is_superuser', 'user_type']
    missing_attrs = []
    
    for attr in required_attrs:
        if not hasattr(User, attr):
            missing_attrs.append(attr)
    
    if missing_attrs:
        print(f"❌ 不足している属性: {missing_attrs}")
        return False
    else:
        print("✅ 必要な属性がすべて存在します")
        return True

if __name__ == "__main__":
    print("=" * 50)
    print("TravelCanvas データベーステーブル作成")
    print("=" * 50)
    
    # モデル定義の確認
    if not verify_models():
        print("❌ モデル定義に問題があります。修正してから再実行してください。")
        sys.exit(1)
    
    # テーブル作成実行
    create_tables()
