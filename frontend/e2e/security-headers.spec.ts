import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate S2] SEC-03・SEC-09 の browser E2E。
 *
 * 1. 画面(vite preview)と API の応答にセキュリティヘッダー(CSP・埋め込み禁止・nosniff 等)が付いている。
 * 2. 主な画面を一通り開いても、CSP の違反(ブラウザが読み込みを拒否したもの)が1件も出ない
 *    (= CSP が画面の正規の動作を壊していない)。
 * 3. メールアドレスの変更は現在のパスワードを求め、誤りでは変わらず、正しければ変わる。
 */

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|connect|apply|frame)/i.test(text)) violations.push(text);
  });
  return violations;
}

test('画面と API の応答にセキュリティヘッダーがあり、主な画面で CSP の違反が出ない', async ({ page }) => {
  const violations = collectCspViolations(page);

  const top = await page.goto('/');
  const headers = top!.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `S2ヘッダーE2E-${Date.now()}`);
  const api = await page.request.get(`${apiBase}/plans/${planId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'");

  // 予定を入れて、地図・当日画面・記録・共有の画面を開く
  const send = apiClient(page.request, apiBase, token);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const day = await send('post', `/plans/${planId}/days`, { local_date: today, timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺S2', local_start_time: '10:00' });
  for (const path of [`/planner/${planId}`, `/planner/${planId}/today`, `/planner/${planId}/memories`,
    `/planner/${planId}/preparation`, '/atlas']) {
    await page.goto(path);
    await page.waitForLoadState('load');
    await expect(page.locator('#root')).not.toBeEmpty();
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

test('メールアドレスの変更: 現在のパスワードを求め、誤りでは変わらず、正しければ変わる', async ({ page }) => {
  const violations = collectCspViolations(page);
  const member = await registerMember(page, 'email');
  const newEmail = `s2changed-${Date.now()}@example.com`;

  await page.goto('/settings');
  const email = page.getByLabel('メールアドレス', { exact: true });
  await expect(email).toHaveValue(member.email);
  await expect(page.getByLabel(/現在のパスワード/)).toHaveCount(0); // 変えるまでは出ない
  await email.fill(newEmail);
  const password = page.getByLabel(/現在のパスワード/);
  await expect(password).toBeVisible();
  // axe-core は判定のために外部のスタイルシート(Google Fonts)を自分で取得しようとし、CSP に止められる。
  // これは検査の道具の動きで画面の動作ではないため、axe の実行中に出た記録は数えない。
  const before = violations.length;
  await expectNoAxeViolations(page, '設定(メールアドレスの変更)');
  violations.splice(before);

  // 誤ったパスワード
  await password.fill('Wrong-Pass-2026');
  const failed = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/auth/me'));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect((await failed).status()).toBe(400);
  const me1 = await apiClient(page.request, member.apiBase, member.token)('get', '/auth/me');
  expect(me1.email).toBe(member.email);

  // 正しいパスワード
  await password.fill('Gate-E1-TestPass-1');
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/auth/me'));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'メールアドレスを変更しました' })).toBeVisible();
  const me2 = await apiClient(page.request, member.apiBase, member.token)('get', '/auth/me');
  expect(me2.email).toBe(newEmail);
  expect(me2.is_verified).toBe(false);
  expect(violations, violations.join('\n')).toEqual([]);
});
