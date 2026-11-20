import { test, expect, type APIRequestContext } from '@playwright/test';
import { tokyoDateAfter } from './support/dates';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate SpotMode] FR-060 スポットモード(SC-49)と自由に歩くエリアの準備(SC-50)の browser E2E。
 *
 * ゲストで旅行を作り、日と位置のある候補を API で用意して次を確かめる。
 *   1. 準備: 候補箱で近くにまとまった候補の案が出て、まとめてエリアにできる(時間・集合・行きたい)
 *   2. スポットモード: 予定 ⇄ スポットの切り替え・残り時間・ジャンルで絞る・一覧から選んで着いた・次どこ？・方角で見る
 *   3. タブレット横の大きさでは地図と欄が左右に並ぶ
 *   4. 各画面に axe(WCAG 2.1 AA)違反が無い
 * 地図の絵(OpenStreetMap)は CI で届かないことがあるため、印・一覧・ボタンで確かめる。
 */

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (path: string, data: unknown) => {
    const res = await request.post(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `spot-e2e-${Date.now()}-${Math.random()}` },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

test('スポットモード: 候補をエリアにまとめ、地図と一覧で気分に合わせて選び、着いたを付ける', async ({ page, context }) => {
  // 準備→スポットモード→別行動→次どこ？→タブレット横を 1 本で通し、axe を 5 回走らせる長い旅。
  // 既定の 30 秒では CI の混み具合で 1 回目だけ超える(CI #791 で 1 回目 31.2 秒・再試行 11.4 秒)ため、他の長い E2E と同じく伸ばす。
  test.setTimeout(90_000);
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `スポットE2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  // [Gate②] 旅行の日は試験を走らせる日の 30 日後(以前は 2026-11-29 の固定で、その日の CI だけ「当日」になって落ちる)
  const tripDay = tokyoDateAfter(30);
  await send(`/plans/${planId}/days`, { local_date: tripDay, timezone_id: 'Asia/Tokyo' });
  for (const [title, latitude, longitude, category] of [
    ['赤福 本店', 34.4610, 136.7247, '甘味'], ['豚捨', 34.4622, 136.7249, null],
    ['五十鈴川のカフェ', 34.4605, 136.7262, null], ['おかげ座', 34.4617, 136.7240, null],
  ] as const) {
    await send(`/plans/${planId}/candidates`, { title, latitude, longitude, ...(category ? { category } : {}) });
  }

  // 1. 準備
  await page.goto(`/planner/${planId}/spot-areas`);
  await expect(page.getByRole('heading', { name: '自由に歩くエリア', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/4 件が「赤福 本店の周り」/)).toBeVisible({ timeout: 15_000 });
  await expectNoAxeViolations(page, 'エリアの準備(案)');
  await page.getByRole('button', { name: 'まとめてエリアにする' }).click();
  const form = page.getByRole('form', { name: 'エリアの設定' });
  await form.getByLabel('エリアの名前').fill('おかげ横丁・おはらい町');
  await form.getByLabel('始まり').fill('13:00');
  await form.getByLabel('終わり').fill('15:30');
  await form.getByLabel('集合の場所(戻る場所)').fill('駐車場');
  await form.getByLabel('集合の時刻').fill('15:30');
  await form.getByRole('group', { name: '豚捨の優先' }).getByRole('button', { name: '行きたい' }).click();
  await expectNoAxeViolations(page, 'エリアの準備(設定)');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && /\/spot-areas$/.test(new URL(r.url()).pathname));
  await form.getByRole('button', { name: '保存' }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByRole('region', { name: 'おかげ横丁・おはらい町' })).toContainText('候補 4件');

  // 2. スポットモード(スマホの大きさ)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: /スポットモードで開く/ }).click();
  await expect(page.getByRole('heading', { name: 'おかげ横丁・おはらい町', level: 1 })).toBeVisible({ timeout: 15_000 });
  const nav = page.getByRole('navigation', { name: '表示の切り替え' });
  await expect(nav.getByRole('link', { name: /予定/ })).toHaveAttribute('href', `/planner/${planId}/today`);
  // CI の日付は旅行の日ではないので、残り時間ではなく時間枠を示す
  await expect(page.getByText(`当日 ${tripDay} 13:00〜15:30`)).toBeVisible();
  const list = page.getByRole('list', { name: 'エリアの候補' });
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expectNoAxeViolations(page, 'スポットモード(一覧)');

  const chips = page.getByRole('group', { name: 'ジャンルで絞る' });
  await chips.getByRole('button', { name: /カフェ/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await chips.getByRole('button', { name: 'すべて' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);

  await list.getByRole('button', { name: /豚捨/ }).click();
  const visited = page.waitForResponse((r) => r.request().method() === 'POST' && /\/visit$/.test(new URL(r.url()).pathname));
  await list.getByRole('button', { name: '着いた' }).click();
  expect((await visited).status()).toBe(200);
  await expect(list.getByRole('button', { name: /豚捨\(訪問済み\)/ })).toBeVisible();

  // 別行動: 集合の約束だけを知らせる(位置は送らない)
  const split = page.getByRole('region', { name: /別行動と集合/ });
  await split.getByRole('button', { name: '別行動にする' }).click();
  await split.getByLabel('ひとこと(任意)').fill('赤福で並びます');
  const splitRes = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/split$/.test(new URL(r.url()).pathname));
  await split.getByRole('button', { name: 'みんなに知らせる' }).click();
  expect((await splitRes).status()).toBe(200);
  await expect(split.getByRole('list', { name: '別行動の約束' })).toContainText('15:30 に 駐車場 で合流');
  await split.getByRole('button', { name: '合流した' }).click();
  await expect(split).toContainText('別行動の人はいません');

  await page.getByRole('button', { name: /次どこ？/ }).click();
  const next = page.getByRole('region', { name: '次どこ行く？' });
  await next.getByRole('button', { name: '雨・屋内' }).click();
  await expect(next.getByRole('listitem').first()).toBeVisible();
  await expect(next).not.toContainText('豚捨');
  await expectNoAxeViolations(page, 'スポットモード(次どこ？)');

  await page.getByRole('button', { name: '方角と距離で見る' }).click();
  await expect(page.getByRole('list', { name: '方角と距離' })).toBeVisible();
  await page.getByRole('button', { name: '地図で見る' }).click();

  // 3. タブレット横: 地図と欄が左右に並ぶ
  await page.setViewportSize({ width: 1194, height: 834 });
  const panel = page.getByRole('region', { name: '候補と操作' });
  const map = page.locator('.tc-spot-map');
  const pb = await panel.boundingBox();
  const mb = await map.boundingBox();
  expect(pb && mb && pb.x >= mb.x + mb.width - 1).toBeTruthy();
  await expectNoAxeViolations(page, 'スポットモード(タブレット横)');

  // 予定へ戻る
  await nav.getByRole('link', { name: /予定/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/today$`), { timeout: 15_000 });
});
