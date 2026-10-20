import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P7] FR-019 What-if・旅程ブランチ(SC-17)のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予定をAPIで用意して次を確認する。
 *   1. 「もしもの案」から遅延の案を作ると、指定時刻以降の予定が遅れた案になり、本案は変わらない
 *   2. 案の予定を外す・追加して保存すると、本案との違いに表示される
 *   3. 本案に採用すると予定が変わり、本案の「元に戻す」で戻ると、案は「採用後に取り消し」になる
 *   4. 一覧・詳細にaxe(WCAG 2.1 AA)違反が無い
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

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title);
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: 'get' | 'post', path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p7-e2e-${Date.now()}-${Math.random()}`, ...headers },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

type PlanDetail = { revision: number; days: Array<{ events: Array<{ title: string; local_start_time: string | null }> }> };
const eventsOf = (d: PlanDetail) => d.days.flatMap((x) => x.events.map((e) => `${e.local_start_time ?? '--'} ${e.title}`)).sort();

test('もしもの案: 遅延の案を作り、編集・採用すると本案が変わり、元に戻すと案は採用後に取り消しになる', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `P7分岐E2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '09:00' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '昼食', event_type: 'meal', local_start_time: '12:00' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '博物館', event_type: 'museum', local_start_time: '14:00' });
  const before = (await send('get', `/plans/${planId}`)) as PlanDetail;

  // 1. 遅延の案を作る
  await page.reload();
  await page.getByRole('button', { name: /もしもの案/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/branches$`), { timeout: 15_000 });
  await expect(page.getByText('まだ案はありません。')).toBeVisible({ timeout: 15_000 });
  await axeViolations(page, 'もしもの案(一覧)');
  await page.getByLabel('題名').fill('電車が2時間遅延');
  await page.getByRole('radio', { name: /遅延/ }).click();
  await page.getByLabel('遅延する日').selectOption({ label: '2026-11-01' });
  await page.getByLabel('この時刻以降(任意)').fill('11:00');
  await page.getByLabel('遅れ(分)').fill('120');
  await page.getByRole('button', { name: '案を作る' }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/branches/[0-9a-fA-F-]{36}$`), { timeout: 15_000 });
  const diff = page.getByRole('list', { name: '変更の一覧' });
  await expect(diff).toContainText('変更: 昼食(開始時刻 12:00 → 14:00)');
  await expect(diff).toContainText('変更: 博物館(開始時刻 14:00 → 16:00)');
  expect(eventsOf((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(eventsOf(before));
  await axeViolations(page, 'もしもの案(詳細)');

  // 2. 清水寺を外し、予定を追加して保存
  const kiyomizu = page.locator('li', { has: page.locator('input[value="清水寺"]') });
  await kiyomizu.getByRole('button', { name: '外す' }).click();
  await page.getByRole('button', { name: '2026-11-01に予定を追加' }).click();
  await page.getByLabel('予定名').last().fill('カフェで待機');
  await page.getByLabel('開始時刻').last().fill('11:30');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('分岐案を保存しました')).toBeVisible();
  await expect(diff).toContainText('外す: 清水寺');
  await expect(diff).toContainText('追加: カフェで待機');

  // 3. 採用 → 本案が変わる → 元に戻す
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '本案に採用' }).click();
  await expect(page.getByText(/「元に戻す」で取り消せます/)).toBeVisible();
  const after = (await send('get', `/plans/${planId}`)) as PlanDetail;
  expect(eventsOf(after)).toEqual(['11:30 カフェで待機', '14:00 昼食', '16:00 博物館']);
  await send('post', `/plans/${planId}/undo`, undefined, { 'If-Match': String(after.revision) });
  expect(eventsOf((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(eventsOf(before));
  await page.reload();
  await expect(page.getByText(/状態: 採用後に取り消し/)).toBeVisible({ timeout: 15_000 });
});
