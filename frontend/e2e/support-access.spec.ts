import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';
import { grantAdmin, revokeAdmin } from './support/admin';
import { stepNow, totp } from './support/totp';

/**
 * [Gate G2] FR-040 サポート閲覧(本人の同意・目的・時間制限・読み取り専用・監査)と運用の要約の browser E2E。
 *
 *   1. 利用者が「設定 → サポート」で、旅行1つを目的・期限・パスワードつきでサポートに見せる許可を作る
 *   2. 管理者(多要素認証あり)が「運用とサポート」で、運用の要約と許可を見て、読み取り専用で閲覧する。
 *      メモ・住所・予約番号は出ない。閲覧は監査ログに残る(support_grant_accessed)
 *   3. 利用者の画面に閲覧の回数が出て、知らせが届く。利用者が取り消すと、管理者は見られない
 *   各画面に axe(WCAG 2.1 AA)違反が無い
 */
const PASSWORD = 'Gate-E1-TestPass-1';
const NOTE = '集合はG2サポート裏口';
const CONF = 'G2SUP-1111-2222';

async function becomeAdminWithMfa(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  await page.goto('/settings?tab=security');
  await page.getByRole('button', { name: '多要素認証を設定する' }).click();
  await page.getByLabel('確認のため、現在のパスワードを入力してください').fill(PASSWORD);
  await page.getByRole('button', { name: '次へ' }).click();
  const secret = (await page.getByTestId('mfa-secret').getAttribute('data-secret')) ?? '';
  await page.getByLabel('確認コード(6桁)').fill(totp(secret, stepNow()));
  await page.getByRole('button', { name: '有効にする' }).click();
  await expect(page.getByTestId('mfa-recovery-codes').locator('li')).toHaveCount(10);
  await page.getByRole('button', { name: '保存しました' }).click();
}

test('サポート閲覧: 本人が目的・期限つきで許可し、管理者は読み取り専用で見て、閲覧は記録され本人に知らされる', async ({ page, browser }) => {
  test.setTimeout(200_000);
  const user = await registerMember(page, 'g2sup');
  const send = apiClient(page.context().request, user.apiBase, user.token);
  const title = `G2サポートE2E-${Date.now()}`;
  const plan = await send('post', '/travel-plans/', { title });
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '銀閣寺G2', local_start_time: '09:00', description: NOTE });
  await send('post', `/plans/${plan.id}/reservations`, { type: 'accommodation', provider_name: '宿G2SUP', confirmation_number: CONF });

  // 1. 許可を作る
  await page.goto('/settings?tab=support');
  const form = page.getByRole('form', { name: 'サポートへの閲覧を許可する' });
  await form.getByLabel('目的(担当者に伝わります)').fill('予約が表示されない件の調査');
  await form.getByLabel('見せる範囲').selectOption({ label: `旅行「${title}」の中身` });
  await form.getByLabel(/期間/).fill('2');
  await form.getByLabel('本人確認のためのパスワード').fill(PASSWORD);
  await form.getByRole('button', { name: '許可する' }).click();
  await expect(page.getByText('サポートへの閲覧を許可しました')).toBeVisible();
  await expect(page.getByText(`旅行「${title}」・有効`)).toBeVisible();
  await expectNoAxeViolations(page, 'サポートへの閲覧の許可');

  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const admin = await registerMember(pageA, 'g2supadm');
  try {
    grantAdmin(admin.email);
    await becomeAdminWithMfa(pageA, admin.email);

    // 2. 管理者が見る
    await pageA.goto('/admin/support');
    await expect(pageA.getByRole('heading', { name: '運用とサポート' })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText('有効な共有リンク', { exact: true }).first()).toBeVisible();
    await expectNoAxeViolations(pageA, '運用とサポート');
    await pageA.getByRole('button', { name: new RegExp(`の許可\\(旅行「${title}」\\)で閲覧する`) }).click();
    const view = pageA.getByLabel('旅行の内容(読み取り専用)');
    await expect(view).toContainText('銀閣寺G2', { timeout: 15_000 });
    await expect(view).toContainText('予約番号 伏せています');
    await expect(view).toContainText('メモあり');
    await expect(pageA.locator('body')).not.toContainText(NOTE);
    await expect(pageA.locator('body')).not.toContainText(CONF);
    await pageA.goto('/admin/audit-logs');
    await pageA.getByLabel('種類', { exact: true }).selectOption('support_grant_accessed');
    await pageA.getByRole('button', { name: '絞り込む' }).click();
    await expect(pageA.getByRole('table', { name: '監査ログの一覧' })).toContainText('support_grant_accessed');

    // 3. 本人: 回数と知らせ。取り消すと管理者は見られない
    await page.reload();
    await expect(page.getByText(/閲覧 1回/)).toBeVisible({ timeout: 15_000 });
    const notes = await send('get', '/notifications');
    expect(JSON.stringify(notes)).toContain('サポートがあなたの情報を閲覧しました');
    await page.getByRole('button', { name: '「予約が表示されない件の調査」の許可を取り消す' }).click();
    await expect(page.getByText('許可を取り消しました')).toBeVisible();
    await pageA.goto('/admin/support');
    await expect(pageA.getByText('有効な許可はありません。')).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctxA.close();
    revokeAdmin(admin.email);
  }
});
