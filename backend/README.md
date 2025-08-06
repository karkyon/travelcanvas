# 🌍 TravelCanvas Backend

**AI-powered travel planning application backend**

TravelCanvasは、AI技術とOR-Tools最適化エンジンを活用した次世代の旅行行程作成アプリケーションです。ユーザーの好みや制約を考慮して、最適化された旅行プランを自動生成します。

## ✨ 主要機能

### 🤖 AI機能
- **智能行程规划**: OpenAI GPTを使用した旅行プラン自動生成
- **画像認識**: 観光地や料理の画像から情報を抽出
- **パーソナライゼーション**: ユーザーの好みに基づく推薦

### 🔧 最適化エンジン
- **OR-Tools統合**: 移動時間・コストを最適化
- **制約処理**: 予算、時間、好みの制約を考慮
- **リアルタイム調整**: 計画の動的な変更に対応

### 👤 ユーザー管理
- **ゲストセッション**: 登録不要での利用
- **ユーザー認証**: JWT-based認証システム
- **プロフィール管理**: カスタマイズ可能なユーザープロフィール

### 🛡️ セキュリティ
- **レート制限**: API使用量の制御
- **セキュリティヘッダー**: XSS、CSRF攻撃対策
- **監査ログ**: セキュリティイベントの記録

## 🏗️ システム構成

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   Database      │
│   (React)       │◄──►│   (FastAPI)     │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Redis Cache   │
                       │   (Session)     │
                       └─────────────────┘
```

## 🛠️ 技術スタック

### コアフレームワーク
- **FastAPI**: 高性能Web APIフレームワーク
- **SQLAlchemy**: ORM（Object-Relational Mapping）
- **Alembic**: データベースマイグレーション
- **Pydantic**: データバリデーション

### データベース・キャッシュ
- **PostgreSQL**: メインデータベース
- **Redis**: セッション管理・キャッシュ

### AI・最適化
- **OpenAI GPT**: 自然言語処理
- **OR-Tools**: 最適化エンジン
- **Transformers**: 機械学習モデル
- **OpenCV**: 画像処理

### セキュリティ・認証
- **JWT**: JSON Web Token認証
- **Passlib + BCrypt**: パスワードハッシュ化
- **CORS**: クロスオリジン制御

## 🚀 クイックスタート

### 前提条件
- Python 3.11+
- Docker & Docker Compose
- PostgreSQL 15+
- Redis 7+

### 1. リポジトリのクローン
```bash
git clone https://github.com/your-org/travelcanvas-backend.git
cd travelcanvas-backend
```

### 2. 環境変数の設定
```bash
cp .env.example .env
# .envファイルを編集して必要な値を設定
```

### 3. Docker Composeで起動
```bash
# 基本サービス（API, DB, Redis）
docker-compose up -d

# 監視ツール付きで起動
docker-compose --profile monitoring up -d

# 開発ツール付きで起動
docker-compose --profile tools up -d
```

### 4. データベースマイグレーション
```bash
docker-compose exec api alembic upgrade head
```

### 5. 動作確認
```bash
curl http://localhost:8000/health
```

## 🔧 開発環境セットアップ

### ローカル開発環境
```bash
# 仮想環境作成
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 依存関係インストール
pip install -r requirements.txt

# 環境変数設定
cp .env.example .env

# データベース起動（Docker）
docker-compose up -d db redis

# マイグレーション実行
alembic upgrade head

# 開発サーバー起動
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### コード品質チェック
```bash
# フォーマット
black .
isort .

# リント
flake8 .
mypy .

# テスト実行
pytest -v --cov=app

# セキュリティチェック
bandit -r app/
```

## 📚 API ドキュメント

### Swagger UI
開発サーバー起動後、以下のURLでAPIドキュメントを確認できます：
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### 主要エンドポイント

