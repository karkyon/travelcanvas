import type { Page, Response } from '@playwright/test';

/**
 * [Gate E1] E2E のプラン作成を1か所にまとめる。
 *
 * 以前は各 spec が「新しいプラン」ダイアログからプランを作っていた。このダイアログは
 * QuickDraft API(作成+昇格)を通り、同じ IP から 1時間に20回までという制限
 * (settings.RATE_LIMIT_QUICKDRAFT_CREATE)がある。E2E を1時間以内に2回流すと
 * 2回目の途中でこの上限に達し、約20件の spec がプラン画面への遷移待ちで
 * タイムアウトしていた(omega-dev2 の E1 v2 実行、2026-10-17)。
 *
 * ここではゲストとして開始したあと、API `POST /travel-plans/` で直接プランを作る。
 * QuickDraft のダイアログそのものは quickdraft-flow.spec.ts だけで確かめる。
 * 失敗したときは応答の状態コードと本文を必ずエラーに含める(429 なら一目で分かる)。
 */
export type GuestPlan = { planId: string; apiBase: string; token: string };

/** [Gate S11] POST /auth/guest の応答からゲストのアクセストークンを取る(画面の遷移と競合しない) */
export async function guestTokenFrom(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  const token = body && typeof body.access_token === 'string' ? body.access_token : null;
  if (!token) throw new Error(`ゲストの応答にアクセストークンがありません: ${response.status()}`);
  return token;
}

export async function startGuestPlanViaApi(
  page: Page,
  title: string,
  options: { open?: boolean } = {},
): Promise<GuestPlan> {
  const open = options.open ?? true;
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const guest = await guestResponse;
  if (!guest.ok()) {
    throw new Error(`ゲストの開始に失敗しました: ${guest.status()} ${await guest.text().catch(() => '')}`);
  }
  const apiBase = guest.url().replace(/\/auth\/guest$/, '');
  // [Gate S11] トークンは応答の本文から取る。以前は画面の遷移中に page.evaluate で localStorage を読み、
  // 「Execution context was destroyed」で1回だけ失敗することがあった(S9 の preparation、再試行で合格)
  const token = await guestTokenFrom(guest);
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const res = await page.request.post(`${apiBase}/travel-plans/`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  });
  if (!res.ok()) {
    throw new Error(`プランの作成に失敗しました: ${res.status()} ${await res.text()}`);
  }
  const planId = (await res.json()).id as string;
  if (open) {
    await page.goto(`/planner/${planId}`);
    await page.waitForURL(new RegExp(`/planner/${planId}$`), { timeout: 15_000 });
  }
  return { planId, apiBase, token };
}
