import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [FR059-B] FR-059 旅程相談の外部 API の原価上限(1旅行 50円)と利用者クラス別 quota
 * (docs/spec/FR-059_旅程相談API原価上限_利用者クラス別Quota_v5.1.md §6・§8・§11)。
 *
 *   1. 会員(Free)の旅程の画面に「この旅行の AI・外部検索の利用枠 0円 / 50円」が旅行の予算とは別に出る。未接続(0円)と出る
 *   2. 自分のクラス(GET /entitlements)は Free・1旅行 50円・月 50円・月1旅行。見積もりは provider を呼ばず、予約しない
 *   3. 上限・クラスを要求で送っても受け付けない(サーバーが決める)。閲覧の人は見積もりできない
 *   4. 旅行相談の入口にクラスと今月の枠が出る
 *   5. ゲストの旅行は 0円(外部の AI・有料の検索を使わない)と出る
 *   6. 360px・暗い見た目で横にはみ出さない。axe 違反 0
 *
 * 外部の有料の provider は未接続(Gate B の合格まで、実際の鍵をつながない)。上限に達した時の停止・80% の警告・
 * 同時の予約・再試行・照合は backend の試験(test_gate_fr059_cost_guard.py、fake provider)と画面の単体試験で確かめる。
 */
test('FR-059 旅程相談の利用枠: 0円 / 50円・クラス・見積もり・未接続・ゲストは 0円', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const me = await registerMember(page, 'fr059');
  const send = apiClient(page.context().request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: `FR059利用枠E2E-${Date.now()}`, destination: '京都' });

  // 2. クラス・見積もり
  const mine = await send('get', '/entitlements');
  expect(mine).toMatchObject({ class: 'free', plan_cap_jpy: '50.0000', monthly_cap_jpy: '50.0000', plans_per_month: 1,
    policy_version: '2026-10-29.1', providers_connected: false });
  const est = await send('post', `/plans/${plan.id}/planning-actions/estimate`,
    { operation: 'places.search', units: { requests: 1 } });
  expect(est).toMatchObject({ max_cost_jpy: '7.9695', max_cost_yen_ceil: 8, allowed: true, connected: false });
  const usage = await send('get', `/plans/${plan.id}/planning-usage`);
  expect(usage).toMatchObject({ plan_used_yen_ceil: 0, plan_cap_yen: 50, state: 'ok', plans_used_this_month: 0 });

  // 3. 上限・クラスは要求で変えられない
  const forged = await page.context().request.post(`${me.apiBase}/plans/${plan.id}/planning-actions/estimate`, {
    headers: { Authorization: `Bearer ${me.token}` },
    data: { operation: 'places.search', plan_cap: '9999', class: 'pro' },
  });
  expect(forged.status()).toBe(422);
  expect((await forged.json()).code).toBe('client_policy_ignored');

  // 1. 旅程の画面
  await page.goto(`/planner/${plan.id}`);
  const meter = page.getByTestId('planning-usage');
  await expect(meter).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('planning-usage-amount')).toHaveText('0円 / 50円');
  await expect(meter).toContainText('クラス: Free');
  await expect(meter).toContainText('旅行の費用(予算)には足しません');
  await expect(page.getByTestId('planning-usage-unconnected')).toContainText('未接続です(0円)');
  await expect(page.getByRole('meter', { name: 'この旅行の AI・外部検索の利用枠の使用' })).toHaveAttribute('aria-valuenow', '0');
  await expectNoAxeViolations(page, '旅程の画面の利用枠');

  // 4. 旅行相談の入口
  await page.goto('/trip-consult');
  await expect(page.getByTestId('planning-class-summary')).toContainText('クラス: Free · 1旅行 50円まで · 今月 0円 / 50円',
    { timeout: 20_000 });

  // 6. 360px・暗い見た目
  await page.evaluate(() => window.localStorage.setItem('tc.theme', 'dark'));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/planner/${plan.id}`);
  await expect(page.getByTestId('planning-usage-amount')).toHaveText('0円 / 50円', { timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page, '利用枠(360px・暗い見た目)');

  // 5. ゲスト(別の文脈)
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const guest = await startGuestPlanViaApi(guestPage, `FR059ゲスト-${Date.now()}`);
  const guestUsage = guestPage.getByTestId('planning-usage');
  await expect(guestUsage).toHaveAttribute('data-state', 'guest', { timeout: 20_000 });
  await expect(guestPage.getByTestId('planning-usage-message')).toContainText('ゲスト・共有の閲覧では外部の AI・有料の検索を使いません(0円)');
  await expect(guestPage.getByTestId('planning-usage-amount')).toHaveText('0円 / 0円');
  const guestSend = apiClient(guestContext.request, guest.apiBase, guest.token);
  expect(await guestSend('get', '/entitlements')).toMatchObject({ class: 'guest', plan_cap_jpy: '0.0000' });
  await guestContext.close();
});
