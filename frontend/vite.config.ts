import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
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
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
