import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { registerMember } from './support/api';
import { grantAdmin, revokeAdmin } from './support/admin';
import { stepNow, totp } from './support/totp';

/**
 * [Gate OpsCMS] 運用コンソールの browser E2E(本物の backend。外部の API へは送らない)。
 *
 *   1. 管理者(多要素認証あり)だけが /admin/ops を開ける。有料の提供元が未接続であることを帯で示す
 *   2. API・契約と接続: 提供元ごとに契約は未確認・鍵の値は出さない・送信は無効
 *   3. テスト実行: 枚方発・大人4人の家族旅行の条件で Fake の試験 → 50円を越えず、40円・45円の段と、送る前に断った理由が出る
 *   4. 原価・利用台帳に試験の旅行が「Fake の試験」として載る(旅行の題は出さない)
 *   各画面に axe(WCAG 2.1 AA)違反が無く、390px で横にはみ出さない
 */
const PASSWORD = 'Gate-E1-TestPass-1';

async function noOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where}: 横にはみ出している`).toBeLessThanOrEqual(1);
}

test('運用コンソール: 未接続の明示・鍵を出さない・Fake の家族旅行の試験で 50円を越えない', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = await registerMember(page, 'opscms');
  grantAdmin(admin.email);
  try {
    await page.goto('/login');
    await page.locator('#email').fill(admin.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '管理者の確認' })).toBeVisible({ timeout: 15_000 });
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

    // 1. 概要
    await page.goto('/admin/ops');
    await expect(page.getByRole('heading', { level: 1, name: '運用の状態を、ひと目で。' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('有料の外部 API はまだ接続していません。')).toBeVisible();
    await expect(page.getByText('今月の Fake の試験の額')).toBeVisible();
    await expect(page.getByText(/Cloud Billing の請求額・予算はアプリから取得していません/)).toBeVisible();
    await expectNoAxeViolations(page, '運用コンソール(概要)');

    // 2. 提供元
    await page.getByRole('tab', { name: 'API・契約と接続' }).click();
    const openai = page.getByTestId('ops-provider-openai');
    await expect(openai).toContainText('契約・課金は未確認');
    await expect(openai).toContainText('無効(送らない)');
    await expect(page.getByTestId('ops-provider-fake')).toContainText('試験用(外へ送らない)');
    expect(await page.content()).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    await expectNoAxeViolations(page, '運用コンソール(提供元)');

    // 3. Fake の家族旅行の試験
    await page.getByRole('tab', { name: 'テスト実行' }).click();
    await expect(page.getByText('大阪府枚方市 · 大人4人')).toBeVisible();
    await page.getByRole('button', { name: 'Fake で原価の上限を試す' }).click();
    const summary = page.getByTestId('ops-run-summary');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    const total = await summary.locator('li').first().locator('b').innerText();
    const [used, cap] = total.split('/').map((t) => Number(t.replace(/[¥,\s]/g, '')));
    expect(cap).toBe(50);
    expect(used).toBeLessThanOrEqual(50);
    expect(used).toBeGreaterThanOrEqual(45);
    await expect(summary).toContainText('上限を越えなかったはい');
    await expect(summary).toContainText('0回');
    await expect(summary).toContainText('二重に数えない');
    await expectNoAxeViolations(page, '運用コンソール(Fake の試験)');

    // 4. 台帳
    await page.getByRole('tab', { name: '原価・利用台帳' }).click();
    await expect(page.getByText('Fake の試験').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('[運用の試験]')).toHaveCount(0);

    // スマホの幅
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: '概要' }).click();
    await expect(page.getByText('今月の Fake の試験の額')).toBeVisible();
    await noOverflow(page, '運用コンソール(390px)');
  } finally {
    revokeAdmin(admin.email);
  }
});
