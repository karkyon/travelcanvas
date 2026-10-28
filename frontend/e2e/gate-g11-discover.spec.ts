import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G11] 発見・SNS の投稿・外部の写真・予定の写真(docs/ux/G11_UIUX全範囲_実装仕様.md §3.3、UIX-M08〜M10・M14)。
 *
 * 外部の提供元(OpenStreetMap・YouTube の oEmbed・Wikimedia Commons)へは E2E からつながない。外部に頼る応答だけを
 * 画面の通信で差し替え(gate-g9 と同じ page.route)、保存は本物の backend を通す。提供元の取り込み・ライセンス・SSRF の
 * 守りは backend の試験(test_gate_g11_discover.py、httpx.MockTransport)で確かめる。
 *
 *   1. 候補箱の「近くを探す」: 旅程の場所を基点に、カテゴリ・半径で探し、「半径内」「周辺優先」と出典を出す
 *   2. SNS の投稿: URL を確かめ、場所の候補を選んで候補箱へ(source_kind=social が本物の backend に保存される)
 *   3. 表紙の「外部の写真を探す」: ライセンスの許さない写真は取り込めず、許す写真は取り込んで表紙にできる
 *   4. 予定の写真: 予定のカードの「写真」から旅行の写真を選ぶと、カードに写真が出る
 *   5. 幅 360px で横にはみ出さない。axe 違反 0
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

async function stubNearby(page: Page) {
  await page.route('**/api/v1/search/spots', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ category: 'food', radius_km: 2, latitude: 34.9949, longitude: 135.785 });
    await route.fulfill({ json: {
      query: '', category: 'food', radius_km: 2, base: { latitude: 34.9949, longitude: 135.785 }, total: 2,
      candidates: [
        { id: 'sc-far', provider: 'nominatim', name: '遠い甘味処', category: 'cafe',
          location: { latitude: 35.005, longitude: 135.785, address: '京都市' }, retrieved_at: '2026-10-28T09:00:00+00:00',
          distance_m: 1120, within_radius: true, radius_guaranteed: false },
        { id: 'sc-near', provider: 'overpass', name: '近くの甘味処', category: 'cafe',
          location: { latitude: 34.996, longitude: 135.785, address: null }, retrieved_at: '2026-10-28T09:00:00+00:00',
          distance_m: 122, within_radius: true, radius_guaranteed: true },
      ],
    } });
  });
}

