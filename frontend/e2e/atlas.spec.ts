import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { guestTokenFrom } from './support/guestPlan';

/**
 * [Gate P15] FR-052 Personal Travel Atlas(SC-41)のbrowser E2E。
 *
 * ゲストで旅行を2つ作り、位置付きの予定に「行った」実績(1つは45分滞在)と位置付きの記録をAPIで用意して次を確認する。
 *   1. 旅の地図で、区画が状態(滞在・訪問)つきで略図と一覧に表示され、2つの旅行で訪れた区画から再訪率が出る
 *   2. 区画の大きさを約110kmにすると区画がまとまる
 *   3. 旅行をAtlasから除くと、その旅行の区画が消える(再読込後も保持)
 *   4. 画面にaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

test('旅の地図: 旅行を横断して訪れた区画を状態つきで示し、区画の大きさを変え、旅行を除ける', async ({ page, context }) => {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const guest = await guestResponse;
  const apiBase = guest.url().replace(/\/auth\/guest$/, '');
  const token = await guestTokenFrom(guest); // [Gate S11] 画面の遷移と競合しないよう応答から取る
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const send = async (method: 'post' | 'put', path: string, data: unknown) => {
    const res = await context.request[method](`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p15-e2e-${Date.now()}-${Math.random()}` }, data,
    });
    if (!res.ok()) throw new Error(`${path} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
  const stamp = Date.now();
  const trips = [
    { title: `京都の旅-${stamp}`, date: '2026-05-01', places: [['清水寺', 34.9948, 135.785, 45], ['奈良公園', 34.6851, 135.8048, 0]] },
    { title: `京都再訪-${stamp}`, date: '2026-09-01', places: [['清水寺(再訪)', 34.9949, 135.7851, 10]] },
  ] as const;
  for (const t of trips) {
    const plan = await send('post', '/travel-plans/', { title: t.title });
    const day = await send('post', `/plans/${plan.id}/days`, { local_date: t.date, timezone_id: 'Asia/Tokyo' });
    for (const [name, lat, lng, stay] of t.places) {
      const ev = await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: name, latitude: lat, longitude: lng });
      const start = `${t.date}T10:00:00+09:00`;
      const end = new Date(Date.parse(start) + stay * 60_000).toISOString();
      await send('put', `/plans/${plan.id}/journey/events/${ev.id}`, { status: 'visited', actual_start_at: start, actual_end_at: end });
    }
  }

  await page.goto('/atlas');
  await expect(page.getByRole('heading', { name: '旅の地図(Atlas)', level: 1 })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Atlasの概要' });
  await expect(summary).toContainText('区画2件(滞在1・訪問1・通過0・予定0)・再訪率 50%');
  await expect(summary.getByRole('img', { name: /訪れた地域の略図\(区画2件/ })).toBeVisible();
  const rows = page.getByRole('region', { name: '区画の一覧' }).getByRole('row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('◆ 滞在');
  await expect(rows.nth(1)).toContainText(`京都の旅-${stamp}、京都再訪-${stamp}`);
  await axeViolations(page, '旅の地図');

  await page.getByLabel('区画の大きさ').selectOption('area');
  await expect(summary).toContainText('区画1件');

  await page.getByLabel('区画の大きさ').selectOption('region');
  await page.getByRole('region', { name: 'Atlasに含める旅行' }).getByRole('checkbox', { name: new RegExp(`京都再訪-${stamp}`) }).uncheck();
  await expect(page.getByRole('status')).toHaveText('Atlasから除きました');
  await expect(summary).toContainText('再訪率 0%');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Atlasに含める旅行' }).getByRole('checkbox', { name: new RegExp(`京都再訪-${stamp}`) })).not.toBeChecked();
});
