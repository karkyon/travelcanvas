import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate Remaining-6] FR-003 パスワードの再設定(忘れた時)とメールの確認の画面。
 * - ログインの画面から「パスワードを忘れた時」へ進み、メールを送ると、登録の有無に関わらず同じ案内が出る
 *   (メールの設定が無い環境では「送れません」の案内。取れたように見せない)
 * - 正しくない札の再設定・確認のリンクは、エラーの文を出し、画面を壊さない
 * - 画面に重大なアクセシビリティの問題が無い
 */
test('パスワードを忘れた時の画面から案内が出る', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'パスワードを忘れた時' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('heading', { name: 'パスワードを忘れた時' })).toBeVisible();
  await page.getByLabel('メール').fill(`nobody-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'リンクを送る' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});

test('正しくない札の再設定・確認はエラーの文を出す', async ({ page }) => {
  await page.goto('/reset-password?token=not-a-real-token-value');
  await page.getByLabel('新しいパスワード').fill('Remaining6-Pass-123!');
  await page.getByLabel('もう一度').fill('Remaining6-Pass-123!');
  await page.getByRole('button', { name: 'パスワードを変える' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.goto('/verify-email?token=not-a-real-token-value');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'メールの確認' })).toBeVisible();
});
