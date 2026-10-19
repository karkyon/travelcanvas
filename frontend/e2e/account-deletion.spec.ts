import { test, expect } from '@playwright/test';
import { registerAccount } from './support/api';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate P9] FR-039 アカウントの削除と同意の撤回(SC-29)のbrowser E2E。
 *
 * 使い捨てアカウントを画面から登録し、旅行を1件作って次を確認する。
 *   1. 同意は既定で「同意しない」。切り替えると保存され、再読込後も保たれる。撤回もできる
 *   2. 削除の内容(所有する旅行の削除・猶予日数)を確認でき、パスワードが違うと削除されない
 *   3. 正しいパスワードで削除すると完了画面になり、端末のログイン状態が消え、元のトークンは使えない
 *   4. 画面にaxe(WCAG 2.1 AA)違反が無い
 */

const PASSWORD = 'Gate-P9-TestPass-1';

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

test('アカウント削除: 同意の変更・撤回、削除内容の確認、パスワード確認後に削除でき、元のトークンは使えない', async ({ page, context }) => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  // [Gate A2] 登録は共通の手順(計算の確認・回数制限の待ち合わせ。e2e/support/api.ts)を通す
  const { apiBase, token } = await registerAccount(page, { prefix: 'p9del', password: PASSWORD });
  const auth = { Authorization: `Bearer ${token}` };
  const plan = await context.request.post(`${apiBase}/travel-plans/`, { headers: auth, data: { title: `P9削除E2E-${suffix}` } });
  expect(plan.status()).toBe(201);

  // 1. 同意
  await page.goto('/settings/data');
  await expect(page.getByRole('heading', { name: 'データとプライバシー', level: 1 })).toBeVisible({ timeout: 15_000 });
  const consents = page.getByRole('list', { name: '同意の一覧' });
  const mail = consents.getByRole('checkbox', { name: /お知らせのメール/ });
  await expect(mail).not.toBeChecked();
  await mail.click();
  await expect(page.getByText('「お知らせのメール」を同意するに変更しました。')).toBeVisible();
  await axeViolations(page, 'データとプライバシー');
  await page.reload();
  await expect(page.getByRole('list', { name: '同意の一覧' }).getByRole('checkbox', { name: /お知らせのメール/ })).toBeChecked({ timeout: 15_000 });
  await page.getByRole('list', { name: '同意の一覧' }).getByRole('checkbox', { name: /お知らせのメール/ }).click();
  await expect(page.getByText('「お知らせのメール」を同意しないに変更しました。')).toBeVisible();

  // 2. 削除の内容とパスワード確認
  await page.getByRole('button', { name: '削除の内容を確認する' }).click();
  await expect(page.getByTestId('deletion-effects')).toContainText('あなたが所有する旅行1件を削除します');
  await expect(page.getByRole('list', { name: '削除する旅行' })).toContainText(`P9削除E2E-${suffix}`);
  await axeViolations(page, 'アカウントの削除(確認)');
  await page.getByLabel(/確認のため/).fill('退会する');
  await page.getByLabel('現在のパスワード').fill('wrong-password-1');
  await page.getByRole('button', { name: 'アカウントを削除する' }).click();
  await expect(page.getByRole('alert')).toContainText('パスワードが正しくありません');
  expect((await context.request.get(`${apiBase}/auth/me`, { headers: auth })).status()).toBe(200);

  // 3. 削除
  await page.getByLabel('現在のパスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'アカウントを削除する' }).click();
  await page.waitForURL(/\/account-deleted$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'アカウントを削除しました', level: 1 })).toBeVisible();
  await expect(page.getByText('この端末に保存したオフラインデータも消しました。')).toBeVisible();
  await axeViolations(page, 'アカウント削除の完了');
  expect(await page.evaluate(() => window.localStorage.getItem('auth_token'))).toBeNull();
  const persisted = await page.evaluate(() => JSON.parse(window.localStorage.getItem('auth-storage') ?? '{}').state ?? {});
  expect(persisted.isAuthenticated).toBe(false);
  expect((await context.request.get(`${apiBase}/auth/me`, { headers: auth })).status()).toBe(401);
  expect(new URL(page.url()).pathname).toBe('/account-deleted');
});
