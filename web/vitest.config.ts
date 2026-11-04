import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // Playwright 的 e2e 用例（web/e2e/*.spec.ts）由 `npx playwright test` 跑，vitest 不收。
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'playwright-report/**'],
    // jsdom 环境在多文件并行时启动开销波动大（bytes.test.ts 曾在满负载下 5s 默认值偶发超时，
    // 试金/榫卯复现两次）：基线放宽到 15s，单个用例仍可用 it(name, fn, timeout) 覆盖。
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
})
