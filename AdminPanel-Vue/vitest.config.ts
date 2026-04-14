// Vitest 独立配置（避免与 vite 的 Plugin 类型版本冲突）
// 会自动继承 vite.config.ts 的 alias 等设置
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
