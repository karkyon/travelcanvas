import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiClient, registerMember } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate G6] 外部の判断の要らない残り(オフライン・位置・記録)を、実際のブラウザで確かめる。
 *   1. LOC-02 守る範囲: 「データとプライバシー」で自宅を守る範囲にする(中心は本人にだけ見える)
 *   2. OFF-01 端末ごとの鍵: 別の端末を失効すると、その端末は鍵を受け取れなくなる(410)
 *   3. MEM-01 旅行記の公開: 内容と確認の項目を見てから公開し、資格情報の無いブラウザで開ける。
 *      守る範囲の中の地名・座標・他のメンバーの記録は出ない。公開をやめると開けない
 *   4. MEM-01 記録の削除は「元に戻す」で戻せる
 *   5. OFF-02 通信できない間に日程を足すと端末に溜まり、通信が戻ると送られる
 */

// 1x1 の透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const HOME = { lat: 35.0116, lng: 135.7681 };

test('LOC-02・OFF-01・MEM-01 守る範囲・端末の失効・旅行記の公開と失効・削除の取り消し', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const me = await registerMember(page, 'g6m');
  const send = apiClient(page.request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: `京都G6-${Date.now()}` }) as { id: string };
  const base = `/plans/${plan.id}`;
  const d1 = await send('post', `${base}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' }) as { id: string };
  const temple = await send('post', `${base}/events`, { day_id: d1.id, title: '清水寺', local_start_time: '09:00' }) as { id: string };
  await send('post', `${base}/memories`, { body: '清水寺は朝が静かG6', event_id: temple.id, place_name: '清水の舞台',
    latitude: 34.9949, longitude: 135.785 });
  await send('post', `${base}/memories`, { body: '家の近くのパン屋G6', day_id: d1.id, place_name: '自宅の近所',
    latitude: HOME.lat, longitude: HOME.lng });
  const up = await page.request.post(`${me.apiBase}${base}/memories/upload`, {
    headers: { Authorization: `Bearer ${me.token}` },
    multipart: { kind: 'photo', event_id: temple.id, file: { name: 'a.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(up.status(), await up.text()).toBe(201);

  // 2. 別の端末(API で鍵を受け取った端末)
  const otherDevice = randomUUID();
  await send('get', `/offline-pack/key?device_id=${otherDevice}`);

  // 1. 守る範囲
  await page.goto('/settings/data');
  const zones = page.getByRole('region', { name: '守る範囲(自宅・職場など)' });
  await expect(zones.getByText('守る範囲はまだありません。')).toBeVisible();
  const form = zones.getByRole('form', { name: '守る範囲を追加する' });
  await form.getByLabel('名前').fill('自宅');
  await form.getByLabel('半径').selectOption('500');
  await form.getByLabel('中心の緯度').fill(String(HOME.lat));
  await form.getByLabel('中心の経度').fill(String(HOME.lng));
  await form.getByRole('button', { name: '守る範囲を追加する' }).click();
  await expect(zones.getByText('「自宅」を守る範囲にしました。')).toBeVisible();
  await expect(zones.getByRole('list', { name: '守る範囲の一覧' })).toContainText('自宅半径 500m中心: 35.0116, 135.7681');

  // 2. 端末の失効
  const devices = page.getByRole('region', { name: 'オフラインで使う端末' });
  const deviceList = devices.getByRole('list', { name: 'オフラインで使う端末の一覧' });
  const other = deviceList.getByRole('listitem').filter({ hasNotText: '(この端末)' });
  await expect(other).toHaveCount(1);
  await other.getByRole('button', { name: /を失効する$/ }).click();
  await expect(devices.getByText(/を失効しました。その端末は次に通信した時に保存データを消します。/)).toBeVisible();
  await expect(deviceList).toContainText('失効しました');
  const revoked = await page.request.get(`${me.apiBase}/offline-pack/key?device_id=${otherDevice}`, {
    headers: { Authorization: `Bearer ${me.token}` } });
  expect(revoked.status()).toBe(410);
  await expectNoAxeViolations(page, 'データとプライバシー(守る範囲・端末)');

  // 3. 旅行記の公開
  await page.goto(`/planner/${plan.id}/memories`);
  await expect(page.getByRole('heading', { name: '旅のあとも、地図に思い出が残る', level: 1 })).toBeVisible();
  const publish = page.getByRole('region', { name: '旅行記の公開' });
  await publish.getByLabel('地名と大まかな移動(約1km)だけ').check();
  await publish.getByLabel(/写真を含める/).check();
  await publish.getByLabel('題名(空なら旅行の名前)').fill('京都の旅行記G6');
  await publish.getByRole('button', { name: '公開する内容を確認する' }).click();
  const content = publish.getByLabel('公開する内容');
  await expect(content).toContainText('記録3件・写真1枚を公開します。守る範囲の中の地名1件は出しません。');
  const records = content.getByRole('list', { name: '公開する記録' });
  await expect(records).toContainText('清水寺は朝が静かG6(清水の舞台)');
  await expect(records).toContainText('家の近くのパン屋G6');
  await expect(records).not.toContainText('自宅の近所');
  const go = publish.getByRole('button', { name: 'この内容で公開する' });
  await expect(go).toBeDisabled();
  const acks = content.getByRole('checkbox');
  for (let i = 0; i < await acks.count(); i += 1) await acks.nth(i).check();
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page.getByRole('status').filter({ hasText: '旅行記を公開しました。URL はこの画面で今だけ表示します。' })).toBeVisible();
  const url = await publish.getByLabel('公開の URL(今だけ表示します)').inputValue();
  expect(url).toMatch(/\/journal\/[A-Za-z0-9_-]{20,}$/);
  await expect(publish.getByRole('list', { name: '公開した旅行記' })).toContainText('京都の旅行記G6');
  await expectNoAxeViolations(page, '旅の記録(旅行記の公開)');

  // 資格情報の無いブラウザで開く
  const visitor = await browser.newContext();
  const vpage = await visitor.newPage();
  await vpage.goto(url);
  await expect(vpage.getByRole('heading', { name: '京都の旅行記G6', level: 1 })).toBeVisible();
  await expect(vpage.getByText('清水寺は朝が静かG6')).toBeVisible();
  await expect(vpage.getByText('清水の舞台')).toBeVisible();
  await expect(vpage.getByText('家の近くのパン屋G6')).toBeVisible();
  await expect(vpage.getByText('自宅の近所')).toHaveCount(0);
  await expect(vpage.getByRole('img', { name: '旅の写真' })).toBeVisible();
  const body = await vpage.getByRole('article', { name: '公開した旅行記' }).innerText();
  expect(body).not.toMatch(/34\.99|135\.78|35\.01/);
  await expect(vpage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expectNoAxeViolations(vpage, '公開した旅行記');

  // 公開をやめると開けない
  await publish.getByRole('button', { name: '京都の旅行記G6の公開をやめる' }).click();
  await expect(page.getByRole('status').filter({ hasText: '「京都の旅行記G6」の公開をやめました。URL はすぐに開けなくなります。' })).toBeVisible();
  await vpage.reload();
  await expect(vpage.getByRole('alert')).toHaveText('この旅行記は見つかりません(公開が終わったか、URL が違います)。');
  await visitor.close();

  // 4. 記録の削除を元に戻す
  const day1 = page.getByRole('region', { name: '2026-11-01' });
  const bread = day1.getByRole('listitem').filter({ hasText: '家の近くのパン屋G6' });
  page.once('dialog', (d) => void d.accept());
  await bread.getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('status').filter({ hasText: '記録を削除しました(7日間は元に戻せます)' })).toBeVisible();
  await expect(bread).toHaveCount(0);
  await expect(page.getByRole('region', { name: '削除した記録' })).toContainText('メモ: 家の近くのパン屋G6');
  await page.getByRole('button', { name: '削除を元に戻す' }).click();
  await expect(page.getByRole('status').filter({ hasText: '記録を元に戻しました' })).toBeVisible();
  await expect(day1.getByRole('listitem').filter({ hasText: '家の近くのパン屋G6' })).toHaveCount(1);
  await expect(page.getByRole('region', { name: '削除した記録' })).toHaveCount(0);
});

test('OFF-02 通信できない間に足した日程を溜め、通信が戻ると送る', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `G6オフラインE2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  await send('post', `/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await page.goto(`/planner/${planId}`);
  const addDay = page.getByRole('button', { name: '＋ 日を追加' });
  await expect(addDay).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  await addDay.click();
  const bar = page.getByRole('region', { name: '同期の状態' });
  await expect(bar).toContainText('未同期の変更 1件');
  const before = await send('get', `/plans/${planId}`) as { days: unknown[] };
  expect(before.days).toHaveLength(1);

  await context.setOffline(false);
  await expect(page.getByText(/未同期の変更/)).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => ((await send('get', `/plans/${planId}`)) as { days: unknown[] }).days.length,
    { timeout: 15_000 }).toBe(2);
});
