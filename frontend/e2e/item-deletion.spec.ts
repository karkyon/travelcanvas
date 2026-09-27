import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate B-013 / B-014] 個別削除(紐付け解除して削除)と、移動区間・経路候補の画面操作のbrowser E2E。
 *
 * B-013: 予約・移動区間・経路候補に紐付いた予定、採用済みの経路候補を削除すると500になっていた。
 * B-014: 移動区間・経路候補の画面が、採用・更新・削除のIf-Matchに項目ごとのrevisionを送って
 *        いたため(backendはプランの版番号と照合する)、画面からの操作がほぼ常に409で失敗していた。
 *
 * ゲストで旅行を作り、子データをAPIで用意して次を確認する。
 *   1. 予約・移動区間の付いた予定を画面から削除でき、予約の紐付けを外したことが案内され、
 *      「元に戻す」で予定・予約の紐付け・移動区間がすべて戻る
 *   2. 確定ロックされた予約の紐付けがあると削除されず、ロック解除の方法が案内される
 *      (「削除しました」とは表示しない)
 *   3. 経路候補を画面から採用・削除でき、採用した移動区間は残る。移動区間も画面から削除できる
 *   4. 上記の画面にaxe(WCAG 2.1 AA)違反が無い
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

async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const apiBase = (await guestResponse).url().replace(/\/auth\/guest$/, '');
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  await newPlanButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('例: 東京旅行').fill(title);
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planIdをURLから取得できませんでした: ${page.url()}`);
  const token = await page.evaluate(() => window.localStorage.getItem('auth_token'));
  if (!token) throw new Error('ゲストのアクセストークンがlocalStorage(auth_token)にありません');
  return { planId: match[1], apiBase, token };
}

type Method = 'post' | 'get' | 'patch';

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (method: Method, path: string, data?: unknown, extra: Record<string, string> = {}) => {
    const res = await request[method](`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra }, data });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

/** 日程1件・予定2件(清水寺→夕食)・夕食に紐付いた予約・移動区間を用意する */
async function seedItinerary(send: ReturnType<typeof apiClient>, planId: string) {
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  const a = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', local_start_time: '10:00' });
  const b = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '夕食', local_start_time: '18:00' });
  const reservation = await send('post', `/plans/${planId}/reservations`,
    { type: 'restaurant', provider_name: '料亭', event_id: b.id });
  const segment = await send('post', `/plans/${planId}/segments`,
    { from_event_id: a.id, to_event_id: b.id, mode: 'walking', duration_minutes: 15 },
    { 'Idempotency-Key': `b013-e2e-${Date.now()}-${Math.random()}` });
  return { day, a, b, reservation, segment };
}

/** 予定カード(一覧項目。名前は「<タイトル>(上下矢印キーで並べ替え)」) */
function eventCard(page: Page, title: string) {
  return page.getByRole('listitem', { name: new RegExp(`^${title}\\(`) });
}

