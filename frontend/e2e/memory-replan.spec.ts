import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { guestTokenFrom } from './support/guestPlan';

/**
 * [Gate P17] FR-057 Memory Replan(CA-015)のbrowser E2E。
 *
 * ゲストで過去の旅行2つ(美術館の滞在が予定より長い実績)と次の旅行をAPIで用意して次を確認する。
 *   1. 次の旅行の「過去の旅からの提案」に、傾向が根拠(旅行・件数)つきで出る。旅程は変わらない
 *   2. 提案の変わる予定(今→提案)を確認して適用すると、後ろの予定の時刻がずれる
 *   3. プランの「元に戻す」(API)で元に戻る
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

test('過去の旅からの提案: 傾向を根拠つきで示し、確認して適用すると予定がずれ、元に戻せる', async ({ page, context }) => {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const guest = await guestResponse;
  const apiBase = guest.url().replace(/\/auth\/guest$/, '');
  const token = await guestTokenFrom(guest); // [Gate S11] 画面の遷移と競合しないよう応答から取る
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const send = async (method: 'get' | 'post' | 'put', path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await context.request[method](`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p17-e2e-${Date.now()}-${Math.random()}`, ...headers }, data,
    });
    if (!res.ok()) throw new Error(`${path} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
  const stamp = Date.now();
  const trip = async (title: string, date: string, items: Array<[string, string, string, [string, string] | null]>) => {
    const plan = await send('post', '/travel-plans/', { title });
    const day = await send('post', `/plans/${plan.id}/days`, { local_date: date, timezone_id: 'Asia/Tokyo' });
    for (const [name, type, time, actual] of items) {
      const ev = await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: name, event_type: type, local_start_time: time });
      if (actual) {
        await send('put', `/plans/${plan.id}/journey/events/${ev.id}`, {
          status: 'visited', actual_start_at: `${date}T${actual[0]}:00+09:00`, actual_end_at: `${date}T${actual[1]}:00+09:00` });
      }
    }
    return plan;
  };
  await trip(`金沢-${stamp}`, '2025-05-01', [['美術館', 'museum', '10:00', ['10:00', '12:40']], ['昼食', 'meal', '12:00', null]]);
  await trip(`上野-${stamp}`, '2025-09-01', [['博物館', 'museum', '10:00', ['10:00', '12:50']], ['公園', 'sightseeing', '12:00', null]]);
  const next = await trip(`京都-${stamp}`, '2026-11-01', [['国立博物館', 'museum', '10:00', null], ['湯豆腐', 'meal', '12:00', null],
    ['清水寺', 'sightseeing', '14:00', null]]);
  const before = await send('get', `/plans/${next.id}`);

  await page.goto(`/planner/${next.id}/memory-replan`);
  const insights = page.getByRole('region', { name: '見つかった傾向' });
  await expect(insights).toContainText('「美術館・博物館」の予定では、実際の滞在が予定より平均45分長くなっています');
  await expect(insights).toContainText(`根拠: 上野-${stamp}・金沢-${stamp}の2件`);
  expect((await send('get', `/plans/${next.id}`)).revision).toBe(before.revision); // 見るだけでは変わらない
  await axeViolations(page, '過去の旅からの提案');

  const proposal = page.getByRole('region', { name: 'この旅行への提案' });
  await expect(proposal.getByRole('row').nth(1)).toContainText('湯豆腐12:0012:45');
  page.once('dialog', (d) => d.accept());
  await proposal.getByRole('button', { name: 'この提案を適用' }).click();
  await expect(page.getByRole('status')).toContainText('予定2件の時刻をずらしました');
  const after = await send('get', `/plans/${next.id}`);
  const times = Object.fromEntries(after.days[0].events.map((e: { title: string; local_start_time: string }) => [e.title, e.local_start_time]));
  expect(times).toEqual({ 国立博物館: '10:00', 湯豆腐: '12:45', 清水寺: '14:45' });

  await send('post', `/plans/${next.id}/undo`, undefined, { 'If-Match': String(after.revision) });
  const undone = await send('get', `/plans/${next.id}`);
  expect(undone.days[0].events.find((e: { title: string }) => e.title === '湯豆腐').local_start_time).toBe('12:00');
});
