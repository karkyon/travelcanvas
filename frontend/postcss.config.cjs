module.exports = {
  plugins: {
    // Tailwind CSS
    tailwindcss: {},
    
    // Autoprefixer - ベンダープレフィックス自動付与
    autoprefixer: {},
    
    // CSS Nano - プロダクションビルド時の最適化
    ...(process.env.NODE_ENV === 'production' && {
      cssnano: {
        preset: [
          'default',
          {
            // 最適化設定
            discardComments: {
              removeAll: true,
            },
            normalizeWhitespace: true,
            colormin: true,
            convertValues: true,
            discardDuplicates: true,
            discardEmpty: true,
            mergeIdents: false,
            mergeRules: true,
            minifyFontValues: true,
            minifyGradients: true,
            minifyParams: true,
            minifySelectors: true,
            normalizeCharset: true,
            normalizeDisplayValues: true,
            normalizePositions: true,
            normalizeRepeatStyle: true,
            normalizeString: true,
            normalizeTimingFunctions: true,
            normalizeUnicode: true,
            normalizeUrl: true,
            orderedValues: true,
            reduceIdents: false,
            reduceInitial: true,
            reduceTransforms: true,
            svgo: true,
            uniqueSelectors: true,
          },
        ],
      },
    }),
    
    // PurgeCSS - 未使用CSSの削除（プロダクションのみ）
    ...(process.env.NODE_ENV === 'production' && {
      '@fullhuman/postcss-purgecss': {
        content: [
          './index.html',
          './src/**/*.{js,ts,jsx,tsx}',
        ],
        defaultExtractor: (content) => {
          // Tailwind CSS クラス名を正確に抽出
          const broadMatches = content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || []
          const innerMatches = content.match(/[^<>"'`\s.()]*[^<>"'`\s.():]/g) || []
          return broadMatches.concat(innerMatches)
        },
        safelist: {
          // 動的に生成されるクラス名を保護
          standard: [
            // React系
            /^react-/,
            // Framer Motion
            /^motion-/,
            // カスタムアニメーション
            /^animate-/,
            // ドラッグ&ドロップ
            /^dragging/,
            /^drop-zone/,
            // ステート関連
            /^is-/,
            /^has-/,
            // ユーティリティ
            /^bg-gradient-/,
            /^text-shadow/,
            /^glass$/,
          ],
          deep: [
            // 第三者ライブラリのクラス
            /react-beautiful-dnd/,
            /leaflet/,
            /mapbox/,
          ],
          greedy: [
            // パターンマッチング
            /^bg-.*-\d+$/,
            /^text-.*-\d+$/,
            /^border-.*-\d+$/,
          ],
        },
        // 除外するファイル
        rejected: true,
        printRejected: false,
      },
    }),
  },
}