import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G2] FR-042 外部連携の秘密の切り替え(猶予つき)・前の秘密の即時の失効・書き込みの API の browser E2E。
 *
 *   1. 組織の画面で API クライアント(distributions:read・write)を作り、「秘密を切り替える」で新しい秘密を1回だけ見る
 *   2. 猶予の間は前の秘密でも新しい秘密でもトークンを取れる。「前の秘密をすぐ失効」で前の秘密は使えなくなる
 *   3. 書き込みの API: Idempotency-Key と If-Match が要る。同じキーの再送は同じ応答
 */
test('外部連携: 秘密を猶予つきで切り替え、前の秘密をすぐ失効でき、書き込みの API は冪等で版を確かめる', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const owner = await registerMember(page, 'g2org');
  const send = apiClient(page.context().request, owner.apiBase, owner.token);
  const plan = await send('post', '/travel-plans/', { title: `G2連携E2E-${Date.now()}` });
  const org = await send('post', '/organizations', { name: `G2連携組織${Date.now() % 100000}`, brand_color: '#1D4ED8' });
  const dist = await send('post', `/organizations/${org.id}/distributions`, { plan_id: plan.id });
  await page.goto(`/organizations/${org.id}`);
  await page.getByLabel('連携の名前').fill('旅行会社G2');
  for (const scope of await page.getByRole('group', { name: 'スコープ' }).getByRole('checkbox').all()) await scope.check();
  await page.getByRole('button', { name: 'API クライアントを作る' }).click();
  const oldSecret = await page.getByLabel('client_secret').inputValue();
  const clientId = (await page.locator('code', { hasText: /^tcc_/ }).first().textContent())!.trim();

  await page.getByRole('button', { name: 'API クライアント「旅行会社G2」の秘密を切り替える' }).click();
  await expect(page.getByText(/前の秘密は .* まで使えます/)).toBeVisible({ timeout: 15_000 });
  const newSecret = await page.getByLabel('client_secret').inputValue();
  expect(newSecret).toMatch(/^tcs_/);
  expect(newSecret).not.toBe(oldSecret);

  const ext = await browser.newContext();
  const token = (secret: string) => ext.request.post(`${owner.apiBase}/oauth/token`, {
    form: { grant_type: 'client_credentials', client_id: clientId, client_secret: secret },
  });
  try {
    expect((await token(oldSecret)).status()).toBe(200);
    const fresh = await token(newSecret);
    expect(fresh.status()).toBe(200);
    const H = { Authorization: `Bearer ${(await fresh.json()).access_token}` };

    // 書き込み
    const url = `${owner.apiBase}/ext/distributions/${dist.id}`;
    const got = await ext.request.get(url, { headers: H });
    const etag = got.headers()['etag']!;
    expect((await ext.request.patch(url, { headers: H, data: { title: 'x' } })).status()).toBe(400);
    const key = `g2-e2e-${Date.now()}`;
    expect((await ext.request.patch(url, { headers: { ...H, 'Idempotency-Key': key }, data: { title: 'x' } })).status()).toBe(428);
    const first = await ext.request.patch(url, { headers: { ...H, 'Idempotency-Key': `${key}-ok`, 'If-Match': etag },
      data: { title: '修学旅行(改)', change_note: '集合時刻を変更' } });
    expect(first.status()).toBe(200);
    const again = await ext.request.patch(url, { headers: { ...H, 'Idempotency-Key': `${key}-ok`, 'If-Match': etag },
      data: { title: '修学旅行(改)', change_note: '集合時刻を変更' } });
    expect(again.status()).toBe(200);
    expect(again.headers()['idempotent-replayed']).toBe('true');
    expect(await again.json()).toEqual(await first.json());

    await page.getByRole('button', { name: 'API クライアント「旅行会社G2」の前の秘密をすぐ失効する' }).click();
    await expect(page.getByText('前の秘密と、発行済みのトークンを失効しました')).toBeVisible();
    expect((await token(oldSecret)).status()).toBe(401);
    expect((await token(newSecret)).status()).toBe(200);
  } finally {
    await ext.close();
  }
});
