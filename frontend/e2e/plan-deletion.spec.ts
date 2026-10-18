import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate B-012] プラン削除(論理削除 → 復元 / 完全削除)のbrowser E2E。
 *
 * B-012では、日程・予約・移動区間を持つプランを削除すると500になり、画面からは一度も
 * 削除できなかった。ゲストで旅行を作り、それらの子データをAPIで用意して次を確認する。
 *   1. プラン一覧の「削除」で削除でき(200)、一覧から消えて「最近削除したプラン」に出る
 *   2. 復元すると一覧に戻り、日程・予定がそのまま残っている
 *   3. もう一度削除して「完全に削除」すると、削除済みの一覧からも消える(APIでも確認)
 *   4. ゴミ箱を開いた画面にaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  const r = await startGuestPlanViaApi(page, title);
  return { planId: r.planId, apiBase: r.apiBase, token: r.token };
}

async function send(request: APIRequestContext, base: string, token: string, method: 'post' | 'get', path: string,
  data?: unknown, extra: Record<string, string> = {}) {
  const res = await request[method](`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra }, data });
  const body = await res.text();
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status()}: ${body}`);
  return JSON.parse(body);
}

function planCard(page: Page, title: string) {
  return page.locator('.grid').getByText(title, { exact: true });
}

test('プラン削除: 子データのあるプランを削除・復元・完全削除できる', async ({ page, context }) => {
  const title = `B012削除E2E-${Date.now()}`;
  const { planId, apiBase, token } = await startGuestPlan(page, title);

  // 子データ: 日程・予定2件・予定に紐付いた予約・移動区間(いずれもB-012で削除を500にしていた)
  const day = await send(context.request, apiBase, token, 'post', `/plans/${planId}/days`,
    { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  const a = await send(context.request, apiBase, token, 'post', `/plans/${planId}/events`,
    { day_id: day.id, title: '清水寺', local_start_time: '10:00' });
  const b = await send(context.request, apiBase, token, 'post', `/plans/${planId}/events`,
    { day_id: day.id, title: '昼食', local_start_time: '12:00' });
  await send(context.request, apiBase, token, 'post', `/plans/${planId}/reservations`,
    { type: 'restaurant', provider_name: '料亭', event_id: b.id });
  await send(context.request, apiBase, token, 'post', `/plans/${planId}/segments`,
    { from_event_id: a.id, to_event_id: b.id, mode: 'walking', duration_minutes: 15 },
    { 'Idempotency-Key': `b012-e2e-${Date.now()}` });

  // 1. 一覧から削除する
  await page.goto('/planner');
  await expect(planCard(page, title)).toBeVisible({ timeout: 15_000 });
  const card = page.locator('.grid > *').filter({ hasText: title });
  page.once('dialog', (d) => d.accept());
  const deleted = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/travel-plans/${planId}`),
  );
  // [Gate E1] 一覧のボタン名にプラン名が入った(「<名前>」を削除)。名前に「削除」を含むため完全一致で選ぶ
  await card.getByRole('button', { name: `「${title}」を削除`, exact: true }).click();
  const deleteResponse = await deleted;
  expect(deleteResponse.status()).toBe(200);
  expect(await deleteResponse.json()).toMatchObject({ message: '旅行プランを削除しました' });
  await expect(planCard(page, title)).toHaveCount(0);

  const trash = page.getByRole('region', { name: /最近削除したプラン/ });
  await expect(trash.getByRole('heading', { name: '最近削除したプラン 1件' })).toBeVisible();
  await trash.getByRole('button', { name: '表示する' }).click();
  await expect(trash.getByText(title, { exact: true })).toBeVisible();
  await expect(trash.getByText(/に完全に削除されます\(あと30日\)/)).toBeVisible();
  // 削除通知(toast)が表示・フェード中だとaxeが途中の半透明状態を測るため、閉じてから検査する
  await expect(page.getByText(/プランを削除しました/)).toBeHidden({ timeout: 10_000 });
  await axeViolations(page, 'プラン一覧(最近削除したプランを表示)');

  // 2. 復元すると一覧に戻り、中身も残っている
  const restored = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/travel-plans/${planId}/restore`),
  );
  await trash.getByRole('button', { name: `${title}を復元` }).click();
  expect((await restored).status()).toBe(200);
  await expect(trash.getByText(/を復元しました/)).toBeVisible();
  await expect(planCard(page, title)).toBeVisible();
  await planCard(page, title).click();
  await page.waitForURL(new RegExp(`/planner/${planId}$`), { timeout: 15_000 });
  await expect(page.getByText('清水寺').first()).toBeVisible({ timeout: 15_000 });

  // 3. もう一度削除し、完全に削除する
  await page.goto('/planner');
  await expect(planCard(page, title)).toBeVisible({ timeout: 15_000 });
  page.once('dialog', (d) => d.accept());
  const deletedAgain = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/travel-plans/${planId}`),
  );
  await page.locator('.grid > *').filter({ hasText: title }).getByRole('button', { name: `「${title}」を削除`, exact: true }).click();
  expect((await deletedAgain).status()).toBe(200);
  await trash.getByRole('button', { name: '表示する' }).click();
  page.once('dialog', (d) => d.accept());
  const purged = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/travel-plans/${planId}/permanent`),
  );
  await trash.getByRole('button', { name: `${title}を完全に削除` }).click();
  expect((await purged).status()).toBe(200);
  await expect(trash.getByText(`「${title}」を完全に削除しました。`)).toBeVisible();
  await expect(trash.getByRole('heading', { name: '最近削除したプラン 0件' })).toBeVisible();

  const remaining = await send(context.request, apiBase, token, 'get', '/travel-plans/deleted');
  expect(remaining).toEqual([]);
  const gone = await context.request.get(`${apiBase}/plans/${planId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(gone.status()).toBe(404);
});
