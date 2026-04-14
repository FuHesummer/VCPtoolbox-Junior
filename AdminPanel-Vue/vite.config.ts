import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 重要：
// - base 必须与后端挂载路径一致（adminServer.js 挂在 /AdminPanel/）
// - build.outDir 走 dist/（不进 git，由 CI 产出）
// - dev 时代理到本地 AdminServer 6006 端口
export default defineConfig({
  base: '/AdminPanel/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/admin_api': {
        target: 'http://localhost:6006',
        changeOrigin: true,
      },
      '/VCPlog': {
        target: 'ws://localhost:6005',
        ws: true,
      },
      '/vcpinfo': {
        target: 'ws://localhost:6005',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
})
