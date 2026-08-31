# 🎨 TravelCanvas Frontend

次世代AI旅行計画プラットフォームのフロントエンドアプリケーション

## 📋 概要

TravelCanvas は、AI技術を活用した革新的な旅行計画作成プラットフォームです。写真1枚から最適な旅行プランを生成し、リアルタイムで調整・共有できる次世代のサービスです。

### 主要機能

- 🤖 **AI画像認識検索**: 写真からスポット自動判定・プラン生成
- ⚡ **OR-Tools最適化**: 数理最適化による科学的ルート計算
- 🎯 **ハイブリッド認証**: 会員登録不要 + 高機能オプション
- ⏰ **リアルタイム進行管理**: 現在時刻・next表示機能
- 📅 **日付ジャンプナビ**: 長期旅行でのスムーズなナビゲーション
- 🎮 **高度ドラッグ&ドロップ**: 直感的なスケジュール調整
- 🤝 **リアルタイム共同編集**: WebSocketによる即座同期
- 📱 **PWA対応**: オフライン利用・アプリインストール

## 🛠️ 技術スタック

### フロントエンド
- **React 18** - UI フレームワーク
- **TypeScript 5.0** - 型安全な開発
- **Vite 5.0** - 高速ビルドツール
- **Tailwind CSS** - ユーティリティファーストCSS
- **Zustand** - 軽量状態管理
- **React Query** - データフェッチング・キャッシュ
- **React Router 6** - ルーティング

### 開発ツール
- **ESLint** - コード品質管理
- **Prettier** - コードフォーマッター
- **Husky** - Git フック
- **Vitest** - ユニットテスト
- **Playwright** - E2Eテスト

## 🚀 クイックスタート

### 前提条件
- Node.js 18.0 以上
- npm または yarn

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/your-org/travelcanvas-frontend.git
cd travelcanvas-frontend

# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env.local
```

### 環境変数の設定

`.env.local` ファイルを編集し、必要なAPIキーを設定してください：

```bash
# 必須設定
VITE_API_BASE_URL=https://api.travelcanvas.app/api/v1
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# オプション設定
VITE_ENABLE_AI_FEATURES=true
VITE_DEBUG_MODE=false
```

### 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` にアクセスしてください。

## 📁 プロジェクト構造

```
src/
├── components/           # 再利用可能コンポーネント
│   ├── Layout/          # レイアウト関連
│   ├── auth/            # 認証関連
│   ├── planner/         # プランナー機能
│   └── common/          # 共通コンポーネント
├── pages/               # ページコンポーネント
│   └── Admin/           # 管理画面
├── hooks/               # カスタムフック
├── store/               # 状態管理
├── services/            # API・外部サービス
├── utils/               # ユーティリティ関数
├── types/               # TypeScript型定義
├── config/              # 設定ファイル
├── styles/              # スタイルファイル
└── router/              # ルーティング設定
```

## 🧪 テスト

```bash
# ユニットテスト実行
npm run test

# E2Eテスト実行
npm run test:e2e

# カバレッジレポート生成
npm run test:coverage
```

## 🏗️ ビルド

```bash
# プロダクションビルド
npm run build

# ビルド結果のプレビュー
npm run preview

# バンドルサイズ分析
npm run analyze
```

## 📱 PWA機能

このアプリケーションはPWA（Progressive Web App）として動作します：

- **オフライン対応**: Service Workerによるキャッシュ
- **インストール可能**: デスクトップ・モバイルにインストール
- **プッシュ通知**: 重要な更新の通知
- **バックグラウンド同期**: オフライン時の変更を自動同期

## 🌐 ブラウザサポート

- Chrome 90+
- Firefox 90+
- Safari 14+
- Edge 90+

## 🔧 開発ガイドライン

### コード規約
- TypeScriptの厳密な型チェックを使用
- ESLintルールの遵守
- Prettierによる自動フォーマット
- 関数型コンポーネント + Hooksの使用

