import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerAccount } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate G11-UsageLayout] 利用枠の全ての状態で、読み終わった後に予定の一覧が動かない(docs/trace/gate-g11-usage-layout-trace.md)。
 *
 * 利用枠の応答は、この試験の中だけで page.route により差し替える(本物の利用・provider の状態ではない。本番のデータに触れない)。
 * 状態: 通常(未接続)・残り少ない・上限・月の上限・ゲスト・読めない(500)。幅: 1280px・360px。
 * 測り方: 利用枠の応答を止めた読み込み中に一覧の上端の位置を測り、応答を返した後に位置が決まるまで(続けて同じになるまで)待って比べる。
 * 許す差: 2px。知らせの全文は「詳しく」を開くと見える(利用者が開いた時だけ高さが変わる)。
 */

const PASSWORD = 'Gate-G11U-TestPass-1';

const usage = (over: Record<string, unknown>) => ({
  plan_id: 'test-only', class: 'free', class_label: 'Free', class_source: 'default', policy_version: '2026-10-29.1', currency: 'JPY',
  plan_cap_jpy: '50.0000', plan_used_jpy: '0.0000', plan_reserved_jpy: '0.0000', plan_remaining_jpy: '50.0000',
  plan_used_yen_ceil: 0, plan_cap_yen: 50, warn_at_jpy: '40.0000', state: 'ok', monthly_cap_jpy: '50.0000',
  monthly_used_jpy: '0.0000', plans_per_month: 1, plans_used_this_month: 0, counted_this_month: false,
  reset_at: '2026-11-01T00:00:00+00:00',
  calls: [{ operation: 'ai.generate', label: 'AI の案の作成', feature: 'trip_planning.ai_calls_per_plan', limit: 5, used: 0, remaining: 5 }],
  connected_operations: [], providers_connected: false, fallbacks: ['USE_SAVED_CANDIDATES', 'CONTINUE_MANUALLY'], ...over,
});

const STATES: Array<[string, Record<string, unknown> | 'error', string]> = [
  ['通常(未接続)', {}, '未接続です(0円)'],
  ['残り少ない', { state: 'warning', plan_used_yen_ceil: 41, plan_used_jpy: '41.0000', plan_remaining_jpy: '9.0000', providers_connected: true }, '残り少なくなっています'],
  ['上限', { state: 'limit_reached', plan_used_yen_ceil: 50, plan_used_jpy: '50.0000', plan_remaining_jpy: '0.0000', providers_connected: true }, '外部の AI・有料の検索を止めました'],
  ['月の上限', { state: 'monthly_plans_reached', providers_connected: true }, '今月の旅程相談の枠'],
  ['ゲスト', { state: 'guest', class: 'guest', class_label: 'Guest', monthly_cap_jpy: null, plans_per_month: null, plan_cap_yen: 0, plan_cap_jpy: '0.0000' }, 'ゲスト'],
  ['読めない', 'error', '読めませんでした'],
];

async function settledY(page: Page): Promise<number> {
  const list = page.getByRole('list', { name: /の予定$/ });
  let last = Number.NaN;
  let y = Number.NaN;
  await expect.poll(async () => {
    y = Math.round((await list.boundingBox())!.y);
    const same = y === last;
    last = y;
    return same;
  }, { message: '一覧の位置が決まらない', intervals: [150], timeout: 10_000 }).toBe(true);
  return y;
}

for (const width of [1280, 360]) {
  test(`利用枠の全ての状態で、読み終わった後に一覧が動かない(${width}px)`, async ({ page }) => {
    test.setTimeout(180_000);
    const a = await registerAccount(page, { prefix: 'g11u', label: `w${width}`, password: PASSWORD });
    const send = apiClient(page.request, a.apiBase, a.token);
    const plan = await send('post', '/travel-plans/', { title: `利用枠G11-${Date.now()}` }) as { id: string };
    const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-21', timezone_id: 'Asia/Tokyo' }) as { id: string };
    await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '清水寺', local_start_time: '09:00' });
    await page.setViewportSize({ width, height: 900 });
    // 地図の下の移動概算は先に読み終わらせる(この試験は利用枠だけを比べる)
    for (const [name, st, text] of STATES) {
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => { release = r; });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route('**/planning-usage', async (route) => {
        await held;
        if (st === 'error') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"test-only"}' });
        else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usage(st)) });
      });
      await page.goto(`/planner/${plan.id}`);
      await expect(page.getByTestId('planning-usage-loading')).toBeVisible();
      await expect(page.getByTestId('route-summary')).not.toHaveAttribute('data-status', 'loading');
      const before = await settledY(page);
      release();
      const box = page.getByTestId(st === 'error' ? 'planning-usage-failed' : 'planning-usage');
      await expect(box).toContainText(text);
      const after = await settledY(page);
      expect(Math.abs(after - before), `${width}px ${name}: 一覧が ${after - before}px 動いた`).toBeLessThanOrEqual(2);
      if (st !== 'error') {
        // 全文は「詳しく」を開くと見える(利用者が開いた時だけ高さが変わる)
        await box.getByTestId('planning-usage-more').click();
        await expect(box.getByTestId('planning-usage-details')).toBeVisible();
        await expect(box.getByTestId('planning-usage-details')).toContainText(text);
      }
      if (name === '上限') await expectNoAxeViolations(page, `利用枠(上限・${width}px)`);
    }
  });
}
