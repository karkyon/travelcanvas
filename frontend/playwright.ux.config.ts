import { defineConfig, devices } from '@playwright/test';

/**
 * [Gate G9] UX-0 今の画面の記録(撮影)だけの設定。CI では動かさない(`npx playwright test -c playwright.ux.config.ts`)。
 *
 * 撮った画面は docs/ux/baseline/ に置き、改修(UX-2 以降)の前後で見比べる。画面が壊れていないことの検査は
 * CI の e2e/ux-baseline.spec.ts(目印・主な操作・横はみ出し)が行う。
 */
export default defineConfig({
  testDir: './ux',
  globalSetup: './e2e/global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
