import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerAccount } from './support/api';

/**
 * [Gate PageAlign] 画面の見出しの位置と字をそろえる。
 * 以前は旅行相談・制約・相談・しおり・設定など約 30 の画面が、中央寄せの狭い箱(max-w-* mx-auto)と 24〜30px の太字の見出しで作られ、
 * ホーム・旅行・行きたい場所などと比べて左端が右へずれ(1920px の画面で最大 +470px)、見出しの字も違っていた。
 * ここでは、見出し(h1)の左端と字の大きさ・太さが、ホーム(/dashboard)と同じかを確かめる。
 * 旅程の表紙(/planner/:id。写真の帯の中の題)と当日の画面(/today。片手で見る小さな題)は、作りが違うので対象外。
 */
const PASSWORD = 'Gate-PageAlign-TestPass-1';

async function measure(page: Page, path: string) {
  await page.goto(path);
  const h = page.locator('main h1').first();
  await expect(h).toBeVisible({ timeout: 15_000 });
  return h.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { x: Math.round(el.getBoundingClientRect().left), size: cs.fontSize, weight: cs.fontWeight };
  });
}

test('ホームと同じ左端・同じ字で見出しを出す(以前の作りの画面も含む)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const a = await registerAccount(page, { prefix: 'align', label: 'wide', password: PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  const p = (await send('post', '/travel-plans/', { title: `見出し-${Date.now()}` }) as { id: string }).id;
  const base = await measure(page, '/dashboard');
  expect(base.size).toBe('27px');
  const paths = ['/planner', '/memories', '/spots', '/search', '/trip-consult', `/planner/${p}/kit`, `/planner/${p}/reservations`,
    `/planner/${p}/constraints`, `/planner/${p}/discussion`, `/planner/${p}/booklet`, `/planner/${p}/exports`, `/planner/${p}/alerts`,
    `/planner/${p}/segments`, `/planner/${p}/track`, `/planner/${p}/journey`, `/planner/${p}/visits`, `/planner/${p}/memory-replan`,
    '/organizations', '/settings', '/search/settings', '/settings/data', '/atlas', '/notifications', '/optimization'];
  const off: string[] = [];
  for (const path of paths) {
    const m = await measure(page, path);
    if (m.x !== base.x || m.size !== base.size || m.weight !== base.weight) off.push(`${path.replace(p, ':id')} x=${m.x} ${m.size} ${m.weight}`);
  }
  expect(off, `ホーム: x=${base.x} ${base.size} ${base.weight}`).toEqual([]);
});

test('スマホの幅でも、見出しの字(22px)と左端がそろう', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await registerAccount(page, { prefix: 'align', label: 'phone', password: PASSWORD });
  const base = await measure(page, '/dashboard');
  for (const path of ['/trip-consult', '/settings', '/organizations', '/notifications']) {
    const m = await measure(page, path);
    expect({ path, x: m.x, size: m.size }).toEqual({ path, x: base.x, size: '22px' });
  }
});
