import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P10] FR-030 外部状況(アラート)・FR-031 安全な再計画(SC-24)のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予定・予約をAPIで用意して次を確認する。
 *   1. プラン画面の「遅延・休業の対応」から、遅延(情報源・確かさ付き)を登録できる
 *   2. 再計画案を作っても旅程は変わらず、案A/Bで変わる予定・外す予定・守る予定(予約付き)を比べられる
 *   3. 確認のうえ案Aを承認すると旅程が変わり(予約付きの予定は動かない)、状況は解決済みになる
 *   4. 旅程の「元に戻す」で全て戻り、案は「適用後に取り消し」になる
 *   5. 状況の一覧・案の比較画面にaxe(WCAG 2.1 AA)違反が無い
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

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title);
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: 'get' | 'post', path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p10-e2e-${Date.now()}-${Math.random()}`, ...headers },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

type PlanDetail = { revision: number; days: Array<{ events: Array<{ title: string; local_start_time: string | null }> }> };
const eventsOf = (d: PlanDetail) => d.days.flatMap((x) => x.events.map((e) => `${e.local_start_time ?? '--'} ${e.title}`)).sort();

test('再計画: 遅延を登録し、案A/Bを比べて承認すると予約を守って旅程が変わり、元に戻せる', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `P10再計画E2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '新幹線で京都へ', event_type: 'transport', local_start_time: '09:00' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '10:00' });
  const lunch = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '料亭で昼食', event_type: 'meal', local_start_time: '12:00' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '庭園散策', event_type: 'sightseeing', local_start_time: '14:00' });
  await send('post', `/plans/${planId}/reservations`, { type: 'restaurant', provider_name: '料亭', event_id: lunch.id });
  const before = (await send('get', `/plans/${planId}`)) as PlanDetail;

  // 1. 遅延を登録する
  await page.reload();
  await page.getByRole('button', { name: /遅延・休業の対応/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/alerts$`), { timeout: 15_000 });
  await expect(page.getByText('対応中の状況はありません。')).toBeVisible({ timeout: 15_000 });
  await axeViolations(page, '遅延・休業などへの対応(登録前)');
  await page.getByLabel('影響を受ける予定').selectOption({ label: '2026-11-01 09:00 新幹線で京都へ' });
  await page.getByLabel('遅れの見込み(分)').fill('120');
  await page.getByLabel('情報源(任意)').fill('駅の掲示');
  await page.getByRole('radio', { name: '確認済み' }).click();
  await page.getByRole('button', { name: '登録する' }).click();
  const active = page.getByRole('list', { name: '対応中の状況' });
  await expect(active).toContainText('新幹線で京都へ');
  await expect(active).toContainText('約120分の遅れ');
  await expect(active).toContainText('駅の掲示');
  await axeViolations(page, '遅延・休業などへの対応(登録後)');

  // 2. 再計画案を作る(旅程は変わらない)
  await active.getByRole('button', { name: '再計画案を作る' }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/replans/[0-9a-fA-F-]{36}$`), { timeout: 15_000 });
  const a = page.getByRole('region', { name: '案A' });
  await expect(a).toContainText('後ろの予定をずらす');
  await expect(a).toContainText('新幹線で京都へ: 09:00 → 11:00');
  await expect(a).toContainText('清水寺');
  await expect(a).toContainText('12:00 料亭で昼食(予約あり)');
  await expect(page.getByRole('region', { name: '案B' })).toContainText('後ろの予定の時刻を守る');
  expect(eventsOf((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(eventsOf(before));
  await axeViolations(page, '再計画案の比較');

  // 3. 案Aを承認する
  page.once('dialog', (d) => d.accept());
  await a.getByRole('button', { name: '案Aで旅程を変更する' }).click();
  await expect(page.getByText(/案Aで旅程を変更しました/)).toBeVisible();
  const after = (await send('get', `/plans/${planId}`)) as PlanDetail;
  expect(eventsOf(after)).toEqual(['11:00 新幹線で京都へ', '12:00 料亭で昼食', '14:00 庭園散策']);
  const alerts = await send('get', `/plans/${planId}/alerts`);
  expect(alerts.alerts[0].status).toBe('resolved');

  // 4. 元に戻す
  await send('post', `/plans/${planId}/undo`, undefined, { 'If-Match': String(after.revision) });
  expect(eventsOf((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(eventsOf(before));
  await page.reload();
  await expect(page.getByText(/状態: 適用後に取り消し/)).toBeVisible({ timeout: 15_000 });
});
