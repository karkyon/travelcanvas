import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient, registerAccount } from './support/api';

/**
 * [Gate Remaining-7] 第7弾の browser E2E。
 *   1. FR-014 移動区間の手段を変え、プランの「元に戻す」で元の手段に戻る
 *   2. FR-015 経路候補を採用し、「元に戻す」で採用の前に戻る(移動区間が消える)
 *   3. FR-016 制約を消し、「元に戻す」で戻る
 *   4. FR-026 準備状況に予算(使った額・未払いの予約の見込み)が出る / FR-049 訪問の地図に候補の層が出る
 *   5. FR-002 ゲストで作った旅行を、既存のアカウントへまとめる
 *   6. FR-003 passkey を作り、passkey でログインする(Chromium の仮想の認証器)
 */
function tokyoDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}
const PASSWORD = 'Gate-R7-TestPass-1';

test('FR-014・FR-015: 移動区間の変更と経路候補の採用を元に戻せる', async ({ page, context }) => {
  test.setTimeout(150_000);
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `R7区間-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(3), timezone_id: 'Asia/Tokyo' });
  const a = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', local_start_time: '10:00' });
  const b = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '夕食', local_start_time: '18:00' });
  await send('post', `/plans/${planId}/segments`, { from_event_id: a.id, to_event_id: b.id, mode: 'walking', duration_minutes: 15 });

  await page.goto(`/planner/${planId}`);
  await page.getByTestId(`segment-choose-${b.id}`).first().click();
  const changed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/segments\//.test(r.url()));
  await page.getByTestId(`segment-modes-${b.id}`).getByTestId('segment-mode-train').click();
  expect((await changed).status()).toBe(200);
  expect((await send('get', `/plans/${planId}/segments`))[0].mode).toBe('train');
  const undone = page.waitForResponse((r) => /\/undo$/.test(r.url()));
  await page.getByRole('button', { name: '元に戻す' }).first().click();
  expect((await undone).status()).toBe(200);
  await expect.poll(async () => (await send('get', `/plans/${planId}/segments`))[0].mode).toBe('walking');

  // 経路候補: 採用 → 元に戻す
  await send('post', `/plans/${planId}/route-options`,
    { from_event_id: a.id, to_event_id: b.id, legs: [{ mode: 'bus', sequence: 0, line: '市バス' }] });
  const before = (await send('get', `/plans/${planId}/segments`)).length;
  await page.goto(`/planner/${planId}/route-options`);
  const adopted = page.waitForResponse((r) => /\/adopt$/.test(r.url()));
  await page.getByRole('button', { name: 'この経路候補を採用' }).click();
  expect((await adopted).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText(/採用し、移動区間に反映しました/);
  const undo2 = page.waitForResponse((r) => /\/undo$/.test(r.url()));
  await page.getByTestId('route-option-undo').click();
  expect((await undo2).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText('元に戻しました。');
  const segs = await send('get', `/plans/${planId}/segments`);
  expect(segs.length).toBe(before);
  expect(segs.every((s: { route_option_id: string | null }) => s.route_option_id === null)).toBe(true);
  await expectNoAxeViolations(page, '経路の比較(元に戻した後)');
});

test('FR-016・FR-026・FR-049: 制約の取り消し・準備状況の予算・訪問の地図の候補の層', async ({ page, context }) => {
  test.setTimeout(150_000);
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `R7制約-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  const c = await send('post', `/plans/${planId}/constraints`, {
    title: '予算は1人5万円まで', constraint_type: 'budget_limit', hardness: 'hard', operator: 'max',
    value: { value: 50000, unit: 'JPY' } });
  await page.goto(`/planner/${planId}/constraints`);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: `${c.title}を削除` }).click();
  const bar = page.getByTestId('constraint-undo');
  await expect(bar).toContainText('制約を削除しました');
  const undone = page.waitForResponse((r) => /\/constraints\/undo\//.test(r.url()));
  await bar.getByRole('button', { name: '元に戻す' }).click();
  expect((await undone).status()).toBe(200);
  await expect(page.getByText('予算は1人5万円まで').first()).toBeVisible();
  await expectNoAxeViolations(page, '制約(元に戻した後)');

  // 準備状況の予算
  const day = await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(5), timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/budgets`, { kind: 'total', amount: '40000' });
  await send('post', `/plans/${planId}/expenses`, { title: '夕食', amount: '15000', currency: 'JPY', category: 'food' });
  await send('post', `/plans/${planId}/reservations`, { type: 'accommodation', provider_name: '宿', total_amount: 30000,
    payment_status: 'unpaid', status: 'confirmed' });
  await page.goto(`/planner/${planId}/preparation`);
  const budget = page.getByTestId('readiness-budget');
  await expect(budget).toContainText('40,000 JPY');
  await expect(budget).toContainText('-5,000 JPY');
  await expect(page.getByText('未払いの予約を足すと予算を超えます')).toBeVisible();
  await expectNoAxeViolations(page, '準備状況(予算)');

  // 訪問の地図の候補の層
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing',
    latitude: 34.9948, longitude: 135.785, local_start_time: '10:00' });
  await send('post', `/plans/${planId}/candidates`, { title: '伏見稲荷', latitude: 34.9671, longitude: 135.7727 });
  await page.goto(`/planner/${planId}/visits`);
  await expect(page.getByTestId('visit-tile-map')).toBeVisible();
  await expect(page.getByTestId('visit-candidates-toggle')).toBeChecked();
  await expect(page.getByText(/候補\(候補箱・まだ予定に置いていない\)\(1件\)/)).toBeVisible();
});

test('FR-002: ゲストで作った旅行を既存のアカウントへまとめる', async ({ page, context }) => {
  test.setTimeout(150_000);
  const account = await registerAccount(page, { prefix: 'r7merge', password: PASSWORD });
  await page.evaluate(() => window.localStorage.clear());
  const { planId } = await startGuestPlanViaApi(page, `R7まとめ-${Date.now()}`, { open: false });
  await page.goto('/guest/upgrade');
  const form = page.getByTestId('guest-merge-form');
  await form.getByLabel('メール').fill(account.email);
  await form.getByLabel('パスワード').fill(PASSWORD);
  const merged = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/guest/merge'));
  await form.getByRole('button', { name: 'このアカウントへまとめる' }).click();
  const res = await merged;
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.merge.moved.travel_plans ?? body.merge.moved['travel_plans.user_id']).toBe(1);
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  const send = apiClient(context.request, account.apiBase, body.access_token);
  const plans = await send('get', '/travel-plans/');
  expect(plans.plans.some((p: { id: string }) => p.id === planId)).toBe(true);
});

test('FR-003: passkey を作り、passkey でログインする', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', '仮想の認証器は Chromium の CDP だけ');
  test.setTimeout(150_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true } });
  const account = await registerAccount(page, { prefix: 'r7pk', password: PASSWORD });
  await page.goto('/settings?tab=security');
  const section = page.getByTestId('passkey-section');
  await expect(section).toBeVisible({ timeout: 15_000 });
  const created = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/passkeys/register'));
  await section.getByRole('button', { name: 'passkey を作る' }).click();
  expect((await created).status()).toBe(201);
  await expect(section.getByRole('status')).toContainText('を作りました');

  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/login');
  const login = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/passkeys/login'));
  await page.getByTestId('passkey-login').click();
  expect((await login).status()).toBe(200);
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  const state = await page.evaluate(() => JSON.parse(window.localStorage.getItem('auth-storage') ?? '{}'));
  expect(state.state?.user?.email ?? account.email).toBe(account.email);
});
