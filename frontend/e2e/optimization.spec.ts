import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate L4] FR-018 説明可能な最適化(SC-16)のbrowser E2E。
 *
 * ゲストで旅行を作り、位置付きの予定4件(行ったり来たりの順)と「地点Cは11:30より後」の制約をAPIで用意して次を確認する。
 *   1. プラン画面の「この日の並べ替え」で候補を計算すると、「移動が最短の案」と「制約・検証を優先した案」が
 *      今の順との比較(距離・検証のエラー・守れていない制約)・理由・変わる予定つきで表示され、旅程は変わらない
 *   2. 確認のうえ「制約・検証を優先した案」を適用すると、並び順と時刻が変わり、制約を満たす
 *   3. 「直前の変更を取り消す」で元に戻る
 *   4. 候補の表示にaxe(WCAG 2.1 AA)違反が無い
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

/**
 * ゲストを開始し、プランはAPIで作る(画面の「新しいプラン」はQuickDraftの作成上限(IPごと1時間20件)を使うため、
 * E2E全体でその上限を超えないよう、新しく追加するE2EではAPIで作る)。
 */
// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title, { open: false });
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: 'get' | 'post', path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `l4-e2e-${Date.now()}-${Math.random()}`, ...headers },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

type PlanDetail = { revision: number; days: Array<{ events: Array<{ title: string; local_start_time: string | null; sort_order: number }> }> };
const dayOrder = (d: PlanDetail) => d.days[0]!.events.slice().sort((a, b) => a.sort_order - b.sort_order)
  .map((e) => `${e.local_start_time ?? '--'} ${e.title}`);

test('並べ替え: 制約・検証を優先した案を比べて適用すると、制約を満たす順番・時刻になり、元に戻せる', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `L4最適化E2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  const lon: Record<string, number> = { A: 135.70, B: 135.711, C: 135.722, D: 135.733 };
  const ids: Record<string, string> = {};
  for (const [name, time] of [['A', '09:00'], ['C', '10:00'], ['B', '11:00'], ['D', '12:00']] as const) {
    const e = await send('post', `/plans/${planId}/events`, {
      day_id: day.id, title: `地点${name}`, event_type: 'sightseeing', local_start_time: time, latitude: 35.0, longitude: lon[name],
    });
    ids[name] = e.id;
  }
  await send('post', `/plans/${planId}/constraints`, {
    title: '地点Cは午後', constraint_type: 'meeting', hardness: 'hard', operator: 'after', value: { value: '11:30' },
    scope_type: 'event', scope_id: ids.C,
  });
  const before = (await send('get', `/plans/${planId}`)) as PlanDetail;
  expect(dayOrder(before)).toEqual(['09:00 地点A', '10:00 地点C', '11:00 地点B', '12:00 地点D']);

  // 1. 候補を計算する(旅程は変わらない)
  await page.goto(`/planner/${planId}`);
  await page.getByRole('button', { name: /この日の並べ替え/ }).click();
  await page.getByRole('button', { name: '並べ替え候補を計算する' }).click();
  const best = page.getByRole('region', { name: '制約・検証を優先した案' });
  await expect(best).toBeVisible({ timeout: 15_000 });
  await expect(best.getByRole('table')).toContainText('守れていない制約1件0件改善');
  await expect(best).toContainText('守れていない制約が1件減ります');
  await expect(best).toContainText('解消する問題');
  await expect(page.getByRole('region', { name: '移動が最短の案' })).toContainText('移動距離が約');
  expect(dayOrder((await send('get', `/plans/${planId}`)) as PlanDetail)).toEqual(dayOrder(before));
  await axeViolations(page, '並べ替え候補');

  // 2. 制約・検証を優先した案を適用する
  page.once('dialog', (d) => d.accept());
  await best.getByRole('button', { name: '「制約・検証を優先した案」を適用' }).click();
  await expect(page.getByText(/「制約・検証を優先した案」を適用しました/)).toBeVisible({ timeout: 15_000 });
  const after = (await send('get', `/plans/${planId}`)) as PlanDetail;
  expect(dayOrder(after).at(-1)).toBe('12:00 地点C');
  const run = await send('post', `/plans/${planId}/validation-runs`);
  expect(run.counts.error).toBe(0);

  // 3. 元に戻す
  await page.getByRole('button', { name: '直前の変更を取り消す' }).click();
  await expect.poll(async () => dayOrder((await send('get', `/plans/${planId}`)) as PlanDetail), { timeout: 15_000 })
    .toEqual(dayOrder(before));
});
