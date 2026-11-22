import { test, expect } from '@playwright/test';
import { tokyoDateAfter } from './support/dates';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [FR-061] 日帰り: 日帰りの旅行 → ルートを計算(CI は外の道路のルートが無いので直線の予備)→ ルートの画面 →
 * ジャンルを選ぶ → 予定に入れる → 旅程に出る。
 * ルートの近くの店の検索は、CI では提供元の鍵が無いため、画面の受け取りの所で模擬の結果を返す(提供元は模擬)。
 * 地図の絵(OpenStreetMap)は CI で届かないことがあるため、一覧・ボタン・文で確かめる。
 */
test('日帰り: ルートの画面でジャンルを選び、寄り道を予定に入れると旅程に出る', async ({ page, context }) => {
  test.setTimeout(90_000);
  const { apiBase, token } = await startGuestPlanViaApi(page, `日帰りE2E-下準備-${Date.now()}`, { open: false });
  const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': `dt-e2e-${Date.now()}` };
  const day = tokyoDateAfter(30);
  const created = await context.request.post(`${apiBase}/travel-plans/`, { headers,
    data: { title: '桂坂・西山の森へ日帰り', start_date: `${day}T00:00:00+09:00`, end_date: `${day}T00:00:00+09:00`, trip_style: 'day_trip' } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const planId = (await created.json()).id as string;
  const dayRes = await context.request.post(`${apiBase}/plans/${planId}/days`, { headers: { ...headers, 'Idempotency-Key': `dt-day-${Date.now()}` },
    data: { local_date: day, timezone_id: 'Asia/Tokyo' } });
  expect(dayRes.ok(), await dayRes.text()).toBeTruthy();
  const route = await context.request.post(`${apiBase}/plans/${planId}/day-trip/route`, { headers: { ...headers, 'Idempotency-Key': `dt-r-${Date.now()}` },
    data: { origin: { label: '現在地のあたり', lat: 34.99, lng: 135.70 }, destination: { label: '桂坂野鳥遊園', lat: 34.98, lng: 135.66 },
      road: 'auto', depart_at: '09:00', home_by: '19:00' } });
  expect(route.ok(), await route.text()).toBeTruthy();

  await page.route('**/day-trip/along**', async (r) => {
    const genres = new URL(r.request().url()).searchParams.get('genres') ?? '';
    const cafe = { name: '森のカフェ', genre: 'cafe', genre_label: 'カフェ', lat: 34.985, lng: 135.68, address: '京都市西京区', off_m: 300,
      at_km: 2.1, detour_min: null, exit_unknown: false, providers: ['openstreetmap'], saved_spot_id: null, stay_min: 40, score: 0.7,
      reasons: [] };
    await r.fulfill({ json: { region_label: '', width_m: 1000, leg: 'out', total_km: 3.7, results: genres.includes('cafe') ? [cafe] : [],
      wishes_near: [], profile_line: null, personalized: true, source: [], keyed_providers: [], failed_providers: [], straight: true, cached: false } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/planner/${planId}/day-trip`);
  await expect(page.getByRole('heading', { name: 'ルートと寄り道', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('dt-straight')).toContainText('直線');
  await expect(page.getByText('森のカフェ', { exact: false })).toBeVisible();
  await page.getByTestId('dt-genre-cafe').click();  // 外す → 0 件
  await expect(page.getByTestId('dt-empty')).toBeVisible();
  await page.getByTestId('dt-genre-cafe').click();  // 戻す
  await expect(page.getByText('森のカフェ', { exact: false })).toBeVisible();
  await expectNoAxeViolations(page, 'ルートと寄り道');
  const add = page.waitForResponse((r) => r.request().method() === 'POST' && new RegExp(`/plans/${planId}/events$`).test(new URL(r.url()).pathname));
  await page.getByTestId('dt-add-0').click();
  expect((await add).status()).toBe(201);
  await expect(page.getByTestId('dt-add-0')).toHaveText(/予定に入れました/);
  await page.goto(`/planner/${planId}`);
  await expect(page.getByText('森のカフェ').first()).toBeVisible({ timeout: 15_000 });
});
