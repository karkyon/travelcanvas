import { createHmac } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { registerMember } from './support/api';

/**
 * [Gate S11] SEC-06 多要素認証(TOTP)の browser E2E。
 *
 * 会員登録 → 設定 → セキュリティで認証アプリを登録(QR は端末内で作る・手入力用のキー)→ 確認コードで有効化
 * → 回復コードの表示 → 別の端末(新しいブラウザの文脈)でログインすると、パスワードの後に確認コードを
 * 求められ、正しい確認コードでダッシュボードへ入れる。確認コードは試験の中で RFC 6238 の手順で計算する。
 * 誤った確認コードは試さない(接続元の点数が上がり、後に動く spec の API 呼び出しが計算の確認を求められるため。
 * 誤りの扱いは backend の test_gate_s11_admin_mfa.py が確かめる)。
 */
const PASSWORD = 'Gate-E1-TestPass-1';

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('base32 ではない文字');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

const stepNow = () => Math.floor(Date.now() / 1000 / 30);

/** 同じ確認コードは2回使えないため、登録に使った区切りの次の区切りになるまで待つ */
async function waitForNextStep(after: number): Promise<number> {
  await expect.poll(stepNow, { timeout: 35_000, intervals: [1_000] }).toBeGreaterThan(after);
  return stepNow();
}

async function openSecurityTab(page: Page) {
  await page.goto('/settings?tab=security');
  await expect(page.getByRole('heading', { name: '多要素認証(認証アプリ)' })).toBeVisible({ timeout: 15_000 });
}

test('多要素認証: 設定して有効にすると、次のログインでは確認コードが必要になる', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const member = await registerMember(page, 'mfa');

  // 1. 設定 → セキュリティ: 未設定 → パスワードで再認証 → QR と手入力用のキー
  await openSecurityTab(page);
  await expect(page.getByTestId('mfa-state')).toHaveText('未設定');
  await page.getByRole('button', { name: '多要素認証を設定する' }).click();
  await page.getByLabel('確認のため、現在のパスワードを入力してください').fill(PASSWORD);
  await page.getByRole('button', { name: '次へ' }).click();
  const secretEl = page.getByTestId('mfa-secret');
  await expect(secretEl).toBeVisible();
  const secret = (await secretEl.getAttribute('data-secret')) ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const qr = page.getByRole('img', { name: '認証アプリに登録する QR コード' });
  await expect(qr).toBeVisible();
  // QR は端末内で作る(秘密を外部のサービスへ送らない)
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  await expectNoAxeViolations(page, '多要素認証の設定');

  // 2. 認証アプリの確認コードで有効にする → 回復コード(1回だけ表示)
  const enabledStep = stepNow();
  await page.getByLabel('確認コード(6桁)').fill(totp(secret, enabledStep));
  await page.getByRole('button', { name: '有効にする' }).click();
  const codes = page.getByTestId('mfa-recovery-codes').locator('li');
  await expect(codes).toHaveCount(10);
  await expectNoAxeViolations(page, '回復コード');
  await page.getByRole('button', { name: '保存しました' }).click();
  await expect(page.getByTestId('mfa-state')).toContainText('有効');
  await expect(page.getByTestId('mfa-state')).toContainText('回復コードの残り 10 個');

  // 3. 別の端末でログイン: パスワードの後に確認コードを求める(この時点ではログインしていない)
  const other = await browser.newContext();
  const page2 = await other.newPage();
  try {
    await page2.goto('/login');
    await page2.locator('#email').fill(member.email);
    await page2.locator('#password').fill(PASSWORD);
    const loginResponse = page2.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/login'));
    await page2.getByRole('button', { name: 'Sign in' }).click();
    const login = await loginResponse;
    expect(await login.json()).toMatchObject({ mfa_required: true });
    const codeInput = page2.getByRole('textbox', { name: '確認コード' });
    await expect(codeInput).toBeVisible();
    await expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(page2).toHaveURL(/\/login$/);
    await expectNoAxeViolations(page2, 'ログインの確認コード');
    expect((await other.cookies()).some((c) => c.name === 'refresh_token')).toBe(false);

    // 4. 次の区切りの確認コードでログインを完了する
    const step = await waitForNextStep(enabledStep);
    const verified = page2.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/mfa/verify'));
    await codeInput.fill(totp(secret, step));
    await page2.getByRole('button', { name: '確認してログイン' }).click();
    expect((await verified).status()).toBe(200);
    await page2.waitForURL(/\/dashboard$/, { timeout: 15_000 });
    expect((await other.cookies()).some((c) => c.name === 'refresh_token')).toBe(true);
  } finally {
    await other.close();
  }
});
