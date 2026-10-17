import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P2] FR-027 予算・費用 / FR-028 立替・精算(SC-23)のbrowser E2E。
 *
 * ゲストで旅行を作り、予算・費用画面から次を確認する。
 *   1. 旅行全体とカテゴリの予算を設定できる
 *   2. 円の支出、ドルの支出(換算レート付き)、ユーロの支出(レートなし)を登録すると、
 *      合計は換算できたものだけになり、換算できない支出があることが表示される
 *   3. カテゴリの予算を超えると「超過」と表示される
 *   4. 返金を登録すると実績から差し引かれる
 *   5. 再読込後も保持され、1人旅では精算は完了と表示される
 *   6. 各タブにaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page): Promise<string> {
  const r = await startGuestPlanViaApi(page, `P2費用E2E-${Date.now()}`);
  return r.planId;
}

async function addExpense(page: Page, fields: { title: string; amount: string; currency?: string; rate?: string; category?: string }) {
  await page.getByRole('button', { name: '支出を追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('内容', { exact: true }).fill(fields.title);
  await dialog.getByLabel('金額', { exact: true }).fill(fields.amount);
  if (fields.currency) await dialog.getByLabel('通貨', { exact: true }).selectOption(fields.currency);
  if (fields.rate) await dialog.getByLabel(/換算レート/).fill(fields.rate);
  if (fields.category) await dialog.getByLabel('カテゴリ', { exact: true }).selectOption(fields.category);
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/expenses$/.test(new URL(r.url()).pathname));
  await dialog.getByRole('button', { name: '保存' }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();
}

test('予算・費用: 予算と実績、外貨の換算、未換算の明示、返金、精算の完了', async ({ page }) => {
  const planId = await startGuestPlan(page);
  await page.getByRole('button', { name: /予算・費用/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/expenses$`), { timeout: 15_000 });
  const total = page.getByTestId('finance-total');
  await expect(total).toContainText('未設定', { timeout: 15_000 });
  await axeViolations(page, '予算・費用(概要・空)');

  // 1. 予算(旅行全体・食事)
  await page.getByRole('button', { name: '旅行全体の予算を設定' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/金額/).fill('30000');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(total).toContainText('30,000円');
  await page.getByRole('button', { name: 'カテゴリの予算を追加' }).click();
  await dialog.getByLabel('カテゴリ', { exact: true }).selectOption('food');
  await dialog.getByLabel(/金額/).fill('5000');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();

  // 2. 支出(円・ドル換算あり・ユーロ換算なし)
  await page.getByRole('tab', { name: '支出' }).click();
  await addExpense(page, { title: '夕食', amount: '6000', category: 'food' });
  await addExpense(page, { title: '空港バス', amount: '12.50', currency: 'USD', rate: '150', category: 'transport' });
  await addExpense(page, { title: 'お土産', amount: '20.00', currency: 'EUR', category: 'shopping' });
  await expect(page.getByText('未換算(集計に含まれません)')).toBeVisible();
  await expect(page.getByText(/≒ 1,875円、レート 150/)).toBeVisible();
  await axeViolations(page, '予算・費用(支出)');

  // 4. 返金
  await page.getByRole('button', { name: '夕食の返金を登録' }).click();
  await expect(dialog.getByLabel('通貨', { exact: true })).toBeDisabled();
  await dialog.getByLabel('金額', { exact: true }).fill('1000');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/返金済み 1,000円/)).toBeVisible();

  // 3. 概要: 合計は換算できた分だけ(6000 + 1875 - 1000)、未換算の注意、食事の超過は返金後に解消
  await page.getByRole('tab', { name: '概要' }).click();
  await expect(total).toContainText('6,875円');
  await expect(page.getByTestId('finance-notices')).toContainText('換算レートが未入力の外貨の支出が1件');
  const food = page.getByRole('region', { name: 'カテゴリ別' }).getByRole('row').filter({ hasText: '食事' });
  await expect(food).toContainText('5,000円');
  await expect(food).not.toContainText('超過');
  await page.getByRole('tab', { name: '支出' }).click();
  await addExpense(page, { title: '昼食', amount: '1500', category: 'food' });
  await page.getByRole('tab', { name: '概要' }).click();
  await expect(food).toContainText('超過');
  await axeViolations(page, '予算・費用(概要)');

  // 5. 再読込後も保持、1人旅の精算は完了
  await page.reload();
  await expect(page.getByTestId('finance-total')).toContainText('8,375円', { timeout: 15_000 });
  await page.getByRole('tab', { name: '精算' }).click();
  await expect(page.getByTestId('finance-settled')).toBeVisible();
  await axeViolations(page, '予算・費用(精算)');
});
