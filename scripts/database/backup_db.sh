#!/bin/bash
# TravelCanvas データベースバックアップ（統合強化版）

BACKUP_DIR="$HOME/travelcanvas_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# 環境変数読み込み
if [[ -f "$HOME/travelcanvas/.env.local" ]]; then
    source "$HOME/travelcanvas/.env.local"
else
    echo "❌ .env.localファイルが見つかりません"
    exit 1
fi

echo "📦 データベースをバックアップしています..."

# PostgreSQLバックアップ
PGPASSWORD="$DB_PASSWORD" pg_dump -h localhost -U "$DB_USER" "$DB_NAME_DEV" > "$BACKUP_DIR/travelcanvas_dev_$TIMESTAMP.sql"

if [[ $? -eq 0 ]]; then
    echo "✅ バックアップ完了: $BACKUP_DIR/travelcanvas_dev_$TIMESTAMP.sql"
else
    echo "❌ バックアップに失敗しました"
    exit 1
fi
