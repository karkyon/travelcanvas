import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P3] FR-022 合意形成 / FR-024 コメント(SC-19/SC-20)のbrowser E2E。
 *
 * ゲストで旅行を作り、相談・投票画面から次を確認する。
 *   1. 投票を作成できる(選択肢2つ・「不可」1票で不成立)
 *   2. 懸念ありは理由が無いと送信できず、理由を入れると送信でき、合意状態が「懸念あり」になる
 *   3. 自分の懸念を「解決済み」にすると合意になり、「これに決定」で決定済みになる
 *   4. コメントで予約番号らしき文字列に注意が出る。返信がスレッドに入る
 *   5. 再読込後も保持される。各タブにaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  await settleForAxe(page);
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
  const r = await startGuestPlanViaApi(page, `P3相談E2E-${Date.now()}`);
  return r.planId;
}

test('相談・投票: 投票の作成、懸念の理由と解決、決定、コメントの注意と返信', async ({ page }) => {
  const planId = await startGuestPlan(page);
  await page.getByRole('button', { name: /相談・投票/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/discussion$`), { timeout: 15_000 });
  await expect(page.getByText('投票はまだありません。')).toBeVisible({ timeout: 15_000 });
  await axeViolations(page, '相談・投票(投票・空)');

  // 1. 投票の作成
  await page.getByRole('button', { name: '投票を作成' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('題名', { exact: true }).fill('2日目の夕食');
  await dialog.getByLabel('選択肢1', { exact: true }).fill('寿司');
  await dialog.getByLabel('選択肢2', { exact: true }).fill('焼肉');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/polls$/.test(new URL(r.url()).pathname));
  await dialog.getByRole('button', { name: '作成' }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();
  const card = page.getByRole('region', { name: '2日目の夕食' });
  await expect(card).toContainText('未回答');
  await axeViolations(page, '相談・投票(投票あり)');

  // 2. 懸念は理由が必要
  await card.getByLabel('寿司へのあなたの回答').selectOption('love');
  await card.getByLabel('焼肉へのあなたの回答').selectOption('concern');
  await card.getByRole('button', { name: '回答を送信' }).click();
  await expect(card.getByRole('alert')).toContainText('理由を入力してください');
  await card.getByLabel('焼肉の理由').fill('前日も焼肉');
  const voted = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/votes$/.test(new URL(r.url()).pathname));
  await card.getByRole('button', { name: '回答を送信' }).click();
  expect((await voted).status()).toBe(200);
  const sushi = card.getByRole('listitem').filter({ hasText: '寿司' }).first();
  const yakiniku = card.getByRole('listitem').filter({ hasText: '焼肉へのあなたの回答' });
  await expect(sushi).toContainText('合意');
  await expect(yakiniku).toContainText('懸念あり');
  await expect(yakiniku).toContainText('前日も焼肉');

  // 3. 懸念の解決と決定
  await yakiniku.getByRole('button', { name: '解決済みにする' }).click();
  await expect(yakiniku).toContainText('解決済み');
  await expect(yakiniku.getByText('合意', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await sushi.getByRole('button', { name: 'これに決定' }).click();
  await expect(card).toContainText('決定済み');
  await expect(card.getByText('決定', { exact: true })).toBeVisible();

  // 4. コメント
  await page.getByRole('tab', { name: /コメント/ }).click();
  await expect(page.getByText('まだコメントはありません。')).toBeVisible();
  await page.getByLabel('コメントするの内容').fill('予約番号は 12345678 です');
  await expect(page.getByRole('note')).toContainText('機密情報');
  await page.getByRole('button', { name: 'コメントする' }).click();
  const thread = page.getByRole('list', { name: 'コメント' });
  await expect(thread).toContainText('予約番号は 12345678 です');
  await expect(thread).toContainText('機密情報が含まれている可能性');
  await thread.getByRole('button', { name: '返信' }).click();
  await page.getByLabel('返信するの内容').fill('専用の欄に移します');
  await page.getByRole('button', { name: '返信する' }).click();
  await expect(page.getByRole('list', { name: '返信' })).toContainText('専用の欄に移します');
  await axeViolations(page, '相談・投票(コメント)');

  // 5. 再読込後も保持
  await page.reload();
  await expect(page.getByRole('region', { name: '2日目の夕食' })).toContainText('決定済み', { timeout: 15_000 });
  await page.getByRole('tab', { name: /コメント\(2\)/ }).click();
  await expect(page.getByRole('list', { name: '返信' })).toContainText('専用の欄に移します');
});
