#!/bin/bash
# TravelCanvas データベースリセット（統合強化版）

echo "⚠️  データベースをリセットします..."

read -p "本当にデータベースをリセットしますか？ [y/N]: " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "キャンセルしました"
    exit 0
fi

# 環境変数読み込み
if [[ -f "$HOME/travelcanvas/.env.local" ]]; then
    source "$HOME/travelcanvas/.env.local"
else
    echo "❌ .env.localファイルが見つかりません"
    exit 1
fi

# データベース削除・再作成
sudo -u postgres psql << EOSQL
DROP DATABASE IF EXISTS travelcanvas_dev;
DROP DATABASE IF EXISTS travelcanvas_test;
CREATE DATABASE travelcanvas_dev OWNER $DB_USER;
CREATE DATABASE travelcanvas_test OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE travelcanvas_dev TO $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE travelcanvas_test TO $DB_USER;
\q
EOSQL

echo "✅ データベースリセット完了"
