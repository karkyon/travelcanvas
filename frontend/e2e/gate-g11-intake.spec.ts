import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G11] 段階5 行き先が未定の旅行相談(docs/ux/G11_UIUX全範囲_実装仕様.md §2.5・§3.5、UIX-M15〜M19・M11)。
 *
 * 外部の提供元(地名の照会 Nominatim・近くの検索 OpenStreetMap・地図の画像)へは E2E からつながない。外部に頼る応答
 * (方面の位置・近くの検索・地図の画像)だけを page.route で差し替え、文章の読み取り・下書き・並び・旅程にする は本物の
 * backend を通す。地名の照会の決まり(1秒に1回・状態)は backend の試験(test_gate_g11_intake.py)で確かめる。
 *
 *   1. ダッシュボードの入口 → 希望を伝える(例文・出発地)→ 内容を確認(AI 未接続・未確認の行・問い)
 *   2. 方面を比較: 地図と一覧(3件+他)、未照会の表示、選ぶだけでは旅程にしない
 *   3. 方面の詳細: カテゴリで探し、選ぶ・外す、URL は出典、何も選ばない時の説明 → 下書き(本物)
 *   4. 下書き: 未確定・候補を置く・上下・読み上げ・元に戻す・全日程 → 日付を決めて旅程にする(本物)
 *   5. 360px・明暗で横にはみ出さず axe 違反 0
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);
const AT = '2026-10-29T00:00:00+00:00';
const geo = (lat: number | null, lng: number | null, label: string | null) => ({
  status: lat === null ? 'not_found' : 'ok', latitude: lat, longitude: lng, label, provider: 'nominatim',
  source_url: lat === null ? null : 'https://www.openstreetmap.org/relation/1', retrieved_at: AT,
});
const area = (name: string, lat: number | null, lng: number | null, km: number | null, limit = 'unknown') => ({
  name, source: 'user_input', geocode: geo(lat, lng, lat === null ? null : `${name}市`), straight_km: km,
  drive: { status: 'not_connected', note: '実走行時間・高速料金は道路の提供元が未接続のため未照会' },
  limit_check: { status: limit, note: limit === 'unknown' ? '運転時間は未照会のため、条件に合うかはまだ分かりません' : '直線距離だけでも超えます' },
  lodging: { status: 'not_connected', note: '' }, quietness: { status: 'unverified', note: '' },
  hours: { status: 'date_pending', note: '' },
});

async function stubExternal(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route('**/api/v1/trip-intents/areas', async (route) => {
    const body = route.request().postDataJSON() as { origin: string; areas: string[] };
    expect(body.origin).toBe('大阪府枚方市');
    expect(body.areas.slice(0, 3)).toEqual(['伊勢', '福井', '滋賀']); // 文章に書いた方面だけ(自動の提案は無い)
    const table: Record<string, ReturnType<typeof area>> = {
      伊勢: area('伊勢', 34.4875, 136.7091, 104.2), 福井: area('福井', 36.0641, 136.2196, 147.6),
      滋賀: area('滋賀', 35.0045, 135.8686, 28.6), 淡路島: area('淡路島', null, null, null),
    };
    await route.fulfill({ json: {
      origin: { query: '大阪府枚方市', ...geo(34.8146, 135.6507, '枚方市') }, retrieved_at: AT,
      providers: { geocode: 'nominatim', route: null, lodging: null, crowd: null, destination_suggestions: null },
      areas: body.areas.map((n) => table[n]),
    } });
  });
  await page.route('**/api/v1/search/spots', async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ category: 'quiet', latitude: 34.4875, longitude: 136.7091, radius_km: 10 });
    await route.fulfill({ json: { query: '', category: 'quiet', radius_km: 10, base: { latitude: 34.4875, longitude: 136.7091 },
      total: 1, candidates: [{ id: 'sc-e2e', provider: 'overpass', name: '倭姫宮の森', category: 'park',
        location: { latitude: 34.49, longitude: 136.71, address: null }, retrieved_at: AT, distance_m: 2300, within_radius: true,
        radius_guaranteed: true }] } });
  });
}

