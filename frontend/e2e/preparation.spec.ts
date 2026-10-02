import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate P1] FR-025 持ち物 / FR-026 準備タスク・レディネス(SC-21/SC-22)のbrowser E2E。
 *
 * ゲストで旅行を作り、宿泊の予定(予約なし)・山歩きの予定・未払いの鉄道予約をAPIで用意して、
 * 準備画面から次を確認する。
 *   1. 準備状況に「予約がない宿泊」「未払いの予約」が出て、「準備完了」とは表示されない
 *   2. 項目を「タスクにする」→ 担当を自分にして保存 → 「対応済みにする」で項目が外れる
 *   3. 持ち物の候補: 条件(海外)を付けて表示すると天候を判定していないことが示され、
 *      候補(パスポート=自分だけ・身分証明書)を追加でき、状態を梱包済みにできる
 *   4. 手入力の持ち物・タスクを追加し、タスクを完了にできる。再読込後も保持される
 *   5. 各タブにaxe(WCAG 2.1 AA)違反が無い
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

async function startGuestPlan(page: Page): Promise<{ planId: string; apiBase: string }> {
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
  await dialog.getByPlaceholder('例: 東京旅行').fill(`P1準備E2E-${Date.now()}`);
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planIdをURLから取得できませんでした: ${page.url()}`);
  return { planId: match[1], apiBase };
}

async function send(request: APIRequestContext, base: string, token: string, path: string, data: unknown) {
  const res = await request.post(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p1-e2e-${Date.now()}-${Math.random()}` },
    data,
  });
  const body = await res.text();
  if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
  return JSON.parse(body);
}

test('準備: 準備状況の項目をタスクで対応し、持ち物の候補を追加・梱包し、タスクを完了できる', async ({ page, context }) => {
  const { planId, apiBase } = await startGuestPlan(page);
  const token = await page.evaluate(() => window.localStorage.getItem('auth_token'));
  if (!token) throw new Error('ゲストのアクセストークンがlocalStorage(auth_token)にありません');

  const day = await send(context.request, apiBase, token, `/plans/${planId}/days`,
    { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  await send(context.request, apiBase, token, `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  await send(context.request, apiBase, token, `/plans/${planId}/events`,
    { day_id: day.id, title: '京都ホテル', event_type: 'accommodation' });
  await send(context.request, apiBase, token, `/plans/${planId}/events`,
    { day_id: day.id, title: '嵐山ハイキング', event_type: 'activity', local_start_time: '10:00' });
  await send(context.request, apiBase, token, `/plans/${planId}/reservations`,
    { type: 'train', provider_name: 'JR', total_amount: 14000, payment_status: 'unpaid' });

  // 1. 準備画面へ。準備状況に残りが出る(準備完了とは表示されない)
  await page.reload();
  await page.getByRole('button', { name: /準備/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/preparation$`), { timeout: 15_000 });
  const summary = page.getByTestId('readiness-summary');
  await expect(summary).toContainText('件の準備が残っています', { timeout: 15_000 });
  await expect(page.getByText('出発前に対応が必要な項目はありません')).toHaveCount(0);
  const items = page.getByRole('list', { name: '準備が残っている項目' });
  const hotelItem = items.getByRole('listitem').filter({ hasText: '「京都ホテル」に予約がありません' });
  await expect(hotelItem).toBeVisible();
  await expect(items.getByText('鉄道の予約(JR)が未払いです')).toBeVisible();
  await axeViolations(page, '準備状況');

  // 2. タスクにして、対応済みにする
  await hotelItem.getByRole('button', { name: 'タスクにする' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('題名', { exact: true })).toHaveValue('「京都ホテル」に予約がありません');
  await dialog.getByLabel('完了条件(任意)').fill('予約不要と確認した');
  const assignee = dialog.getByLabel('担当', { exact: true });
  const myOption = await assignee.locator('option', { hasText: '(自分)' }).getAttribute('value');
  await assignee.selectOption(myOption as string);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/preparation-tasks`),
  );
  await dialog.getByRole('button', { name: '保存' }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(hotelItem.getByText(/タスクにしました\(担当: /)).toBeVisible();
  await hotelItem.getByRole('button', { name: '対応済みにする' }).click();
  await expect(items.getByText('「京都ホテル」に予約がありません')).toHaveCount(0);
  await expect(summary).toContainText('タスク: 未完了 0 件 / 完了 1 件');

  // 3. 持ち物の候補(海外)。天候は判定していないと示す
  await page.getByRole('tab', { name: '持ち物' }).click();
  await page.getByLabel('海外旅行').check();
  await page.getByRole('button', { name: '候補を表示' }).click();
  const suggestions = page.getByTestId('packing-suggestions');
  await expect(suggestions.getByText(/天気予報の取得元が未接続/)).toBeVisible();
  await expect(suggestions.getByText(/山歩きの予定があり/)).toBeVisible();
  await suggestions.getByRole('button', { name: 'パスポートを持ち物に追加' }).click();
  await expect(suggestions.getByRole('button', { name: 'パスポートを持ち物に追加' })).toHaveCount(0);
  await suggestions.getByRole('button', { name: '身分証明書を持ち物に追加' }).click();
  await expect(page.getByLabel('自分だけの持ち物')).toBeVisible();
  await expect(page.getByTestId('packing-progress')).toContainText('梱包済み 0/2 件(必須で未準備 2 件)');
  await page.getByLabel('身分証明書の状態').selectOption('packed');
  await expect(page.getByTestId('packing-progress')).toContainText('梱包済み 1/2 件(必須で未準備 1 件)');
  await axeViolations(page, '持ち物');

  // 4. 手入力の持ち物
  await page.getByRole('button', { name: '持ち物を追加' }).click();
  await dialog.getByLabel('名前', { exact: true }).fill('折りたたみ傘');
  await dialog.getByLabel('分類', { exact: true }).selectOption('gear');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: '道具' })).toBeVisible();
  await expect(page.getByText('折りたたみ傘', { exact: true })).toBeVisible();

  // タスクを追加して完了にする
  await page.getByRole('tab', { name: 'タスク' }).click();
  await page.getByRole('button', { name: 'タスクを追加' }).click();
  await dialog.getByLabel('題名', { exact: true }).fill('両替する');
  await dialog.getByLabel('期限(任意)').fill('2026-11-01T18:00');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  const exchange = page.getByRole('checkbox', { name: '両替する' });
  await expect(exchange).not.toBeChecked();
  await exchange.click();
  await expect(exchange).toBeChecked();
  await axeViolations(page, 'タスク');

  // 再読込後も保持される
  await page.reload();
  await page.getByRole('tab', { name: 'タスク' }).click();
  await expect(page.getByRole('checkbox', { name: '両替する' })).toBeChecked({ timeout: 15_000 });
  await expect(page.getByRole('checkbox', { name: '「京都ホテル」に予約がありません' })).toBeChecked();
  await page.getByRole('tab', { name: '持ち物' }).click();
  await expect(page.getByTestId('packing-progress')).toContainText('梱包済み 1/3 件');
});
