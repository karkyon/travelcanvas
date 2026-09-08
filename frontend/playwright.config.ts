import { defineConfig, devices } from '@playwright/test';

/**
 * [Gate R2-6] QuickDraft browser E2E設定。
 *
 * 対象はomega-dev2上でdocker composeにより既に起動しているフルスタック
 * (frontend: http://localhost:4173 / backend: http://localhost:8001)。
 * このリポジトリの開発サンドボックス環境にはdockerが無いため、browser E2E
 * の実地実行はomega-dev2側でパッチスクリプト自身が
 * `docker compose up -d` 済みのスタックに対して行う設計としている
 * (ハンドオフ資料 2026-09-08 §6、docs/adr/ADR-quick-draft.md 改訂履歴v4参照)。
 *
 * CI(.github/workflows/ci.yml の e2e job)では `docker compose up -d --build`
 * でフルスタックを起動したうえで本設定を用いる。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
