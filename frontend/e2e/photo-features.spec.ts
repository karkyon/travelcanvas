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
  await page.getByLabel('予約確認メールの本文を貼る').fill('●予約番号：ABC12345\n●施設名：都リゾート 奥志摩\n●チェックイン日：2026年4月10日(金)\n●チェックイン可能時間：15:00～18:00\n●チェックアウト日：2026年4月11日(土)\n●チェックアウト時間：～11:00\n●食事：夕朝食付\n●お部屋：ツイン\n●宿泊人数：大人2名');
  await page.getByRole('button', { name: '本文を読み取る' }).click();
  await expect(page.getByLabel('施設・事業者の名前')).toHaveValue('都リゾート 奥志摩');
  await expect(page.getByLabel('開始(チェックイン・出発)')).toHaveValue('2026-04-10T15:00');
  await page.getByTestId('booking-review-submit').click();
  await expect(page).toHaveURL(/reservations/);
  await expect(page.getByText('都リゾート 奥志摩').first()).toBeVisible();
  await expect(page.getByTestId('reservation-notes').first()).toContainText('部屋: ツイン');

  // 旅行の基本情報: 日程を変えると予定も動く
  await page.goto(`/planner/${planId}`);
  await page.getByTestId('plan-basics-open').click();
  await page.getByLabel('出発日').fill('2026-05-01');
  await page.getByLabel('最終日').fill('2026-05-02');
  await page.getByLabel('人数').fill('4');
  await page.getByTestId('plan-basics-save').click();
  await expect(page.getByRole('heading', { name: /2026-05-01/ }).or(page.getByText(/2026-05-01/).first())).toBeVisible();
  await page.getByTestId('plan-basics-open').click();
  await page.getByRole('button', { name: 'キャンセル' }).click();

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
  await panel.getByRole('list', { name: '写真の一覧' }).getByRole('button').first().click();
  await panel.getByLabel('予定の場所から選ぶ').selectOption({ index: 1 });
  await expect(panel).toContainText('確認が必要 0 枚');
});
