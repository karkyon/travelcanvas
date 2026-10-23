import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate G5] 外部の判断の要らない残り(費用・使用量・組織)を、実際のブラウザで確かめる。
 *   1. FIN-01・FIN-02 費用: 為替を記録し、その記録で外貨の支出を換算する。予算の版を残す。支出を理由つきで取り消すと、
 *      一覧には残り、合計から外れる。精算を締めると支出を足せず、所有者が理由つきで解除できる
 *   2. ORG-01 組織: ロゴを登録して表示する(PNG に作り直される)。席の上限に達するとメンバーを足せない。
 *      独自のドメインを登録すると TXT レコードの値が示される
 *   3. BILL-02 使用量: 設定の「使用量」に今月の使用量が出る(共有リンクを発行すると数が増える)
 */

// 1x1 の PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('FIN-01・FIN-02 為替の記録・予算の版・取消・締め', async ({ page, context }) => {
  test.setTimeout(180_000);
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `G5費用E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  await send('post', `/plans/${planId}/budgets`, { kind: 'total', amount: '50000' });
  await send('post', `/plans/${planId}/expenses`, { title: '夕食G5', category: 'food', amount: '3000' });
  await page.goto(`/planner/${planId}/expenses`);
  await expect(page.getByRole('heading', { name: '予算・費用', level: 1 })).toBeVisible();

  // 為替を記録し、予算の版を残す
  await page.getByRole('tab', { name: '記録' }).click();
  await page.locator('#fx-currency').selectOption('USD');
  await page.getByLabel(/1 単位 = \? JPY/).fill('150.25');
  await page.getByLabel('基準日').fill('2026-10-01');
  await page.getByLabel('出典').fill('銀行の公示G5');
  await page.getByRole('button', { name: '為替を記録' }).click();
  await expect(page.getByRole('list', { name: '為替の記録' })).toContainText('1 USD = 150.25 JPY');
  await page.getByRole('button', { name: '「当初」の版を残す' }).click();
  await expect(page.getByRole('list', { name: '予算の版' })).toContainText('当初: 当初の予算 合計 50,000円');
  await expect(page.getByRole('button', { name: '「当初」の版を残す' })).toHaveCount(0);
  await expectNoAxeViolations(page, '費用(記録)');

  // 記録した為替で外貨の支出を足す
  await page.getByRole('tab', { name: '支出' }).click();
  await page.getByRole('button', { name: '支出を追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('内容', { exact: true }).fill('空港バスG5');
  await dialog.getByLabel('金額', { exact: true }).fill('10.00');
  await dialog.getByLabel('通貨').selectOption('USD');
  await dialog.getByLabel('記録した為替').selectOption({ label: '1 USD = 150.25 JPY(2026-10-01・銀行の公示G5)' });
  await expect(dialog.getByLabel(/換算レート/)).toHaveCount(0);
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('空港バスG5')).toBeVisible();
  const list = await send('get', `/plans/${planId}/expenses`) as Array<{ title: string; base_amount: string; fx_rate_id: string | null }>;
  const bus = list.find((e) => e.title === '空港バスG5')!;
  expect(bus.base_amount).toBe('1503');
  expect(bus.fx_rate_id).not.toBeNull();

  // 取り消す(一覧に残り、合計から外れる)
  await page.getByRole('button', { name: '夕食G5を取り消す' }).click();
  const voidDialog = page.getByRole('dialog', { name: '支出の取消' });
  await voidDialog.getByLabel('取り消す理由').fill('二重に登録したG5');
  await voidDialog.getByRole('button', { name: '取り消す' }).click();
  await expect(page.getByText('取消済み(集計に含まれません)')).toBeVisible();
  await expect(page.getByText('取り消した理由: 二重に登録したG5')).toBeVisible();
  const summary = await send('get', `/plans/${planId}/finance-summary`) as { total: { actual: string }; voided_expenses: number };
  expect(summary.total.actual).toBe('1503');
  expect(summary.voided_expenses).toBe(1);

  // 締める → 足せない → 所有者が解除する
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('tab', { name: '記録' }).click();
  await page.getByRole('button', { name: '精算を締める' }).click();
  await expect(page.getByRole('status').filter({ hasText: '精算を締めました' })).toBeVisible();
  await page.getByRole('tab', { name: '支出' }).click();
  await expect(page.getByText(/精算を締めています。支出・精算を変えるには/)).toBeVisible();
  await expect(page.getByRole('button', { name: '支出を追加' })).toHaveCount(0);
  await page.getByRole('tab', { name: '記録' }).click();
  await page.getByLabel('解除する理由').fill('金額の訂正G5');
  await page.getByRole('button', { name: '締めを解除する' }).click();
  await expect(page.getByRole('status').filter({ hasText: '締めを解除しました' })).toBeVisible();
  await page.getByRole('tab', { name: '支出' }).click();
  await expect(page.getByRole('button', { name: '支出を追加' })).toBeVisible();
});

test('ORG-01 ロゴ・席の上限・独自のドメイン', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await registerMember(page, 'g5o');
  const sendO = apiClient(page.request, owner.apiBase, owner.token);
  const otherCtx = await browser.newContext();
  const other = await registerMember(await otherCtx.newPage(), 'g5m');
  const thirdCtx = await browser.newContext();
  const third = await registerMember(await thirdCtx.newPage(), 'g5n');
  const org = await sendO('post', '/organizations', { name: `G5の会社-${Date.now()}` }) as { id: string; name: string };
  await page.goto(`/organizations/${org.id}`);
  await expect(page.getByRole('heading', { name: org.name, level: 1 })).toBeVisible();

  // ロゴ
  await page.getByLabel('画像(PNG・JPEG・WebP、1MBまで)').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'ロゴを保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ロゴを保存しました' })).toBeVisible();
  await expect(page.getByRole('img', { name: '組織のロゴ' }).first()).toBeVisible();
  const detail = await sendO('get', `/organizations/${org.id}`) as { has_logo: boolean };
  expect(detail.has_logo).toBe(true);

  // 席の上限(2人)に達すると足せない
  await page.getByLabel('席の上限(空欄は上限なし)').fill('2');
  await page.getByRole('button', { name: '席の上限を保存' }).click();
  await expect(page.getByRole('status').filter({ hasText: '席の上限を保存しました' })).toBeVisible();
  await page.getByLabel('会員のメールアドレス').fill(other.email);
  await page.getByRole('button', { name: 'メンバーを足す' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'メンバーを足しました' })).toBeVisible();
  await expect(page.getByTestId('org-seats')).toContainText('使用中 2人・上限 2人(残り 0人)');
  await expect(page.getByLabel('会員のメールアドレス')).toHaveValue(''); // 足した後に入力欄が空になってから
  await page.getByLabel('会員のメールアドレス').fill(third.email);
  await page.getByRole('button', { name: 'メンバーを足す' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '席の上限(2人)に達しています' })).toBeVisible();

  // ドメイン(TXT の値が示される。確認は DNS が要るので、ここでは登録まで)
  await page.getByLabel('ドメイン(例: example.co.jp)').fill(`g5-${Date.now()}.example.co.jp`);
  await page.getByRole('button', { name: 'ドメインを登録' }).click();
  const domains = page.getByRole('list', { name: 'ドメイン' });
  await expect(domains).toContainText('確認待ち');
  await expect(domains).toContainText('travelcanvas-verify=');
  await expectNoAxeViolations(page, '組織(ロゴ・席・ドメイン)');
  await otherCtx.close();
  await thirdCtx.close();
});

test('BILL-02 設定の使用量に今月の使用量が出る', async ({ page }) => {
  const me = await registerMember(page, 'g5u');
  const send = apiClient(page.request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: `G5使用量-${Date.now()}` }) as { id: string };
  await send('post', `/travel-plans/${plan.id}/share`, { permission: 'view' });
  await page.goto('/settings?tab=usage');
  await expect(page.getByRole('heading', { name: /今月の使用量/ })).toBeVisible();
  const usage = page.getByRole('list', { name: '使用量' });
  await expect(usage).toContainText('共有リンクの発行');
  await expect(usage).toContainText('1件 / 300件');
  await expectNoAxeViolations(page, '設定(使用量)');
});
