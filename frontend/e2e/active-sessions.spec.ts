import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate S9] 新しい端末からのログインの通知と、ログイン中の端末の一覧の browser E2E。
 *
 * 1. 会員登録した端末(既定の Chromium)とは別のブラウザ・OS(User-Agent を変えた別の文脈)でログインする
 * 2. 最初の端末に「新しい端末からログインがありました」の通知が届く
 * 3. 最初の端末の設定 → セキュリティに2台が出て、もう1台をログアウトさせると、その端末のトークンは使えない
 * 4. 設定のセキュリティのタブに axe-core の違反が無い
 */

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

test('新しい端末からのログインを通知し、ログイン中の端末の一覧からログアウトさせられる', async ({ page, browser }) => {
  const member = await registerMember(page, 'devices');

  // 1. 別の端末(別のブラウザ・OS)でログイン
  const other = await browser.newContext({ userAgent: FIREFOX_LINUX });
  const otherPage = await other.newPage();
  await otherPage.goto('/login');
  await otherPage.locator('#email').fill(member.email);
  await otherPage.locator('#password').fill('Gate-E1-TestPass-1');
  const loggedIn = otherPage.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.status() === 200);
  await otherPage.getByRole('button', { name: 'Sign in' }).click();
  const otherToken = String((await (await loggedIn).json()).access_token);
  await otherPage.waitForURL(/\/dashboard$/, { timeout: 15_000 });

  // 2. 最初の端末に通知
  const send = apiClient(page.request, member.apiBase, member.token);
  const notifications = await send('get', '/notifications/');
  const alert = (notifications as { type: string; message: string }[]).find((n) => n.type === 'new_device_login');
  expect(alert?.message).toContain('Firefox / Linux');

  // 3. 一覧と、ほかの端末のログアウト
  await page.goto('/settings');
  await page.getByRole('button', { name: 'セキュリティ' }).click();
  const list = page.getByRole('list', { name: 'ログイン中の端末' });
  await expect(list).toContainText('Firefox / Linux');
  await expect(list).toContainText('この端末');
  await expectNoAxeViolations(page);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /「Firefox \/ Linux」.*をログアウトさせる/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ログアウトさせました' })).toBeVisible();
  await expect(list).not.toContainText('Firefox / Linux');

  const me = await page.request.get(`${member.apiBase}/auth/me`, { headers: { Authorization: `Bearer ${otherToken}` } });
  expect(me.status()).toBe(401);
  await other.close();
});
