import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P3] FR-022 合意形成 / FR-024 コメント(SC-19/SC-20)のbrowser E2E。
 * [Gate ChatConsensus] 相談は話し合い中心(タブなし)。投票は必要な時だけ。
 *
 * ゲストで旅行を作り、相談の画面から次を確認する。
 *   1. 発言する。予約番号らしき文字列に注意が出る。返信がスレッドに入る
 *   2. 発言の「これで決まり」で、投票なしで「決まったこと」に記録できる(元の発言と結び付く)
 *   3. 発言の「投票にする」で、題名・選択肢の下書き付きのかんたん投票を作り、1つ選べる
 *   4. 詳しい設定(4段階)の投票: 懸念は理由が必要、解決すると合意、「これに決定」で決定済み
 *   5. 再読込後も保持される。各状態にaxe(WCAG 2.1 AA)違反が無い
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

test('相談: 話し合い・これで決まり・発言から投票・詳しい投票・注意と返信', async ({ page }) => {
  const planId = await startGuestPlan(page);
  await page.getByRole('button', { name: /相談・投票/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/discussion$`), { timeout: 15_000 });
  await expect(page.getByText(/まだ発言はありません/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('tab')).toHaveCount(0);
  await axeViolations(page, '相談(空)');
  page.on('dialog', (d) => void d.accept());

  // 1. 発言・注意・返信
  await page.getByLabel('発言するの内容').fill('予約番号は 12345678 です');
  await expect(page.getByRole('note')).toContainText('機密情報');
  await page.getByRole('button', { name: '発言する' }).click();
  const thread = page.getByRole('list', { name: 'コメント' });
  await expect(thread).toContainText('予約番号は 12345678 です');
  await expect(thread).toContainText('機密情報が含まれている可能性');
  await thread.getByRole('button', { name: '返信' }).click();
  await page.getByLabel('返信するの内容').fill('専用の欄に移します');
  await page.getByRole('button', { name: '返信する' }).click();
  await expect(page.getByRole('list', { name: '返信' })).toContainText('専用の欄に移します');

  // 2. これで決まり(投票なし)
  await page.getByLabel('発言するの内容').fill('夕食は寿司でいいよね');
  await page.getByRole('button', { name: '発言する' }).click();
  await expect(thread).toContainText('夕食は寿司でいいよね');
  await page.getByRole('button', { name: /これで決まり\(この発言\): 夕食は寿司/ }).click();
  const decide = page.getByRole('dialog', { name: 'これで決まり' });
  await expect(decide.getByLabel('何を決めたか(題名)')).toHaveValue('夕食');
  await expect(decide.getByLabel('決めたこと')).toHaveValue('寿司');
  await axeViolations(page, '相談(これで決まり)');
  const recorded = page.waitForResponse((r) => r.request().method() === 'POST' && /\/polls\/decision$/.test(new URL(r.url()).pathname));
  await decide.getByRole('button', { name: '記録する' }).click();
  expect((await recorded).status()).toBe(201);
  const decided = page.getByRole('region', { name: '決まったこと' });
  await expect(decided).toContainText('寿司');
  await expect(decided).toContainText('話し合いで決定');
  await expect(decided).toContainText('元の発言: 「夕食は寿司でいいよね」');
  await expect(thread).toContainText('→ 決まったこと「夕食: 寿司」');

  // 3. 発言から投票にする(かんたん投票)
  await page.getByLabel('発言するの内容').fill('2日目の昼は赤福か伊勢うどんかな');
  await page.getByRole('button', { name: '発言する' }).click();
  await expect(thread).toContainText('2日目の昼は赤福か伊勢うどんかな');
  await page.getByRole('button', { name: /投票にする\(この発言\): 2日目の昼/ }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel('題名', { exact: true })).toHaveValue('2日目の昼');
  await expect(form.getByLabel('選択肢1', { exact: true })).toHaveValue('赤福');
  await expect(form.getByLabel('選択肢2', { exact: true })).toHaveValue('伊勢うどん');
  await form.getByRole('button', { name: '作成' }).click();
  await expect(form).toBeHidden();
  const simple = page.getByRole('region', { name: '2日目の昼' });
  await expect(simple).toContainText('かんたん投票');
  await simple.getByRole('button', { name: '赤福を選ぶ' }).click();
  await expect(simple.getByRole('button', { name: '赤福の選択を取り消す' })).toBeVisible();
  await simple.getByRole('button', { name: '伊勢うどんを選ぶ' }).click();  // 選び直し
  await expect(simple.getByRole('button', { name: '伊勢うどんの選択を取り消す' })).toBeVisible();
  await expect(simple.getByRole('button', { name: '赤福を選ぶ' })).toBeVisible();
  await axeViolations(page, '相談(かんたん投票)');

  // 4. 詳しい設定の投票(4段階)
  await page.getByRole('button', { name: '投票を作成' }).click();
  await form.getByLabel('題名', { exact: true }).fill('2日目の夕食');
  await form.getByLabel('選択肢1', { exact: true }).fill('寿司');
  await form.getByLabel('選択肢2', { exact: true }).fill('焼肉');
  await form.getByText(/詳しい設定/).click();
  await form.getByLabel(/4段階で答える/).check();
  await form.getByRole('button', { name: '作成' }).click();
  await expect(form).toBeHidden();
  const card = page.getByRole('region', { name: '2日目の夕食' });
  await card.getByLabel('寿司へのあなたの回答').selectOption('love');
  await card.getByLabel('焼肉へのあなたの回答').selectOption('concern');
  await card.getByRole('button', { name: '回答を送信' }).click();
  await expect(card.getByRole('alert')).toContainText('理由を入力してください');
  await card.getByLabel('焼肉の理由').fill('前日も焼肉');
  await card.getByRole('button', { name: '回答を送信' }).click();
  const sushi = card.getByRole('listitem').filter({ hasText: '寿司へのあなたの回答' });
  const yakiniku = card.getByRole('listitem').filter({ hasText: '焼肉へのあなたの回答' });
  await expect(yakiniku).toContainText('懸念あり');
  await yakiniku.getByRole('button', { name: '解決済みにする' }).click();
  await expect(yakiniku.getByText('合意', { exact: true })).toBeVisible();
  await sushi.getByRole('button', { name: 'これに決定' }).click();
  await expect(card).toContainText('決定済み');
  await expect(page.getByRole('list', { name: '投票で決まったこと' })).toContainText('2日目の夕食: 寿司');
  await axeViolations(page, '相談(決定の後)');

  // 5. 再読込後も保持
  await page.reload();
  await expect(page.getByRole('region', { name: '決まったこと' })).toContainText('話し合いで決定', { timeout: 15_000 });
  await expect(page.getByRole('region', { name: '2日目の夕食' })).toContainText('決定済み');
  await expect(page.getByRole('list', { name: '返信' })).toContainText('専用の欄に移します');
});
