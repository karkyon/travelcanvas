import type { APIRequestContext, Page } from '@playwright/test';

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

/** 画面から会員登録し、API の基底 URL とアクセストークンを返す(メール確認は不要な実装) */
export async function registerMember(page: Page, label: string): Promise<{ email: string; apiBase: string; token: string }> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `e1${label}-${suffix}@example.com`;
  await page.goto('/register');
  await page.locator('#username').fill(`e1${label}${suffix}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30));
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('Gate-E1-TestPass-1');
  await page.locator('#confirmPassword').fill('Gate-E1-TestPass-1');
  const registered = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/auth/register'));
  await page.getByRole('button', { name: 'Create Account' }).click();
  const res = await registered;
  if (!res.ok()) throw new Error(`会員登録に失敗しました: ${res.status()} ${await res.text().catch(() => '')}`);
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  const apiBase = res.url().replace(/\/auth\/register$/, '');
  const token = await page.evaluate(() => window.localStorage.getItem('auth_token'));
  if (!token) throw new Error('会員のアクセストークンがlocalStorage(auth_token)にありません');
  return { email, apiBase, token };
}
