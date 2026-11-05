import { test, expect } from '@playwright/test';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate MyMaps・PhotoQR・PhotoMap・BookingImport] 新しい機能を画面で通して確かめる(外部の AI・Google へは送らない)。
 */
test('マイマップの案内・QR の投稿・写真の地図・予約メールの読み取り', async ({ page, context, browser }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `新機能E2E-${Date.now()}`, { open: false });
  const post = async (path: string, data: unknown) => {
    const res = await context.request.post(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `pf-${Date.now()}-${Math.random()}` }, data,
    });
    expect(res.ok()).toBeTruthy();
    return res.json();
  };
  const day = await post(`/plans/${planId}/days`, { local_date: '2026-04-10', timezone_id: 'Asia/Tokyo' });
  await post(`/plans/${planId}/events`, { day_id: day.id, title: '兼六園', local_start_time: '10:00', latitude: 36.5621, longitude: 136.6627 });
  await post(`/plans/${planId}/events`, { day_id: day.id, title: '美術館', local_start_time: '13:00', latitude: 36.5609, longitude: 136.6583 });

  // ① マイマップ
  await page.goto(`/planner/${planId}/exports`);
  await expect(page.getByTestId('mymaps-card')).toContainText('1. 兼六園(10:00)');
  await expect(page.getByRole('link', { name: '経路を Google マップで開く' })).toHaveAttribute('href', /google\.com\/maps\/dir/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'KML を保存する' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.kml$/);

  // ③ 予約メール
  await page.goto(`/planner/${planId}/imports`);
  await page.getByLabel('予約確認メールの本文').fill('じゃらん 予約番号: ABC12345\nチェックイン 2026年4月10日 15:00\n大人2名\n合計 ¥24,800');
  await page.getByRole('button', { name: '本文を読み取る' }).click();
  await expect(page.getByRole('dialog')).toContainText('ABC12345');
  await page.getByRole('button', { name: '確認待ちをすべて採用' }).click();
  await expect(page.getByRole('dialog')).toContainText('承認済み');

  // ② QR(別の端末 = 別のブラウザ文脈で確認コードから送る)
  await page.goto(`/planner/${planId}/memories`);
  await page.getByRole('button', { name: 'QR コードを出す' }).click();
  const code = (await page.getByTestId('photo-qr-code').innerText()).trim();
  const links = await context.request.get(`${apiBase}/plans/${planId}/upload-links`, { headers: { Authorization: `Bearer ${token}` } });
  expect(links.ok()).toBeTruthy();
  const created = await context.request.post(`${apiBase}/plans/${planId}/upload-links`, { headers: { Authorization: `Bearer ${token}` }, data: {} });
  const fresh = await created.json();
  const phone = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 800 } });
  const mobile = await phone.newPage();
  await mobile.goto(`/u/${fresh.token}`);
  await mobile.getByLabel('PC に出ている確認コード').fill(fresh.code);
  expect(code).toMatch(/^\d{6}$/);
  await mobile.getByRole('button', { name: '続ける' }).click();
  await mobile.getByTestId('upload-files').setInputFiles({
    name: 'a.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  });
  await expect(mobile.getByTestId('upload-summary')).toContainText('1 枚を送りました');
  await phone.close();

  // ② 写真の地図: 未配置の写真を予定の場所へ置く
  await page.reload();
  await page.getByTestId('memory-map-toggle').click();
  const panel = page.getByTestId('memory-map');
  await expect(panel).toContainText('確認が必要 1 枚');
  await panel.getByRole('button', { pressed: false }).first().click();
  await panel.getByLabel('予定の場所から選ぶ').selectOption({ index: 1 });
  await expect(panel).toContainText('確認が必要 0 枚');
});