#### 認証
```bash
# ゲストセッション作成
POST /api/v1/auth/guest

# ユーザー登録
POST /api/v1/auth/register

# ログイン
POST /api/v1/auth/login

# トークンリフレッシュ
POST /api/v1/auth/refresh
```

#### 旅行プラン
```bash
# プラン一覧取得
GET /api/v1/travel/plans

# プラン作成
POST /api/v1/travel/plans

# プラン詳細取得
GET /api/v1/travel/plans/{plan_id}

# プラン最適化
POST /api/v1/travel/plans/{plan_id}/optimize
```

#### AI機能
```bash
# AI推薦取得
POST /api/v1/ai/recommendations

# 画像認識
POST /api/v1/ai/image-recognition

# テキスト生成
POST /api/v1/ai/generate-description
```

## 🏗️ プロジェクト構造

```
backend/
├── app/
│   ├── core/                   # コア機能
│   │   ├── auth.py            # 認証システム
│   │   ├── config.py          # 設定管理
│   │   ├── database.py        # DB設定
│   │   ├── security.py        # セキュリティ
│   │   └── exceptions.py      # 例外処理
│   ├── models/                 # データモデル
│   │   └── models.py          # SQLAlchemyモデル
│   ├── schemas/                # APIスキーマ
│   │   ├── auth.py            # 認証スキーマ
│   │   ├── travel.py          # 旅行スキーマ
│   │   └── common.py          # 共通スキーマ
│   ├── api/                    # APIエンドポイント
│   │   └── v1/
│   │       ├── auth.py        # 認証API
│   │       ├── travel.py      # 旅行API
│   │       └── ai.py          # AI API
│   ├── services/               # ビジネスロジック
│   │   ├── optimization.py    # 最適化サービス
│   │   ├── ai_search.py       # AI検索
│   │   └── image_recognition.py # 画像認識
│   └── main.py                # アプリケーション起動
├── alembic/                    # DBマイグレーション
├── tests/                      # テストコード
├── docker-compose.yml          # Docker設定
├── Dockerfile                  # Dockerイメージ
├── requirements.txt            # Python依存関係
└── README.md                   # このファイル
```

## 🗄️ データベース設計

### 主要テーブル

#### Users（ユーザー）
```sql
- id (UUID, PK)
- email (String, Unique)
- username (String, Unique)
- hashed_password (String)
- user_type (Enum: GUEST, REGISTERED)
- guest_token (String, Unique)
- full_name (String)
- is_active (Boolean)
- created_at (DateTime)
- updated_at (DateTime)
```

#### TravelPlans（旅行プラン）
```sql
- id (UUID, PK)
- user_id (UUID, FK)
- title (String)
- description (Text)
- destination (String)
- start_date (Date)
- end_date (Date)
- status (Enum: DRAFT, OPTIMIZED, PUBLISHED)
- is_optimized (Boolean)
- created_at (DateTime)
- updated_at (DateTime)
```

#### TravelDays（旅行日程）
```sql
- id (UUID, PK)
- travel_plan_id (UUID, FK)
- day_number (Integer)
- date (Date)
- locations (JSON)
- transportation (JSON)
- created_at (DateTime)
- updated_at (DateTime)
```

## 🔐 セキュリティ

### 認証・認可
- **JWT Token**: アクセストークン（30分）+ リフレッシュトークン（30日）
- **パスワード**: BCrypt暗号化（12ラウンド）
- **ゲストセッション**: 24時間の一時セッション

