import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { guestTokenFrom } from './support/guestPlan';

/**
 * [Gate P14] FR-054 Plan-to-Memory・FR-053 旅の達成指標(SC-42 Journey Review)のbrowser E2E。
 *
 * ゲストで旅行を2つ作り、1つ目に日程1日・予定3件、記録(日時付きのメモ)をAPIで用意して次を確認する。
 *   1. 振り返りで、記録の日時から到着・出発が提案され、「提案を使う」で記録される(予定の時刻は変わらない)
 *   2. 「行かなかった」を記録すると達成指標(計画達成率・訪問達成率・記録完成率)が変わる。数値を隠せる
 *   3. 到着・出発を日程のタイムゾーンで入力して保存できる
 *   4. 行かなかった予定を2つ目の旅行の日へ戻すと、その旅行に予定が増える
 *   5. 画面にaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  await settleForAxe(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

async function startGuest(page: Page): Promise<{ apiBase: string; token: string }> {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const guest = await guestResponse;
  const apiBase = guest.url().replace(/\/auth\/guest$/, '');
  const token = await guestTokenFrom(guest); // [Gate S11] 画面の遷移と競合しないよう応答から取る
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  if (!token) throw new Error('ゲストのアクセストークンがlocalStorage(auth_token)にありません');
  return { apiBase, token };
}

test('振り返り: 記録から到着・出発を提案して記録し、指標が変わり、行かなかった予定を次の旅行へ戻せる', async ({ page, context }) => {
  const { apiBase, token } = await startGuest(page);
  const send = async (method: 'get' | 'post', path: string, data?: unknown) => {
    const res = await context.request[method](`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p14-e2e-${Date.now()}-${Math.random()}` }, data,
    });
    if (!res.ok()) throw new Error(`${path} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
  const stamp = Date.now();
  const plan = await send('post', '/travel-plans/', { title: `P14振り返りE2E-${stamp}` });
  const next = await send('post', '/travel-plans/', { title: `P14次の旅行-${stamp}` });
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  const nextDay = await send('post', `/plans/${next.id}/days`, { local_date: '2027-04-01', timezone_id: 'Asia/Tokyo' });
  const ev: Record<string, { id: string }> = {};
  for (const [name, time] of [['清水寺', '10:00'], ['昼食', '12:00'], ['美術館', '15:00']] as const) {
    ev[name] = await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: name, local_start_time: time });
  }
  await send('post', `/plans/${plan.id}/memories`, { body: '朝の参拝', event_id: ev['清水寺']!.id, occurred_at: '2026-11-01T10:20:00+09:00' });
  await send('post', `/plans/${plan.id}/memories`, { body: '本堂', event_id: ev['清水寺']!.id, occurred_at: '2026-11-01T11:05:00+09:00' });

  await page.goto(`/planner/${plan.id}/journey`);
  await expect(page.getByRole('heading', { name: '旅の振り返り', level: 1 })).toBeVisible();
  const metrics = page.getByRole('region', { name: '達成指標' });
  await expect(metrics).toContainText('計画達成率0%');

  // 1. 提案を使う
  const temple = page.getByRole('listitem').filter({ hasText: '10:00 清水寺' });
  await expect(temple).toContainText('提案: 到着 10:20・出発 11:05(記録の日時から)');
  await temple.getByRole('button', { name: '提案を使う' }).click();
  await expect(page.getByRole('status')).toHaveText('提案した時刻で記録しました');
  await expect(temple).toContainText('到着 10:20・出発 11:05(提案から)');
  await expect(temple).toContainText('予定より20分遅れ');
  const planNow = await send('get', `/plans/${plan.id}`);
  const templePlanned = planNow.days[0].events.find((e: { id: string }) => e.id === ev['清水寺']!.id);
  expect(templePlanned.local_start_time).toBe('10:00'); // 予定は変わらない

  // 2. 行かなかった・指標
  const lunch = page.getByRole('listitem').filter({ hasText: '12:00 昼食' });
  await lunch.getByRole('button', { name: '行かなかった' }).click();
  await expect(page.getByRole('status')).toHaveText('「行かなかった」を記録しました');
  await expect(metrics).toContainText('計画達成率33%');
  await expect(metrics).toContainText('訪問達成率50%');
  await expect(metrics).toContainText('記録完成率67%');
  await axeViolations(page, '旅の振り返り');
  await metrics.getByRole('button', { name: '数値を隠す' }).click();
  await expect(metrics).toContainText('数値は隠しています。');
  await page.reload();
  await expect(page.getByRole('region', { name: '達成指標' })).toContainText('数値は隠しています。');
  await page.getByRole('region', { name: '達成指標' }).getByRole('button', { name: '数値を表示する' }).click();

  // 3. 時刻の入力
  await temple.getByLabel('出発').fill('11:30');
  await temple.getByRole('button', { name: '時刻を保存' }).click();
  await expect(page.getByRole('status')).toHaveText('到着と出発を保存しました');
  await expect(temple).toContainText('到着 10:20・出発 11:30');
  await expect(page.getByRole('region', { name: '達成指標' })).toContainText('1時間10分');

  // 4. 次の旅行へ戻す
  await lunch.getByRole('button', { name: '次の旅行の候補に戻す' }).click();
  await lunch.getByLabel('旅行').selectOption({ label: `P14次の旅行-${stamp}` });
  await expect(lunch.getByLabel('日')).toHaveValue(nextDay.id);
  await lunch.getByRole('button', { name: '戻す' }).click();
  await expect(page.getByRole('status')).toContainText('次の旅行に予定として戻しました');
  const target = await send('get', `/plans/${next.id}`);
  expect(target.days[0].events.map((e: { title: string }) => e.title)).toEqual(['昼食']);
});
