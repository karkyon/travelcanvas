/// <reference types="vitest" />
// [Gate G2] DEP-1 Vitest 4 へ更新。以前の設定は Vitest 0.34 の書き方(threads・ui・coverage の閾値の位置・reporter)で、
// 新しい版では無効か非推奨だった。挙動(jsdom・globals・setup・再試行・タイムアウト・別名)は変えない。
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: {
      modules: {
        classNameStrategy: 'stable',
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
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
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'threads',
    maxWorkers: 4,
    watch: false,
    clearMocks: true,
    restoreMocks: true,
    resolveSnapshotPath: (testPath, snapExtension) => {
      return path.join(
        path.dirname(testPath),
        '__snapshots__',
        path.basename(testPath) + snapExtension
      )
    },
    env: {
      NODE_ENV: 'test',
      VITE_API_BASE_URL: 'http://localhost:3001/api/v1',
      VITE_MOCK_API: 'true',
      VITE_DEBUG_MODE: 'false',
    },
    retry: 2,
    typecheck: {
      enabled: true,
      checker: 'tsc',
      include: ['**/*.{test,spec}-d.{ts,tsx}'],
    },
  },

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

  esbuild: {
    target: 'node14',
  },

  define: {
    __TEST__: true,
    __DEV__: false,
  },
})