### セキュリティヘッダー
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'
```

### レート制限
- **ゲストユーザー**: 100リクエスト/時間
- **登録ユーザー**: 1000リクエスト/時間
- **認証エンドポイント**: 5回/15分

## 📊 監視・ログ

### ログレベル
- **INFO**: 一般的な操作ログ
- **WARNING**: レート制限・認証失敗
- **ERROR**: システムエラー
- **CRITICAL**: サービス停止レベルのエラー

### メトリクス（Prometheus）
- **API応答時間**: ヒストグラム
- **リクエスト数**: カウンター
- **エラー率**: ゲージ
- **アクティブユーザー数**: ゲージ

### ダッシュボード（Grafana）
- **システム概要**: CPU、メモリ、ディスク使用量
- **API メトリクス**: レスポンス時間、エラー率
- **ユーザー活動**: 登録数、アクティブセッション

## 🚀 デプロイメント

### 本番環境要件
- **CPU**: 4コア以上
- **メモリ**: 8GB以上
- **ディスク**: 100GB以上（SSD推奨）
- **PostgreSQL**: 15.0以上
- **Redis**: 7.0以上

### Docker Compose デプロイ
```bash
# 本番用環境変数設定
cp .env.example .env.production

# 本番環境起動
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# SSL証明書設定（Let's Encrypt）
docker-compose exec nginx certbot --nginx -d your-domain.com
```

### Kubernetes デプロイ（オプション）
```bash
# Helm チャート使用
helm install travelcanvas ./k8s/helm-chart

# または kubectl使用
kubectl apply -f k8s/
```

## 🧪 テスト

### テスト実行
```bash
# 全テスト実行
pytest

# カバレッジ付きテスト
pytest --cov=app --cov-report=html

# 特定のテストファイル
pytest tests/test_auth.py -v

# 統合テスト
pytest tests/integration/ -v
```

### テストデータベース
テスト用のデータベースは自動で作成・削除されます：
```bash
# テスト用DB作成
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/travelcanvas_test
```

## 🛠️ トラブルシューティング

### よくある問題

#### データベース接続エラー
```bash
# PostgreSQL の状態確認
docker-compose ps db

# ログ確認
docker-compose logs db

# データベース再起動
docker-compose restart db
```

#### Redis 接続エラー
```bash
# Redis の状態確認
docker-compose ps redis

# Redis CLI接続テスト
docker-compose exec redis redis-cli ping
```

#### マイグレーションエラー
```bash
# マイグレーション状態確認
alembic current

# マイグレーション履歴
alembic history

# 特定のリビジョンに戻す
alembic downgrade <revision>
```

### ログ確認
```bash
# アプリケーションログ
docker-compose logs api

# すべてのサービスログ
docker-compose logs

# リアルタイムログ監視
docker-compose logs -f api
```

## 🤝 コントリビューション

### 開発フロー
1. イシューを作成
2. フィーチャーブランチを作成
3. 変更を実装
4. テストを追加・実行
5. プルリクエストを作成

### コードスタイル
```bash
# フォーマット（自動修正）
black .
isort .

# リント（チェックのみ）
flake8 .
mypy .

# プリコミットフック設定
pre-commit install
```

### コミットメッセージ
```
feat: 新機能追加
fix: バグ修正
docs: ドキュメント更新
style: フォーマット変更
refactor: リファクタリング
test: テスト追加・修正
chore: その他の変更
```

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。

## 📞 サポート

### ドキュメント
- **API文書**: http://localhost:8000/docs
- **技術仕様書**: `docs/` ディレクトリ
- **FAQ**: `docs/faq.md`

### 連絡先
- **メール**: dev@travelcanvas.com
- **GitHub Issues**: [Issues](https://github.com/your-org/travelcanvas-backend/issues)
- **Discord**: [開発者コミュニティ](https://discord.gg/travelcanvas)

## 🎯 ロードマップ

### v1.1.0（予定）
- [ ] リアルタイム通知機能
- [ ] ソーシャルログイン（Google, Apple）
- [ ] 多言語対応（英語, 中国語）

### v1.2.0（予定）
- [ ] グループ旅行機能
- [ ] 旅行記録・写真共有
- [ ] AR機能統合

### v2.0.0（計画中）
- [ ] マイクロサービス化
- [ ] GraphQL API
- [ ] モバイルアプリ対応

---

**TravelCanvas** - *AI-powered travel planning for everyone* 🌍✈️

Made with ❤️ by the TravelCanvas Team