### コミット規約
```bash
git commit -m "feat: 新機能の追加"
git commit -m "fix: バグの修正"
git commit -m "docs: ドキュメントの更新"
git commit -m "style: コードスタイルの修正"
git commit -m "refactor: リファクタリング"
git commit -m "test: テストの追加・修正"
```

### ブランチ戦略
- `main`: プロダクション環境
- `develop`: 開発環境
- `feature/*`: 新機能開発
- `hotfix/*`: 緊急修正

## 🔍 主要コンポーネント詳細

### 認証システム
```typescript
// ハイブリッド認証の使用例
const { user, login, logout, createGuestSession } = useAuth()

// ゲストセッション作成
await createGuestSession()

// 会員ログイン
await login({ email, password })
```

### AI機能
```typescript
// AI検索の使用例
const { searchSpots, recognizeImage } = useSearch()

// テキスト検索
const results = await searchSpots({
  query: '東京 観光',
  location: { latitude: 35.6762, longitude: 139.6503 }
})

// 画像認識検索
const spots = await recognizeImage(imageFile)
```

### プラン最適化
```typescript
// 最適化機能の使用例
const { optimizePlan } = useOptimization()

const result = await optimizePlan(planId, {
  optimizationType: 'balanced',
  constraints: {
    maxTravelTime: 60,
    budgetLimit: 10000
  }
})
```

### リアルタイム同期
```typescript
// WebSocket接続の使用例
const { connect, disconnect, sendMessage } = useRealtime()

// プランの共同編集
connect(`plan/${planId}`)
sendMessage({
  type: 'plan_updated',
  data: updatedPlan
})
```

## 🐛 トラブルシューティング

### よくある問題

**Q: npm install でエラーが発生する**
```bash
# Node.jsのバージョンを確認
node --version  # 18.0以上が必要

# キャッシュクリア
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

**Q: Google Maps APIキーが無効**
- [Google Cloud Console](https://console.cloud.google.com) でAPIキーを確認
- Maps JavaScript API が有効になっているか確認
- APIキーの制限設定を確認

**Q: PWAが動作しない**
- HTTPSでアクセスしているか確認（localhost除く）
- Service Workerが正しく登録されているか確認
- manifest.jsonの設定を確認

## 📈 パフォーマンス最適化

### 実装済み最適化
- **コード分割**: ルート別の動的インポート
- **画像最適化**: WebP形式・遅延読み込み
- **キャッシュ戦略**: SWR + Service Worker
- **バンドル最適化**: Tree shaking + 圧縮

### パフォーマンス目標
- First Contentful Paint: < 1.5秒
- Largest Contentful Paint: < 2.5秒
- Cumulative Layout Shift: < 0.1
- First Input Delay: < 100ms

## 🔒 セキュリティ

### 実装済みセキュリティ対策
- **XSS防御**: DOMPurifyによるサニタイゼーション
- **CSRF防御**: CSRFトークンの実装
- **Content Security Policy**: 厳格なCSP設定
- **HTTPS強制**: 本番環境でのHTTPS必須

## 🚀 デプロイ

### Vercel（推奨）
```bash
# Vercelデプロイ
npm run build
vercel --prod
```

### Netlify
```bash
# Netlifyデプロイ
npm run build
netlify deploy --prod --dir=dist
```

### AWS S3 + CloudFront
```bash
# S3デプロイ
npm run build
aws s3 sync dist/ s3://your-bucket-name --delete
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

## 📞 サポート・コミュニティ

- **バグレポート**: [GitHub Issues](https://github.com/your-org/travelcanvas-frontend/issues)
- **機能要望**: [GitHub Discussions](https://github.com/your-org/travelcanvas-frontend/discussions)
- **メール**: support@travelcanvas.app
- **Discord**: [開発者コミュニティ](https://discord.gg/travelcanvas)

## 📝 ライセンス

MIT License - 詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 🙏 謝辞

TravelCanvasの開発にご協力いただいた全ての方々に感謝いたします。

---

**TravelCanvas Team** 🎨✈️