test('予定削除: 予約・移動区間の付いた予定を削除でき、「元に戻す」で紐付けまで戻る', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `B013予定削除-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const { b, reservation, segment } = await seedItinerary(send, planId);

  await page.goto(`/planner/${planId}`);
  const card = eventCard(page, '夕食');
  await expect(card).toBeVisible({ timeout: 15_000 });

  page.once('dialog', (d) => d.accept());
  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/events\//.test(r.url()));
  await card.getByRole('button', { name: '削除', exact: true }).click();
  expect((await deleted).status()).toBe(200);

  // 予約は残り、紐付けだけを外したこと・移動区間も削除したこと・元に戻せることを案内する
  await expect(page.getByText(/予約1件との紐付けを外しました/)).toBeVisible();
  await expect(page.getByText(/移動区間1件も削除しました/)).toBeVisible();
  await expect(eventCard(page, '夕食')).toHaveCount(0);
  const unlinked = await send('get', `/plans/${planId}/reservations/${reservation.id}`);
  expect(unlinked.event_id).toBeNull();

  // 「元に戻す」で予定・予約の紐付け・移動区間がすべて戻る(予定は元のIDのまま)
  const undone = page.waitForResponse((r) => /\/undo$/.test(r.url()));
  await page.getByRole('button', { name: /元に戻す/ }).click();
  expect((await undone).status()).toBe(200);
  await expect(eventCard(page, '夕食')).toBeVisible();
  const relinked = await send('get', `/plans/${planId}/reservations/${reservation.id}`);
  expect(relinked.event_id).toBe(b.id);
  const segments = await send('get', `/plans/${planId}/segments`);
  expect(segments.map((s: { id: string }) => s.id)).toEqual([segment.id]);

  await expect(page.getByText(/予約1件との紐付けを外しました/)).toHaveCount(0, { timeout: 15_000 });
  await axeViolations(page, '予定削除後のプランナー画面');
});

test('予定削除: 確定ロックされた予約の紐付けがあると削除せず、ロック解除を案内する', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `B013ロック-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const { reservation } = await seedItinerary(send, planId);
  const [link] = await send('get', `/plans/${planId}/reservations/${reservation.id}/events`);
  await send('patch', `/plans/${planId}/reservations/${reservation.id}/events/${link.id}`, { is_locked: true });

  await page.goto(`/planner/${planId}`);
  const card = eventCard(page, '夕食');
  await expect(card).toBeVisible({ timeout: 15_000 });
  page.once('dialog', (d) => d.accept());
  const refused = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/events\//.test(r.url()));
  await card.getByRole('button', { name: '削除', exact: true }).click();
  const res = await refused;
  expect(res.status()).toBe(409);
  expect((await res.json()).detail.code).toBe('locked_relation');

  await expect(page.getByText(/ロックを解除してから削除してください/)).toBeVisible();
  await expect(page.getByText('スケジュールを削除しました')).toHaveCount(0);
  await expect(eventCard(page, '夕食')).toBeVisible();
  const still = await send('get', `/plans/${planId}/reservations/${reservation.id}`);
  expect(still.event_id).toBe(link.event_id);
});

test('経路候補・移動区間: 画面から採用・削除でき、採用した移動区間は残る', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `B014経路-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  const a = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '京都駅', local_start_time: '09:00' });
  const b = await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '嵐山', local_start_time: '11:00' });
  await send('post', `/plans/${planId}/route-options`,
    { from_event_id: a.id, to_event_id: b.id, legs: [{ mode: 'train', sequence: 0, line: 'JR嵯峨野線' }] },
    { 'Idempotency-Key': `b014-e2e-${Date.now()}` });

  // 経路候補の採用(以前は候補のrevisionを送って409になっていた)
  await page.goto(`/planner/${planId}/route-options`);
  const adopted = page.waitForResponse((r) => /\/adopt$/.test(r.url()));
  await page.getByRole('button', { name: 'この経路候補を採用' }).click();
  expect((await adopted).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText(/採用し、移動区間に反映しました/);
  await axeViolations(page, '経路候補画面');

  // 採用済みの候補を削除(以前は500)。採用した移動区間は残る
  page.once('dialog', (d) => d.accept());
  const removed = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/route-options\//.test(r.url()));
  await page.getByRole('button', { name: 'この経路候補を削除' }).click();
  expect((await removed).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText(/採用した移動区間1件は残っています/);
  const segments = await send('get', `/plans/${planId}/segments`);
  expect(segments).toHaveLength(1);
  expect(segments[0].route_option_id).toBeNull();

  // 移動区間の削除(以前は区間のrevisionを送って409になっていた)
  await page.goto(`/planner/${planId}/segments`);
  page.once('dialog', (d) => d.accept());
  const segDeleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/segments\//.test(r.url()));
  await page.getByRole('button', { name: 'この移動区間を削除' }).click();
  expect((await segDeleted).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'この移動区間を削除' })).toHaveCount(0);
  expect(await send('get', `/plans/${planId}/segments`)).toHaveLength(0);
  await axeViolations(page, '移動区間画面');
});
