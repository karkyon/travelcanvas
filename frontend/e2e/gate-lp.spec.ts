import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate LP] 製品の LP(/)。docs/trace/gate-lp-trace.md
 *   1. 景色の上に見出し・始める操作・動く画面イメージがあり、旅行の計画のサービスだと分かる
 *   2. 「旅の流れを見る ↓」で流れの説明(#story)へ移る。場面を押すと画面イメージが切り替わる・一時停止できる
 *   3. 利用者の評価・星・価格は無く、料金は準備中と書く。最後は「あなたの次の旅を、描きはじめよう。」
 *   4. 動きを減らす設定では自動で切り替えない。360px で横にはみ出さない。暗い見た目でも axe の違反が無い
 */

test('LP: 景色・動く画面イメージ・旅の流れ・正直な料金・最後の呼びかけ', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('行きたい景色から、旅の一日を描こう。');
  await expect(page.getByRole('button', { name: /旅の計画をはじめる.*ゲストとして始める/ })).toBeVisible();
  // 全体の見出しの帯は出さない(LP は自分の案内を持つ)
  await expect(page.getByTestId('global-header')).toHaveCount(0);
  // 景色の画像が配信される
  for (const n of [1, 2, 3]) {
    const res = await page.request.get(`/lp/scene-${n}.webp`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/webp');
  }

  const demo = page.getByTestId('lp-demo');
  await expect(demo).toContainText('画面イメージ');
  await expect(page.getByTestId('lp-scene')).toHaveAttribute('data-stage', '0');
  // 自動で次の場面へ進む(3.6 秒ごと)
  await expect(page.getByTestId('lp-scene')).toHaveAttribute('data-stage', '1', { timeout: 6_000 });
  // 場面を押すと切り替わり、自動の切り替えは止まる
  await page.getByTestId('lp-stage-3').click();
  await expect(page.getByTestId('lp-scene')).toHaveAttribute('data-stage', '3');
  await expect(page.getByTestId('lp-scene')).toContainText('思い出につなぐ');
  await expect(page.getByTestId('lp-play')).toHaveText('自動で切り替える');
  await expect(page.getByTestId('lp-counter')).toHaveText('相談から記録まで · 4 / 4');

  // 旅の流れを見る ↓
  await page.getByRole('link', { name: /旅の流れを見る/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: '相談 → 計画 → 旅行 → 思い出' })).toBeInViewport();
  // 流れの場面を押すと、上の画面イメージも同じ場面になる
  await page.getByRole('button', { name: /02 · PLAN/ }).click();
  await expect(page.getByTestId('lp-scene')).toHaveAttribute('data-stage', '1');

  // できること・正直な状態・料金
  await expect(page.getByText('01 — PLAN YOUR WAY')).toBeVisible();
  await expect(page.getByText('02 — ENJOY THE DAY')).toBeVisible();
  await expect(page.getByText('03 — KEEP THE MOMENT')).toBeVisible();
  await expect(page.getByText('文章の読み取りは決まった規則(AI は未接続)')).toBeVisible();
  const pricing = page.locator('#pricing');
  await expect(pricing).toContainText('料金・有料プランは準備中');
  await expect(pricing).toContainText('現在、購入できるプランはありません');
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/[¥￥]\s?\d|円\/月|\/月|★|レビュー|利用者数|無制限/);
  await expect(page.getByRole('heading', { level: 2, name: 'あなたの次の旅を、描きはじめよう。' })).toBeVisible();
  await expectNoAxeViolations(page, 'LP(明るい)');
});

test('LP: 動きを減らす設定・360px・暗い見た目、最後の呼びかけからゲストで始める', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('lp-demo')).toBeVisible();
  await expect(page.getByTestId('lp-play')).toHaveText('自動で切り替える');
  // 自動では進まない: 押した時だけ変わる
  await page.getByTestId('lp-stage-2').click();
  await expect(page.getByTestId('lp-scene')).toHaveAttribute('data-stage', '2');
  const animations = await page.locator('.lp-scene').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(animations).toBe('none');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page, 'LP(暗い・360px・動きを減らす)');

  await page.getByRole('button', { name: /TravelCanvasを試す/ }).click();
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
});
