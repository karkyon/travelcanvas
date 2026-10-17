import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'fs';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P8] FR-036 カレンダー(ICS)の取込(SC-27「外部更新の取込は差分確認後に適用する」)のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予定をAPIで用意して次を確認する。
 *   1. 書き出したICSをそのまま取り込むと「本案と同じ」で、追加・変更は0件
 *   2. 他のカレンダーで時刻を変え、予定を1件足したICSを取り込むと、変更前後と追加が表示され、本案はまだ変わらない
 *   3. 取り込むと本案が変わり、本案の「元に戻す」で取り込み前に戻る
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

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title);
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: 'get' | 'post', path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p8-e2e-${Date.now()}-${Math.random()}`, ...headers },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

type PlanDetail = { revision: number; days: Array<{ events: Array<{ title: string; local_start_time: string | null }> }> };
const eventsOf = (d: PlanDetail) => d.days.flatMap((x) => x.events.map((e) => `${e.local_start_time ?? '--'} ${e.title}`)).sort();

test('カレンダー取込: 書き出したICSを編集して取り込むと、差分を確認して適用でき、元に戻せる', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `P8取込E2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '10:00' });
  const before = (await send('get', `/plans/${planId}`)) as PlanDetail;

  // 書き出しからICSを保存する
  await page.goto(`/planner/${planId}/exports`);
  await expect(page.getByRole('heading', { name: '書き出し', level: 1 })).toBeVisible({ timeout: 15_000 });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ICSを書き出す' }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('ダウンロードしたファイルの場所を取得できませんでした');
  const ics = readFileSync(path, 'utf-8');
  expect(ics).toContain('DTSTART:20261101T010000Z');

  await page.getByRole('button', { name: 'カレンダー(ICS)から予定を取り込む' }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/calendar-import$`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'カレンダーから取り込む', level: 1 })).toBeVisible();
  await axeViolations(page, 'カレンダー取込');
  const input = page.getByLabel(/ICSファイル/);

  // 1. そのまま取り込むと変更なし
  await input.setInputFiles({ name: 'same.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await expect(page.getByTestId('import-summary')).toContainText('1件中、追加0件・変更0件・取り込まない1件');
  await expect(page.getByText(/本案と同じです/)).toBeVisible();

  // 2. 時刻を変え(10:00→11:30)、予定を1件足す
  const added = ['BEGIN:VEVENT', 'UID:outside-1@example.com', 'DTSTAMP:20261001T000000Z',
    'DTSTART;TZID=Asia/Tokyo:20261101T150000', 'SUMMARY:伏見稲荷', 'LOCATION:京都市伏見区', 'END:VEVENT'].join('\r\n');
  const edited = ics.replace('DTSTART:20261101T010000Z', 'DTSTART:20261101T023000Z').replace('END:VCALENDAR', `${added}\r\nEND:VCALENDAR`);
  await input.setInputFiles({ name: 'edited.ics', mimeType: 'text/calendar', buffer: Buffer.from(edited) });
  await expect(page.getByTestId('import-summary')).toContainText('2件中、追加1件・変更1件・取り込まない0件');
  const list = page.getByRole('list', { name: '取り込み案' });
  await expect(list).toContainText('開始時刻 10:00 → 11:30');
  await expect(list).toContainText('伏見稲荷');
  await expect(list).toContainText('2026-11-01 15:00 ・ 京都市伏見区');
  expect(eventsOf((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(eventsOf(before));
  await axeViolations(page, 'カレンダー取込(確認)');

  // 3. 取り込む → 本案が変わる → 元に戻す
  await page.getByRole('button', { name: '選んだ予定を取り込む' }).click();
  await expect(page.getByTestId('import-result')).toContainText('取り込みました(追加1件・変更1件)');
  const after = (await send('get', `/plans/${planId}`)) as PlanDetail;
  expect(eventsOf(after)).toEqual(['11:30 清水寺', '15:00 伏見稲荷']);
  await send('post', `/plans/${planId}/undo`, undefined, { 'If-Match': String(after.revision) });
  expect(eventsOf((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(eventsOf(before));
});
