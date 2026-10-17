import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate K1] B-008 / FR-032・FR-048 オフラインパックの鍵の browser E2E。
 *
 * 1. 会員がプランを「オフラインで使う」で保存する。端末(IndexedDB)には利用者 ID・鍵の版付きの暗号文だけがあり、
 *    旅行名は平文で残らない。
 * 2. 端末のログイン情報と鍵を消して(ログアウト相当)、ログインし直す。以前はトークンが変わると読めなかったが、
 *    同じ利用者なら同じ鍵を受け取り直せるので、backend へ届かない状態でも保存したプランを開ける。
 * 3. 設定の「全ての端末のオフラインデータを無効にする」で鍵の版を上げると、端末のデータは消え、
 *    backend へ届かない状態ではもう開けない。
 */

const PASSWORD = 'Gate-E1-TestPass-1';

async function readOfflineDb(page: Page): Promise<{ packs: Array<Record<string, unknown>>; keys: string[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('travelcanvas-offline');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const all = (store: string) => new Promise<Array<Record<string, unknown>>>((resolve) => {
      if (!db.objectStoreNames.contains(store)) { resolve([]); return; }
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
    });
    const packs = (await all('packs')).map((p) => ({
      planId: p.planId, planTitle: p.planTitle, format: p.format, userId: p.userId, keyVersion: p.keyVersion,
      ciphertextText: new TextDecoder().decode(p.ciphertext as ArrayBuffer),
    }));
    const keys = (await all('meta')).map((m) => String(m.key)).filter((k) => k.startsWith('offline-key:'));
    db.close();
    return { packs, keys };
  });
}

/** 端末のログイン情報と、端末に置いた鍵を消す(ログアウトした端末と同じ状態) */
async function signOutDevice(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.localStorage.clear();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('travelcanvas-offline');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of req.result) if (String(k).startsWith('offline-key:')) store.delete(k);
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
}

async function blockBackend(page: Page, apiBase: string): Promise<void> {
  const origin = new URL(apiBase).origin;
  await page.route(`${origin}/**`, (route) => route.abort('internetdisconnected'));
}

test('オフラインパック: 再ログインしても同じ鍵で開け、backend に届かなくても表示でき、無効化すると開けない', async ({ page }) => {
  const member = await registerMember(page, 'offline');
  const send = apiClient(page.request, member.apiBase, member.token);
  const title = `K1オフラインE2E-${Date.now()}`;
  const plan = await send('post', '/travel-plans/', { title });
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-05', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '嵐山K1', local_start_time: '10:00' });

  // 1. 保存する(暗号文には利用者・版が付き、旅行名・予定名は平文で残らない)
  await page.goto(`/planner/${plan.id}`);
  await expect(page.getByText('嵐山K1').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /オフラインで使う/ }).click();
  await expect(page.getByRole('button', { name: /オフライン保存済み/ })).toBeVisible();
  let stored = await readOfflineDb(page);
  const pack = stored.packs.find((p) => p.planId === plan.id);
  expect(pack).toMatchObject({ format: 2, keyVersion: 1 });
  expect(String(pack!.ciphertextText)).not.toContain('嵐山K1');
  expect(stored.keys.length).toBe(1);
  const localStorageDump = await page.evaluate(() => JSON.stringify(Object.entries(window.localStorage)));
  expect(localStorageDump).not.toContain('嵐山K1');

  // 2. ログアウトした端末と同じ状態にしてから、ログインし直す
  await signOutDevice(page);
  stored = await readOfflineDb(page);
  expect(stored.keys).toEqual([]);
  await page.goto('/login');
  await page.locator('#email').fill(member.email);
  await page.locator('#password').fill(PASSWORD);
  const keyFetched = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/offline-pack/key'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  const keyResponse = await keyFetched;
  expect(keyResponse.status()).toBe(200);
  expect(keyResponse.headers()['cache-control']).toBe('no-store');
  await expect.poll(async () => (await readOfflineDb(page)).keys.length).toBe(1);

  // 3. backend に届かない状態で開く → 保存したプランを表示する
  await blockBackend(page, member.apiBase);
  await page.goto(`/planner/${plan.id}`);
  await expect(page.getByText('オフラインで保存されたデータを表示しています').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('嵐山K1').first()).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  // 4. 設定から全ての端末のオフラインデータを無効にする
  await page.goto('/settings');
  await page.getByRole('button', { name: 'オフライン' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
  await expectNoAxeViolations(page, '設定(オフライン)');
  page.once('dialog', (d) => d.accept());
  const rotated = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/offline-pack/key/rotate'));
  await page.getByRole('button', { name: '全ての端末のオフラインデータを無効にする' }).click();
  expect((await rotated).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: '無効にしました' })).toBeVisible();
  await expect(page.getByText('保存されているオフラインデータはありません。')).toBeVisible();
  await expectNoAxeViolations(page, '設定(オフライン・無効化後)');
  const now = await send('get', '/offline-pack/key');
  expect(now.key_version).toBe(2);
  stored = await readOfflineDb(page);
  expect(stored.packs.filter((p) => p.planId === plan.id)).toEqual([]);

  // 5. backend に届かない状態ではもう開けない
  await blockBackend(page, member.apiBase);
  await page.goto(`/planner/${plan.id}`);
  await expect(page.getByText('プランの読み込みに失敗しました').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('嵐山K1')).toHaveCount(0);
});
