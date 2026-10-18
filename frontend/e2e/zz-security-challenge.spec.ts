import { test, expect } from '@playwright/test';
import { registerMember } from './support/api';

/**
 * [Gate S7] SEC-07 計算の確認の browser E2E。
 *
 * この接続元の「怪しさの点数」(Gate S6)を、偽のトークンでの要求で上げてから、画面でログイン・会員登録をする。
 * backend は 428 と問題を返し、画面(APIクライアント)が自動で解いて送り直すため、利用者の操作は増えずに通る。
 *
 * 点数はこの接続元(E2E を動かす機械)に15分残るため、他の E2E の前提(登録の最初の応答が 200)を崩さないよう、
 * ファイル名を zz- で始めて最後に動かす(Playwright はファイル名の順に動かす。workers=1)。
 * 点数は E2E の前の準備で消している(patch の reset、Runbook §3.9)。
 */

const PASSWORD = 'Gate-E1-TestPass-1';

test('怪しい接続元でも、画面のログイン・登録は自動の計算の確認を経て通る', async ({ page }) => {
  const member = await registerMember(page, 'chal');

  // 1. 偽のトークンで10回(無効なトークン 3点 × 10 = 30点 → 確認が要る)
  for (let i = 0; i < 10; i++) {
    const res = await page.request.get(`${member.apiBase}/auth/me`, { headers: { Authorization: `Bearer forged.${i}.token` } });
    expect(res.status()).toBe(401);
  }

  // 2. この端末のログインを消して、画面からログインする
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/login');
  const loginStatuses: number[] = [];
  const solvedHeaders: (string | undefined)[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.endsWith('/auth/login')) {
      loginStatuses.push(r.status());
      solvedHeaders.push(r.request().headers()['x-tc-challenge-solution']);
    }
  });
  await page.locator('#email').fill(member.email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  expect(loginStatuses).toEqual([428, 200]);
  expect(solvedHeaders[0]).toBeUndefined();
  expect(solvedHeaders[1]).toMatch(/^\d+$/);

  // 3. 別の新しい会員の登録も、同じように自動で通る
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.clear());
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const registerStatuses: number[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.endsWith('/auth/register')) registerStatuses.push(r.status());
  });
  await page.goto('/register');
  await page.locator('#username').fill(`s7chal${suffix}`.slice(0, 30));
  await page.locator('#email').fill(`s7chal-${suffix}@example.com`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirmPassword').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  expect(registerStatuses).toEqual([428, 200]);
});
