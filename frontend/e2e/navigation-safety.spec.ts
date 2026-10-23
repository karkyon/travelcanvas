import { test, expect } from '@playwright/test';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient } from './support/api';

/**
 * [Gate G3] DEP-02 悪意のある移動先・リンクで外部へ飛ばない・スクリプトが動かないことを、実際のブラウザで確かめる。
 *   1. `//`・`\`・符号化した区切り・制御文字を含むパスを開いても、画面の外(別のオリジン)へ移らない
 *   2. サーバーから `javascript:` の URL が届いても、リンクにしない(押してもスクリプトが動かない)
 */
test('悪意のある移動先で画面の外へ移らない', async ({ page }) => {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  for (const path of ['//evil.example/x', '/\\evil.example', '/%2F%2Fevil.example', '/%5Cevil.example',
    '/%09/evil.example', '/planner/%2F%2Fevil.example']) {
    await page.goto(origin + path);
    await expect.poll(() => new URL(page.url()).origin).toBe(origin);
    await expect(page.locator('body')).toBeVisible();
  }
});

test('サーバーから javascript: の URL が届いてもリンクにしない', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `G3移動先E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  await send('post', `/plans/${planId}/candidates`, { title: '危険なリンクの候補', source_url: 'https://example.com/ok' });
  // 応答の出典を javascript: に書き換える(サーバーの検査をすり抜けた値が届いた場合を作る)
  await page.route(`**/api/v1/plans/${planId}/candidates**`, async (route) => {
    const res = await route.fetch();
    const body = await res.json() as Record<string, unknown>;
    const text = JSON.stringify(body).split('https://example.com/ok').join('javascript:window.__pwned=1');
    await route.fulfill({ response: res, body: text, headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  let dialog = false;
  page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
  await page.goto(`/planner/${planId}/candidates`);
  const card = page.getByRole('article', { name: '危険なリンクの候補' });
  await expect(card).toBeVisible();
  await expect(card.locator('a[href^="javascript:" i]')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0);
  // 出典の行(候補の名前には「出典」を含めない。strict mode で1つに決まるように)
  await card.getByText(/・出典/).click();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(dialog).toBe(false);
});