test('発見: 近くを探す・SNS の投稿・外部の写真の表紙・予定の写真', async ({ page }) => {
  test.setTimeout(180_000);
  const me = await registerMember(page, 'g11disc');
  const send = apiClient(page.context().request, me.apiBase, me.token);
  const plan = await send('post', '/travel-plans/', { title: `G11発見E2E-${Date.now()}`, destination: '京都' });
  const base = `/plans/${plan.id}`;
  const day = await send('post', `${base}/days`, { local_date: '2026-11-14', timezone_id: 'Asia/Tokyo' });
  const ev = await send('post', `${base}/events`, {
    day_id: day.id, title: '清水寺', local_start_time: '09:30', latitude: 34.9949, longitude: 135.785,
  });

  // 1. 近くを探す
  await stubNearby(page);
  await page.goto(`/planner/${plan.id}/candidates`);
  const nearby = page.getByTestId('nearby-discover');
  await expect(nearby).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('nearby-base')).toContainText('清水寺');
  await nearby.getByTestId('nearby-category-food').click();
  await nearby.getByTestId('nearby-search').click();
  const rows = nearby.getByTestId(/nearby-result-/);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('近くの甘味処');
  await expect(rows.nth(0)).toContainText('半径内 · 122m');
  await expect(rows.nth(1)).toContainText('周辺優先 · 1.1km');
  await expect(rows.nth(1)).toContainText('出典: OpenStreetMap(地名)');

  // 2. SNS の投稿
  await page.route(`**/api/v1/plans/${plan.id}/candidates/social-preview`, (route) => route.fulfill({ json: {
    platform: 'youtube', status: 'ok', url: 'https://www.youtube.com/watch?v=g11e2e', title: '京都の清水寺と甘味めぐり',
    author: '旅の記録', retrieved_at: '2026-10-28T09:30:00+00:00', reason: null, fallback: null,
    place_suggestions: [{ word: '清水寺', name: '清水寺', address: '京都市東山区', latitude: 34.9949, longitude: 135.785,
      provider: 'nominatim', confidence: 'medium' }],
  } }));
  const social = page.getByTestId('social-import');
  await social.getByTestId('social-url').fill('https://www.youtube.com/watch?v=g11e2e');
  await social.getByTestId('social-check').click();
  await expect(social.getByTestId('social-preview')).toHaveAttribute('data-status', 'ok');
  await expect(social.getByText('確からしさ 中', { exact: false })).toBeVisible();
  await social.getByTestId('social-name').fill('清水寺(動画で見た)');
  await social.getByTestId('social-save').click();
  await expect(social.getByTestId('social-save')).toHaveText('候補箱に入れました');
  const list = await send('get', `${base}/candidates`);
  const saved = list.items.find((c: { title: string }) => c.title === '清水寺(動画で見た)');
  expect(saved).toMatchObject({ source_kind: 'social', provider: 'youtube_oembed', source_url: 'https://www.youtube.com/watch?v=g11e2e' });
  await expect(page.getByText('SNS の投稿', { exact: false }).first()).toBeVisible();
  await expectNoAxeViolations(page, '候補箱(近くを探す・SNS の投稿)');

  // 3. 外部の写真の表紙(提供元の応答だけ差し替え、取り込みは本物の記録の保存で返す)
  await page.route('**/api/v1/media-providers/status', (route) => route.fulfill({ json: {
    image_providers: ['wikimedia_commons'], social_providers: ['youtube_oembed'] } }));
  await page.route('**/api/v1/media-providers/images?*', (route) => route.fulfill({ json: {
    retrieved_at: '2026-10-28T09:40:00+00:00', unavailable: [], images: [
      { provider: 'wikimedia_commons', provider_id: 'File:Kiyomizu.png', title: '清水の舞台', author: '山田', license: 'CC BY-SA 4.0',
        license_url: null, attribution: null, source_page_url: 'https://commons.wikimedia.org/wiki/File:Kiyomizu.png', width: 2,
        height: 2, mime: 'image/png', retrieved_at: '2026-10-28T09:40:00+00:00', importable: true },
      { provider: 'wikimedia_commons', provider_id: 'File:NC.png', title: '非商用の写真', author: '佐藤', license: 'CC BY-NC 4.0',
        license_url: null, attribution: null, source_page_url: null, width: 2, height: 2, mime: 'image/png',
        retrieved_at: '2026-10-28T09:40:00+00:00', importable: false },
    ] } }));
  await page.route('**/api/v1/media-providers/images/thumb?*', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route(`**/api/v1/plans/${plan.id}/memories/import-external`, async (route) => {
    const r = await page.context().request.post(`${me.apiBase}${base}/memories/upload`, {
      headers: { Authorization: `Bearer ${me.token}` },
      multipart: { kind: 'photo', include_in_journal: 'false', file: { name: 'kiyomizu.png', mimeType: 'image/png', buffer: PNG } },
    });
    await route.fulfill({ status: 201, json: await r.json() });
  });
  await page.goto(`/planner/${plan.id}`);
  const header = page.getByTestId('trip-header-cover');
  await header.getByRole('button', { name: '写真を設定' }).click();
  await page.getByTestId('cover-external').click();
  const picker = page.getByTestId('external-photo-picker');
  await picker.getByRole('button', { name: '探す' }).click();
  await expect(picker.getByTestId('external-image-File:Kiyomizu.png')).toContainText('ライセンス: CC BY-SA 4.0');
  await expect(picker.getByTestId('external-blocked-File:NC.png')).toContainText('使えないライセンス');
  await expectNoAxeViolations(page, '外部の写真を探す');
  await picker.getByTestId('external-use-File:Kiyomizu.png').click();
  await expect(page.getByTestId('cover-photo-dialog')).toBeVisible();
  await expect(page.getByText('外部の写真をこの旅行内に非公開', { exact: false })).toBeVisible();
  await page.getByTestId('cover-save').click();
  await expect(header).toHaveAttribute('data-has-photo', 'true', { timeout: 20_000 });

  // 4. 予定の写真
  const card = page.getByRole('list', { name: /の予定$/ }).getByRole('listitem', { name: '清水寺(上下矢印キーで並べ替え)' });
  await card.getByTestId(`schedule-photo-${ev.id}`).click();
  const dialog = page.getByTestId('event-photo-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId(/event-photo-choice-/).first().click();
  await dialog.getByTestId('event-photo-save').click();
  await expect(card.getByTestId('schedule-image')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => card.getByTestId('schedule-image').locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(Object.keys((await send('get', `${base}/event-images`)).images)).toEqual([ev.id]);

  // 5. 360px
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/planner/${plan.id}/candidates`);
  await expect(page.getByTestId('nearby-discover')).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page, '候補箱(360px)');
});
