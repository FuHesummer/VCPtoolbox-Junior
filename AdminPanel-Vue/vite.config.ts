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
  // 🔌 让 Vue 包含运行时模板编译器（esm-bundler 版），插件通过 window.__VCPPanel
  // 写的组件里可直接用 template 字符串，挂到主面板 Vue 实例原生渲染
  define: {
    __VUE_OPTIONS_API__: JSON.stringify(true),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Vue full build：runtime + compiler。插件组件用 template 字符串必须要
      vue: 'vue/dist/vue.esm-bundler.js',
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
