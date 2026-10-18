import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { securityHeaders } from './src/config/securityHeaders'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_BASE_URL || env.VITE_API_URL
  const production = (env.APP_ENV || '').toLowerCase() === 'production'
  return {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    https: false,  // HTTPSを無効化
    hmr: {
      port: 3000,
    },
  },
  define: {
    global: 'globalThis',
  },
  // [Gate S2] SEC-03 画面の応答ヘッダー(CSP 等)。docker compose の frontend は `vite preview` で配信する
  preview: {
    headers: securityHeaders(apiUrl, production),
  },
  base: '/',
  build: {
    outDir: 'dist',
    // [Gate S2] 以前は常に source map を出し、配信先から元のソース一式を取得できた。
    // 調査で必要な時だけ VITE_SOURCEMAP=true で作る
    sourcemap: env.VITE_SOURCEMAP === 'true',
  },
  }
})
