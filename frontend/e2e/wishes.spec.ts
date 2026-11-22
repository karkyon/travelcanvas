import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { registerMember } from './support/api';

/**
 * [FR-062] 今度行きたい・また行きたい の browser E2E。
 *   1. ヘッダーの ♡ でシートを開き、名前で探す代わりに「近くの候補」(画面の受け取りで模擬)の行を押すと、その場で残る(2 タップ)。
 *      取り消しの知らせが出る。閉じ方(Esc)
 *   2. 同じ場所をもう一度 ♡ すると、作らずに「もう残してあります」
 *   3. 行きたい場所の画面: 札(すべて・今度・また・エリア)の数と絞り込み・残した元・近くに来たら知らせる・ここから日帰り
 *   4. axe(WCAG 2.1 AA)違反が無い
 * 近くの候補の提供元(Overpass)は CI で届かないため、GET /spots/nearby-candidates の応答だけを模擬にする(保存は本物の API)。
 */
test('今度行きたい: ♡ のシートから 2 タップで残し、行きたい場所の画面の札で見分けられる', async ({ page, context }) => {
  test.setTimeout(90_000);
  const { apiBase, token } = await registerMember(page, 'wishes');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.4622, longitude: 136.7253, accuracy: 20 });
  await page.route('**/spots/nearby-candidates**', (r) => r.fulfill({ json: { source: ['overpass'], unavailable: [], results: [
    { name: '赤福 本店', genre: 'restaurant', distance_m: 40, lat: 34.4623, lng: 136.7256, address: '三重県伊勢市宇治中之切町26' },
    { name: 'おかげ座', genre: 'sightseeing', distance_m: 120, lat: 34.4617, lng: 136.7240, address: null }] } }));

  // 1. ヘッダーの ♡ → 近くの候補 → 押すと残る
  await page.getByRole('button', { name: '今度行きたいに残す' }).first().click();
  const sheet = page.getByRole('dialog', { name: '今度行きたいに残す' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /赤福 本店/ })).toBeVisible({ timeout: 15_000 });
  await expectNoAxeViolations(page, '今度行きたいのシート');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && /\/spots\/quick$/.test(new URL(r.url()).pathname));
  await sheet.getByRole('button', { name: /赤福 本店/ }).click();
  expect((await saved).status()).toBe(201);
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('wish-saved-toast')).toContainText('今度行きたいに残しました');

  // 2. 同じ場所をもう一度 → 作らない
  await page.getByRole('button', { name: '今度行きたいに残す' }).first().click();
  const again = page.waitForResponse((r) => r.request().method() === 'POST' && /\/spots\/quick$/.test(new URL(r.url()).pathname));
  await page.getByRole('dialog', { name: '今度行きたいに残す' }).getByRole('radio', { name: /また行きたい/ }).click();
  await page.getByRole('dialog', { name: '今度行きたいに残す' }).getByRole('button', { name: /赤福 本店/ }).click();
  expect((await again).status()).toBe(200);
  await expect(page.getByTestId('wish-saved-toast').filter({ hasText: 'もう残してあります' })).toContainText('また行きたい 2 回目');
  // Esc でも閉じる
  await page.getByRole('button', { name: '今度行きたいに残す' }).first().click();
  await expect(page.getByRole('dialog', { name: '今度行きたいに残す' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '今度行きたいに残す' })).toBeHidden();

  // 3. 行きたい場所の画面(API で今度・エリアも 1 件ずつ足す)
  const headers = { Authorization: `Bearer ${token}` };
  const r1 = await context.request.post(`${apiBase}/spots/quick`, { headers,
    data: { name: '伊勢うどん ちとせ', latitude: 34.49, longitude: 136.70, wish_kind: 'next', wish_note: '時間がなくて行けず', source_kind: 'quick',
      client_id: `e2e${Date.now()}abcdef` } });
  expect(r1.ok(), await r1.text()).toBeTruthy();
  await page.goto('/spots');
  await expect(page.getByTestId('wish-kind-all')).toContainText('2', { timeout: 15_000 });
  await expect(page.getByTestId('wish-kind-again')).toContainText('1');
  await expect(page.getByTestId('wish-kind-next')).toContainText('1');
  await page.getByTestId('wish-kind-again').click();
  const card = page.getByRole('listitem', { name: '赤福 本店' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('また行きたい 1 回');
  await expect(page.getByRole('listitem', { name: '伊勢うどん ちとせ' })).toHaveCount(0);
  await page.getByTestId('wish-kind-all').click();
  await expect(page.getByRole('listitem', { name: '伊勢うどん ちとせ' })).toContainText('『時間がなくて行けず』');
  const sw = card.getByRole('switch');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(card.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expectNoAxeViolations(page, '行きたい場所(札)');
  await card.getByRole('button', { name: 'ここから日帰り' }).click();
  await expect(page).toHaveURL(/\/planner\?new=1&mode=day&spot=/);
  await expect(page.getByTestId('trip-mode-day')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('dt-dest-chosen')).toContainText('赤福 本店', { timeout: 15_000 });
});
