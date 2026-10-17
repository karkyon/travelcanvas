import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P11] FR-033 オフライン編集・同期のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予定をAPIで用意して次を確認する。
 *   1. 通信できない状態で予定を削除すると、画面からは消え「未同期の変更」として端末に残る(サーバーは変わらない)
 *   2. 同じ間に別の端末(API)で変更された予定を削除すると、通信回復時の自動同期で「競合」になる
 *   3. 通信が戻ると自動で送られ、競合しない削除はサーバーへ反映される
 *   4. 競合の画面で自分の変更とサーバーの内容を比べ、「サーバーの内容を残す」で解決できる
 *   5. 競合の画面にaxe(WCAG 2.1 AA)違反が無い
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

/**
 * ゲストを開始し、プランはAPIで作る(画面の「新しいプラン」はQuickDraftの作成上限(IPごと1時間20件)を使うため、
 * E2E全体でその上限を超えないよう、新しく追加するE2EではAPIで作る)。
 */
// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title, { open: false });
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: 'get' | 'post' | 'put', path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p11-e2e-${Date.now()}-${Math.random()}`, ...headers },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

type PlanDetail = { revision: number; days: Array<{ events: Array<{ id: string; title: string }> }> };
const titles = (d: PlanDetail) => d.days.flatMap((x) => x.events.map((e) => e.title)).sort();

function eventCard(page: Page, title: string) {
  return page.getByRole('listitem', { name: new RegExp(`^${title}\\(`) });
}

test('オフライン: 通信できない間の削除を端末に溜め、通信回復で同期し、競合を解決できる', async ({ page, context, request }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `P11同期E2E-${Date.now()}`);
  const send = apiClient(request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '09:00' });
  const lunch = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '昼食', event_type: 'meal', local_start_time: '12:00' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '博物館', event_type: 'museum', local_start_time: '14:00' });

  await page.goto(`/planner/${planId}`);
  await expect(eventCard(page, '博物館')).toBeVisible({ timeout: 15_000 });

  // 1. 通信できない状態で博物館を削除する
  await context.setOffline(true);
  page.once('dialog', (d) => d.accept());
  await eventCard(page, '博物館').getByRole('button', { name: '削除', exact: true }).click();
  await expect(eventCard(page, '博物館')).toHaveCount(0);
  const bar = page.getByRole('region', { name: '同期の状態' });
  await expect(bar).toContainText('未同期の変更 1件');
  expect(titles((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(['博物館', '昼食', '清水寺']);

  // 2. 同じ間に別の端末で昼食が変更され、こちらでは昼食を削除する
  const rev = ((await send('get', `/plans/${planId}`)) as PlanDetail).revision;
  await send('put', `/plans/${planId}/events/${lunch.id}`, { title: '昼食(予約済み)' }, { 'If-Match': String(rev) });
  page.once('dialog', (d) => d.accept());
  await eventCard(page, '昼食').getByRole('button', { name: '削除', exact: true }).click();
  await expect(bar).toContainText('未同期の変更 2件');

  // 3. 通信が戻ると自動で送る: 博物館は削除され、昼食は競合になる
  await context.setOffline(false);
  await expect(bar).toContainText('同期で競合した変更 1件', { timeout: 15_000 });
  await expect(bar).not.toContainText('未同期の変更');
  expect(titles((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(['昼食(予約済み)', '清水寺']);

  // 4. 競合を確認して、サーバーの内容を残す
  await bar.getByRole('button', { name: '競合を確認する' }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/sync$`), { timeout: 15_000 });
  const card = page.getByRole('region', { name: '競合: 昼食(予約済み)' });
  await expect(card).toContainText('端末で削除しましたが');
  await expect(card.getByRole('table')).toContainText('予定名(削除)昼食(予約済み)');
  await expect(page.getByText(/端末に保存していた変更を送りました/)).toHaveCount(0, { timeout: 15_000 });
  await axeViolations(page, '同期で競合した変更');
  await card.getByRole('button', { name: 'サーバーの内容を残す' }).click();
  await expect(page.getByText('競合している変更はありません。')).toBeVisible({ timeout: 15_000 });
  expect(titles((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(['昼食(予約済み)', '清水寺']);
});
