import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate Remaining-2] 無料の外部サービスと接続口の browser E2E(外へは送らない。CI は模擬の通信)。
 *   1. 状況の画面の「外の情報を確かめる」: 気象庁の警報を「状況として登録」で欄へ入れ、登録できる
 *      (外の応答は page.route で差し替える。backend の模擬では気象庁は「取れない」の案内になる)
 *   2. 経路の候補の「時刻表から探す」: 鍵が無い時は手で入れる案内
 *   3. 予算・費用の「為替を自動で取る」: 取れない時は手入力の案内(何も記録しない)
 *   4. 旅程の日のタブに祝日の印(日本は計算。通信しない)
 *   5. [Gate Remaining-3] 予約の取り込みの「転送アドレス」(受信の設定が無い環境は案内)・通知の「すぐ送る」(メールが
 *      使えない環境は選べない)
 *   6. [Gate Remaining-4] 料金・お支払い(CI は決済の鍵なし → 案内・買えない)。ゲストは買えない
 *   7. 画面に axe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  await settleForAxe(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations.map((v) => `- ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件:\n${summary}`);
  }
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: 'get' | 'post', path: string, data?: unknown) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `r2-e2e-${Date.now()}-${Math.random()}` }, data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

test('外の情報: 警報を状況として登録・時刻表の案内・為替の自動・祝日の印', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `R2外の情報E2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  const a = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '東京', local_start_time: '09:00',
    latitude: 35.6812, longitude: 139.7671 });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '新大阪', local_start_time: '12:00' });

  // 1. 状況の画面(外の応答を差し替える: 今日・明日の予定の場所の警報)
  await page.route('**/api/v1/plans/*/alerts/external', (route) => route.fulfill({ json: {
    plan_id: planId, server_time: new Date().toISOString(), can_edit: true,
    days: [{ day_id: day.id, local_date: '2026-11-03' }],
    weather: [{ day_id: day.id, local_date: '2026-11-03', office: '130000', office_name: '東京都',
      report_at: new Date().toISOString(), area_name: '千代田区', source: '気象庁',
      warnings: [{ code: '03', name: '大雨警報', level: 'warning', status: '発表', disruptive: true }] }],
    transit: [], providers: { jma: { enabled: true, source: '気象庁' }, odpt: { configured: false, source: 'ODPT' } },
    unavailable: [] } }));
  await page.goto(`/planner/${planId}/alerts`);
  await page.getByRole('button', { name: '外の情報を確かめる' }).click();
  const panel = page.getByTestId('external-status');
  await expect(panel.getByText('大雨警報')).toBeVisible();
  await expect(panel.getByText(/鉄道の運行情報は提供元の設定が無い/)).toBeVisible();
  await axeViolations(page, '状況の画面(外の情報)');
  await panel.getByRole('button', { name: '状況として登録' }).click();
  await expect(page.locator('#alert-source')).toHaveValue('気象庁');
  await expect(page.locator('#alert-note')).toHaveValue('大雨警報(千代田区)');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByRole('list', { name: '対応中の状況' })).toContainText('気象庁');
  await page.unroute('**/api/v1/plans/*/alerts/external');

  // backend の模擬(外へ送らない)では「取れない」と案内し、手で登録できる
  await page.getByRole('button', { name: 'もう一度確かめる' }).click();
  await expect(panel.getByText(/状況は下の欄から手で登録できます|警報・注意報は調べていません|今日・明日の予定がありません/)
    .first()).toBeVisible();
  await expect(panel.getByText('大雨警報')).toHaveCount(0);

  // 2. 経路の候補: 時刻表(鍵が無い)→ 手で入れる案内
  await page.goto(`/planner/${planId}/route-options`);
  await page.getByRole('button', { name: '候補を追加' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select').nth(0).selectOption(a.id);
  await dialog.locator('select').nth(1).selectOption({ label: '新大阪' });
  const lookup = dialog.getByTestId('timetable-lookup');
  await lookup.getByRole('button', { name: '時刻表から探す' }).click();
  await expect(lookup.getByText(/提供元が未設定です/)).toBeVisible();
  await page.keyboard.press('Escape');

  // 3. 予算・費用: 為替の自動(CI の模擬では取れない → 手入力の案内。何も記録しない)
  const fx = await context.request.post(`${apiBase}/plans/${planId}/fx-rates/fetch`, {
    headers: { Authorization: `Bearer ${token}` }, data: { currency: 'USD' } });
  expect([201, 503]).toContain(fx.status());

  // 4. 祝日(2026-11-03 は文化の日): 旅程の日のタブに印
  await page.goto(`/planner/${planId}`);
  await expect(page.getByTestId('day-holiday-0')).toBeVisible();
  await expect(page.getByTestId('day-tab-0')).toHaveAccessibleName(/文化の日/);

  // 5. 予約メールの転送(CI は受信の設定なし → 案内)・メールの「すぐ送る」(メールの設定なし → 選べない)
  await page.goto(`/planner/${planId}/imports`);
  await expect(page.getByTestId('inbound-mail')).toContainText('管理者の設定が必要です');
  await axeViolations(page, '予約の取り込みの画面');

  // 6. 料金・お支払い(決済の鍵なし → 案内して買えない。ゲストは API でも買えない)
  await page.goto('/settings/billing');
  await expect(page.getByRole('heading', { name: '料金・お支払い' })).toBeVisible();
  await expect(page.getByText(/決済を使えません/)).toBeVisible();
  await expect(page.getByRole('button', { name: '購読する' }).first()).toBeDisabled();
  await axeViolations(page, '料金・お支払いの画面');
  const products = await (await context.request.get(`${apiBase}/billing/products`, {
    headers: { Authorization: `Bearer ${token}` } })).json();
  expect(products.configured).toBe(false);
  const buy = await context.request.post(`${apiBase}/billing/checkout`, {
    headers: { Authorization: `Bearer ${token}` }, data: { product_id: products.products[0].id } });
  expect([403, 409]).toContain(buy.status());
});
