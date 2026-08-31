/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  
  test: {
    // テスト環境設定
    environment: 'jsdom',
    
    // セットアップファイル
    setupFiles: ['./src/test/setup.ts'],
    
    // グローバル設定
    globals: true,
    
    // CSS関連の処理
    css: {
      modules: {
        classNameStrategy: 'stable',
      },
    },
    
    // カバレッジ設定
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
        '**/dist/**',
        '**/build/**',
        '**/.{idea,git,cache,output,temp}/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      include: ['src/**/*.{ts,tsx}'],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
    
    // レポーター設定
    reporter: ['verbose', 'json', 'html'],
    outputFile: {
      json: './test-results/vitest-report.json',
      html: './test-results/vitest-report.html',
    },
    
    // テストファイルのパターン
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
    ],
    exclude: [
      'node_modules',
      'dist',
      'build',
      '.idea',
      '.git',
      '.cache',
      '**/e2e/**',
    ],
    
    // タイムアウト設定
    testTimeout: 10000,
    hookTimeout: 10000,
    
    // 並列実行設定
    threads: true,
    maxThreads: 4,
    minThreads: 1,
    
    // ウォッチモード設定
    watch: false,
    
    // Mock設定
    clearMocks: true,
    restoreMocks: true,
    
    // スナップショット設定
    resolveSnapshotPath: (testPath, snapExtension) => {
      return path.join(
        path.dirname(testPath),
        '__snapshots__',
        path.basename(testPath) + snapExtension
      )
    },
    
    // 環境変数
    env: {
      NODE_ENV: 'test',
      VITE_API_BASE_URL: 'http://localhost:3001/api/v1',
      VITE_MOCK_API: 'true',
      VITE_DEBUG_MODE: 'false',
    },
    
    // ベンチマーク設定
    benchmark: {
      include: ['**/*.{bench,benchmark}.{js,ts,jsx,tsx}'],
      exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    },
    
    // UI設定
    ui: true,
    open: false,
    
    // レポート設定
    silent: false,
    
    // リトライ設定
    retry: 2,
    
    // タイプチェック設定
    typecheck: {
      enabled: true,
      checker: 'tsc',
      include: ['**/*.{test,spec}-d.{ts,tsx}'],
    },
  },
  
  // パス解決設定
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@store': path.resolve(__dirname, './src/store'),
      '@services': path.resolve(__dirname, './src/services'),
      '@config': path.resolve(__dirname, './src/config'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@test': path.resolve(__dirname, './src/test'),
    },
  },
  
  // ESBuild設定
  esbuild: {
    target: 'node14',
  },
  
  // 依存関係最適化
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@testing-library/react',
      '@testing-library/jest-dom',
      '@testing-library/user-event',
    ],
  },
  
  // Define設定
  define: {
    __TEST__: true,
    __DEV__: false,
  },
})