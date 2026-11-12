import { test, expect } from '@playwright/test';
import { apiClient, registerAccount } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate PlanB] FR-019 日ごとの案(プランB)を実際のブラウザで確かめる(もしもの案を置き換えた機能)。
 *   1. 旅程の日の見出しの下に案のタブ(A 今の案・B 雨の日)。B を開くと「控えの案を見ています」の帯と、たたき台の印
 *      (屋外の河原でバーベキューに代わりの提案)が出る。旅程の本体(今の案)は変わらない
 *   2. 「この案に切り替える」→ 前後のつながり・天気の確かめ → 切り替えると B が今の案になり、「元に戻す」で A に戻る
 *   3. もしもの案の前の URL(/planner/:id/branches)は旅程へ移る
 */

const PASSWORD = 'Gate-PlanB-TestPass-1';

test('FR-019 日ごとの案: 雨の日の案を作り(たたき台)、開いて確かめ、切り替えて元に戻す', async ({ page }) => {
  test.setTimeout(150_000);
  const a = await registerAccount(page, { prefix: 'pb', label: 'variant', password: PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  const plan = await send('post', '/travel-plans/', { title: `伊勢PlanB-${Date.now()}` }) as { id: string };
  const base = `/plans/${plan.id}`;
  const day = await send('post', `${base}/days`, { local_date: '2026-11-28', timezone_id: 'Asia/Tokyo' }) as { id: string };
  for (const [title, type, time] of [['伊勢神宮', 'sightseeing', '09:00'], ['河原でバーベキュー', 'dining', '12:00'],
    ['鳥羽水族館', 'sightseeing', '15:00']] as const) {
    await send('post', `${base}/events`, { day_id: day.id, title, event_type: type, local_start_time: time });
  }
  const made = await send('post', `${base}/variants`, {
    local_date: '2026-11-28', source: 'copy_active', name: '雨の日', reason: 'rain', scaffold: true,
  }) as { variants: Array<{ day_id: string; label: string }> };
  expect(made.variants[0]!.label).toBe('B');

  // 1. タブ・帯・たたき台の印
  await page.goto(`/planner/${plan.id}`);
  await expect(page.getByTestId('variant-tab-A')).toContainText('今の案');
  await page.getByTestId('variant-tab-B').click();
  const banner = page.getByTestId('variant-banner');
  await expect(banner).toContainText('控えの案「B 雨の日」を見ています');
  await banner.getByTestId('variant-scaffold-notes').locator('summary').click();
  await expect(banner.getByTestId('variant-scaffold-notes')).toContainText('河原でバーベキュー');
  await expect(banner.getByTestId('variant-scaffold-notes')).toContainText('焼肉');
  await expectNoAxeViolations(page, '旅程(控えの案を開いている)');
  // 本体(今の案)は 3 件のまま
  const detail = await send('get', `/plans/${plan.id}`) as { days: Array<{ events: unknown[] }> };
  expect(detail.days[0]!.events).toHaveLength(3);

  // 2. 切り替える(確かめの中に天気の注意が出る)→ 元に戻す
  await banner.getByTestId('variant-switch').click();
  const dialog = page.getByTestId('variant-switch-dialog');
  await expect(dialog.getByTestId('variant-check-weather').first()).toContainText('河原でバーベキュー');
  await page.getByTestId('variant-switch-go').click();
  await expect(page.getByTestId('variant-tab-B')).toContainText('今の案');
  await expect.poll(async () => {
    const v = await send('get', `${base}/variants`) as { dates: Record<string, Array<{ label: string; status: string }>> };
    return v.dates['2026-11-28']!.find((x) => x.status === 'active')!.label;
  }).toBe('B');
  const rev = (await send('get', `/plans/${plan.id}`) as { revision: number }).revision;
  await send('post', `${base}/undo`, undefined, { 'If-Match': String(rev) });
  const back = await send('get', `${base}/variants`) as { dates: Record<string, Array<{ label: string; status: string }>> };
  expect(back.dates['2026-11-28']!.find((x) => x.status === 'active')!.label).toBe('A');

  // 3. もしもの案の前の URL は旅程へ
  await page.goto(`/planner/${plan.id}/branches`);
  await expect(page).toHaveURL(new RegExp(`/planner/${plan.id}$`));
});
