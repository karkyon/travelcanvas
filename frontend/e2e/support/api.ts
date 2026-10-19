import { test, type APIRequestContext, type Page } from '@playwright/test';

/** [Gate E1] E2E の下準備を API で行うための小さな呼び出し口。失敗時は状態コードと本文を出す */
export type Send = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  data?: unknown,
  extra?: Record<string, string>,
) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function apiClient(request: APIRequestContext, base: string, token: string): Send {
  return async (method, path, data, extra = {}) => {
    const res = await request[method](`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `e1-${Date.now()}-${Math.random()}`, ...extra },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status()}: ${body}`);
    return body ? JSON.parse(body) : null;
  };
}

export interface RegisteredAccount {
  email: string;
  username: string;
  apiBase: string;
  token: string;
}

const RATE_WINDOW_MS = 61_000;

/**
 * [Gate A2] 画面から会員登録する(全ての spec の会員登録はここを通す)。
 *
 * - 計算の確認(428): 接続元の点数が高い時(他の試験の失敗・再試行の後)は、画面が自動で解いて送り直す。最後の応答を待つ
 * - 回数制限(429「登録試行回数が上限」): 登録は接続元ごとに1分5回まで(backend RATE_LIMIT_AUTH)。E2E は1つの接続元から
 *   多くの会員を作るため、試験の速さによって別の spec の登録と同じ1分に重なる(omega-dev2 で collaboration・document-wallet が
 *   落ちた)。回数制限は変えず、1分の枠が過ぎるのを待ってからやり直す(最大2回。待つ分だけ試験の時間を延ばす)
 */
export async function registerAccount(
  page: Page, opts: { prefix: string; password: string; label?: string },
): Promise<RegisteredAccount> {
  for (let attempt = 0; ; attempt++) {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const email = `${opts.prefix}${opts.label ? `-${opts.label}` : ''}-${suffix}@example.com`;
    const username = `${opts.prefix}${opts.label ?? ''}${suffix}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30);
    await page.goto('/register');
    await page.locator('#username').fill(username);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(opts.password);
    await page.locator('#confirmPassword').fill(opts.password);
    const registered = page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/auth/register') && r.status() !== 428, { timeout: 90_000 });
    await page.getByRole('button', { name: 'Create Account' }).click();
    const res = await registered;
    const text = res.ok() ? '' : await res.text().catch(() => '');
    if (res.status() === 429 && text.includes('登録試行回数') && attempt < 2) {
      test.info().setTimeout(test.info().timeout + RATE_WINDOW_MS + 15_000);
      await page.waitForTimeout(RATE_WINDOW_MS);
      continue;
    }
    if (!res.ok()) throw new Error(`会員登録に失敗しました: ${res.status()} ${text}`);
    await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
    const apiBase = res.url().replace(/\/auth\/register$/, '');
    // [Gate S5] 会員のアクセストークンは端末に保存しないので、登録の応答から受け取る
    const token = String((await res.json()).access_token ?? '');
    if (!token) throw new Error('会員登録の応答にアクセストークンがありません');
    return { email, username, apiBase, token };
  }
}

/** 画面から会員登録し、API の基底 URL とアクセストークンを返す(メール確認は不要な実装) */
export async function registerMember(page: Page, label: string): Promise<{ email: string; apiBase: string; token: string }> {
  const a = await registerAccount(page, { prefix: 'e1', label, password: 'Gate-E1-TestPass-1' });
  return { email: a.email, apiBase: a.apiBase, token: a.token };
}
