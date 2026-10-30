import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { seedBaseline } from '../ux/baselineData';

/**
 * [Gate G11] 段階4 見た目の系統(docs/ux/G11_UIUX全範囲_実装仕様.md §3.4、UIX-M01・UIX-M11)の browser E2E。
 *
 * 1. 設定 → 表示 の「見た目の系統」で選ぶと <html data-style> とページの地・強調色が変わり、読み直しても続く。
 *    端末の保存を消しても、アカウントに保存した系統が当たる(別の端末と同じ)
 * 2. 4つの系統 × 明るい・暗い で、主な画面(ダッシュボード・プランナー・設定)に axe(WCAG 2.1 AA)の違反が無く、
 *    360px で横にはみ出さない。Daylight はボタンが 48px 以上、Editorial は見出しが明朝体
 * 3. モックの「系統の比較の帯」は製品に無い(設定だけで選ぶ)
 */

const PAGE_BG: Record<string, string> = {
  atlas: 'rgb(245, 244, 238)', editorial: 'rgb(247, 243, 240)', daylight: 'rgb(238, 243, 248)', studio: 'rgb(244, 246, 250)',
};

async function chooseStyle(page: Page, label: RegExp): Promise<void> {
  await page.goto('/settings?tab=preferences');
  const radio = page.getByRole('radio', { name: label });
  await expect(radio).toBeVisible({ timeout: 15_000 });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('この端末に当て、アカウントにも保存しました')).toBeVisible();
}

/**
 * [Gate CI-429] 画面の中の移動(読み直さない)。page.goto は毎回読み直しになり、会員は読み直しのたびに cookie の更新鍵で
 * アクセストークンを取り直す(POST /auth/refresh)。この試験は 4系統 × 2 × 2幅 × 3画面 = 48回の読み直しを短い間に行い、
 * CI の速さでは更新の回数の上限(1分 60回)を越えて 429 → 接続元の点数(Gate S6)が 150 に届き、後の全ての試験が 429 になっていた
 * (PR #13・#15・#17・#18 の 429 の連鎖。実際の点数の 123 点が更新の 429)。利用者の操作(画面の中のリンク)と同じく読み直さずに移る。
 */
async function spaGoto(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForURL((url) => `${url.pathname}${url.search}` === path);
}

async function layoutBg(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector('main')?.parentElement ?? document.body).backgroundColor);
}

async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where}: 横にはみ出している`).toBeLessThanOrEqual(0);
}

test('見た目の系統: 設定で選ぶと全ての画面に当たり、読み直し・端末の保存を消しても(アカウントの値で)続く', async ({ page }) => {
  test.setTimeout(180_000);
  await seedBaseline(page, 'g11style');

  await chooseStyle(page, /^Atlas/);
  await expect(page.locator('html')).toHaveAttribute('data-style', 'atlas');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: '次の旅を、楽しみに変える' })).toBeVisible({ timeout: 15_000 });
  expect(await layoutBg(page)).toBe(PAGE_BG.atlas);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tc-accent').trim());
  expect(accent).toBe('#385a55');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'atlas');

  // 端末の保存を消しても、アカウントの値(users.preferences.ui_style)で同じ系統になる
  await page.evaluate(() => window.localStorage.removeItem('tc.style'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'atlas', { timeout: 15_000 });

  // モックの系統の比較の帯(Atlas / Editorial / Daylight / Studio のボタン列)は製品の画面に無い
  await expect(page.getByRole('group', { name: 'UI案を切り替える' })).toHaveCount(0);

  // 標準へ戻すと G10 のままの見た目
  await chooseStyle(page, /^標準/);
  await expect(page.locator('html')).toHaveAttribute('data-style', 'standard');
  // [Gate MockScreens] 既定はモックと同じ Atlas。標準は選んだ時だけ端末に保存する
  expect(await page.evaluate(() => window.localStorage.getItem('tc.style'))).toBe('standard');
});

test('見た目の系統 × 明るい・暗い で主な画面に axe の違反が無く、360px で崩れない', async ({ page }) => {
  test.setTimeout(900_000);
  const { planId } = await seedBaseline(page, 'g11styleaxe');
  const screens = [
    { name: 'ダッシュボード', path: '/dashboard', h1: '次の旅を、楽しみに変える' },
    { name: 'プランナー', path: `/planner/${planId}`, h1: '京都 紅葉の1泊2日' },
    { name: '設定', path: '/settings?tab=preferences', h1: null },
  ];
  for (const [style, label] of [['atlas', /^Atlas/], ['editorial', /^Editorial/], ['daylight', /^Daylight/], ['studio', /^Studio/]] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await chooseStyle(page, label);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((t) => window.localStorage.setItem('tc.theme', t), theme);
      await page.reload();  // 明暗は読み込みの時に当てる(系統・明暗の組ごとに1回だけ読み直す)
      for (const width of [1440, 360]) {
        await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
        for (const s of screens) {
          const where = `${s.name}(${style}・${theme}・${width}px)`;
          await spaGoto(page, s.path);
          if (s.h1) await expect(page.getByRole('heading', { level: 1, name: s.h1 }), where).toBeVisible({ timeout: 15_000 });
          else await expect(page.getByRole('heading', { level: 1 }), where).toBeVisible({ timeout: 15_000 });
          await expect(page.locator('html'), where).toHaveAttribute('data-style', style);
          await expect(page.locator('html'), where).toHaveAttribute('data-theme', theme);
          if (theme === 'light' && width === 1440) expect(await layoutBg(page), where).toBe(PAGE_BG[style]);
          if (style === 'daylight') {
            const heights = await page.locator('.tc-btn:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
            if (s.name === 'プランナー') expect(heights.length, `${where}: ボタンが無い`).toBeGreaterThan(0);
            if (heights.length > 0) expect(Math.min(...heights), `${where}: ボタンが 48px 未満`).toBeGreaterThanOrEqual(48);
          }
          if (style === 'editorial') {
            const font = await page.getByRole('heading', { level: 1 }).first().evaluate((e) => getComputedStyle(e).fontFamily);
            expect(font, where).toContain('Noto Serif JP');
          }
          await expectNoOverflow(page, where);
          await expectNoAxeViolations(page, where);
        }
      }
    }
  }
  await page.evaluate(() => window.localStorage.removeItem('tc.theme'));
  await chooseStyle(page, /^標準/);
});
