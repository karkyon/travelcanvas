import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { allowedHosts, apiUrlForHost, securityHeaders } from './src/config/securityHeaders'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_BASE_URL || env.VITE_API_URL
  const production = (env.APP_ENV || '').toLowerCase() === 'production'
  // [Gate H1] 画面を omega-dev2・LAN の IP で開けるようにする。名前は .env の TC_PUBLIC_HOSTS(カンマ区切り)。
  // CSP の通信先は要求の Host に合わせる(画面と同じ名前の :8001。services/api/core.ts と同じ規則)。
  const hosts = allowedHosts(env.TC_PUBLIC_HOSTS)
  return {
  plugins: [react(), {
    name: 'tc-security-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const headers = securityHeaders(apiUrlForHost(apiUrl, req.headers.host), production)
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
        next()
      })
    },
  }],
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
    // ヘッダー(CSP 等)は上の tc-security-headers が要求ごとに付ける
    allowedHosts: hosts,
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
