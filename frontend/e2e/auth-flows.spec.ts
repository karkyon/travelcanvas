import { test, expect, type Page } from '@playwright/test';

/**
 * [Gate A1] FR-003 認証の一本化(B-002)のbrowser E2E。
 *
 * authStoreの独自fetch()をAPIクライアント経由へ置き換えたため、これまでE2Eで
 * 通していなかった「ログイン(失敗→成功)」と「ゲスト昇格」を実際の画面から確認する。
 *   1. 誤ったパスワードでは、backendのエラー文言を表示したままログイン画面に留まる
 *      (APIクライアントの共通401処理は/loginへ強制遷移=再読込するため、認証系は
 *       それを通さない。ページ内マーカーが消えないことで再読込が無いことを確認する)
 *   2. 正しいパスワードでダッシュボードへ進み、APIクライアントと状態のトークンが一致する
 *   3. ゲスト開始 → 正式アカウントへ昇格 → そのアカウントでログインできる
 *   4. ブラウザのconsoleへパスワード・メールアドレス・アクセストークンを出力しない
 *
 * 登録・ログインはbackendでIPごとに1分5回までのため、1テスト内の試行回数を抑えている。
 */

const PASSWORD = 'Gate-A1-TestPass-1';

function uniqueSuffix(label: string): string {
  return `${Date.now()}${label}${Math.floor(Math.random() * 100000)}`;
}

function collectConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => lines.push(msg.text()));
  return lines;
}

async function readAuthState(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('auth-storage');
    const persisted = raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }).state ?? {} : {};
    return { persisted, apiToken: window.localStorage.getItem('auth_token') };
  });
}

async function signOutLocally(page: Page): Promise<void> {
  // ログアウトUIはヘッダーの構成(ページごとに異なる)に依存するため、端末側の認証情報を
  // 消してから再読込する(サーバー側セッションの有無はこのテストの対象外)。
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
}

test('ログイン: 誤ったパスワードでは画面に留まりエラーを表示し、正しいパスワードでダッシュボードへ進む', async ({ page }) => {
  const consoleLines = collectConsole(page);
  const suffix = uniqueSuffix('login');
  const username = `a1login${suffix}`.slice(0, 30);
  const email = `a1-login-${suffix}@example.com`;

  // 1. 使い捨てアカウントを画面から登録する(登録直後はログイン済みになる)
  await page.goto('/register');
  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirmPassword').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });

  await signOutLocally(page);

  // 2. 誤ったパスワード: 401でもログイン画面に留まり、再読込されない
  await page.evaluate(() => {
    (window as unknown as { __a1Marker?: string }).__a1Marker = 'still-here';
  });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('wrong-password-1');
  const failed = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/login'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await failed).status()).toBe(401);

  await expect(page.getByText('メールアドレスまたはパスワードが正しくありません').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(await page.evaluate(() => (window as unknown as { __a1Marker?: string }).__a1Marker)).toBe('still-here');
  await expect(page.locator('#email')).toHaveValue(email);
  expect((await readAuthState(page)).apiToken).toBeNull();

  // 3. 正しいパスワード: ダッシュボードへ進み、状態とAPIクライアントのトークンが一致する
  await page.locator('#password').fill(PASSWORD);
  const succeeded = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/login'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect((await succeeded).status()).toBe(200);
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByText(`ようこそ、${username}さん！`)).toBeVisible();

  const { persisted, apiToken } = await readAuthState(page);
  expect(persisted.isAuthenticated).toBe(true);
  expect(persisted.isGuest).toBe(false);
  expect(typeof persisted.token).toBe('string');
  expect(apiToken).toBe(persisted.token);

  // 4. consoleへ秘匿値を出さない
  const logged = consoleLines.join('\n');
  expect(logged).not.toContain(PASSWORD);
  expect(logged).not.toContain(email);
  expect(logged).not.toContain(String(persisted.token));
});

test('ゲスト昇格: ゲスト開始から正式アカウントへ昇格し、そのアカウントでログインできる', async ({ page }) => {
  const consoleLines = collectConsole(page);
  const suffix = uniqueSuffix('up');
  const username = `a1up${suffix}`.slice(0, 30);
  const email = `a1-upgrade-${suffix}@example.com`;

  // 1. ゲスト開始
  await page.goto('/');
  const guest = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/guest'));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  expect((await guest).status()).toBe(201);
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });

  const asGuest = await readAuthState(page);
  expect(asGuest.persisted.isGuest).toBe(true);
  expect(typeof asGuest.persisted.guestToken).toBe('string');
  expect(asGuest.apiToken).toBe(asGuest.persisted.guestToken);

  // 2. 昇格(再読込後もゲストセッションが復元され、昇格画面を開ける)
  await page.goto('/guest/upgrade');
  await page.locator('#username').fill(username);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#confirmPassword').fill(PASSWORD);
  const upgraded = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/guest/upgrade'));
  await page.getByRole('button', { name: 'アカウントを作成' }).click();
  const upgradeResponse = await upgraded;
  expect(upgradeResponse.status()).toBe(200);
  expect(upgradeResponse.request().headers()['authorization']).toBe(`Bearer ${String(asGuest.persisted.guestToken)}`);
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByText(`ようこそ、${username}さん！`)).toBeVisible();

  const asMember = await readAuthState(page);
  expect(asMember.persisted).toMatchObject({ isGuest: false, guestToken: null, guestId: null, isAuthenticated: true });
  expect(typeof asMember.persisted.token).toBe('string');
  expect(asMember.apiToken).toBe(asMember.persisted.token);

  // 3. 昇格したアカウントでログインできる
  await signOutLocally(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  await expect(page.getByText(`ようこそ、${username}さん！`)).toBeVisible();

  const logged = consoleLines.join('\n');
  expect(logged).not.toContain(PASSWORD);
  expect(logged).not.toContain(email);
  expect(logged).not.toContain(String(asGuest.persisted.guestToken));
  expect(logged).not.toContain(String(asMember.persisted.token));
});
