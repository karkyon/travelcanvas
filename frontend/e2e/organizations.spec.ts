import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate B1] FR-041 組織・B2B / FR-042 外部連携の browser E2E(2人・2画面)。
 *
 * 1. 先生(会員)が組織を作り、保護者(会員)をメールアドレスで足し、自分の旅行を配布する。写しに予約・番号・住所・メモは無い
 * 2. 保護者は配布を開いて最新版を確認し、自分の旅行として複製する(先生からは複製した旅行が見えない)
 * 3. 先生は確認の状況を見て、元の旅行から改訂する(版2。保護者は「改訂があります」)
 * 4. 先生が API クライアントを作り、秘密は作った時だけ表示。外部の仕組みとして client_credentials でトークンを受け取り、
 *    配布の一覧を読める(スコープの無い確認の件数は 403)
 * 5. 画面に axe(WCAG 2.1 AA)違反が無い
 */
const CONFIRMATION = 'B1E2ECONF-5521';

test('組織: 配布・閲覧確認・複製・改訂と、外部連携の client_credentials', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const teacher = await registerMember(page, 'b1t');
  const sendT = apiClient(page.request, teacher.apiBase, teacher.token);
  const title = `B1修学旅行-${Date.now()}`;
  const plan = await sendT('post', '/travel-plans/', { title, destination: '京都' }) as { id: string };
  const day = await sendT('post', `/plans/${plan.id}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo', title: '1日目B1' }) as { id: string };
  await sendT('post', `/plans/${plan.id}/events`, {
    day_id: day.id, title: '清水寺B1E2E', local_start_time: '10:00', address: '京都市東山区B1E2E', description: '集合メモB1E2E',
  });
  await sendT('post', `/plans/${plan.id}/reservations`, { type: 'accommodation', provider_name: '宿B1E2E', confirmation_number: CONFIRMATION });

  const parentCtx = await browser.newContext();
  const parentPage = await parentCtx.newPage();
  const parent = await registerMember(parentPage, 'b1p');
  const sendP = apiClient(parentPage.request, parent.apiBase, parent.token);

  // 1. 組織を作り、保護者を足し、配布する
  const orgName = `B1中学校-${Date.now()}`;
  await page.goto('/organizations');
  await expect(page.getByRole('heading', { name: '組織', level: 1 })).toBeVisible();
  await page.getByLabel('組織の名前').fill(orgName);
  await page.getByRole('button', { name: '組織を作る' }).click();
  await page.getByRole('link', { name: `「${orgName}」を開く` }).click();
  await expect(page.getByRole('heading', { name: orgName, level: 1 })).toBeVisible();
  await page.getByLabel('会員のメールアドレス').fill(parent.email);
  await page.getByRole('button', { name: 'メンバーを足す' }).click();
  await expect(page.getByRole('status')).toHaveText('メンバーを足しました');
  await page.getByLabel('配布する旅行(自分の旅行)').selectOption({ label: title });
  await page.getByRole('button', { name: '配布する', exact: true }).click();
  await expect(page.getByText(/確認 0\/2人/)).toBeVisible();
  await expectNoAxeViolations(page, '組織(管理者)');
  const orgUrl = page.url();

  // 2. 保護者: 開いて確認し、複製する
  await parentPage.goto(new URL(orgUrl).pathname);
  await expect(parentPage.getByRole('heading', { name: orgName, level: 1 })).toBeVisible();
  await expect(parentPage.getByRole('heading', { name: 'メンバー' })).toHaveCount(0);
  await parentPage.getByRole('link', { name: `「${title}」を開く` }).click();
  await expect(parentPage.getByRole('heading', { name: `配布: ${title}`, level: 1 })).toBeVisible();
  await expect(parentPage.getByText('清水寺B1E2E')).toBeVisible();
  const body = parentPage.locator('body');
  for (const secret of [CONFIRMATION, '宿B1E2E', '京都市東山区B1E2E', '集合メモB1E2E']) {
    await expect(body).not.toContainText(secret);
  }
  await expectNoAxeViolations(parentPage, '配布(メンバー)');
  await parentPage.getByRole('button', { name: '版1を確認しました' }).click();
  await expect(parentPage.getByText('あなたの確認: 最新版(版1)を確認済み')).toBeVisible();
  await parentPage.getByRole('button', { name: '自分の旅行として複製' }).click();
  await parentPage.waitForURL(/\/planner\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const forkId = new URL(parentPage.url()).pathname.split('/').pop()!;
  const forkRes = await page.request.get(`${teacher.apiBase}/plans/${forkId}`, { headers: { Authorization: `Bearer ${teacher.token}` } });
  expect([403, 404]).toContain(forkRes.status()); // 先生からは保護者の旅行が見えない

  // 3. 確認の状況と改訂
  await sendT('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '金閣寺B1E2E', local_start_time: '14:00' });
  await page.reload();
  await page.getByRole('link', { name: `「${title}」を開く` }).click();
  await expect(page.getByText('最新版(版1)を確認 1人・未確認 1人')).toBeVisible();
  await page.getByLabel('改訂の説明').fill('午後を追加');
  await page.getByRole('button', { name: '改訂する' }).click();
  await expect(page.getByRole('status')).toHaveText('版2にしました(予定の追加 1・削除 0・変更 0)');
  await expectNoAxeViolations(page, '配布(管理者)');
  await parentPage.goBack();
  await parentPage.goto(new URL(page.url()).pathname);
  await expect(parentPage.getByText('あなたの確認: 版1を確認済み・改訂があります')).toBeVisible();
  await expect(parentPage.getByText('金閣寺B1E2E')).toBeVisible();
  const fork = await sendP('get', `/plans/${forkId}`) as { days: Array<{ events: Array<{ title: string }> }> };
  expect(fork.days.flatMap((d) => d.events.map((e) => e.title))).toEqual(['清水寺B1E2E']); // 複製は変わらない

  // 4. 外部連携
  await page.goto(orgUrl);
  await page.getByLabel('連携の名前').fill('旅行会社B1');
  await page.getByRole('button', { name: 'API クライアントを作る' }).click();
  const secretBox = page.getByLabel('client_secret');
  await expect(secretBox).toBeVisible();
  const secret = await secretBox.inputValue();
  const clientId = (await page.locator('code', { hasText: /^tcc_/ }).first().textContent())!.trim();
  expect(secret).toMatch(/^tcs_/);
  await expectNoAxeViolations(page, '組織(外部連携)');
  await page.reload();
  await expect(page.getByLabel('client_secret')).toHaveCount(0); // 秘密は二度と出ない
  await expect(page.locator('body')).not.toContainText(secret);

  const ext = await browser.newContext();
  const tokenRes = await ext.request.post(`${teacher.apiBase}/oauth/token`, {
    form: { grant_type: 'client_credentials', client_id: clientId, client_secret: secret },
  });
  expect(tokenRes.status()).toBe(200);
  const tok = (await tokenRes.json()) as { access_token: string; scope: string };
  expect(tok.scope).toBe('distributions:read');
  const H = { Authorization: `Bearer ${tok.access_token}` };
  const lst = await ext.request.get(`${teacher.apiBase}/ext/distributions`, { headers: H });
  expect(lst.status()).toBe(200);
  const listed = (await lst.json()) as { distributions: Array<{ id: string; title: string; version: number }> };
  expect(listed.distributions.map((d) => [d.title, d.version])).toEqual([[title, 2]]);
  expect(await lst.text()).not.toContain(CONFIRMATION);
  const acks = await ext.request.get(`${teacher.apiBase}/ext/distributions/${listed.distributions[0]!.id}/acknowledgements`, { headers: H });
  expect(acks.status()).toBe(403);
  const bad = await ext.request.post(`${teacher.apiBase}/oauth/token`, {
    form: { grant_type: 'client_credentials', client_id: clientId, client_secret: 'tcs_wrong' },
  });
  expect(bad.status()).toBe(401);
  await ext.close();
  await parentCtx.close();
});