async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where}: 横にはみ出している`).toBeLessThanOrEqual(0);
}

test('旅行相談: 希望 → 確認 → 方面の比較 → 方面の詳細 → 下書き → 旅程にする', async ({ page }) => {
  test.setTimeout(240_000);
  const me = await registerMember(page, 'g11intake');
  const send = apiClient(page.context().request, me.apiBase, me.token);
  await stubExternal(page);

  // 1. 入口と、希望を伝える
  await page.goto('/dashboard');
  const start = page.getByTestId('dashboard-start');
  await expect(start.getByRole('link', { name: /行き先が決まっている/ })).toBeVisible({ timeout: 20_000 });
  await start.getByRole('link', { name: '✦ 条件から旅行先を相談' }).click();
  await expect(page).toHaveURL(/\/trip-consult$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('行き先が決まっていなくても、相談から始められます');
  await expect(page.getByRole('list', { name: '旅行相談の進み具合' }).locator('[aria-current="step"]')).toContainText('希望を伝える');
  await page.getByRole('button', { name: '例文を入れる' }).click();
  await page.getByLabel('出発地').fill('大阪府枚方市');
  await expect(page.getByTestId('brief-summary-出発地')).toHaveText('大阪府枚方市');
  await expect(page.getByText('まだ旅行も予約も作りません', { exact: false })).toBeVisible();
  await expectNoAxeViolations(page, '旅行相談: 希望を伝える');
  await page.getByTestId('consult-extract').click();

  // 2. 内容を確認(本物の読み取り)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('読み取った内容を確認してください');
  await expect(page.getByText(/AI の読み取りは未接続/)).toBeVisible();
  await expect(page.getByTestId('review-personal')).toBeVisible();
  await expect(page.getByTestId('review-row-origin')).toContainText(/あなたの入力/);
  await expect(page.getByTestId('review-row-party_size')).toContainText('文章から読み取り · 未確認');
  await expect(page.getByTestId('consult-compare')).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: '片道の時間が「希望」か「絶対条件」か' })).toBeVisible();
  await page.getByRole('radiogroup', { name: '片道の時間の扱い' }).getByRole('radio', { name: /希望/ }).click();
  await page.getByRole('radiogroup', { name: '宿泊費の範囲' }).getByRole('radio', { name: /全員の合計/ }).click();
  await page.getByTestId('review-confirm-party_size').check();
  await expect(page.getByRole('status').filter({ hasText: '片道の時間が' })).toHaveCount(0);
  await expectNoAxeViolations(page, '旅行相談: 内容を確認');
  await page.getByTestId('consult-compare').click();

  // 3. 方面を比較(位置は差し替え)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('候補の方面を、同じ条件で比べます');
  await expect(page.getByTestId('area-row-伊勢')).toContainText('大阪府枚方市から直線 104km(計算値 · 道路の距離ではない)');
  await expect(page.getByTestId('area-row-伊勢')).toContainText('実走行時間・高速料金は未照会');
  await expect(page.getByTestId('area-row-伊勢')).toContainText('料金・空室は未照会');
  await expect(page.getByRole('button', { name: /他の候補も見る/ })).toHaveCount(0); // 3件までは全部見える
  await page.getByLabel('比べる方面を足す').fill('淡路島');
  await page.getByRole('button', { name: '足して照会する' }).click();
  await expect(page.getByTestId('area-row-淡路島')).toContainText('位置が見つかりません');
  await page.getByRole('button', { name: '最初の3件だけ表示' }).click();
  await expect(page.getByTestId('area-row-淡路島')).toHaveCount(0);
  await page.getByRole('button', { name: /他の候補も見る\(\+1\)/ }).click();
  await expect(page.getByTestId('area-row-淡路島')).toBeVisible();
  await expect(page.getByTestId('areas-map').locator('.leaflet-marker-icon')).toHaveCount(4); // 出発地 + 位置のある3方面
  await page.getByTestId('area-row-福井').getByRole('button', { name: /福井/ }).first().click();
  await expect(page.getByTestId('area-row-福井')).toHaveAttribute('data-selected', 'true');
  await expectNoAxeViolations(page, '旅行相談: 方面を比較');
  await page.getByTestId('area-open-伊勢').click();

  // 4. 方面の詳細
  await expect(page.getByText('SELECTED AREA · 伊勢')).toBeVisible();
  await page.getByTestId('consult-create-draft').click();
  await expect(page.getByText(/行きたい場所がまだ選ばれていません/)).toBeVisible();
  await page.getByTestId('consult-category-quiet').click();
  await page.getByTestId('consult-search').click();
  await expect(page.getByTestId('consult-result-sc-e2e')).toContainText('出典: OpenStreetMap');
  await page.getByTestId('consult-pick-sc-e2e').click();
  await expect(page.getByTestId('consult-check-0')).toContainText('1件 選択');
  await expect(page.getByTestId('consult-check-1')).toContainText('未照会');
  // 差し替えた検索結果は backend に無いため外し、場所なしで下書きを作る(本人の検索結果だけを使う決まりは backend の試験)
  await page.getByTestId('consult-pick-sc-e2e').click();
  await page.getByLabel('見つけた記事・SNS の投稿を参考に足す').fill('https://example.com/ise-trip?utm_source=sns');
  await page.getByRole('button', { name: '出典として足す' }).click();
  await expectNoAxeViolations(page, '旅行相談: 方面の詳細');
  await page.getByTestId('consult-create-draft').click();

  // 5. 下書き(本物)
  await expect(page).toHaveURL(/\/planner\/[^/]+\/draft$/, { timeout: 20_000 });
  const planId = page.url().split('/planner/')[1]!.split('/')[0]!;
  await expect(page.getByTestId('draft-banner')).toContainText('旅程ドラフト · まだ確定していません');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('伊勢・1泊2日の旅程案');
  await expect(page.getByText('https://example.com/ise-trip')).toBeVisible();
  await expect(page.getByTestId('draft-validation')).toContainText('未照会(道路の提供元が未接続)');
  for (const [title, lng] of [['伊勢神宮 内宮', 136.725], ['おかげ横丁', 136.722]] as const) {
    await send('post', `/plans/${planId}/candidates`, { title, latitude: 34.455, longitude: lng });
  }
  await page.reload();
  await page.getByRole('button', { name: '＋ 伊勢神宮 内宮 を1日目の午後へ' }).click();
  await expect(page.getByTestId('draft-slot-伊勢神宮 内宮')).toBeVisible();
  await page.getByRole('button', { name: '＋ おかげ横丁 を1日目の午後へ' }).click();
  await expect(page.getByTestId('draft-segment')).toContainText('経路・所要時間は未照会');
  const live = page.getByTestId('draft-live');
  await page.getByRole('button', { name: 'おかげ横丁を上へ' }).click();
  await expect(live).toHaveText('おかげ横丁を上へ移しました。移動時間と営業時間は未照会のままです');
  await expect(page.getByTestId(/draft-slot-/).first()).toContainText('おかげ横丁');
  await page.getByTestId('draft-undo').click();
  await expect(live).toHaveText('前の並びに戻しました');
  await expect(page.getByTestId(/draft-slot-/).first()).toContainText('伊勢神宮 内宮');
  const box = await page.getByRole('button', { name: 'おかげ横丁を上へ' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('tab', { name: '全日程を横断で見る' }).click();
  await expect(page.getByTestId('draft-all-days')).toContainText('午後: 伊勢神宮 内宮、おかげ横丁');
  await page.getByRole('tab', { name: /1日目/ }).click();
  await expectNoAxeViolations(page, '旅程の下書き');

  // 6. 日付を決めて旅程にする(本物)
  await page.getByLabel('初日').fill('2026-11-28');
  await page.getByTestId('draft-commit').click();
  await expect(page).toHaveURL(new RegExp(`/planner/${planId}$`), { timeout: 20_000 });
  const detail = await send('get', `/plans/${planId}`) as { days: Array<{ local_date: string; timezone_id: string;
    events: Array<{ title: string }> }> };
  expect(detail.days.map((d) => d.local_date)).toEqual(['2026-11-28', '2026-11-29']);
  expect(detail.days[0]!.timezone_id).toBe('Asia/Tokyo');
  expect(detail.days[0]!.events.map((e) => e.title)).toEqual(['伊勢神宮 内宮', 'おかげ横丁']);
  await expect(page.getByText('伊勢神宮 内宮').first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/planner/${planId}/draft`);
  await expect(page.getByTestId('draft-banner')).toContainText('旅程にしました');
  await expect(page.getByTestId('draft-commit')).toHaveCount(0);
});

