import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { registerMember } from './support/api';
import { grantAdmin, revokeAdmin } from './support/admin';
import { stepNow, totp } from './support/totp';
import { postSolvingChallenge } from './support/challenge';

/**
 * [Gate A2] FR-040 管理・監査の browser E2E。
 *
 *   1. 会員を運用の道具で管理者にする(画面・API からは付けられない)。権限が変わるとその人の端末はログアウトされる
 *   2. 管理者の画面は、多要素認証を設定するまで何も見せない(設定 → セキュリティへ案内)。設定すると見られる
 *   3. 利用者の管理: 検索 → 詳細 → 停止(確認つき)。停止した人の端末はすぐ使えなくなる。自分自身は停止できない
 *      (停止する相手はゲストにして、利用者の ID で探す。会員登録は接続元ごとに1分5回までで、他の spec の登録と重なるため)
 *   4. 監査ログ: 停止の記録が種類で絞り込めて、接続元は末尾が伏せてある
 *   各画面に axe(WCAG 2.1 AA)違反が無い
 */
const PASSWORD = 'Gate-E1-TestPass-1';

test('管理者: 多要素認証を設定するまで管理者の画面は見えず、利用者の停止と監査ログの確認ができる', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await registerMember(page, 'a2adm');
  const ctxT = await browser.newContext();
  try {
    // 停止する相手: ゲスト(/auth/me は会員だけのため、開始の応答の guest_id = 利用者の ID を使う)
    const started = await postSolvingChallenge(ctxT.request, `${admin.apiBase}/auth/guest`);
    expect(started.status()).toBe(201);
    const startedBody = await started.json();
    const target = { id: String(startedBody.guest_id), token: String(startedBody.access_token) };
    const asTarget = () => ctxT.request.get(`${admin.apiBase}/travel-plans/`, { headers: { Authorization: `Bearer ${target.token}` } });
    expect((await asTarget()).status()).toBe(200);
    grantAdmin(admin.email);

    // 1. 権限が変わったので、ログインし直す(多要素認証はまだ無いのでパスワードだけ)
    await page.goto('/login');
    await page.locator('#email').fill(admin.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });

    // 2. 多要素認証が無いと管理者の画面は見えない
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '管理者の確認' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('管理者ダッシュボード')).toHaveCount(0);
    await expectNoAxeViolations(page, '管理者の確認');
    await page.getByRole('link', { name: '多要素認証を設定する' }).click();
    await expect(page.getByRole('heading', { name: '多要素認証(認証アプリ)' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '多要素認証を設定する' }).click();
    await page.getByLabel('確認のため、現在のパスワードを入力してください').fill(PASSWORD);
    await page.getByRole('button', { name: '次へ' }).click();
    const secret = (await page.getByTestId('mfa-secret').getAttribute('data-secret')) ?? '';
    await page.getByLabel('確認コード(6桁)').fill(totp(secret, stepNow()));
    await page.getByRole('button', { name: '有効にする' }).click();
    await expect(page.getByTestId('mfa-recovery-codes').locator('li')).toHaveCount(10);
    await page.getByRole('button', { name: '保存しました' }).click();

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible({ timeout: 15_000 });
    await expectNoAxeViolations(page, '管理者ダッシュボード');

    // 3. 利用者の停止
    await page.getByRole('button', { name: /ユーザー管理/ }).click();
    await page.waitForURL(/\/admin\/users$/);
    await page.getByLabel('ユーザー名・メールアドレス・IDで検索').fill(target.id);
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: '詳細' }) });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expectNoAxeViolations(page, 'ユーザー管理');
    await row.getByRole('button', { name: '詳細' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(target.id);
    await dialog.getByRole('button', { name: /アカウント停止/ }).click();
    await dialog.getByRole('alertdialog', { name: 'アカウント停止の確認' }).getByRole('button', { name: '停止する' }).click();
    await expect(page.getByText(/^アカウントを停止しました/)).toBeVisible();
    expect((await asTarget()).status()).toBe(401);

    // 自分自身は停止できない
    await page.getByLabel('ユーザー名・メールアドレス・IDで検索').fill(admin.email);
    const own = page.getByRole('row').filter({ hasText: admin.email });
    await expect(own).toHaveCount(1, { timeout: 15_000 });
    await own.getByRole('button', { name: '詳細' }).click();
    await expect(page.getByRole('dialog')).toContainText('自分自身のアカウントはこの画面から停止・認証の切り替えができません');
    await expect(page.getByRole('dialog').getByRole('button', { name: /アカウント停止/ })).toBeDisabled();
    await page.keyboard.press('Escape');

    // 4. 監査ログ
    await page.goto('/admin/audit-logs');
    await expect(page.getByLabel('種類', { exact: true }).locator('option', { hasText: 'admin_user_suspend' })).toHaveCount(1, { timeout: 15_000 });
    await page.getByLabel('種類', { exact: true }).selectOption('admin_user_suspend');
    await page.getByRole('button', { name: '絞り込む' }).click();
    const table = page.getByRole('table', { name: '監査ログの一覧' });
    await expect(table).toContainText('admin_user_suspend');
    // 接続元の列(5列目)は末尾が伏せてある
    await expect(table.locator('tbody tr').first().locator('td').nth(4)).toHaveText(/^(\d+\.\d+\.\d+\.x|[0-9a-f:]+::x)$/);
    await expectNoAxeViolations(page, '監査ログ');
  } finally {
    await ctxT.close();
    revokeAdmin(admin.email);
  }
});