test('旅行相談と下書き: 360px・明暗で横にはみ出さず axe 違反 0', async ({ page }) => {
  test.setTimeout(240_000);
  await registerMember(page, 'g11intake360');
  await stubExternal(page);
  await page.setViewportSize({ width: 360, height: 780 });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => { window.localStorage.setItem('tc.theme', t); window.sessionStorage.clear(); }, theme);
    await page.goto('/trip-consult');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectNoOverflow(page, `希望を伝える(${theme})`);
    await expectNoAxeViolations(page, `希望を伝える(360px・${theme})`);
    await page.getByRole('button', { name: '例文を入れる' }).click();
    await page.getByLabel('出発地').fill('大阪府枚方市');
    await page.getByTestId('consult-extract').click();
    await expect(page.getByTestId('review-row-origin')).toBeVisible();
    await expectNoOverflow(page, `内容を確認(${theme})`);
    await expectNoAxeViolations(page, `内容を確認(360px・${theme})`);
    await page.getByRole('radiogroup', { name: '片道の時間の扱い' }).getByRole('radio', { name: /絶対条件/ }).click();
    await page.getByRole('radiogroup', { name: '宿泊費の範囲' }).getByRole('radio', { name: /1人あたり/ }).click();
    await page.getByTestId('consult-compare').click();
    await expect(page.getByTestId('area-row-伊勢')).toBeVisible();
    await expectNoOverflow(page, `方面を比較(${theme})`);
    await expectNoAxeViolations(page, `方面を比較(360px・${theme})`);
    await page.getByTestId('area-open-伊勢').click();
    await expect(page.getByText('SELECTED AREA · 伊勢')).toBeVisible();
    await expectNoOverflow(page, `方面の詳細(${theme})`);
    await expectNoAxeViolations(page, `方面の詳細(360px・${theme})`);
    await page.getByTestId('consult-create-draft').click();
    await page.getByTestId('consult-create-draft').click();
    await expect(page.getByTestId('draft-banner')).toContainText('まだ確定していません', { timeout: 20_000 });
    await expectNoOverflow(page, `旅程の下書き(${theme})`);
    await expectNoAxeViolations(page, `旅程の下書き(360px・${theme})`);
  }
  await page.evaluate(() => window.localStorage.removeItem('tc.theme'));
});
